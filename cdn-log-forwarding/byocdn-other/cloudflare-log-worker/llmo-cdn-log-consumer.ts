import { AwsClient } from "aws4fetch";

type LlmoCdnLogEvent = {
  timestamp: string;
  host: string;
  url: string;
  request_method: string;
  request_user_agent: string;
  request_referer: string;
  response_status: number;
  response_content_type: string;
  time_to_first_byte: number;
};

interface LlmoCdnLogConsumerEnv {
  LLMO_CDN_LOG_AWS_ACCESS_KEY: string;
  LLMO_CDN_LOG_AWS_SECRET_KEY: string;
  LLMO_CDN_LOG_AWS_REGION: string;
  LLMO_CDN_LOG_S3_BUCKET: string;
  LLMO_CDN_LOG_S3_PATH_PREFIX: string;
}

function isLlmoCdnLogEvent(value: unknown): value is LlmoCdnLogEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const event = value as Record<string, unknown>;

  return (
    typeof event.timestamp === "string" &&
    typeof event.host === "string" &&
    typeof event.url === "string" &&
    typeof event.request_method === "string" &&
    typeof event.request_user_agent === "string" &&
    typeof event.request_referer === "string" &&
    typeof event.response_status === "number" &&
    typeof event.response_content_type === "string" &&
    typeof event.time_to_first_byte === "number"
  );
}

function getUtcDateParts(timestamp: string): { year: string; month: string; day: string } {
  const date = new Date(timestamp);

  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1).padStart(2, "0"),
    day: String(date.getUTCDate()).padStart(2, "0"),
  };
}

function normalizeS3PathPrefix(pathPrefix: string): string {
  return pathPrefix
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/<year>\/<month>\/<day>$/i, "");
}

function buildS3Key(pathPrefix: string, timestamp: string): string {
  const { year, month, day } = getUtcDateParts(timestamp);
  const normalizedPrefix = normalizeS3PathPrefix(pathPrefix);

  return `${normalizedPrefix}/${year}/${month}/${day}/${Date.now()}-${crypto.randomUUID()}.jsonl`;
}

type ValidQueueMessage = Message<LlmoCdnLogEvent>;

function getUtcDayKey(timestamp: string): string {
  const { year, month, day } = getUtcDateParts(timestamp);
  return `${year}-${month}-${day}`;
}

function groupMessagesByUtcDay(messages: ValidQueueMessage[]): Map<string, ValidQueueMessage[]> {
  const groupedMessages = new Map<string, ValidQueueMessage[]>();

  for (const message of messages) {
    const dayKey = getUtcDayKey(message.body.timestamp);
    const existingMessages = groupedMessages.get(dayKey) ?? [];
    existingMessages.push(message);
    groupedMessages.set(dayKey, existingMessages);
  }

  return groupedMessages;
}

export default {
  async queue(batch: MessageBatch<unknown>, env: LlmoCdnLogConsumerEnv): Promise<void> {
    if (batch.messages.length === 0) {
      return;
    }

    const awsClient = new AwsClient({
      accessKeyId: env.LLMO_CDN_LOG_AWS_ACCESS_KEY,
      secretAccessKey: env.LLMO_CDN_LOG_AWS_SECRET_KEY,
    });

    const validMessages: ValidQueueMessage[] = [];

    for (const message of batch.messages) {
      if (!isLlmoCdnLogEvent(message.body)) {
        console.error("Queue message body does not match the expected LLMO CDN log schema.", {
          messageId: message.id,
        });
        message.ack();
        continue;
      }

      validMessages.push(message as ValidQueueMessage);
    }

    if (validMessages.length === 0) {
      return;
    }

    const groupedMessages = groupMessagesByUtcDay(validMessages);

    for (const dayMessages of groupedMessages.values()) {
      const dayEvents = dayMessages.map((message) => message.body);
      const body = dayEvents.map((event) => JSON.stringify(event)).join("\n") + "\n";
      const key = buildS3Key(env.LLMO_CDN_LOG_S3_PATH_PREFIX, dayEvents[0].timestamp);
      const s3Url = `https://${env.LLMO_CDN_LOG_S3_BUCKET}.s3.${env.LLMO_CDN_LOG_AWS_REGION}.amazonaws.com/${key}`;

      const response = await awsClient.fetch(s3Url, {
        method: "PUT",
        headers: {
          "content-type": "application/x-ndjson",
        },
        body,
        aws: {
          service: "s3",
          region: env.LLMO_CDN_LOG_AWS_REGION,
        },
      });

      if (response.ok) {
        for (const message of dayMessages) {
          message.ack();
        }

        continue;
      }

      console.error("S3 upload failed for queue day group.", {
        status: response.status,
        dayKey: getUtcDayKey(dayEvents[0].timestamp),
        responseText: await response.text(),
      });

      for (const message of dayMessages) {
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<LlmoCdnLogConsumerEnv>;

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

function toIso8601UtcSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const requestStartedAt = performance.now();
    const requestTimestamp = toIso8601UtcSeconds(new Date());
    const url = new URL(request.url);

    const response = await fetch(request);

    const logEvent: LlmoCdnLogEvent = {
      timestamp: requestTimestamp,
      host: url.hostname,
      url: `${url.pathname}${url.search}`,
      request_method: request.method.toUpperCase(),
      request_user_agent: request.headers.get("user-agent") ?? "",
      request_referer: request.headers.get("referer") ?? "",
      response_status: response.status,
      response_content_type: response.headers.get("content-type") ?? "",
      time_to_first_byte: Math.max(0, Math.round(performance.now() - requestStartedAt)),
    };

    ctx.waitUntil(env.LLMO_CDN_LOG_QUEUE.send(logEvent));

    return response;
  },
} satisfies ExportedHandler<Env>;

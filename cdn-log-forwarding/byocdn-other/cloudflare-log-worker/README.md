# Cloudflare Worker Log Forwarding for Adobe LLM Optimizer

This example shows how to forward Cloudflare request logs to Adobe LLM Optimizer using:

- a request Worker
- a Cloudflare Queue
- a queue consumer Worker
- an S3 bucket and S3 path prefix provided by Adobe LLM Optimizer

This pattern is intended for customers on Cloudflare non-Enterprise plans who do not have access to Logpush.

## Architecture

The flow is:

1. `llmo-cdn-log-producer` runs on the site traffic you want to log.
2. The producer captures the required fields from the request and response.
3. The producer sends one log event to `llmo-cdn-log-queue`.
4. `llmo-cdn-log-consumer` consumes queue batches.
5. The consumer uploads newline-delimited JSON log files to the Adobe-provided S3 location.

## Adobe Schema Requirements

Adobe LLM Optimizer expects one JSON object per line with these exact fields:

- `timestamp`
- `host`
- `url`
- `request_method`
- `request_user_agent`
- `request_referer`
- `response_status`
- `response_content_type`
- `time_to_first_byte`

Reference:

- [Adobe LLM Optimizer: Log Forwarding - Other](https://experienceleague.adobe.com/en/docs/llm-optimizer/using/log-forwarding/other)

## Install Dependencies

Install the project dependencies:

```bash
npm install
```

## Authenticate Wrangler

Wrangler must be authenticated before it can create Cloudflare resources or deploy Workers.

```bash
npx wrangler login
```

## Create The Queue

Create the queue used by both Workers:

```bash
npx wrangler queues create llmo-cdn-log-queue
```

## Deploy The Consumer

Deploy the consumer Worker first so the remote Worker exists before you add secrets:

```bash
npx wrangler deploy --config wrangler.consumer.jsonc
```

## Add Consumer Secrets

The consumer uploads logs to the Adobe-provided S3 destination, so add the Adobe credentials and S3 location as Worker secrets.

Get the values from Adobe LLM Optimizer:

1. Go to `Customer Configuration`
2. Open `CDN Configuration`
3. Open `AI Traffic Insights`
4. Choose the `Other` integration
5. Copy the bucket name, bucket path, access key, and secret key

For example, the bucket path shown in the UI looks like:

```text
ABCDEF1234567890ABCDEF12AdobeOrg/raw/byocdn-other/<year>/<month>/<day>
```

Set `LLMO_CDN_LOG_S3_PATH_PREFIX` to the bucket path shown in the UI. This sample handles the date folders automatically when it uploads logs.

Set the secrets on the consumer Worker by running each command below and pasting the value when Wrangler prompts you:

```bash
npx wrangler secret put LLMO_CDN_LOG_AWS_ACCESS_KEY --config wrangler.consumer.jsonc
npx wrangler secret put LLMO_CDN_LOG_AWS_SECRET_KEY --config wrangler.consumer.jsonc
npx wrangler secret put LLMO_CDN_LOG_AWS_REGION --config wrangler.consumer.jsonc
npx wrangler secret put LLMO_CDN_LOG_S3_BUCKET --config wrangler.consumer.jsonc
npx wrangler secret put LLMO_CDN_LOG_S3_PATH_PREFIX --config wrangler.consumer.jsonc
```

## Deploy The Producer

Before deploying the producer, update the `routes` section in [wrangler.producer.jsonc](/Users/constantinpopa/code/llmo-code-samples/cdn-log-forwarding/byocdn-other/cloudflare-log-worker/wrangler.producer.jsonc):

- replace `www.example.com/*` with the hostname or path you want to log
- replace `example.com` with your Cloudflare zone name

Then deploy the producer Worker:

```bash
npx wrangler deploy --config wrangler.producer.jsonc
```

## Validate The Setup

After everything has been deployed, browse the site normally and then check the status icon in the LLM Optimizer UI to confirm that logs are being received successfully.

## Cleanup

To remove the sample resources and start over:

```bash
npx wrangler queues consumer remove llmo-cdn-log-queue llmo-cdn-log-consumer
npx wrangler delete llmo-cdn-log-producer
npx wrangler delete llmo-cdn-log-consumer
npx wrangler queues delete llmo-cdn-log-queue
```

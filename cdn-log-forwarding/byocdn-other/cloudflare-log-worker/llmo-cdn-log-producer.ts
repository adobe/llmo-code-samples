/*
Copyright 2026 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

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

const ALLOWED_QUERY_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "gclid",
  "gclsrc",
  "wbraid",
  "gbraid",
  "dclid",
  "msclkid",
  "fbclid",
  "fbad_id",
  "fbpxl_id",
  "twclid",
  "twsrc",
  "twterm",
  "li_fat_id",
  "epik",
  "ttclid",
]);

function toIso8601UtcSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function buildSanitizedUrlPath(url: URL): string {
  const filteredSearchParams = new URLSearchParams();

  for (const [key, value] of url.searchParams) {
    if (ALLOWED_QUERY_PARAMS.has(key.toLowerCase())) {
      filteredSearchParams.append(key.toLowerCase(), value);
    }
  }

  const filteredSearch = filteredSearchParams.toString();
  return filteredSearch ? `${url.pathname}?${filteredSearch}` : url.pathname;
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
      url: buildSanitizedUrlPath(url),
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

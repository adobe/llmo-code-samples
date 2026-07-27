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
/**
 * Edge Optimize BYOCDN - Vercel Edge Route Handler
 *
 * Catch-all edge route that proxies agentic requests to the Edge Optimize
 * backend (live.edgeoptimize.net). If Edge Optimize returns an error or is
 * unreachable, the request automatically fails over to the default origin.
 *
 * Route: /adobe-edgeoptimize/* → https://live.edgeoptimize.net/*
 *
 * Environment variables:
 *   EDGE_OPTIMIZE_ORIGIN            - Edge Optimize backend URL (default: https://live.edgeoptimize.net)
 *   EDGE_OPTIMIZE_API_KEY           - Your Adobe-provided API key
 *   EDGE_OPTIMIZE_X_FORWARDED_HOST  - Your site's hostname forwarded to Edge Optimize
 */

export const runtime = 'edge';

/**
 * Build headers to forward to the Edge Optimize origin.
 * @param {Request} request
 * @returns {Headers}
 */
function buildEdgeOptimizeHeaders(request) {
  const headers = new Headers(request.headers);

  // x-forwarded-host: identifies the original site domain for Edge Optimize
  headers.set('x-forwarded-host', process.env.EDGE_OPTIMIZE_X_FORWARDED_HOST || '');
  // x-edgeoptimize-api-key: your Adobe-provided API key
  headers.set('x-edgeoptimize-api-key', process.env.EDGE_OPTIMIZE_API_KEY || '');

  return headers;
}

/**
 * Main handler — supports all HTTP methods.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handler(request) {
  const edgeOptimizeOrigin = process.env.EDGE_OPTIMIZE_ORIGIN || 'https://live.edgeoptimize.net';
  const url = new URL(request.url);

  // x-edgeoptimize-url is set by middleware.js and contains the original path + query
  const originalPath = request.headers.get('x-edgeoptimize-url') || `${url.pathname}${url.search}`;
  const targetUrl = `${edgeOptimizeOrigin}${originalPath}`;

  let response;
  let shouldFallback = false;

  try {
    console.log(`[Edge Optimize] ${request.method} ${targetUrl}`);

    response = await fetch(targetUrl, {
      method: request.method,
      headers: buildEdgeOptimizeHeaders(request),
      body: request.body,
      redirect: 'manual',
    });

    console.log(`[Edge Optimize] Returned ${response.status}`);

    if (response.status >= 400) {
      shouldFallback = true;
    }
  } catch (error) {
    console.error(`[Edge Optimize] Network error: ${error.message}`);
    shouldFallback = true;
  }

  // Failover: fetch from the default Vercel origin
  if (shouldFallback) {
    try {
      const fallbackUrl = `${url.protocol}//${url.host}${originalPath}`;
      console.log(`[Edge Optimize] Failing over to origin: ${fallbackUrl}`);

      const fallbackHeaders = new Headers(request.headers);
      // Strip Edge Optimize-specific headers before calling the origin
      fallbackHeaders.delete('x-edgeoptimize-api-key');
      fallbackHeaders.delete('x-edgeoptimize-url');
      fallbackHeaders.delete('x-edgeoptimize-config');
      fallbackHeaders.delete('x-forwarded-host');
      // Mark as a failover request so middleware does not re-route it
      fallbackHeaders.set('x-edgeoptimize-request', 'fo');

      const fallbackResponse = await fetch(fallbackUrl, {
        method: request.method,
        headers: fallbackHeaders,
        body: request.body,
        redirect: 'manual',
      });

      const fallbackRespHeaders = new Headers(fallbackResponse.headers);
      fallbackRespHeaders.set('x-edgeoptimize-fo', '1');
      fallbackRespHeaders.set('cache-control', 'no-store');

      return new Response(fallbackResponse.body, {
        status: fallbackResponse.status,
        statusText: fallbackResponse.statusText,
        headers: fallbackRespHeaders,
      });
    } catch (fallbackError) {
      console.error(`[Edge Optimize] Fallback also failed: ${fallbackError.message}`);
      return new Response('Service unavailable', {
        status: 503,
        headers: {
          'x-served-by': 'error',
          'x-error': 'fallback-failed',
        },
      });
    }
  }

  // Success path — transform Cache-Control to enable Vercel CDN edge caching.
  // Vercel's CDN respects s-maxage for shared caching; if the origin only
  // returns max-age, mirror it as s-maxage so edge nodes cache the response.
  const respHeaders = new Headers(response.headers);
  const cacheControl = respHeaders.get('cache-control');

  if (cacheControl) {
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    if (maxAgeMatch && !cacheControl.includes('s-maxage=')) {
      respHeaders.set('cache-control', `${cacheControl}, s-maxage=${maxAgeMatch[1]}`);
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: respHeaders,
  });
}

// Export handler for all HTTP methods
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;

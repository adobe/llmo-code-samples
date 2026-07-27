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
 * Edge Optimize BYOCDN - Vercel Edge Middleware
 *
 * Detects agentic bot traffic (AI/LLM user agents) and rewrites matching
 * requests to the Edge Optimize proxy route. All other traffic is served
 * normally from the Next.js origin.
 *
 * Works with both App Router (app/) and Pages Router (pages/).
 * Set PROXY_PATH_PREFIX below to match your router.
 *
 * Features:
 * - Detects agentic bots by User-Agent
 * - Rewrites agentic requests to the Edge Optimize proxy route
 * - Loop protection via x-edgeoptimize-request header
 * - Configurable targeted paths (all HTML pages by default)
 */

import { NextResponse } from 'next/server';

// ─── Configuration ────────────────────────────────────────────────────────────

// List of agentic bot user agents to route to Edge Optimize
const AGENTIC_BOTS = [
  'AdobeEdgeOptimize-AI',
  'ChatGPT-User',
  'GPTBot',
  'OAI-SearchBot',
  'PerplexityBot',
  'Perplexity-User'
];

// Targeted paths for Edge Optimize routing
// Set to null to route all HTML pages, or specify an array of paths
const TARGETED_PATHS = null; // e.g., ['/', '/page.html', '/products']

// Proxy route prefix — must match where the proxy file lives in your project:
//   App Router  (app/ directory):   '/adobe-edgeoptimize'
//   Pages Router (pages/ directory): '/api/adobe-edgeoptimize'
const PROXY_PATH_PREFIX = '/adobe-edgeoptimize'; // change to '/api/adobe-edgeoptimize' for Pages Router

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detects whether the incoming request should be routed to Edge Optimize.
 * @param {Request} request
 * @returns {boolean}
 */
function isAgenticRequest(request) {
  const { pathname } = new URL(request.url);

  // Loop protection: skip if this request was already processed
  const isEdgeOptimizeRequest = request.headers.get('x-edgeoptimize-request');

  // Check User-Agent for agentic bots
  const userAgent = (request.headers.get('user-agent') || '').toLowerCase();
  const isAgenticBot = AGENTIC_BOTS.some(agent =>
    userAgent.includes(agent.toLowerCase())
  );

  // Match HTML pages: paths ending with /, a path segment, or .html
  // Exclude /api/* paths to avoid routing API calls through Edge Optimize
  const isHtmlPage = /(?:\/[^./]+|\.html|\/)$/.test(pathname) && !pathname.startsWith('/api/');

  // If TARGETED_PATHS is null, all HTML pages are targeted.
  // Otherwise, only pages whose path is in the array are targeted.
  const isTargetedPath = TARGETED_PATHS === null
    ? isHtmlPage
    : (isHtmlPage && TARGETED_PATHS.includes(pathname));

  return !isEdgeOptimizeRequest && isAgenticBot && isTargetedPath;
}

/**
 * Vercel Edge Middleware entry point.
 */
export function middleware(request) {
  try {
    const url = new URL(request.url);
    const { pathname, search } = url;

    // Sanitize inbound headers — strip any pre-set Edge Optimize headers
    const headers = new Headers(request.headers);
    headers.delete('x-edgeoptimize-api-key');
    headers.delete('x-edgeoptimize-url');
    headers.delete('x-edgeoptimize-config');
    headers.delete('x-forwarded-host');

    if (isAgenticRequest(request)) {
      // Rewrite to the Edge Optimize proxy route
      const proxyPath = `${PROXY_PATH_PREFIX}${pathname}${search}`;
      const proxyUrl = new URL(proxyPath, url.origin);

      // Pass the original path to the proxy route via header
      headers.set('x-edgeoptimize-url', `${pathname}${search}`);
      // Signal to Edge Optimize that this is an LLM client request
      headers.set('x-edgeoptimize-config', 'LLMCLIENT=TRUE;');

      return NextResponse.rewrite(proxyUrl, { request: { headers } });
    }

    // Non-agentic traffic — serve normally
    return NextResponse.next();
  } catch (err) {
    // On any unexpected error, fall through to normal serving
    return NextResponse.next();
  }
}

/**
 * Run this middleware on all routes.
 * The agentic detection logic inside decides which requests are eligible.
 */
export const config = {
  matcher: ['/(.*)',],
};

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
import cf from 'cloudfront';
 
/**
 * CloudFront Viewer Request Function: Edge Optimize Routing
 *
 * This function intercepts incoming viewer requests and determines
 * whether they originate from agentic bots (e.g., ChatGPT, GPTBot).
 * If so, it routes the request to the Edge Optimize origin with
 * automatic failover to the default origin.
 *
 * Non-agentic (regular user) requests pass through unchanged.
 */
function handler(event) {
    var request = event.request;
    var headers = request.headers;
 
    // ---------------------------------------------------------------
    // Security: Strip any Edge Optimize headers that may have been
    // injected by the client. These headers should only be set by
    // this function or the origin, never by the end user.
    // ---------------------------------------------------------------
    delete headers['x-edgeoptimize-api-key'];
    delete headers['x-edgeoptimize-url'];
    delete headers['x-edgeoptimize-config'];
 
    // ---------------------------------------------------------------
    // Configuration: Define which bots are considered "agentic"
    // and which paths should be routed to Edge Optimize.
    //
    // AGENTIC_BOTS: List of known AI bot user-agent strings.
    //   Add or remove entries as needed.
    //
    // TARGETED_PATHS: Controls which paths are eligible for routing.
    //   - Set to `null` to target ALL HTML pages.
    //   - Set to an array of specific paths to limit routing,
    //     e.g., ['/', '/products', '/about']
    // ---------------------------------------------------------------
    var AGENTIC_BOTS = ['AdobeEdgeOptimize-AI', 'ChatGPT-User', 'GPTBot', 'OAI-SearchBot', 'PerplexityBot', 'Perplexity-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot'];
    var TARGETED_PATHS = null;

    // Multi-domain (optional): map each onboarded host (lowercase) to its
    // CloudFront origin IDs. Use when ONE function is shared across distributions.
    //   - null   => single domain: route every host using DEFAULT_*_ORIGIN_ID below.
    //   - object => only the hosts listed as keys route to Edge Optimize; each
    //               maps to that domain's { edgeOptimizeOriginId, defaultOriginId }.
    //               All other hosts pass through unchanged.
    // Example (multi-distribution):
    //   var ADOBE_EO_ONBOARDED_HOSTS = {
    //     'www.domain-a.com': { edgeOptimizeOriginId: 'EdgeOptimize_Origin_A', defaultOriginId: 'Default_Origin_A' },
    //     'www.domain-b.com': { edgeOptimizeOriginId: 'EdgeOptimize_Origin_B', defaultOriginId: 'Default_Origin_B' }
    //   };
    var ADOBE_EO_ONBOARDED_HOSTS = null;

    // Origin IDs for the single-domain case (ADOBE_EO_ONBOARDED_HOSTS = null).
    // These must match the origin IDs configured on this distribution.
    var DEFAULT_EDGE_OPTIMIZE_ORIGIN_ID = 'EdgeOptimize_Origin';
    var DEFAULT_ORIGIN_ID = 'YOUR_DEFAULT_ORIGIN';
 
    // ---------------------------------------------------------------
    // Extract the User-Agent header (lowercase for case-insensitive matching)
    // ---------------------------------------------------------------
    var userAgent = headers['user-agent'] ? headers['user-agent'].value.toLowerCase() : '';
 
    // Check if this request was already processed by Edge Optimize
    // (prevents re-routing on sub-requests or redirects)
    var isEdgeOptimizeRequest = headers['x-edgeoptimize-request'];
 
    // ---------------------------------------------------------------
    // Path matching: Only route requests for HTML pages.
    // This regex matches URLs ending in:
    //   - `/`           (directory index)
    //   - `.html`       (explicit HTML files)
    //   - `/some-path`  (extensionless paths, assumed to be pages)
    // It excludes static assets like .css, .js, .png, .jpg, etc.
    // ---------------------------------------------------------------
    var path = request.uri;
    var pattern = /(?:\/[^./]+|\.html|\/)$/;
    var isHtmlPage = pattern.test(path);
 
    // If TARGETED_PATHS is null, all HTML pages are targeted.
    // Otherwise, only pages whose path is in the array are targeted.
    var isTargetedPath = TARGETED_PATHS === null
        ? isHtmlPage
        : isHtmlPage && TARGETED_PATHS.includes(path);
 
    // ---------------------------------------------------------------
    // Bot detection: Check if the User-Agent matches any known
    // agentic bot (case-insensitive comparison)
    // ---------------------------------------------------------------
    var isAgenticBot = AGENTIC_BOTS.some(function(bot) {
        return userAgent.includes(bot.toLowerCase());
    });

    // Multi-domain host gate + per-host origin selection (see ADOBE_EO_ONBOARDED_HOSTS above).
    // hostConfig is null when the host isn't onboarded, leaving isOnboardedHost false.
    var host = headers['host'] ? headers['host'].value.toLowerCase() : '';
    var hostConfig = (ADOBE_EO_ONBOARDED_HOSTS != null
        && Object.prototype.hasOwnProperty.call(ADOBE_EO_ONBOARDED_HOSTS, host))
        ? ADOBE_EO_ONBOARDED_HOSTS[host]
        : null;
    var isOnboardedHost = ADOBE_EO_ONBOARDED_HOSTS == null || hostConfig != null;
    // Fall back to the defaults if a host entry omits either origin ID,
    // so a partial config never passes an undefined originId to CloudFront.
    var edgeOptimizeOriginId = (hostConfig && hostConfig.edgeOptimizeOriginId) || DEFAULT_EDGE_OPTIMIZE_ORIGIN_ID;
    var defaultOriginId = (hostConfig && hostConfig.defaultOriginId) || DEFAULT_ORIGIN_ID;
 
    // ---------------------------------------------------------------
    // Routing decision:
    // If the request is from an agentic bot, targets an HTML page,
    // and has not already been processed by Edge Optimize, then:
    //   1. Set x-edgeoptimize-url header with the original request URI
    //   2. Set x-edgeoptimize-config header to enable LLM client mode
    //   3. Create an origin group that tries Edge Optimize first,
    //      with automatic failover to the default origin on errors
    // ---------------------------------------------------------------
    if (!isEdgeOptimizeRequest && isAgenticBot && isTargetedPath && isOnboardedHost) {
        // Pass the original URI to Edge Optimize so it knows which page to optimize
        request.headers['x-edgeoptimize-url'] = { value: request.uri };
 
        // Enable LLM client optimization mode
        request.headers['x-edgeoptimize-config'] = { value: "LLMCLIENT=TRUE;" };
 
        console.log("Adding origin group for userAgent: " + userAgent);
 
        // Create an origin group: try this host's Edge Optimize origin first,
        // and fall back to its default origin if Edge Optimize returns any of
        // the listed error status codes. The origin IDs are resolved per host
        // from ADOBE_EO_ONBOARDED_HOSTS (or DEFAULT_*_ORIGIN_ID for a single domain).
        cf.createRequestOriginGroup({
            "originIds": [
                { "originId": edgeOptimizeOriginId },
                { "originId": defaultOriginId }
            ],
            "failoverCriteria": {
                "statusCodes": [400, 403, 404, 416, 500, 502, 503, 504]
            }
        });
 
        console.log("Routing to Edge Optimize origin for userAgent: " + userAgent);
        return request;
    }
 
    // ---------------------------------------------------------------
    // Default: Non-agentic requests (or non-targeted paths) pass
    // through to the default origin with no modifications.
    // ---------------------------------------------------------------
    console.log("Routing to Default origin for userAgent: " + userAgent);
    return request;
}

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
 * Helper: Check if a header exists and has a non-empty value.
 *
 * Lambda@Edge headers are stored as arrays of objects: { key, value }.
 * This function checks that the header array exists, has at least one entry,
 * and that the first entry's value is not blank.
 *
 * @param {Object} map - The headers object (request.headers or response.headers)
 * @param {string} name - The header name to check (case-sensitive, should be lowercase)
 * @returns {boolean} True if the header exists with a non-empty value
 */
function hasHeader(map, name) {
  const h = map?.[name];
  return Array.isArray(h) && h.length > 0 && (h[0].value || '').trim() !== '';
}
 
/**
 * Helper: Set (or overwrite) a header in the Lambda@Edge headers format.
 *
 * Lambda@Edge expects headers as: { 'header-name': [{ key: 'Header-Name', value: 'val' }] }
 * The key in the outer object must be lowercase; the inner `key` preserves original casing.
 *
 * @param {Object} map - The headers object to modify
 * @param {string} name - The header name
 * @param {*} value - The header value (will be converted to string)
 */
function setHeader(map, name, value) {
  if (map) {
    map[name.toLowerCase()] = [{ key: name, value: String(value) }];
  }
}
 
/**
 * Lambda@Edge handler for Origin Request and Origin Response events.
 *
 * This single function handles two CloudFront event types:
 *
 * 1. ORIGIN REQUEST (before CloudFront contacts the origin):
 *    - If the request has the x-edgeoptimize-config header (set by the viewer
 *      request function for agentic bots) and is heading to Edge Optimize
 *      (live.edgeoptimize.net), it sets the correct `host` header so the
 *      origin can process the request.
 *    - If CloudFront triggered a failover (request went to default origin
 *      instead of Edge Optimize), it marks the request with
 *      x-edgeoptimize-request: fo to indicate failover occurred.
 *
 * 2. ORIGIN RESPONSE (after receiving a response from the origin):
 *    - If the response does NOT contain x-edgeoptimize-request-id, it means
 *      Edge Optimize did not process it (failover occurred).
 *    - In that case, it sets cache-control: no-store to prevent CloudFront
 *      from caching the failover response, and marks it with
 *      x-edgeoptimize-fo: 1 for debugging.
 */
export const handler = async (event) => {
  const request = event?.Records?.[0]?.cf?.request;
  const response = event?.Records?.[0]?.cf?.response;
  const eventType = event.Records[0].cf.config.eventType;
  const reqHeaders = request.headers || {};
 
  // ---------------------------------------------------------------
  // ORIGIN REQUEST: Runs before CloudFront sends the request to the origin.
  // ---------------------------------------------------------------
  if (eventType === 'origin-request') {
    // Get the domain of the origin CloudFront is about to contact
    const originDomain = request.origin?.custom?.domainName;
 
    // Check if this is an agentic request (has x-edgeoptimize-config)
    // and has not already been marked as processed
    const isEdgeOptimizeConfig = hasHeader(reqHeaders, 'x-edgeoptimize-config');
    const isEdgeOptimizeRequest = hasHeader(reqHeaders, 'x-edgeoptimize-request');
 
    if (isEdgeOptimizeConfig && !isEdgeOptimizeRequest) {
      if (originDomain === 'live.edgeoptimize.net') {
        // Primary path: Request is going to Edge Optimize origin.
        // Set the host header to match the origin domain so TLS/SNI works correctly.
        console.log("Calling Edge Optimize Origin for agentic requests");
        setHeader(request.headers, 'host', originDomain);
      } else {
        // Failover path: Edge Optimize returned an error, so CloudFront
        // is now trying the default origin. Mark the request so we know
        // failover occurred (used by origin-response to prevent caching).
        console.log("Calling Default Origin in case of failover for agentic requests");
        setHeader(request.headers, 'x-edgeoptimize-request', 'fo');
      }
    }
 
    return request;
 
  // ---------------------------------------------------------------
  // ORIGIN RESPONSE: Runs after CloudFront receives the response from the origin.
  // ---------------------------------------------------------------
  } else if (eventType === 'origin-response') {
    const resHeaders = response.headers || {};
 
    // Check if this was an agentic request (has x-edgeoptimize-config)
    const isEdgeOptimizeConfig = hasHeader(reqHeaders, 'x-edgeoptimize-config');
 
    // Check if Edge Optimize actually processed the request.
    // If x-edgeoptimize-request-id is present, Edge Optimize handled it.
    // If absent, it means failover occurred and the default origin responded.
    const isEdgeOptimizeRequestId = hasHeader(resHeaders, 'x-edgeoptimize-request-id');
 
    if (isEdgeOptimizeConfig && !isEdgeOptimizeRequestId) {
      // Failover detected: the response came from the default origin,
      // not from Edge Optimize. We must:
      // 1. Mark the response with x-edgeoptimize-fo: 1 (for debugging/monitoring)
      // 2. Set cache-control: no-store to prevent CloudFront from caching
      //    this failover response. Without this, subsequent agentic requests
      //    would keep getting the cached non-optimized response.
      setHeader(response.headers, 'x-edgeoptimize-fo', '1');
      setHeader(response.headers, 'cache-control', 'no-store');
      console.log('Failover Triggered for agentic requests');
    }
 
    return response;
  } 
};

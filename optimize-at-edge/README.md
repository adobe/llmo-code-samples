# Adobe LLM Optimizer - Optimize at Edge — BYOCDN Samples

Sample edge worker implementations for [Adobe LLM Optimizer - Optimize at Edge](https://experienceleague.adobe.com/en/docs/llm-optimizer/using/resources/optimize-at-edge) **Bring Your Own CDN (BYOCDN)** integration. These samples show how to route agentic bot traffic (AI/LLM user agents) through your existing CDN to the Edge Optimize backend for optimized content delivery.

## Overview

Adobe Edge Optimize improves how AI-powered agents and LLM bots consume your website content. When you manage your own CDN, you can use these edge worker samples to transparently intercept agentic bot requests and route them to Edge Optimize — while serving all other visitors (humans and SEO bots) from your origin as usual.

### How It Works

```
                  ┌──────────────┐
                  │  Incoming    │
                  │  Request     │
                  └──────┬───────┘
                         │
                  ┌──────▼───────┐
                  │  Edge Worker │
                  │  (Bot Check) │
                  └──┬────────┬──┘
                     │        │
              Agentic Bot   Human / SEO Bot
                     │        │
              ┌──────▼──┐  ┌──▼──────────┐
              │  Edge   │  │   Origin    │
              │ Optimize│  │   Server    │
              └─────────┘  └─────────────┘
```

1. An edge worker intercepts every incoming request.
2. The **User-Agent** header is checked against a configurable list of known agentic bots.
3. **Agentic bots** are routed to the Edge Optimize backend (`live.edgeoptimize.net`).
4. **All other traffic** passes through to your origin unchanged.
5. If Edge Optimize returns an error, the request **fails over** to your origin automatically.

### Detected Agentic Bots

Both samples ship with the following default bot list (easily configurable):

| Bot | User-Agent String |
|-----|-------------------|
| Adobe Edge Optimize Test | `AdobeEdgeOptimize-AI` |
| OpenAI (browsing) | `ChatGPT-User` |
| OpenAI (crawler) | `GPTBot` |
| OpenAI (search) | `OAI-SearchBot` |
| Perplexity (crawler) | `PerplexityBot` |
| Perplexity (browsing) | `Perplexity-User` |
| Claude (crawler) | `ClaudeBot` |
| Claude (browsing) | `Claude-User` |
| Claude (search) | `Claude-SearchBot` |

## CDN Implementations

### Cloudflare Workers

A single Cloudflare Worker that handles routing, failover, and loop protection.

**File:** [`cloudflare/worker.js`](cloudflare/worker.js)

#### Features

- Routes agentic bot traffic to Edge Optimize
- Automatic failover to origin on any 4XX or 5XX error
- Loop protection via `x-edgeoptimize-request` header
- Caching support via Cloudflare's `cf.cacheEverything`
- Configurable targeted paths (all HTML pages by default)

#### Environment Variables

| Variable | Description |
|----------|-------------|
| `EDGE_OPTIMIZE_API_KEY` | Your Adobe-provided API key |
| `EDGE_OPTIMIZE_TARGET_HOST` | Your origin domain (falls back to the request host) |

#### Configuration

Edit the constants at the top of `worker.js`:

```js
// Add or remove bot user agents
const AGENTIC_BOTS = ['ChatGPT-User', 'GPTBot', ...];

// Set to null to route all HTML pages, or specify an array of paths
const TARGETED_PATHS = null; // e.g., ['/', '/page.html', '/products']

// Failover behavior
const FAILOVER_ON_4XX = true;
const FAILOVER_ON_5XX = true;
```

---

### AWS CloudFront

A two-layer setup using **CloudFront Functions** (viewer request) and **Lambda@Edge** (origin request + origin response).

#### Architecture

```
Viewer Request (CloudFront Function)
  → Detects agentic bots, sets headers, creates origin group with failover

Origin Request (Lambda@Edge)
  → Sets host header for Edge Optimize origin; marks failover requests

Origin Response (Lambda@Edge)
  → Prevents caching of failover responses
```

#### Files

| File | Purpose |
|------|---------|
| [`cloudfront/cloudfront-function/viewer-request.js`](cloudfront/cloudfront-function/viewer-request.js) | CloudFront Function — viewer request handler that detects bots and sets up origin group routing with failover |
| [`cloudfront/lambda/origin-request-response.js`](cloudfront/lambda/origin-request-response.js) | Lambda@Edge — handles both origin-request and origin-response events |
| [`cloudfront/lambda/trust-policy.json`](cloudfront/lambda/trust-policy.json) | IAM trust policy for the Lambda execution role |
| [`cloudfront/lambda/cloudwatch-policy.json`](cloudfront/lambda/cloudwatch-policy.json) | IAM policy granting CloudWatch Logs permissions |

#### Setup

1. **Create a CloudFront Origin** named `EdgeOptimize_Origin` pointing to `live.edgeoptimize.net` (HTTPS, port 443).
2. **Deploy the CloudFront Function** (`viewer-request.js`) and associate it with your distribution's **Viewer Request** event.
3. **Create a Lambda@Edge function** with the code from `origin-request-response.js`.
4. **Attach the IAM policies** (`trust-policy.json` and `cloudwatch-policy.json`) to the Lambda execution role. Replace `ACCOUNT_ID` and `FUNCTION_NAME` with your values.
5. **Associate the Lambda@Edge function** with both the **Origin Request** and **Origin Response** events on your distribution.

#### Configuration

Edit the constants in `viewer-request.js`:

```js
// Add or remove bot user agents
var AGENTIC_BOTS = ['ChatGPT-User', 'GPTBot', ...];

// Set to null to route all HTML pages, or specify an array of paths
var TARGETED_PATHS = null; // e.g., ['/', '/products', '/about']
```

Update the origin IDs in the `cf.createRequestOriginGroup` call to match your CloudFront distribution:

```js
cf.createRequestOriginGroup({
    "originIds": [
        { "originId": "EdgeOptimize_Origin" },     // Your Edge Optimize origin
        { "originId": "YOUR_DEFAULT_ORIGIN" }       // Your default/fallback origin
    ],
    "failoverCriteria": {
        "statusCodes": [400, 403, 404, 416, 500, 502, 503, 504]
    }
});
```

---

### Apache HTTP Server (Self-Hosted)

Native Apache `Include` files for a reverse-proxy vhost — no worker or serverless function. Routing, failover, and cache isolation are implemented with `mod_rewrite`, `mod_headers`, `mod_setenvif`, and `mod_proxy`.

**Files:** [`apache/oae/`](apache/oae) — `oae-routing.conf` (routing, header injection, failover triggers, `Vary` cache isolation), `oae-failover.conf` (origin replay on EO error), and `domains.conf` (per-domain enablement + API keys).

#### Setup

1. Copy the three files to a directory (for example, `conf/oae/`); use the routing and failover files as-is.
2. Enable your domain and set the API key in `domains.conf`.
3. Add the two Includes to your vhost — routing **before** your Rewrite & `ProxyPass` rules, failover **after**. Lines marked `#NEWLINE` are the only lines you add for Optimize at Edge; everything else is your existing, unchanged configuration:

```apache
Define OAE_CONF_DIR conf/oae                       #NEWLINE  directory holding the OAE include files

<VirtualHost *:443>
    ServerName www.example.com

    Include "${OAE_CONF_DIR}/oae-routing.conf"     #NEWLINE  OAE routing — BEFORE your Rewrite & ProxyPass rules

    # --- your existing rewrite rules and ProxyPass to origin ---
    ProxyPass        "/" "https://www.example.com/"
    ProxyPassReverse "/" "https://www.example.com/"

    Include "${OAE_CONF_DIR}/oae-failover.conf"    #NEWLINE  OAE failover — AFTER your ProxyPass rules
</VirtualHost>
```

See the [Apache HTTP Server guide](https://experienceleague.adobe.com/en/docs/llm-optimizer/using/resources/optimize-at-edge/apache-http-server) for the full step-by-step setup.

## Key Headers

| Header | Direction | Description |
|--------|-----------|-------------|
| `x-forwarded-host` | → Edge Optimize | The original site domain |
| `x-edgeoptimize-api-key` | → Edge Optimize | Your Adobe-provided API key |
| `x-edgeoptimize-url` | → Edge Optimize | The original request URL path and query |
| `x-edgeoptimize-config` | → Edge Optimize | Configuration flags (e.g., `LLMCLIENT=TRUE;`) |
| `x-edgeoptimize-request` | Internal | Loop/failover protection marker |
| `x-edgeoptimize-request-id` | ← Edge Optimize | Present when Edge Optimize processed the request |
| `x-edgeoptimize-fo` | ← Response | Set to `1` when failover to origin occurred |

## License

This project is licensed under the [Apache License 2.0](LICENSE).

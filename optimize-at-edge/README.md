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
| ChatGPT (browsing) | `ChatGPT-User` |
| GPTBot (crawler) | `GPTBot` |
| OpenAI Search | `OAI-SearchBot` |
| Perplexity (crawler) | `PerplexityBot` |
| Perplexity (browsing) | `Perplexity-User` |

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

A set of Apache `Include` files for a reverse-proxy vhost — no worker or serverless function required. Routing, header injection, failover, and cache isolation are implemented entirely in native Apache directives (`mod_rewrite`, `mod_headers`, `mod_setenvif`, `mod_proxy`).

#### Files

| File | Purpose |
|------|---------|
| [`apache/oae/oae-routing.conf`](apache/oae/oae-routing.conf) | Bot detection, HTML-only filtering, header injection, loop protection, proxy routing to Edge Optimize, conditional `ErrorDocument` failover triggers, and `Vary`-based cache isolation. Include **inside** your `<VirtualHost>`, **before** your rewrite rules. |
| [`apache/oae/oae-failover.conf`](apache/oae/oae-failover.conf) | Failover handler — when Edge Optimize returns a `4XX`/`5XX`, replays the original request against your origin. Include **inside** your `<VirtualHost>`, **after** your `ProxyPass`. |
| [`apache/oae/domains.conf`](apache/oae/domains.conf) | Per-domain enablement and API keys. Uncomment one block per registered domain and fill in the Adobe-provided API key. |

#### Required modules

`proxy`, `proxy_http`, `ssl`, `rewrite`, `headers`, `env`, `setenvif` (most installs already load these).

#### Setup

1. Deploy the three files to a directory (for example, `conf/oae/`) on your Apache server.
2. In your reverse-proxy vhost, add the two Includes:

```apache
<VirtualHost *:443>
    ServerName www.example.com

    # OAE routing — MUST be BEFORE your rewrite rules and ProxyPass.
    Include "conf/oae/oae-routing.conf"

    # --- your existing rewrite rules and ProxyPass to origin ---
    ProxyPass        "/" "https://www.example.com/"
    ProxyPassReverse "/" "https://www.example.com/"

    # OAE failover — MUST be AFTER your ProxyPass.
    Include "conf/oae/oae-failover.conf"
</VirtualHost>
```

3. Enable your domain in `domains.conf` by uncommenting its block and setting the API key. Domains not listed safely route to origin.

#### Cache isolation

Bot and human responses are kept in separate cache entries via `Vary: x-edgeoptimize-config` (set by `oae-routing.conf`). If your Apache already uses `mod_cache`, ensure it has `CacheQuickHandler Off` so the cache lookup runs after the Edge Optimize headers are set. No separate cache configuration files are required.

For the full step-by-step guide, see the [Apache HTTP Server / Self-Hosted BYOCDN guide](https://experienceleague.adobe.com/en/docs/llm-optimizer/using/resources/optimize-at-edge/apache-selfhosted-byocdn).

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

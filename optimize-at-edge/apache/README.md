# Apache HTTP Server — Optimize at Edge (BYOCDN)

Apache reverse-proxy configuration for routing agentic traffic (AI bots and LLM user agents) to the Edge Optimize backend (`live.edgeoptimize.net`). Human visitors and SEO bots continue to be served from your origin as usual.

Unlike the Cloudflare and CloudFront samples (which run an edge worker or Lambda), the Apache integration is a set of native `Include` files — no code execution, no separate runtime. Routing, header injection, failover, and cache isolation are implemented entirely with `mod_rewrite`, `mod_headers`, `mod_setenvif`, and `mod_proxy`.

## Files

| File | Purpose |
|------|---------|
| [`oae/oae-routing.conf`](oae/oae-routing.conf) | Bot detection (User-Agent match), HTML-only filtering, header injection, loop protection, proxy routing to Edge Optimize, conditional `ErrorDocument` failover triggers, and `Vary`-based cache isolation. |
| [`oae/oae-failover.conf`](oae/oae-failover.conf) | Failover handler — when Edge Optimize returns a `4XX`/`5XX`, replays the original request against your origin. |
| [`oae/domains.conf`](oae/domains.conf) | Per-domain enablement and API keys. One block per registered domain. |

## Required modules

`proxy`, `proxy_http`, `ssl`, `rewrite`, `headers`, `env`, `setenvif`

Most Apache installs already load these. The Edge Optimize backend is reached over HTTPS, so `mod_ssl` and `SSLProxyEngine On` (set in `oae-routing.conf`) are required.

## How it works

These files implement the standard Optimize at Edge BYOCDN routing logic:

1. **Bot detection** — `SetEnvIfExpr` matches the `User-Agent` against the agentic bot list (`AdobeEdgeOptimize-AI`, `ChatGPT-User`, `GPTBot`, `OAI-SearchBot`, `PerplexityBot`, `Perplexity-User`).
2. **HTML-only routing** — only HTML page requests (paths ending in `/`, `.html`, or with no extension) are routed; static assets always go to origin.
3. **Header injection** — sets `x-forwarded-host`, `x-edgeoptimize-api-key`, `x-edgeoptimize-config`, and `x-edgeoptimize-url` on requests to Edge Optimize.
4. **Loop protection** — requests already carrying `x-edgeoptimize-request` (Edge Optimize fetching the original page) are not re-routed.
5. **Failover** — if Edge Optimize returns a `4XX`/`5XX`, `ProxyErrorOverride` + `ErrorDocument` hand off to `oae-failover.conf`, which replays the original URL against origin and marks the response with `x-edgeoptimize-fo: 1`.
6. **Cache isolation** — `Vary: x-edgeoptimize-config` keeps bot-optimized and human responses in separate cache entries.
7. **Header security** — incoming `x-edgeoptimize-*` headers are stripped before routing (anti-spoofing), and again before failover to origin (no internal metadata leaks).

## Setup

1. Deploy the three files to a directory on your Apache server, for example `conf/oae/`.
2. Wire the two Includes into your reverse-proxy vhost:

```apache
<VirtualHost *:443>
    ServerName www.example.com

    ProxyPreserveHost Off

    # OAE routing — MUST be BEFORE your rewrite rules and ProxyPass.
    Include "conf/oae/oae-routing.conf"

    # --- your existing rewrite rules / headers go here ---

    # Restore the origin Host header for human/origin traffic.
    RequestHeader set Host "www.example.com" "env=!ADOBE_EDGE_OPTIMIZE"

    ProxyPass        "/" "https://www.example.com/"
    ProxyPassReverse "/" "https://www.example.com/"

    # OAE failover — MUST be AFTER your ProxyPass.
    Include "conf/oae/oae-failover.conf"
</VirtualHost>
```

3. Enable your domain in `domains.conf` — uncomment its block and set the Adobe-provided API key:

```apache
SetEnvIfExpr "%{HTTP_HOST} =~ m#(?i)^(www\.)?example\.com(:\d+)?$#" OAE_DOMAIN_ENABLED=1 OAE_API_KEY=YOUR_API_KEY_EXAMPLE_COM
```

Domains not listed (or left commented) safely route to origin, so you can roll out one domain at a time.

4. Validate the config and reload Apache:

```bash
httpd -t          # or: apachectl configtest
apachectl -k graceful
```

## Cache isolation and caching

Cache isolation does not require a separate cache configuration file. `oae-routing.conf` sets `Vary: x-edgeoptimize-config` on all responses for OAE-enabled domains, so bot-optimized and human responses are stored as separate cache variants and never mix.

If your Apache already uses `mod_cache` (disk or socache):

- Ensure your cache config has `CacheQuickHandler Off`. Without it, the cache lookup runs before the Edge Optimize request headers are set, which breaks `Vary`-based isolation. `oae-routing.conf` sets this automatically inside an `<IfModule cache_module>` guard.
- When you first enable Optimize at Edge on a domain that already has cached human entries, those pre-existing entries self-heal as they expire by `max-age` (a short cooldown window). No cache purge is required.

## Configuring the bot list and targeted paths

- **Bot list:** edit the User-Agent alternation in the `SetEnvIfExpr` in `oae-routing.conf`.
- **Targeted paths:** by default all HTML pages are routed. The HTML-only filter is the `m#(/[^./]+|\.html|/)$#` clause in the same `SetEnvIfExpr`.

## Verify the setup

Bot traffic (should be optimized) — a successful response includes `x-edgeoptimize-request-id`:

```bash
curl -svo /dev/null https://www.example.com/page.html \
  --header "user-agent: chatgpt-user"
```

Human traffic (should NOT be affected) — the response must **not** include `x-edgeoptimize-request-id`:

```bash
curl -svo /dev/null https://www.example.com/page.html \
  --header "user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
```

## Documentation

- [Apache HTTP Server / Self-Hosted BYOCDN guide](https://experienceleague.adobe.com/en/docs/llm-optimizer/using/resources/optimize-at-edge/apache-selfhosted-byocdn) — full customer-facing setup guide on Adobe Experience League.
- [Optimize at Edge — Overview](https://experienceleague.adobe.com/en/docs/llm-optimizer/using/resources/optimize-at-edge/overview)

For onboarding assistance, contact `llmo-at-edge@adobe.com`.

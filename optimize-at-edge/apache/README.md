# Apache HTTP Server (Self-Hosted) — Optimize at Edge

Native Apache `Include` files that route agentic bot traffic to Edge Optimize (`live.edgeoptimize.net`) and serve everyone else from origin. No worker or serverless runtime — just `mod_rewrite`, `mod_headers`, `mod_setenvif`, and `mod_proxy`.

## Files

| File | Purpose |
|------|---------|
| [`oae/oae-routing.conf`](oae/oae-routing.conf) | Bot detection, HTML-only routing, header injection, loop protection, proxy to Edge Optimize, failover triggers, and `Vary`-based cache isolation. Include **before** your `ProxyPass`. |
| [`oae/oae-failover.conf`](oae/oae-failover.conf) | Replays the original request against origin if Edge Optimize returns an error. Include **after** your `ProxyPass`. |
| [`oae/domains.conf`](oae/domains.conf) | Per-domain enablement and API keys. |

Required modules: `proxy`, `proxy_http`, `ssl`, `rewrite`, `headers`, `env`, `setenvif`.

## Setup

1. Copy the three files to a directory on your server (for example, `conf/oae/`). Use `oae-routing.conf` and `oae-failover.conf` as-is.
2. Enable your domain and set your API key in `domains.conf`:

```apache
SetEnvIfExpr "%{HTTP_HOST} =~ m#(?i)^(www\.)?example\.com(:\d+)?$#" OAE_DOMAIN_ENABLED=1 OAE_API_KEY=YOUR_API_KEY
```

3. Add the two `Include` lines to your virtual host — routing before `ProxyPass`, failover after:

```apache
<VirtualHost *:443>
    ServerName www.example.com
    Include "conf/oae/oae-routing.conf"
    ProxyPass        "/" "https://www.example.com/"
    ProxyPassReverse "/" "https://www.example.com/"
    Include "conf/oae/oae-failover.conf"
</VirtualHost>
```

4. Reload Apache (`apachectl configtest && apachectl -k graceful`).

For the full step-by-step guide, see [Apache HTTP Server / Self-Hosted (BYOCDN)](https://experienceleague.adobe.com/en/docs/llm-optimizer/using/resources/optimize-at-edge/apache-selfhosted-byocdn).

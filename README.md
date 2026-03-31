# Adobe LLM Optimizer — Code Samples

Production-ready code samples for integrating [Adobe LLM Optimizer](https://business.adobe.com/products/experience-cloud/llm-optimizer.html) with your infrastructure. These samples cover edge-level request routing for AI bot traffic and CDN log validation for data ingestion.

## Samples

### [Optimize at Edge — BYOCDN](./optimize-at-edge/)

Edge worker implementations that route agentic bot traffic (ChatGPT, GPTBot, PerplexityBot, etc.) through your CDN to Adobe's Edge Optimize backend, while serving all other traffic from your origin as usual. Includes automatic failover if Edge Optimize is unavailable.

Available for:

- **[Cloudflare Workers](./optimize-at-edge/cloudflare/)** — Single worker handling bot detection, routing, and failover
- **[AWS CloudFront](./optimize-at-edge/cloudfront/)** — Two-layer approach using CloudFront Functions (viewer request) + Lambda@Edge (origin request/response)

### [CDN Log Forwarding — BYOCDN-Other](./cdn-log-forwarding/byocdn-other/log-format-validation/)

A Python validation tool for verifying log files before uploading them to Adobe LLM Optimizer via the BYOCDN-Other ingestion method. Enforces the required JSON Lines schema including field names, data types, timestamp format, and URL structure.

```bash
python3 validate.py samples/valid.jsonl
python3 validate.py samples/valid.jsonl --upload-path "ABC123AdobeOrg/raw/byocdn-other/2025/02/01/logs.jsonl"
```

## Prerequisites

| Sample | Requirements |
|--------|-------------|
| Cloudflare Worker | Cloudflare account, Wrangler CLI, Edge Optimize API key |
| CloudFront | AWS account, CloudFront distribution, Lambda@Edge permissions, Edge Optimize API key |
| Log Validation | Python 3 |

## Getting Started

1. Clone this repository
2. Navigate to the sample you need
3. Follow the setup instructions in the sample's README

For detailed product documentation, see [Adobe Experience League](https://experienceleague.adobe.com/).

## Contributing

Contributions are welcome! Please read the [Contributing Guidelines](./.github/CONTRIBUTING.md) and sign the [Adobe CLA](https://opensource.adobe.com/cla.html) before submitting a pull request.

## Code of Conduct

This project follows the [Adobe Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## License

This project is licensed under the [Apache License 2.0](./LICENSE).

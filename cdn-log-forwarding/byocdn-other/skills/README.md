# BYOCDN-Other Skills

This folder contains three AI agent skills for onboarding customers to Adobe LLM Optimizer
using the BYOCDN-Other ingestion method.

| Skill | What it does |
|---|---|
| `byocdn-other-transform` | Analyzes a sample log file and generates a tailored `transform_logs.py` |
| `byocdn-other-upload` | Generates a ready-to-use `upload_to_llmo.py` with S3 connection setup |
| `byocdn-other-onboard` | Orchestrates both of the above and produces a complete customer delivery folder |

For most use cases, **`byocdn-other-onboard` is the only skill you need** — it calls the other
two internally.

## Installing the skills

### Cursor

Copy the skill folders into `~/.cursor/skills/`:

```bash
cp -r byocdn-other-onboard ~/.cursor/skills/
cp -r byocdn-other-transform ~/.cursor/skills/
cp -r byocdn-other-upload ~/.cursor/skills/
```

Cursor picks them up automatically. Trigger them by describing your task in chat — for example:

> "Generate a complete onboarding package for a customer whose CDN logs are in Apache format."

### Codex

Copy the skill folders into `~/.codex/skills/` (or `$CODEX_HOME/skills/` if that variable is set):

```bash
cp -r byocdn-other-onboard ~/.codex/skills/
cp -r byocdn-other-transform ~/.codex/skills/
cp -r byocdn-other-upload ~/.codex/skills/
```

Invoke them explicitly using the `$` prefix:

```
Use $byocdn-other-onboard to generate a log forwarding setup package for my customer.
```

## Using the onboard skill

The `byocdn-other-onboard` skill requires two inputs:

1. **A sample of the customer's source log file** — a few representative lines in whatever
   format they use (Apache, Nginx, CSV, JSON Lines, etc.)
2. **S3 connection details** from LLM Optimizer → Customer Configuration →
   CDN Configuration → AI Traffic Insights

It produces a `llmo-cdn-log-setup/` folder ready to share with the customer, containing:

- `transform_logs.py` — customized to their log format
- `upload_to_llmo.py` — ready to use without modification
- `raw_sample.<ext>` — a few lines from their source log as-is
- `transformed_sample.jsonl` — those same lines after transformation
- `README.md` — step-by-step instructions for the customer

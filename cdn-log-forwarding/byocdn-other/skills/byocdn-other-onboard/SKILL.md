---
name: byocdn-other-onboard
description: Orchestrates the complete BYOCDN-Other customer onboarding by composing the transform and upload skills to produce a ready-to-share delivery folder containing a tailored transform script, a ready-to-use upload script, and a customer-facing README. Use when preparing a full onboarding package for a customer, packaging LLM Optimizer log forwarding scripts for handoff, or setting up BYOCDN-Other end-to-end for a customer team.
---

# BYOCDN-Other Customer Onboarding Package

Produces a self-contained `llmo-cdn-log-setup/` folder with everything a customer needs to start
forwarding logs to LLM Optimizer — ready to share as-is:

- `transform_logs.py` — tailored to the customer's source log format
- `upload_to_llmo.py` — ready to use without modification
- `raw_sample.<ext>` — 2–3 lines taken verbatim from the customer's source log, preserving its original format and extension (e.g. `.log`, `.csv`, `.json`)
- `transformed_sample.jsonl` — those same records after applying the transform, in BYOCDN-Other JSONL format
- `README.md` — customer-facing setup guide with actual commands and field mappings

## Required inputs

1. **Sample log file** — a small representative file in the customer's source format
2. **S3 credentials** from LLM Optimizer → Customer Configuration → CDN Configuration → AI Traffic Insights:
   bucket name, bucket path, access key ID, secret access key

## Step 1: Generate `transform_logs.py`, `raw_sample.<ext>`, and `transformed_sample.jsonl`

Read and follow the `byocdn-other-transform` skill
(`../byocdn-other-transform/SKILL.md` relative to this skill).
Save the generated script as `llmo-cdn-log-setup/transform_logs.py`.

Then produce exactly two sample files — no more:

- **`llmo-cdn-log-setup/raw_sample.<ext>`** — copy 2–3 lines verbatim from the customer's
  source log file, preserving the original format and extension (e.g. `raw_sample.log`,
  `raw_sample.csv`, `raw_sample.json`). Do not convert or reformat.
- **`llmo-cdn-log-setup/transformed_sample.jsonl`** — apply the `transform()` mapping you just
  built to those same records and write the BYOCDN-Other output (one JSON object per line).

These two files are the ground-truth proof that the transform is correct:
the raw file shows the input, `transformed_sample.jsonl` shows the expected output.

## Step 2: Copy `upload_to_llmo.py`

Read `../byocdn-other-upload/assets/upload-template.py` (relative to this skill)
and save it verbatim as `llmo-cdn-log-setup/upload_to_llmo.py`. No modifications needed.

## Step 3: Generate `README.md`

Read [assets/README-template.md](assets/README-template.md) and save the result as
`llmo-cdn-log-setup/README.md`, making exactly two substitutions:

- `{{RAW_SAMPLE_FILENAME}}` → the exact filename you saved in Step 1 (e.g. `raw_sample.log`).
  You already know this — you created the file.
- `{{FIELD_MAPPING_TABLE}}` → a markdown table of Source field → BYOCDN-Other field,
  one row per mapped field.

## Step 4: Summarize the delivery

Once all five files are written, tell the user:
- The files created under `llmo-cdn-log-setup/`
- The field mapping that was applied

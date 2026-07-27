---
name: byocdn-other-upload
description: Generates a ready-to-use Python script that uploads BYOCDN-Other JSONL log files to the Adobe LLM Optimizer S3 ingestion bucket. Use when a user needs to upload logs to LLM Optimizer, configure S3 log delivery for the BYOCDN-Other ingestion method, set up continuous or scheduled log forwarding, or obtain credentials from the LLM Optimizer AI Traffic Insights UI.
---

# BYOCDN-Other S3 Upload Script Generator

Generates `upload_to_llmo.py` — a script that reads a BYOCDN-Other JSONL file, groups records by
UTC date, and uploads each group to the correct S3 path for LLM Optimizer ingestion.

The expected input is the `.jsonl` output produced by the `$byocdn-other-transform` skill.
Any valid BYOCDN-Other JSONL file works.

## Required input

S3 credentials from LLM Optimizer → Customer Configuration → CDN Configuration → AI Traffic Insights:
- S3 bucket name → `LLMO_S3_BUCKET`
- Bucket path → `LLMO_BUCKET_PATH` (e.g. `ABC123AdobeOrg/raw/byocdn-other/`)
- Access key ID → `LLMO_ACCESS_KEY_ID`
- Secret access key → `LLMO_SECRET_ACCESS_KEY`

## Step 1: Generate the script

Read [assets/upload-template.py](assets/upload-template.py) and save it as `upload_to_llmo.py`
alongside the log files. **No customization is needed** — the script is ready to use as-is.

## Step 2: Credentials setup (always include in your response)

### Where to find the values in LLM Optimizer

1. Go to [LLM Optimizer](https://llmo.now/) → **Customer Configuration** → **CDN Configuration** → **AI Traffic Insights**
2. Open the **Other** integration
3. Copy the S3 location and access credentials

Here is what each value looks like for a quick sanity check:

| Value | Looks like |
|---|---|
| Bucket name | `cdn-logs-` followed by a long string of letters and numbers |
| Bucket path | Org ID in uppercase + `AdobeOrg/raw/byocdn-other/` — e.g. `XXXXXXXXAdobeOrg/raw/byocdn-other/` |
| Access key ID | A long string of uppercase letters and numbers |
| Secret access key | A long mixed-case string — treat it like a password |

### Setting the values as environment variables

```bash
export LLMO_S3_BUCKET="<bucket name from UI>"
export LLMO_BUCKET_PATH="<bucket path from UI>"   # e.g. ABC123AdobeOrg/raw/byocdn-other/
export LLMO_ACCESS_KEY_ID="<access key from UI>"
export LLMO_SECRET_ACCESS_KEY="<secret key from UI>"

python upload_to_llmo.py logs.jsonl
```

> Run these in the same terminal window used to run the upload command.

## Step 3: Dependencies

Always tell the user to install:

```bash
pip install boto3
```

## Behavior notes

- Records are grouped by the UTC date in `timestamp` and uploaded to
  `<BUCKET_PATH>/yyyy/mm/dd/logs.jsonl` automatically.
- Each date's records are always written to `logs.jsonl`, so re-running the script for the same
  day overwrites the previous upload — no duplicates accumulate.
- Exits `0` on full success; `1` if any records failed validation; `2` if the input file is missing.
- **Backfill**: re-run with older files — the S3 date comes from each record's `timestamp`, not today.
- **Scheduling**: `0 * * * * python /path/to/upload_to_llmo.py /path/to/logs.jsonl`

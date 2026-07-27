# LLM Optimizer — CDN Log Forwarding Setup

This folder contains everything you need to upload your CDN logs to Adobe LLM Optimizer,
where they will populate the **Agentic Traffic** and **Referral Traffic** dashboards.

## What's included

| File | What it does |
|---|---|
| `transform_logs.py` | Converts your log files into the format LLM Optimizer expects |
| `upload_to_llmo.py` | Uploads the converted logs to Adobe |
| `{{RAW_SAMPLE_FILENAME}}` | A few lines from your source logs — shows what the transform script expects as input |
| `transformed_sample.jsonl` | Those same records already converted — use this to test the upload script |
| `README.md` | This guide |

## Before you start

Install the required dependency:

```bash
pip install boto3
```

## Step 1: Convert your logs

You can verify the transform works straight away using the sample file already in this folder:

```bash
python transform_logs.py {{RAW_SAMPLE_FILENAME}} transformed_sample.jsonl
```

For your actual log files, run the same command replacing `{{RAW_SAMPLE_FILENAME}}` with your log file path:

```bash
python transform_logs.py <your_log_file>
```

## Step 2: Set up your S3 connection

Go to **LLM Optimizer → Customer Configuration → CDN Configuration → AI Traffic Insights**
and copy the S3 location and access credentials.

Here is what each value looks like so you can double-check you copied the right thing:

| Value | Looks like |
|---|---|
| Bucket name | `cdn-logs-` followed by a long string of letters and numbers |
| Bucket path | Your org ID in uppercase + `AdobeOrg/raw/byocdn-other/` — e.g. `XXXXXXXXAdobeOrg/raw/byocdn-other/` |
| Access key ID | A long string of uppercase letters and numbers |
| Secret access key | A long mixed-case string — treat it like a password |

Then run these commands in your terminal, pasting each value between the quotes:

```bash
export LLMO_S3_BUCKET="paste-bucket-name-here"
export LLMO_BUCKET_PATH="paste-bucket-path-here"
export LLMO_ACCESS_KEY_ID="paste-access-key-here"
export LLMO_SECRET_ACCESS_KEY="paste-secret-key-here"
```

> Run these in the same terminal window you will use for Step 3.

## Step 3: Upload your logs

To verify everything is working before uploading your real logs, run this command first with the
included sample file:

```bash
python upload_to_llmo.py transformed_sample.jsonl
```

Once that succeeds, upload your own converted logs the same way:

```bash
python upload_to_llmo.py <your_converted_file.jsonl>
```

By the end of the day (UTC), your data will be available in the **Agentic Traffic** and
**Referral Traffic** dashboards in LLM Optimizer.

You can run this command again at any time — re-uploading the same day's logs overwrites the
previous upload, so there is no risk of duplicates.

## Field mapping reference

These are the source fields that were mapped when generating `transform_logs.py`:

{{FIELD_MAPPING_TABLE}}

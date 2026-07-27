---
name: byocdn-other-transform
description: Generates a Python script that parses a customer's source log format (JSONL, JSON, CSV, Apache/Nginx text, etc.) and transforms records into the BYOCDN-Other JSONL schema required by Adobe LLM Optimizer. Use when a user needs to convert CDN logs or web server logs into the BYOCDN-Other format, map source fields to the required schema, or prepare logs for LLM Optimizer ingestion.
---

# BYOCDN-Other Log Transform Script Generator

Generates a tailored `transform_logs.py` that reads source log files, maps fields to the
BYOCDN-Other schema, validates each record, and writes a `.jsonl` file ready for upload.

## Required input

A sample log file in the customer's source format.

## Step 1: Inspect the sample

Read the sample. Identify:
- File format (JSONL / JSON array / CSV / Apache text / etc.)
- Field names and their data types
- How to derive each required BYOCDN-Other field

## Step 2: BYOCDN-Other schema reference

| Field | Type | Key constraints |
|---|---|---|
| `timestamp` | str | ISO 8601 UTC ending in `Z`, e.g. `2025-02-01T23:00:05Z` |
| `host` | str | Domain only, no scheme |
| `url` | str | Must start with `/`; include query params; no fragment |
| `request_method` | str | HTTP verb, uppercase |
| `request_user_agent` | str | User-Agent header |
| `request_referer` | str | Referer header; empty string `""` if absent |
| `response_status` | **int** | HTTP status code — must NOT be a string |
| `response_content_type` | str | Content-Type header |
| `time_to_first_byte` | **int** | Milliseconds ≥ 0; use `0` if unknown |

**Common conversions:**
- Unix timestamp → `datetime.utcfromtimestamp(ts).strftime("%Y-%m-%dT%H:%M:%SZ")`
- Full URL → `host` from `urlparse(url).hostname`, `url` from `path + ("?" + query if query else "")`
- String status code → `int(raw["status"])`
- Missing referer → `""`

## Step 3: Generate the script

Read [assets/transform-template.py](assets/transform-template.py) and produce a customized copy
saved as `transform_logs.py` alongside the customer's log files.

Customize exactly two functions:

1. **`parse_log_file(path)`** — adjust the parser to match the source format:
   - JSONL (default): already works as-is
   - JSON array: use `for record in json.load(fh):`
   - CSV: use `csv.DictReader(fh)`
   - Apache/Nginx combined log: apply a regex to each line

2. **`transform(raw)`** — replace every field mapping based on Step 2. Apply type conversions
   inline. Raise `ValueError` for records that cannot be mapped.

Do not modify the validation or `main` sections.

## Usage (always include in your response)

```bash
# Transform source logs → BYOCDN-Other JSONL
python transform_logs.py source.log

# Output defaults to source.jsonl; specify explicitly if needed:
python transform_logs.py source.log output.jsonl
```

The output file is the input for the `$byocdn-other-upload` skill.

## Dependencies

No external packages required — standard library only.

# Copyright 2026 Adobe. All rights reserved.
# This file is licensed to you under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License. You may obtain a copy
# of the License at http://www.apache.org/licenses/LICENSE-2.0

# Unless required by applicable law or agreed to in writing, software distributed under
# the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
# OF ANY KIND, either express or implied. See the License for the specific language
# governing permissions and limitations under the License.

#!/usr/bin/env python3
"""Upload BYOCDN-Other JSONL logs to Adobe LLM Optimizer via S3.

Expects a file already in BYOCDN-Other format (e.g. produced by transform_logs.py).
Records are grouped by the UTC date in their `timestamp` field and uploaded to the
correct S3 path automatically.

Usage:
    python upload_to_llmo.py <log_file.jsonl>

Exit codes:
    0 — all records uploaded successfully
    1 — one or more records failed validation (see stderr)
    2 — input file not found
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

import boto3

# ---------------------------------------------------------------------------
# Credentials — set these as environment variables before running.
# Obtain all four values from LLM Optimizer → Customer Configuration → CDN Configuration → AI Traffic Insights.
# ---------------------------------------------------------------------------
S3_BUCKET      = os.environ["LLMO_S3_BUCKET"]         # e.g. "cdn-logs-abc123..."
BUCKET_PATH    = os.environ["LLMO_BUCKET_PATH"]        # e.g. "ABC123AdobeOrg/raw/byocdn-other/"
AWS_ACCESS_KEY = os.environ["LLMO_ACCESS_KEY_ID"]
AWS_SECRET_KEY = os.environ["LLMO_SECRET_ACCESS_KEY"]

# ---------------------------------------------------------------------------
# Lightweight validation — guards against accidentally uploading malformed files
# ---------------------------------------------------------------------------
REQUIRED_FIELDS: dict[str, type] = {
    "timestamp":             str,
    "host":                  str,
    "url":                   str,
    "request_method":        str,
    "request_user_agent":    str,
    "request_referer":       str,
    "response_status":       int,
    "response_content_type": str,
    "time_to_first_byte":    int,
}
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")


def validate(record: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    missing = set(REQUIRED_FIELDS) - record.keys()
    if missing:
        errors.append(f"missing fields: {sorted(missing)}")
        return errors
    for field, expected in REQUIRED_FIELDS.items():
        value = record[field]
        if expected is int:
            if not (isinstance(value, int) and not isinstance(value, bool)):
                errors.append(f"'{field}' must be int, got {type(value).__name__}")
        elif not isinstance(value, str):
            errors.append(f"'{field}' must be str, got {type(value).__name__}")
    if not ISO_RE.match(record.get("timestamp", "")):
        errors.append("'timestamp' must be ISO 8601 UTC ending in Z, e.g. 2025-02-01T23:00:05Z")
    if record.get("time_to_first_byte", 0) < 0:
        errors.append("'time_to_first_byte' must be >= 0 ms")
    return errors


# ---------------------------------------------------------------------------
# S3 upload
# ---------------------------------------------------------------------------
def s3_key(date: dt.date, filename: str) -> str:
    """Build the S3 key: <BUCKET_PATH>/yyyy/mm/dd/<filename>."""
    return f"{BUCKET_PATH.rstrip('/')}/{date:%Y/%m/%d}/{filename}"


def upload_jsonl(records: list[dict], date: dt.date, filename: str) -> None:
    body = "\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n"
    key = s3_key(date, filename)
    client = boto3.client(
        "s3",
        aws_access_key_id=AWS_ACCESS_KEY,
        aws_secret_access_key=AWS_SECRET_KEY,
    )
    client.put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=body.encode("utf-8"),
        ContentType="application/x-ndjson",
    )
    print(f"Uploaded {len(records):,} records → s3://{S3_BUCKET}/{key}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main(log_path: str) -> int:
    path = Path(log_path)
    if not path.is_file():
        print(f"ERROR: not a file: {path}", file=sys.stderr)
        return 2

    by_date: dict[dt.date, list[dict]] = {}
    invalid = 0

    with path.open(encoding="utf-8") as fh:
        for lineno, raw_line in enumerate(fh, start=1):
            line = raw_line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                print(f"  line {lineno}: malformed JSON — {exc.msg}", file=sys.stderr)
                invalid += 1
                continue

            errors = validate(record)
            if errors:
                print(f"  line {lineno}: {'; '.join(errors)}", file=sys.stderr)
                invalid += 1
                continue

            date = dt.date.fromisoformat(record["timestamp"][:10])
            by_date.setdefault(date, []).append(record)

    if invalid:
        print(
            f"WARNING: {invalid} record(s) failed validation — run transform_logs.py to fix",
            file=sys.stderr,
        )

    if not by_date:
        print("ERROR: no valid records to upload", file=sys.stderr)
        return 1

    for date, records in sorted(by_date.items()):
        upload_jsonl(records, date, "logs.jsonl")

    return 1 if invalid else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <log_file.jsonl>", file=sys.stderr)
        sys.exit(1)
    sys.exit(main(sys.argv[1]))

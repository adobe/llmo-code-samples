# Copyright 2026 Adobe. All rights reserved.
# This file is licensed to you under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License. You may obtain a copy
# of the License at http://www.apache.org/licenses/LICENSE-2.0

# Unless required by applicable law or agreed to in writing, software distributed under
# the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
# OF ANY KIND, either express or implied. See the License for the specific language
# governing permissions and limitations under the License.

#!/usr/bin/env python3
"""Transform source CDN/web server logs to BYOCDN-Other JSONL format.

Usage:
    python transform_logs.py <source_log_file> [output.jsonl]

If the output path is omitted, output is written to <source_log_file_stem>.jsonl.

Exit codes:
    0 — all records transformed and written successfully
    1 — one or more records were skipped (see stderr)
    2 — input file not found
"""

from __future__ import annotations

import datetime as dt
import json
import re
import sys
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# BYOCDN-Other schema
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


# ---------------------------------------------------------------------------
# CUSTOMISE: parse_log_file
# Yield one raw dict per source log entry.
# The default implementation reads JSON Lines — adjust for other formats.
# ---------------------------------------------------------------------------
def parse_log_file(path: Path):
    """Yield raw records from the source log file."""
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            stripped = line.strip()
            if stripped:
                yield json.loads(stripped)

    # CSV example:
    #   import csv
    #   with path.open(encoding="utf-8", newline="") as fh:
    #       for row in csv.DictReader(fh):
    #           yield row

    # JSON array example:
    #   with path.open(encoding="utf-8") as fh:
    #       for record in json.load(fh):
    #           yield record

    # Apache/Nginx combined log example:
    #   LOG_RE = re.compile(
    #       r'(?P<host>\S+) \S+ \S+ \[(?P<time>[^\]]+)\] '
    #       r'"(?P<method>\S+) (?P<url>\S+) \S+" (?P<status>\d+) \S+ '
    #       r'"(?P<referer>[^"]*)" "(?P<ua>[^"]*)"'
    #   )
    #   with path.open(encoding="utf-8") as fh:
    #       for line in fh:
    #           m = LOG_RE.match(line.strip())
    #           if m:
    #               yield m.groupdict()


# ---------------------------------------------------------------------------
# CUSTOMISE: transform
# Map a raw source record to the BYOCDN-Other schema.
# Replace every field reference below with the actual key names from the source.
# Raise ValueError for records that cannot be transformed.
# ---------------------------------------------------------------------------
def transform(raw: dict[str, Any]) -> dict[str, Any]:
    """Return a BYOCDN-Other record mapped from a raw source entry."""
    # Common conversions (uncomment as needed):
    #
    # Unix timestamp (seconds) → ISO 8601 UTC string:
    #   ts = dt.datetime.utcfromtimestamp(float(raw["unix_time"])).strftime("%Y-%m-%dT%H:%M:%SZ")
    #
    # Full URL → separate host and url (path + query):
    #   from urllib.parse import urlparse
    #   parsed = urlparse(raw["full_url"])
    #   host = parsed.hostname or ""
    #   url  = parsed.path + ("?" + parsed.query if parsed.query else "")

    return {
        "timestamp":             raw["timestamp"],
        "host":                  raw["host"],
        "url":                   raw["url"],
        "request_method":        raw["request_method"].upper(),
        "request_user_agent":    raw.get("request_user_agent", ""),
        "request_referer":       raw.get("request_referer", ""),
        "response_status":       int(raw["response_status"]),
        "response_content_type": raw.get("response_content_type", ""),
        "time_to_first_byte":    int(raw.get("time_to_first_byte", 0)),
    }


# ---------------------------------------------------------------------------
# Validation — do not modify
# ---------------------------------------------------------------------------
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
# Main — do not modify
# ---------------------------------------------------------------------------
def main(input_path: str, output_path: str | None) -> int:
    src = Path(input_path)
    if not src.is_file():
        print(f"ERROR: not a file: {src}", file=sys.stderr)
        return 2

    dst = Path(output_path) if output_path else src.with_suffix(".jsonl")
    written = skipped = 0

    with dst.open("w", encoding="utf-8") as out:
        for raw in parse_log_file(src):
            try:
                record = transform(raw)
            except Exception as exc:
                print(f"  skip (transform error): {exc}", file=sys.stderr)
                skipped += 1
                continue

            errors = validate(record)
            if errors:
                print(f"  skip (validation): {'; '.join(errors)}", file=sys.stderr)
                skipped += 1
                continue

            out.write(json.dumps(record, ensure_ascii=False) + "\n")
            written += 1

    print(f"Written {written:,} records → {dst}")
    if skipped:
        print(
            f"WARNING: {skipped} record(s) skipped — fix the errors above and re-run",
            file=sys.stderr,
        )

    return 1 if skipped else 0


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        print(f"Usage: {sys.argv[0]} <source_log_file> [output.jsonl]", file=sys.stderr)
        sys.exit(1)
    sys.exit(main(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None))

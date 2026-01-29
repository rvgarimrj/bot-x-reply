#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Production Readiness Scan - Search engine for production readiness checks
Usage: python scan.py "<query>" [--domain <domain>] [--max-results 5]

Domains: security, headers, secrets, auth, validation, performance, vitals, bundle,
         images, seo, i18n, sitemap, robots, schema, a11y, keyboard, aria, focus,
         database, indexes, migrations, backup, api, cors, errors, monitoring,
         logging, alerts, health, env, ci, rollback, preview, legal, cookies, gdpr, retention
"""

import argparse
from core import CSV_CONFIG, MAX_RESULTS, search, SEVERITY_ORDER


def format_output(result):
    """Format results for Claude consumption (token-optimized)"""
    if "error" in result:
        return f"Error: {result['error']}"

    output = []
    output.append(f"## Production Readiness Scan Results")
    output.append(f"**Domain:** {result['domain']} | **Query:** {result['query']}")
    output.append(f"**Source:** {result['file']} | **Found:** {result['count']} results\n")

    severity_emoji = {
        "CRITICAL": "🔴",
        "HIGH": "🟠",
        "MEDIUM": "🟡",
        "LOW": "🟢"
    }

    for i, row in enumerate(result['results'], 1):
        severity = row.get("Severity", "LOW")
        emoji = severity_emoji.get(severity, "⚪")

        # Get the primary identifier (Check, Header, Metric, etc.)
        primary_key = None
        for key in ["Check", "Header", "Metric", "Schema", "Attribute", "Variable", "Strategy", "Alert", "Data Type"]:
            if key in row:
                primary_key = key
                break

        title = row.get(primary_key, f"Result {i}") if primary_key else f"Result {i}"
        output.append(f"### {emoji} [{severity}] {title}")

        for key, value in row.items():
            if key == "Severity":
                continue  # Already shown in title
            value_str = str(value)
            if len(value_str) > 800:
                value_str = value_str[:800] + "..."
            output.append(f"- **{key}:** {value_str}")
        output.append("")

    return "\n".join(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Production Readiness Scan")
    parser.add_argument("query", help="Search query")
    parser.add_argument("--domain", "-d", choices=list(CSV_CONFIG.keys()), help="Search domain")
    parser.add_argument("--max-results", "-n", type=int, default=MAX_RESULTS, help="Max results (default: 5)")
    parser.add_argument("--json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    result = search(args.query, args.domain, args.max_results)

    if args.json:
        import json
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(format_output(result))

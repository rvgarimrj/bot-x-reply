#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SEO Elite i18n Search - BM25 search engine for multilingual SEO patterns
Usage: python search.py "<query>" [--domain <domain>] [--locale <locale>] [--max-results 3]

Domains: metadata, hreflang, sitemap, schema, vitals, technical
Locales: pt-BR, en-US, es, fr, zh-CN
"""

import argparse
from core import CSV_CONFIG, AVAILABLE_LOCALES, MAX_RESULTS, search, search_locale


def format_output(result):
    """Format results for Claude consumption (token-optimized)"""
    if "error" in result:
        return f"Error: {result['error']}"

    output = []
    if result.get("locale"):
        output.append(f"## SEO Elite Locale Guidelines")
        output.append(f"**Locale:** {result['locale']} | **Query:** {result['query']}")
    else:
        output.append(f"## SEO Elite Search Results")
        output.append(f"**Domain:** {result['domain']} | **Query:** {result['query']}")
    output.append(f"**Source:** {result['file']} | **Found:** {result['count']} results\n")

    for i, row in enumerate(result['results'], 1):
        output.append(f"### Result {i}")
        for key, value in row.items():
            value_str = str(value)
            if len(value_str) > 500:
                value_str = value_str[:500] + "..."
            output.append(f"- **{key}:** {value_str}")
        output.append("")

    return "\n".join(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SEO Elite i18n Search")
    parser.add_argument("query", help="Search query")
    parser.add_argument("--domain", "-d", choices=list(CSV_CONFIG.keys()), help="Search domain")
    parser.add_argument("--locale", "-l", choices=AVAILABLE_LOCALES, help="Locale-specific search (pt-BR, en-US, es, fr, zh-CN)")
    parser.add_argument("--max-results", "-n", type=int, default=MAX_RESULTS, help="Max results (default: 3)")
    parser.add_argument("--json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    # Locale search takes priority
    if args.locale:
        result = search_locale(args.query, args.locale, args.max_results)
    else:
        result = search(args.query, args.domain, args.max_results)

    if args.json:
        import json
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(format_output(result))

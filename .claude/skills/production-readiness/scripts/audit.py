#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Production Readiness Audit - Comprehensive audit and checklist generation
Usage:
  python audit.py --full              # Full audit report
  python audit.py --checklist         # Generate printable checklist
  python audit.py --domain security   # Audit specific domain
  python audit.py --severity CRITICAL # Show only critical issues
"""

import argparse
from datetime import datetime
from core import CSV_CONFIG, get_all_checks, generate_checklist, SEVERITY_ORDER


def format_full_audit():
    """Generate comprehensive audit report"""
    all_checks = get_all_checks()

    output = []
    output.append("=" * 80)
    output.append("# PRODUCTION READINESS AUDIT REPORT")
    output.append(f"# Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    output.append("=" * 80)
    output.append("")

    # Summary
    severity_counts = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
    for check in all_checks:
        severity = check.get("Severity", "LOW")
        if severity in severity_counts:
            severity_counts[severity] += 1

    output.append("## SUMMARY")
    output.append("")
    output.append(f"Total Checks: {len(all_checks)}")
    output.append(f"  - 🔴 CRITICAL: {severity_counts['CRITICAL']}")
    output.append(f"  - 🟠 HIGH:     {severity_counts['HIGH']}")
    output.append(f"  - 🟡 MEDIUM:   {severity_counts['MEDIUM']}")
    output.append(f"  - 🟢 LOW:      {severity_counts['LOW']}")
    output.append("")

    # Recommendation
    if severity_counts['CRITICAL'] > 0:
        output.append("⚠️  ACTION REQUIRED: Fix all CRITICAL issues before launch!")
    elif severity_counts['HIGH'] > 0:
        output.append("⚠️  RECOMMENDED: Address HIGH severity issues before launch.")
    else:
        output.append("✅ Looking good! Review MEDIUM and LOW items when possible.")
    output.append("")

    # Group by severity
    checklist = generate_checklist("severity")

    severity_emoji = {
        "CRITICAL": "🔴",
        "HIGH": "🟠",
        "MEDIUM": "🟡",
        "LOW": "🟢"
    }

    for severity in ["CRITICAL", "HIGH", "MEDIUM", "LOW"]:
        checks = checklist.get(severity, [])
        if not checks:
            continue

        output.append("-" * 80)
        output.append(f"## {severity_emoji[severity]} {severity} SEVERITY ({len(checks)} checks)")
        output.append("-" * 80)
        output.append("")

        for check in checks:
            domain = check.get("_domain", "unknown")

            # Get primary identifier
            primary_key = None
            for key in ["Check", "Header", "Metric", "Schema", "Attribute", "Variable", "Strategy", "Alert", "Data Type"]:
                if key in check:
                    primary_key = key
                    break

            title = check.get(primary_key, "Unknown") if primary_key else "Unknown"
            description = check.get("Description", "No description")

            output.append(f"### [{domain.upper()}] {title}")
            output.append(f"   {description}")

            # Show key fields
            for field in ["Why It Matters", "How to Fix", "Best Practice", "Requirement", "Prevention"]:
                if field in check and check[field]:
                    output.append(f"   **{field}:** {check[field][:200]}...")
            output.append("")

    return "\n".join(output)


def format_checklist():
    """Generate printable checklist"""
    output = []
    output.append("=" * 80)
    output.append("# PRODUCTION READINESS CHECKLIST")
    output.append(f"# Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    output.append("# Print this and check off items as you complete them")
    output.append("=" * 80)
    output.append("")

    # Group by domain category
    categories = {
        "SECURITY": ["security", "headers", "secrets", "auth", "validation"],
        "PERFORMANCE": ["performance", "vitals", "bundle", "images"],
        "SEO": ["seo", "i18n", "sitemap", "robots", "schema"],
        "ACCESSIBILITY": ["a11y", "keyboard", "aria", "focus"],
        "DATABASE": ["database", "indexes", "migrations", "backup"],
        "API": ["api", "cors"],
        "ERROR HANDLING": ["errors"],
        "MONITORING": ["monitoring", "logging", "alerts", "health"],
        "DEPLOYMENT": ["env", "ci", "rollback", "preview"],
        "LEGAL": ["legal", "cookies", "gdpr", "retention"]
    }

    severity_emoji = {
        "CRITICAL": "🔴",
        "HIGH": "🟠",
        "MEDIUM": "🟡",
        "LOW": "🟢"
    }

    for category, domains in categories.items():
        output.append(f"\n## {category}")
        output.append("-" * 40)

        for domain in domains:
            checks = get_all_checks(domain)
            if not checks:
                continue

            for check in checks:
                severity = check.get("Severity", "LOW")
                emoji = severity_emoji.get(severity, "⚪")

                # Get primary identifier
                primary_key = None
                for key in ["Check", "Header", "Metric", "Schema", "Attribute", "Variable", "Strategy", "Alert", "Data Type"]:
                    if key in check:
                        primary_key = key
                        break

                title = check.get(primary_key, "Unknown") if primary_key else "Unknown"
                output.append(f"[ ] {emoji} {title}")

    output.append("")
    output.append("=" * 80)
    output.append("# LEGEND")
    output.append("# 🔴 CRITICAL - Must fix before launch")
    output.append("# 🟠 HIGH     - Should fix before launch")
    output.append("# 🟡 MEDIUM   - Fix within first week")
    output.append("# 🟢 LOW      - Fix when possible")
    output.append("=" * 80)

    return "\n".join(output)


def format_domain_audit(domain):
    """Audit specific domain"""
    checks = get_all_checks(domain)

    if not checks:
        return f"No checks found for domain: {domain}"

    output = []
    output.append(f"## {domain.upper()} AUDIT")
    output.append(f"Total Checks: {len(checks)}")
    output.append("")

    severity_emoji = {
        "CRITICAL": "🔴",
        "HIGH": "🟠",
        "MEDIUM": "🟡",
        "LOW": "🟢"
    }

    for check in checks:
        severity = check.get("Severity", "LOW")
        emoji = severity_emoji.get(severity, "⚪")

        # Get primary identifier
        primary_key = None
        for key in ["Check", "Header", "Metric", "Schema", "Attribute", "Variable", "Strategy", "Alert", "Data Type"]:
            if key in check:
                primary_key = key
                break

        title = check.get(primary_key, "Unknown") if primary_key else "Unknown"
        output.append(f"### {emoji} [{severity}] {title}")

        for key, value in check.items():
            if key in ["Severity", "_domain"] or not value:
                continue
            value_str = str(value)
            if len(value_str) > 500:
                value_str = value_str[:500] + "..."
            output.append(f"- **{key}:** {value_str}")
        output.append("")

    return "\n".join(output)


def format_severity_filter(severity):
    """Show only checks of specific severity"""
    all_checks = get_all_checks()
    filtered = [c for c in all_checks if c.get("Severity", "").upper() == severity.upper()]

    if not filtered:
        return f"No {severity} severity checks found."

    output = []
    output.append(f"## {severity.upper()} SEVERITY CHECKS ({len(filtered)} total)")
    output.append("")

    for check in filtered:
        domain = check.get("_domain", "unknown")

        # Get primary identifier
        primary_key = None
        for key in ["Check", "Header", "Metric", "Schema", "Attribute", "Variable", "Strategy", "Alert", "Data Type"]:
            if key in check:
                primary_key = key
                break

        title = check.get(primary_key, "Unknown") if primary_key else "Unknown"
        description = check.get("Description", "")

        output.append(f"### [{domain.upper()}] {title}")
        output.append(f"   {description}")

        # Show remediation
        for field in ["How to Fix", "Best Practice", "Requirement", "Prevention", "Remediation"]:
            if field in check and check[field]:
                output.append(f"   **{field}:** {check[field][:300]}")
        output.append("")

    return "\n".join(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Production Readiness Audit")
    parser.add_argument("--full", action="store_true", help="Full comprehensive audit")
    parser.add_argument("--checklist", action="store_true", help="Generate printable checklist")
    parser.add_argument("--domain", "-d", choices=list(CSV_CONFIG.keys()), help="Audit specific domain")
    parser.add_argument("--severity", "-s", choices=["CRITICAL", "HIGH", "MEDIUM", "LOW"], help="Filter by severity")
    parser.add_argument("--json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    if args.json:
        import json
        if args.domain:
            checks = get_all_checks(args.domain)
        elif args.severity:
            all_checks = get_all_checks()
            checks = [c for c in all_checks if c.get("Severity", "").upper() == args.severity.upper()]
        else:
            checks = get_all_checks()
        print(json.dumps(checks, indent=2, ensure_ascii=False))
    elif args.checklist:
        print(format_checklist())
    elif args.domain:
        print(format_domain_audit(args.domain))
    elif args.severity:
        print(format_severity_filter(args.severity))
    else:
        print(format_full_audit())

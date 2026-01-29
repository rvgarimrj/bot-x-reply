#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Production Readiness Core - BM25 search engine for production readiness checks
"""

import csv
import re
from pathlib import Path
from math import log
from collections import defaultdict

# ============ CONFIGURATION ============
DATA_DIR = Path(__file__).parent.parent / "data"
CHECKS_DIR = DATA_DIR / "checks"
MAX_RESULTS = 5

# Domain configuration with CSV files and column mappings
CSV_CONFIG = {
    # Security Domains
    "security": {
        "file": "checks/security.csv",
        "search_cols": ["Check", "Keywords", "Description", "Category"],
        "output_cols": ["Check", "Keywords", "Severity", "Category", "Description", "Why It Matters", "How to Fix", "Code Example", "Tools", "References"]
    },
    "headers": {
        "file": "checks/headers.csv",
        "search_cols": ["Header", "Keywords", "Description", "Purpose"],
        "output_cols": ["Header", "Keywords", "Severity", "Purpose", "Description", "Recommended Value", "Code Example", "Common Mistakes", "References"]
    },
    "secrets": {
        "file": "checks/secrets.csv",
        "search_cols": ["Check", "Keywords", "Description", "Risk"],
        "output_cols": ["Check", "Keywords", "Severity", "Risk", "Description", "Detection Method", "Remediation", "Code Example", "Tools"]
    },
    "auth": {
        "file": "checks/auth.csv",
        "search_cols": ["Check", "Keywords", "Description", "Vulnerability"],
        "output_cols": ["Check", "Keywords", "Severity", "Vulnerability", "Description", "Best Practice", "Code Example", "Testing Method", "References"]
    },
    "validation": {
        "file": "checks/validation.csv",
        "search_cols": ["Check", "Keywords", "Description", "Attack Vector"],
        "output_cols": ["Check", "Keywords", "Severity", "Attack Vector", "Description", "Prevention", "Code Example", "Testing Method"]
    },

    # Performance Domains
    "performance": {
        "file": "checks/performance.csv",
        "search_cols": ["Check", "Keywords", "Description", "Impact"],
        "output_cols": ["Check", "Keywords", "Severity", "Impact", "Description", "Target", "How to Measure", "How to Fix", "Code Example", "Tools"]
    },
    "vitals": {
        "file": "checks/vitals.csv",
        "search_cols": ["Metric", "Keywords", "Description", "Factors"],
        "output_cols": ["Metric", "Keywords", "Severity", "Good", "Needs Improvement", "Poor", "Description", "Factors", "Optimization", "Code Example", "Tools"]
    },
    "bundle": {
        "file": "checks/bundle.csv",
        "search_cols": ["Check", "Keywords", "Description", "Impact"],
        "output_cols": ["Check", "Keywords", "Severity", "Impact", "Description", "Target", "How to Analyze", "How to Fix", "Code Example", "Tools"]
    },
    "images": {
        "file": "checks/images.csv",
        "search_cols": ["Check", "Keywords", "Description", "Impact"],
        "output_cols": ["Check", "Keywords", "Severity", "Impact", "Description", "Best Practice", "Code Example", "Common Mistakes", "Tools"]
    },

    # SEO Domains
    "seo": {
        "file": "checks/seo.csv",
        "search_cols": ["Check", "Keywords", "Description", "Impact"],
        "output_cols": ["Check", "Keywords", "Severity", "Impact", "Description", "Requirement", "Code Example", "Validation", "Tools"]
    },
    "i18n": {
        "file": "checks/i18n.csv",
        "search_cols": ["Check", "Keywords", "Description", "Locale"],
        "output_cols": ["Check", "Keywords", "Severity", "Locale", "Description", "Requirement", "Code Example", "Common Mistakes", "Validation"]
    },
    "sitemap": {
        "file": "checks/sitemap.csv",
        "search_cols": ["Check", "Keywords", "Description", "Purpose"],
        "output_cols": ["Check", "Keywords", "Severity", "Purpose", "Description", "Implementation", "Code Example", "Validation"]
    },
    "robots": {
        "file": "checks/robots.csv",
        "search_cols": ["Check", "Keywords", "Description", "Impact"],
        "output_cols": ["Check", "Keywords", "Severity", "Impact", "Description", "Best Practice", "Code Example", "Common Mistakes"]
    },
    "schema": {
        "file": "checks/schema.csv",
        "search_cols": ["Schema", "Keywords", "Description", "Use Case"],
        "output_cols": ["Schema", "Keywords", "Severity", "Use Case", "Description", "Required Properties", "Code Example", "Validation URL"]
    },

    # Accessibility Domains
    "a11y": {
        "file": "checks/a11y.csv",
        "search_cols": ["Check", "Keywords", "Description", "WCAG"],
        "output_cols": ["Check", "Keywords", "Severity", "WCAG", "Level", "Description", "Requirement", "Code Example", "Testing Method", "Tools"]
    },
    "keyboard": {
        "file": "checks/keyboard.csv",
        "search_cols": ["Check", "Keywords", "Description", "Interaction"],
        "output_cols": ["Check", "Keywords", "Severity", "Interaction", "Description", "Requirement", "Code Example", "Testing Method"]
    },
    "aria": {
        "file": "checks/aria.csv",
        "search_cols": ["Attribute", "Keywords", "Description", "Use Case"],
        "output_cols": ["Attribute", "Keywords", "Severity", "Use Case", "Description", "When to Use", "Code Example", "Common Mistakes"]
    },
    "focus": {
        "file": "checks/focus.csv",
        "search_cols": ["Check", "Keywords", "Description", "Purpose"],
        "output_cols": ["Check", "Keywords", "Severity", "Purpose", "Description", "Requirement", "Code Example", "Testing Method"]
    },

    # Database Domains
    "database": {
        "file": "checks/database.csv",
        "search_cols": ["Check", "Keywords", "Description", "Impact"],
        "output_cols": ["Check", "Keywords", "Severity", "Impact", "Description", "Best Practice", "Code Example", "Monitoring", "Tools"]
    },
    "indexes": {
        "file": "checks/indexes.csv",
        "search_cols": ["Check", "Keywords", "Description", "Query Pattern"],
        "output_cols": ["Check", "Keywords", "Severity", "Query Pattern", "Description", "Best Practice", "Code Example", "How to Identify"]
    },
    "migrations": {
        "file": "checks/migrations.csv",
        "search_cols": ["Check", "Keywords", "Description", "Risk"],
        "output_cols": ["Check", "Keywords", "Severity", "Risk", "Description", "Best Practice", "Code Example", "Rollback Strategy"]
    },
    "backup": {
        "file": "checks/backup.csv",
        "search_cols": ["Check", "Keywords", "Description", "RTO"],
        "output_cols": ["Check", "Keywords", "Severity", "RTO", "RPO", "Description", "Implementation", "Testing Method"]
    },

    # API Security Domains
    "api": {
        "file": "checks/api.csv",
        "search_cols": ["Check", "Keywords", "Description", "Vulnerability"],
        "output_cols": ["Check", "Keywords", "Severity", "Vulnerability", "Description", "Prevention", "Code Example", "Testing Method"]
    },
    "cors": {
        "file": "checks/cors.csv",
        "search_cols": ["Check", "Keywords", "Description", "Risk"],
        "output_cols": ["Check", "Keywords", "Severity", "Risk", "Description", "Best Practice", "Code Example", "Common Mistakes"]
    },

    # Error Handling Domains
    "errors": {
        "file": "checks/errors.csv",
        "search_cols": ["Check", "Keywords", "Description", "Scope"],
        "output_cols": ["Check", "Keywords", "Severity", "Scope", "Description", "Implementation", "Code Example", "Testing Method"]
    },

    # Monitoring Domains
    "monitoring": {
        "file": "checks/monitoring.csv",
        "search_cols": ["Check", "Keywords", "Description", "Purpose"],
        "output_cols": ["Check", "Keywords", "Severity", "Purpose", "Description", "Implementation", "Metrics", "Tools", "Alerting"]
    },
    "logging": {
        "file": "checks/logging.csv",
        "search_cols": ["Check", "Keywords", "Description", "Purpose"],
        "output_cols": ["Check", "Keywords", "Severity", "Purpose", "Description", "Best Practice", "Code Example", "Tools"]
    },
    "alerts": {
        "file": "checks/alerts.csv",
        "search_cols": ["Alert", "Keywords", "Description", "Trigger"],
        "output_cols": ["Alert", "Keywords", "Severity", "Trigger", "Description", "Threshold", "Response", "Channels"]
    },
    "health": {
        "file": "checks/health.csv",
        "search_cols": ["Check", "Keywords", "Description", "Type"],
        "output_cols": ["Check", "Keywords", "Severity", "Type", "Description", "Implementation", "Code Example", "Response Format"]
    },

    # Deployment Domains
    "env": {
        "file": "checks/env.csv",
        "search_cols": ["Variable", "Keywords", "Description", "Service"],
        "output_cols": ["Variable", "Keywords", "Severity", "Service", "Description", "Required", "Example Value", "Security Notes"]
    },
    "ci": {
        "file": "checks/ci.csv",
        "search_cols": ["Check", "Keywords", "Description", "Stage"],
        "output_cols": ["Check", "Keywords", "Severity", "Stage", "Description", "Implementation", "Code Example", "Failure Action"]
    },
    "rollback": {
        "file": "checks/rollback.csv",
        "search_cols": ["Strategy", "Keywords", "Description", "Use Case"],
        "output_cols": ["Strategy", "Keywords", "Severity", "Use Case", "Description", "Implementation", "Pros", "Cons", "Rollback Time"]
    },
    "preview": {
        "file": "checks/preview.csv",
        "search_cols": ["Check", "Keywords", "Description", "Purpose"],
        "output_cols": ["Check", "Keywords", "Severity", "Purpose", "Description", "Implementation", "Best Practice"]
    },

    # Legal Compliance Domains
    "legal": {
        "file": "checks/legal.csv",
        "search_cols": ["Check", "Keywords", "Description", "Regulation"],
        "output_cols": ["Check", "Keywords", "Severity", "Regulation", "Description", "Requirement", "Implementation", "Penalty"]
    },
    "cookies": {
        "file": "checks/cookies.csv",
        "search_cols": ["Check", "Keywords", "Description", "Category"],
        "output_cols": ["Check", "Keywords", "Severity", "Category", "Description", "Requirement", "Code Example", "Common Mistakes"]
    },
    "gdpr": {
        "file": "checks/gdpr.csv",
        "search_cols": ["Check", "Keywords", "Description", "Article"],
        "output_cols": ["Check", "Keywords", "Severity", "Article", "Description", "Requirement", "Implementation", "Documentation"]
    },
    "retention": {
        "file": "checks/retention.csv",
        "search_cols": ["Data Type", "Keywords", "Description", "Purpose"],
        "output_cols": ["Data Type", "Keywords", "Severity", "Purpose", "Description", "Retention Period", "Deletion Method", "Legal Basis"]
    }
}

# Severity levels for prioritization
SEVERITY_ORDER = {
    "CRITICAL": 0,
    "HIGH": 1,
    "MEDIUM": 2,
    "LOW": 3
}


# ============ BM25 IMPLEMENTATION ============
class BM25:
    """BM25 ranking algorithm for text search"""

    def __init__(self, k1=1.5, b=0.75):
        self.k1 = k1
        self.b = b
        self.corpus = []
        self.doc_lengths = []
        self.avgdl = 0
        self.idf = {}
        self.doc_freqs = defaultdict(int)
        self.N = 0

    def tokenize(self, text):
        """Lowercase, split, remove punctuation, filter short words"""
        text = re.sub(r'[^\w\s]', ' ', str(text).lower())
        return [w for w in text.split() if len(w) > 2]

    def fit(self, documents):
        """Build BM25 index from documents"""
        self.corpus = [self.tokenize(doc) for doc in documents]
        self.N = len(self.corpus)
        if self.N == 0:
            return
        self.doc_lengths = [len(doc) for doc in self.corpus]
        self.avgdl = sum(self.doc_lengths) / self.N

        for doc in self.corpus:
            seen = set()
            for word in doc:
                if word not in seen:
                    self.doc_freqs[word] += 1
                    seen.add(word)

        for word, freq in self.doc_freqs.items():
            self.idf[word] = log((self.N - freq + 0.5) / (freq + 0.5) + 1)

    def score(self, query):
        """Score all documents against query"""
        query_tokens = self.tokenize(query)
        scores = []

        for idx, doc in enumerate(self.corpus):
            score = 0
            doc_len = self.doc_lengths[idx]
            term_freqs = defaultdict(int)
            for word in doc:
                term_freqs[word] += 1

            for token in query_tokens:
                if token in self.idf:
                    tf = term_freqs[token]
                    idf = self.idf[token]
                    numerator = tf * (self.k1 + 1)
                    denominator = tf + self.k1 * (1 - self.b + self.b * doc_len / self.avgdl)
                    score += idf * numerator / denominator

            scores.append((idx, score))

        return sorted(scores, key=lambda x: x[1], reverse=True)


# ============ SEARCH FUNCTIONS ============
def _load_csv(filepath):
    """Load CSV and return list of dicts"""
    if not filepath.exists():
        return []
    with open(filepath, 'r', encoding='utf-8') as f:
        return list(csv.DictReader(f))


def _search_csv(filepath, search_cols, output_cols, query, max_results):
    """Core search function using BM25"""
    if not filepath.exists():
        return []

    data = _load_csv(filepath)
    if not data:
        return []

    # Build documents from search columns
    documents = [" ".join(str(row.get(col, "")) for col in search_cols) for row in data]

    # BM25 search
    bm25 = BM25()
    bm25.fit(documents)
    ranked = bm25.score(query)

    # Get top results with score > 0
    results = []
    for idx, score in ranked[:max_results]:
        if score > 0:
            row = data[idx]
            results.append({col: row.get(col, "") for col in output_cols if col in row})

    return results


def detect_domain(query):
    """Auto-detect the most relevant domain from query"""
    query_lower = query.lower()

    domain_keywords = {
        # Security
        "security": ["owasp", "vulnerability", "attack", "exploit", "injection", "xss", "csrf", "secure"],
        "headers": ["header", "csp", "hsts", "x-frame", "x-content", "strict-transport", "permissions-policy"],
        "secrets": ["secret", "api key", "password", "credential", "hardcoded", "env", "environment"],
        "auth": ["authentication", "login", "session", "jwt", "oauth", "nextauth", "token", "mfa"],
        "validation": ["validation", "sanitize", "escape", "input", "zod", "schema"],

        # Performance
        "performance": ["performance", "speed", "slow", "fast", "optimize", "lighthouse"],
        "vitals": ["lcp", "inp", "cls", "fid", "core web vitals", "largest contentful", "layout shift"],
        "bundle": ["bundle", "chunk", "split", "tree shake", "dynamic import", "lazy load"],
        "images": ["image", "webp", "avif", "next/image", "placeholder", "blur"],

        # SEO
        "seo": ["seo", "metadata", "title", "description", "canonical", "crawl", "index"],
        "i18n": ["i18n", "locale", "hreflang", "alternate", "language", "translation", "multilingual"],
        "sitemap": ["sitemap", "sitemap.xml", "priority", "changefreq", "lastmod"],
        "robots": ["robots", "robots.txt", "crawl", "disallow", "allow", "user-agent"],
        "schema": ["schema", "json-ld", "structured data", "organization", "product", "breadcrumb"],

        # Accessibility
        "a11y": ["accessibility", "a11y", "wcag", "ada", "screen reader", "disability"],
        "keyboard": ["keyboard", "tab", "focus", "enter", "escape", "navigation"],
        "aria": ["aria", "role", "label", "describedby", "live region"],
        "focus": ["focus", "outline", "ring", "indicator", "trap"],

        # Database
        "database": ["database", "postgres", "supabase", "connection", "pool", "query"],
        "indexes": ["index", "query", "slow query", "explain", "optimize"],
        "migrations": ["migration", "schema change", "alter", "zero-downtime"],
        "backup": ["backup", "restore", "recovery", "point-in-time", "disaster"],

        # API
        "api": ["api", "endpoint", "route", "rate limit", "throttle"],
        "cors": ["cors", "origin", "cross-origin", "preflight"],

        # Errors
        "errors": ["error", "boundary", "catch", "exception", "sentry", "crash"],

        # Monitoring
        "monitoring": ["monitoring", "apm", "observability", "metrics", "trace"],
        "logging": ["log", "logging", "pino", "winston", "structured"],
        "alerts": ["alert", "notification", "slack", "pagerduty", "threshold"],
        "health": ["health", "healthcheck", "liveness", "readiness", "probe"],

        # Deployment
        "env": ["environment", "env var", "config", "vercel", "secret"],
        "ci": ["ci", "cd", "pipeline", "github actions", "deploy", "test"],
        "rollback": ["rollback", "revert", "previous", "version", "blue-green", "canary"],
        "preview": ["preview", "staging", "branch", "pr deploy"],

        # Legal
        "legal": ["legal", "compliance", "privacy", "terms", "policy"],
        "cookies": ["cookie", "consent", "banner", "opt-in", "tracking"],
        "gdpr": ["gdpr", "dsar", "data subject", "right to erasure", "consent"],
        "retention": ["retention", "deletion", "archive", "data lifecycle"]
    }

    scores = {domain: sum(1 for kw in keywords if kw in query_lower) for domain, keywords in domain_keywords.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "security"


def search(query, domain=None, max_results=MAX_RESULTS):
    """Main search function with auto-domain detection"""
    if domain is None:
        domain = detect_domain(query)

    config = CSV_CONFIG.get(domain, CSV_CONFIG["security"])
    filepath = DATA_DIR / config["file"]

    if not filepath.exists():
        return {"error": f"File not found: {filepath}", "domain": domain}

    results = _search_csv(filepath, config["search_cols"], config["output_cols"], query, max_results)

    # Sort by severity
    results.sort(key=lambda x: SEVERITY_ORDER.get(x.get("Severity", "LOW"), 3))

    return {
        "domain": domain,
        "query": query,
        "file": config["file"],
        "count": len(results),
        "results": results
    }


def get_all_checks(domain=None):
    """Get all checks for a domain or all domains"""
    all_checks = []

    domains = [domain] if domain else list(CSV_CONFIG.keys())

    for d in domains:
        config = CSV_CONFIG.get(d)
        if not config:
            continue
        filepath = DATA_DIR / config["file"]
        data = _load_csv(filepath)
        for row in data:
            row["_domain"] = d
            all_checks.append(row)

    # Sort by severity
    all_checks.sort(key=lambda x: SEVERITY_ORDER.get(x.get("Severity", "LOW"), 3))

    return all_checks


def generate_checklist(group_by="severity"):
    """Generate a checklist grouped by severity or domain"""
    all_checks = get_all_checks()

    if group_by == "severity":
        grouped = defaultdict(list)
        for check in all_checks:
            severity = check.get("Severity", "LOW")
            grouped[severity].append(check)
        return dict(grouped)
    else:
        grouped = defaultdict(list)
        for check in all_checks:
            domain = check.get("_domain", "unknown")
            grouped[domain].append(check)
        return dict(grouped)

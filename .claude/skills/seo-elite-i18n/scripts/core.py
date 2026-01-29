#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SEO Elite i18n Core - BM25 search engine for multilingual SEO patterns
"""

import csv
import re
from pathlib import Path
from math import log
from collections import defaultdict

# ============ CONFIGURATION ============
DATA_DIR = Path(__file__).parent.parent / "data"
MAX_RESULTS = 3

CSV_CONFIG = {
    "metadata": {
        "file": "metadata.csv",
        "search_cols": ["Page Type", "Keywords", "Title Pattern", "Description Pattern", "Best For"],
        "output_cols": ["Page Type", "Keywords", "Title Pattern", "Description Pattern", "Title Length", "Description Length", "OpenGraph", "Twitter Card", "Best For", "Code Example"]
    },
    "hreflang": {
        "file": "hreflang.csv",
        "search_cols": ["Configuration", "Keywords", "Use Case", "Description"],
        "output_cols": ["Configuration", "Keywords", "Use Case", "Description", "Locales", "X-Default", "Code Example", "Common Mistakes"]
    },
    "sitemap": {
        "file": "sitemap.csv",
        "search_cols": ["Pattern", "Keywords", "Use Case", "Description"],
        "output_cols": ["Pattern", "Keywords", "Use Case", "Description", "Priority", "ChangeFreq", "Code Example", "Next.js Implementation"]
    },
    "schema": {
        "file": "schema.csv",
        "search_cols": ["Schema Type", "Keywords", "Use Case", "Properties"],
        "output_cols": ["Schema Type", "Keywords", "Use Case", "Properties", "Required Fields", "Recommended Fields", "JSON-LD Example", "Validation URL"]
    },
    "vitals": {
        "file": "core-web-vitals.csv",
        "search_cols": ["Metric", "Keywords", "Impact", "Optimization"],
        "output_cols": ["Metric", "Keywords", "Target Value", "Impact", "Common Issues", "Optimization", "Code Example", "Tools"]
    },
    "technical": {
        "file": "technical.csv",
        "search_cols": ["Topic", "Keywords", "Description", "Best Practice"],
        "output_cols": ["Topic", "Keywords", "Description", "Best Practice", "Do", "Dont", "Code Example", "Severity"]
    }
}

LOCALE_CONFIG = {
    "pt-BR": {"file": "locales/pt-BR.csv"},
    "en-US": {"file": "locales/en-US.csv"},
    "es": {"file": "locales/es.csv"},
    "fr": {"file": "locales/fr.csv"},
    "zh-CN": {"file": "locales/zh-CN.csv"}
}

# Common columns for all locales
_LOCALE_COLS = {
    "search_cols": ["Topic", "Keywords", "Description", "Optimization"],
    "output_cols": ["Topic", "Keywords", "Description", "Search Engine", "Market Share", "Optimization", "Local Keywords", "Code Example", "Cultural Notes"]
}

AVAILABLE_LOCALES = list(LOCALE_CONFIG.keys())


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
    with open(filepath, 'r', encoding='utf-8') as f:
        return list(csv.DictReader(f))


def _search_csv(filepath, search_cols, output_cols, query, max_results):
    """Core search function using BM25"""
    if not filepath.exists():
        return []

    data = _load_csv(filepath)

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
        "metadata": ["title", "description", "meta", "og:", "opengraph", "twitter", "card", "seo"],
        "hreflang": ["hreflang", "alternate", "language", "locale", "international", "x-default", "canonical"],
        "sitemap": ["sitemap", "robots", "index", "crawl", "priority", "changefreq", "lastmod"],
        "schema": ["json-ld", "schema", "structured", "organization", "product", "breadcrumb", "faq", "article"],
        "vitals": ["lcp", "fid", "cls", "core web vitals", "performance", "speed", "loading", "lighthouse"],
        "technical": ["robots", "noindex", "redirect", "301", "404", "crawl", "index", "block"]
    }

    scores = {domain: sum(1 for kw in keywords if kw in query_lower) for domain, keywords in domain_keywords.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "metadata"


def search(query, domain=None, max_results=MAX_RESULTS):
    """Main search function with auto-domain detection"""
    if domain is None:
        domain = detect_domain(query)

    config = CSV_CONFIG.get(domain, CSV_CONFIG["metadata"])
    filepath = DATA_DIR / config["file"]

    if not filepath.exists():
        return {"error": f"File not found: {filepath}", "domain": domain}

    results = _search_csv(filepath, config["search_cols"], config["output_cols"], query, max_results)

    return {
        "domain": domain,
        "query": query,
        "file": config["file"],
        "count": len(results),
        "results": results
    }


def search_locale(query, locale, max_results=MAX_RESULTS):
    """Search locale-specific SEO guidelines"""
    if locale not in LOCALE_CONFIG:
        return {"error": f"Unknown locale: {locale}. Available: {', '.join(AVAILABLE_LOCALES)}"}

    filepath = DATA_DIR / LOCALE_CONFIG[locale]["file"]

    if not filepath.exists():
        return {"error": f"Locale file not found: {filepath}", "locale": locale}

    results = _search_csv(filepath, _LOCALE_COLS["search_cols"], _LOCALE_COLS["output_cols"], query, max_results)

    return {
        "domain": "locale",
        "locale": locale,
        "query": query,
        "file": LOCALE_CONFIG[locale]["file"],
        "count": len(results),
        "results": results
    }

---
name: production-readiness
description: "Production Readiness Audit for Next.js SaaS. Comprehensive pre-launch validation: security (OWASP, CSP, secrets), performance (Core Web Vitals, bundle), SEO, accessibility (WCAG 2.1), database, API security, deployment, monitoring, legal compliance (GDPR/CCPA). Actions: audit, validate, check, scan, verify, review, fix production issues. Features: automated scanning, checklist generation, severity classification, actionable remediation. Topics: security headers, rate limiting, error boundaries, connection pooling, rollback strategy, alerting."
---

# Production Readiness - Pre-Launch Audit Intelligence

Comprehensive production readiness validation system for Next.js SaaS applications. Ensures your application meets industry standards for security, performance, accessibility, SEO, and legal compliance before going live.

## Prerequisites

Check if Python is installed:

```bash
python3 --version || python --version
```

If Python is not installed, install it based on user's OS:

**macOS:**
```bash
brew install python3
```

**Ubuntu/Debian:**
```bash
sudo apt update && sudo apt install python3
```

**Windows:**
```powershell
winget install Python.Python.3.12
```

---

## The Production Readiness Philosophy

> "You don't ship when you're done. You ship when it's **ready**."

Production readiness isn't a checkbox - it's a commitment to your users that your application won't:
- Expose their data (Security)
- Frustrate them with slowness (Performance)
- Exclude them due to disabilities (Accessibility)
- Be invisible to search engines (SEO)
- Violate their privacy rights (Legal Compliance)

---

## 10 Pillars of Production Readiness

### 1. SECURITY - Protect Your Users

| Check | Severity | Tool |
|-------|----------|------|
| OWASP Top 10 compliance | CRITICAL | `scan --domain security` |
| Security headers (CSP, HSTS, X-Frame) | CRITICAL | `scan --domain headers` |
| Secrets management (no hardcoded keys) | CRITICAL | `scan --domain secrets` |
| Authentication security (NextAuth) | CRITICAL | `scan --domain auth` |
| Input validation (Zod schemas) | HIGH | `scan --domain validation` |
| Dependency vulnerabilities | HIGH | `npm audit` |

### 2. PERFORMANCE - Respect Their Time

| Check | Target | Tool |
|-------|--------|------|
| LCP (Largest Contentful Paint) | < 2.5s | `scan --domain vitals` |
| INP (Interaction to Next Paint) | < 200ms | `scan --domain vitals` |
| CLS (Cumulative Layout Shift) | < 0.1 | `scan --domain vitals` |
| Bundle size analysis | < 200KB initial | `scan --domain bundle` |
| Image optimization | WebP/AVIF | `scan --domain images` |

### 3. SEO - Be Discoverable

| Check | Requirement | Tool |
|-------|-------------|------|
| Dynamic metadata (all pages) | generateMetadata() | `scan --domain seo` |
| Hreflang (5 locales) | All alternates | `scan --domain i18n` |
| Sitemap generation | app/sitemap.ts | `scan --domain sitemap` |
| robots.txt | Proper allow/disallow | `scan --domain robots` |
| JSON-LD structured data | Schema.org valid | `scan --domain schema` |

### 4. ACCESSIBILITY - Include Everyone

| Check | Standard | Tool |
|-------|----------|------|
| Color contrast | 4.5:1 (AA) | `scan --domain a11y` |
| Keyboard navigation | All interactive | `scan --domain keyboard` |
| Screen reader support | ARIA labels | `scan --domain aria` |
| Focus indicators | Visible | `scan --domain focus` |
| Alt text (localized) | All images | `scan --domain images` |

### 5. DATABASE - Scale Gracefully

| Check | Requirement | Tool |
|-------|-------------|------|
| Connection pooling | PgBouncer/Supabase | `scan --domain database` |
| Index optimization | Critical queries | `scan --domain indexes` |
| Migration safety | Zero-downtime | `scan --domain migrations` |
| Backup strategy | Automated | `scan --domain backup` |

### 6. API SECURITY - Guard Your Endpoints

| Check | Requirement | Tool |
|-------|-------------|------|
| Rate limiting | All endpoints | `scan --domain api` |
| Input validation | Zod schemas | `scan --domain validation` |
| Authentication | Protected routes | `scan --domain auth` |
| CORS configuration | Proper origins | `scan --domain cors` |

### 7. ERROR HANDLING - Fail Gracefully

| Check | Requirement | Tool |
|-------|-------------|------|
| Error boundaries | All critical paths | `scan --domain errors` |
| Global error handler | app/global-error.tsx | `scan --domain errors` |
| Sentry integration | Configured | `scan --domain monitoring` |
| User-friendly messages | Localized | `scan --domain i18n` |

### 8. DEPLOYMENT - Ship Safely

| Check | Requirement | Tool |
|-------|-------------|------|
| Environment variables | All configured | `scan --domain env` |
| CI/CD pipeline | Tests pass | `scan --domain ci` |
| Rollback strategy | Documented | `scan --domain rollback` |
| Preview deployments | Working | `scan --domain preview` |

### 9. MONITORING - Know When It Breaks

| Check | Requirement | Tool |
|-------|-------------|------|
| APM integration | Sentry/Vercel | `scan --domain monitoring` |
| Structured logging | Pino configured | `scan --domain logging` |
| Alerting rules | Critical paths | `scan --domain alerts` |
| Health endpoints | /api/health | `scan --domain health` |

### 10. LEGAL COMPLIANCE - Respect Privacy

| Check | Requirement | Tool |
|-------|-------------|------|
| Privacy policy | Published | `scan --domain legal` |
| Cookie consent | GDPR compliant | `scan --domain cookies` |
| DSAR process | Documented | `scan --domain gdpr` |
| Data retention | Policy defined | `scan --domain retention` |

---

## How to Use This Skill

When user requests production readiness work (audit, validate, check, scan, verify, review), follow this workflow:

### Step 1: Full System Audit

Run comprehensive audit across all domains:

```bash
python3 .claude/skills/production-readiness/scripts/audit.py --full
```

This generates a complete report with:
- Severity-classified findings (CRITICAL, HIGH, MEDIUM, LOW)
- Actionable remediation steps
- Estimated fix times
- Code examples for fixes

### Step 2: Domain-Specific Scans

For targeted validation:

```bash
# Security audit
python3 .claude/skills/production-readiness/scripts/scan.py "<query>" --domain security

# Performance check
python3 .claude/skills/production-readiness/scripts/scan.py "<query>" --domain performance

# SEO validation
python3 .claude/skills/production-readiness/scripts/scan.py "<query>" --domain seo

# Accessibility review
python3 .claude/skills/production-readiness/scripts/scan.py "<query>" --domain a11y

# Database readiness
python3 .claude/skills/production-readiness/scripts/scan.py "<query>" --domain database
```

### Step 3: Generate Checklist

Generate a printable checklist for manual review:

```bash
python3 .claude/skills/production-readiness/scripts/audit.py --checklist
```

---

## Search Reference

### Available Domains

| Domain | Focus | Example Keywords |
|--------|-------|------------------|
| `security` | OWASP, headers, auth, secrets | csp, xss, sql injection, csrf |
| `headers` | Security headers configuration | hsts, x-frame, csp, permissions |
| `secrets` | Secrets management, env vars | api key, database url, hardcoded |
| `auth` | Authentication, session | nextauth, oauth, jwt, session |
| `validation` | Input validation, Zod | schema, sanitize, escape, inject |
| `performance` | Core Web Vitals, speed | lcp, inp, cls, lighthouse, bundle |
| `vitals` | Core Web Vitals metrics | largest contentful, interaction, shift |
| `bundle` | Bundle size, code splitting | dynamic import, tree shake, lazy |
| `images` | Image optimization | next/image, webp, avif, blur |
| `seo` | Metadata, crawlability | title, description, canonical |
| `i18n` | Internationalization, hreflang | locale, alternate, x-default |
| `sitemap` | Sitemap generation | priority, changefreq, lastmod |
| `robots` | Robots.txt configuration | allow, disallow, crawl |
| `schema` | JSON-LD structured data | organization, product, faq |
| `a11y` | Accessibility compliance | wcag, contrast, keyboard, aria |
| `keyboard` | Keyboard navigation | focus, tab, enter, escape |
| `aria` | ARIA attributes, roles | label, describedby, live |
| `focus` | Focus management, indicators | outline, ring, visible |
| `database` | Database readiness | pool, connection, timeout |
| `indexes` | Index optimization | query, slow, explain |
| `migrations` | Migration safety | zero-downtime, rollback |
| `backup` | Backup strategy | automated, restore, point-in-time |
| `api` | API security | rate limit, cors, validation |
| `cors` | CORS configuration | origin, headers, methods |
| `errors` | Error handling | boundary, global, sentry |
| `monitoring` | APM, observability | sentry, vercel, posthog |
| `logging` | Structured logging | pino, correlation, trace |
| `alerts` | Alerting configuration | slack, email, pagerduty |
| `health` | Health checks | endpoint, liveness, readiness |
| `env` | Environment variables | vercel, secrets, config |
| `ci` | CI/CD pipeline | github actions, tests, lint |
| `rollback` | Rollback strategy | revert, previous, deploy |
| `preview` | Preview deployments | branch, pr, staging |
| `legal` | Legal compliance | privacy, terms, cookies |
| `cookies` | Cookie consent | gdpr, banner, opt-in |
| `gdpr` | GDPR compliance | dsar, retention, consent |
| `retention` | Data retention | policy, deletion, archive |

---

## Severity Classification

### CRITICAL (Must Fix Before Launch)
- Security vulnerabilities (OWASP Top 10)
- Missing security headers
- Hardcoded secrets
- Broken authentication
- No error boundaries

### HIGH (Should Fix Before Launch)
- Performance issues (Core Web Vitals failing)
- Missing SEO metadata
- Accessibility violations (WCAG AA)
- No rate limiting
- Missing input validation

### MEDIUM (Fix Within First Week)
- Bundle size optimization
- Missing structured data
- Incomplete logging
- No health endpoints
- Missing monitoring

### LOW (Fix When Possible)
- Documentation gaps
- Minor UX improvements
- Nice-to-have features
- Code style issues

---

## Pre-Launch Checklist Summary

### Day -7: Security Audit
- [ ] Run `npm audit` and fix vulnerabilities
- [ ] Verify all security headers configured
- [ ] Scan for hardcoded secrets with GitGuardian
- [ ] Test authentication flows (login, logout, session)
- [ ] Verify rate limiting on all API endpoints

### Day -5: Performance Validation
- [ ] Run Lighthouse audit (score > 90)
- [ ] Verify Core Web Vitals (LCP < 2.5s, INP < 200ms, CLS < 0.1)
- [ ] Analyze bundle size (< 200KB initial)
- [ ] Test on slow 3G connection
- [ ] Verify image optimization

### Day -3: SEO & Accessibility
- [ ] Verify metadata on all pages
- [ ] Test hreflang implementation (5 locales)
- [ ] Validate sitemap.xml
- [ ] Run WAVE accessibility audit
- [ ] Test with screen reader (VoiceOver/NVDA)

### Day -2: Database & API
- [ ] Verify connection pooling configured
- [ ] Test database under load
- [ ] Verify all migrations applied
- [ ] Test API rate limiting
- [ ] Verify CORS configuration

### Day -1: Final Checks
- [ ] Verify all environment variables
- [ ] Test CI/CD pipeline end-to-end
- [ ] Document rollback procedure
- [ ] Verify monitoring alerts configured
- [ ] Test cookie consent flow

### Day 0: Launch
- [ ] Deploy to production
- [ ] Verify DNS and SSL
- [ ] Test critical user flows
- [ ] Monitor error rates
- [ ] Celebrate!

---

## Common Issues and Fixes

### CRITICAL: Missing Security Headers

```typescript
// next.config.ts
const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload'
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY'
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block'
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin'
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()'
  },
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';"
  }
];

module.exports = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};
```

### CRITICAL: Missing Error Boundary

```typescript
// app/global-error.tsx
'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <h1>Something went wrong!</h1>
        <button onClick={() => reset()}>Try again</button>
      </body>
    </html>
  );
}
```

### HIGH: Missing Rate Limiting

```typescript
// middleware.ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NextRequest, NextResponse } from 'next/server';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '10 s'),
  analytics: true,
});

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api')) {
    const ip = request.ip ?? '127.0.0.1';
    const { success, limit, reset, remaining } = await ratelimit.limit(ip);

    if (!success) {
      return NextResponse.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': reset.toString(),
          }
        }
      );
    }
  }

  return NextResponse.next();
}
```

### HIGH: Missing Health Endpoint

```typescript
// app/api/health/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0',
    checks: {
      database: await checkDatabase(),
      redis: await checkRedis(),
      external: await checkExternalServices(),
    }
  };

  const isHealthy = Object.values(health.checks).every(c => c.status === 'ok');

  return NextResponse.json(health, {
    status: isHealthy ? 200 : 503
  });
}

async function checkDatabase() {
  try {
    // Your database check
    return { status: 'ok', latency: '5ms' };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}
```

---

## Integration with Other Skills

Production Readiness works best when combined with:

1. **SEO Elite i18n** - For comprehensive SEO validation
2. **UI/UX Pro Max** - For accessibility and visual quality
3. **React Best Practices** - For performance optimization
4. **Security Auditor Agent** - For deep security analysis

---

## Example Workflow

**User request:** "Prepare the app for production launch"

**AI should:**

```bash
# 1. Run full audit
python3 .claude/skills/production-readiness/scripts/audit.py --full

# 2. Check security headers
python3 .claude/skills/production-readiness/scripts/scan.py "security headers" --domain headers

# 3. Validate Core Web Vitals
python3 .claude/skills/production-readiness/scripts/scan.py "performance" --domain vitals

# 4. Check SEO readiness
python3 .claude/skills/production-readiness/scripts/scan.py "metadata hreflang" --domain seo

# 5. Verify accessibility
python3 .claude/skills/production-readiness/scripts/scan.py "wcag contrast" --domain a11y

# 6. Check database readiness
python3 .claude/skills/production-readiness/scripts/scan.py "connection pooling" --domain database

# 7. Validate error handling
python3 .claude/skills/production-readiness/scripts/scan.py "error boundary" --domain errors

# 8. Check monitoring setup
python3 .claude/skills/production-readiness/scripts/scan.py "sentry alerting" --domain monitoring

# 9. Verify legal compliance
python3 .claude/skills/production-readiness/scripts/scan.py "gdpr cookie" --domain legal

# 10. Generate final checklist
python3 .claude/skills/production-readiness/scripts/audit.py --checklist
```

**Then:** Address all CRITICAL and HIGH severity issues before launch.

---

## Sources and References

### Security
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/)
- [Next.js Security Checklist](https://nextjs.org/docs/app/guides/security)
- [Vercel Production Checklist](https://vercel.com/docs/production-checklist)

### Performance
- [Google Core Web Vitals](https://web.dev/vitals/)
- [Next.js Performance Guidelines](https://nextjs.org/docs/app/guides/production-checklist)

### Accessibility
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [WebAIM Checklist](https://webaim.org/standards/wcag/checklist)

### Legal
- [GDPR Compliance Guide](https://gdpr.eu/checklist/)
- [CCPA Requirements](https://oag.ca.gov/privacy/ccpa)

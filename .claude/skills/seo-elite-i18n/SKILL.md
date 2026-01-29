---
name: seo-elite-i18n
description: "SEO Elite for Multilingual SaaS. 5 locales (pt-BR, en-US, es, fr, zh-CN), dynamic metadata, hreflang, sitemaps, JSON-LD Schema.org, Core Web Vitals. Actions: audit, optimize, implement, validate, check, fix SEO issues. Features: generateMetadata, alternates, canonical, hreflang, robots.txt, sitemap.xml, structured data, image alt, Open Graph, Twitter Cards. Topics: international SEO, localized content, search ranking, indexing, crawlability, page speed, mobile-first, SERP optimization."
---

# SEO Elite i18n - Multilingual SaaS SEO Intelligence

Searchable database of SEO patterns, metadata templates, hreflang configurations, sitemap strategies, JSON-LD schemas, and locale-specific optimizations for Next.js multilingual applications.

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

## Core SEO Rules for Multilingual SaaS

### MANDATORY: Every Page Must Have

1. **Dynamic Metadata** with `generateMetadata()`:
   ```typescript
   export async function generateMetadata({ params }: Props): Promise<Metadata> {
     const { locale } = await params;
     const t = await getTranslations({ locale, namespace: 'PageName' });

     return {
       title: t('meta.title'),
       description: t('meta.description'),
       alternates: {
         canonical: `https://example.com/${locale}/page`,
         languages: {
           'pt-BR': 'https://example.com/pt-BR/page',
           'en-US': 'https://example.com/en-US/page',
           'es': 'https://example.com/es/page',
           'fr': 'https://example.com/fr/page',
           'zh-CN': 'https://example.com/zh-CN/page',
           'x-default': 'https://example.com/en-US/page',
         }
       },
       openGraph: {
         title: t('meta.title'),
         description: t('meta.description'),
         locale: locale,
         alternateLocale: ['pt-BR', 'en-US', 'es', 'fr', 'zh-CN'].filter(l => l !== locale),
       }
     };
   }
   ```

2. **Localized Image Alt Text**:
   ```typescript
   // ❌ WRONG
   <Image src={img} alt="Product image" />

   // ✅ CORRECT
   <Image src={img} alt={t('images.productAlt')} />
   ```

3. **Locale-Prefixed Links**:
   ```typescript
   // ❌ WRONG
   <Link href="/pricing">Pricing</Link>

   // ✅ CORRECT
   import { Link } from '@/i18n/routing';
   <Link href="/pricing">{t('nav.pricing')}</Link>
   ```

---

## How to Use This Skill

When user requests SEO work (audit, optimize, implement, validate, check, fix), follow this workflow:

### Step 1: Analyze SEO Requirements

Extract key information from user request:
- **Page type**: Landing page, product page, blog, dashboard, etc.
- **Target locales**: pt-BR, en-US, es, fr, zh-CN
- **SEO focus**: Metadata, hreflang, sitemap, schema, performance
- **Framework**: Next.js 14/15 with App Router

### Step 2: Search Relevant Domains

Use `search.py` to gather SEO intelligence:

```bash
python3 .claude/skills/seo-elite-i18n/scripts/search.py "<keyword>" --domain <domain> [-n <max_results>]
```

**Recommended search order:**

1. **Metadata** - Get dynamic metadata patterns for page type
2. **Hreflang** - Get international SEO configurations
3. **Sitemap** - Get sitemap generation patterns
4. **Schema** - Get JSON-LD structured data templates
5. **Vitals** - Get Core Web Vitals optimization tips
6. **Locale** - Get locale-specific SEO requirements

### Step 3: Locale-Specific Search

For locale-specific patterns:

```bash
python3 .claude/skills/seo-elite-i18n/scripts/search.py "<keyword>" --locale pt-BR
python3 .claude/skills/seo-elite-i18n/scripts/search.py "<keyword>" --locale zh-CN
```

Available locales: `pt-BR`, `en-US`, `es`, `fr`, `zh-CN`

---

## Search Reference

### Available Domains

| Domain | Use For | Example Keywords |
|--------|---------|------------------|
| `metadata` | Dynamic metadata patterns | landing, product, blog, pricing, dashboard |
| `hreflang` | International SEO, language alternates | alternates, canonical, x-default, regional |
| `sitemap` | Sitemap generation, robots.txt | dynamic, static, streaming, priority |
| `schema` | JSON-LD structured data | SaaS, product, organization, FAQ, breadcrumb |
| `vitals` | Core Web Vitals, performance | LCP, FID, CLS, speed, images, fonts |
| `technical` | Technical SEO, crawlability | robots, indexing, redirects, canonical |

### Available Locales

| Locale | Focus |
|--------|-------|
| `pt-BR` | Brazilian Portuguese SEO, Google.com.br, local keywords |
| `en-US` | US English SEO, primary market patterns |
| `es` | Spanish SEO, Latin America & Spain markets |
| `fr` | French SEO, France & Francophone markets |
| `zh-CN` | Simplified Chinese SEO, Baidu considerations |

---

## Example Workflow

**User request:** "Optimize SEO for the pricing page with all locales"

**AI should:**

```bash
# 1. Search metadata patterns for pricing page
python3 .claude/skills/seo-elite-i18n/scripts/search.py "pricing saas" --domain metadata

# 2. Search hreflang configuration
python3 .claude/skills/seo-elite-i18n/scripts/search.py "pricing alternates" --domain hreflang

# 3. Search JSON-LD schema for pricing
python3 .claude/skills/seo-elite-i18n/scripts/search.py "pricing product" --domain schema

# 4. Search locale-specific requirements
python3 .claude/skills/seo-elite-i18n/scripts/search.py "pricing" --locale pt-BR
python3 .claude/skills/seo-elite-i18n/scripts/search.py "pricing" --locale zh-CN

# 5. Search Core Web Vitals for pricing pages
python3 .claude/skills/seo-elite-i18n/scripts/search.py "interactive pricing" --domain vitals
```

**Then:** Implement all SEO patterns with proper i18n support.

---

## Mandatory SEO Checklist for Every Page

### Metadata (generateMetadata)
- [ ] Title from i18n dictionary (50-60 characters)
- [ ] Description from i18n dictionary (150-160 characters)
- [ ] Canonical URL with locale prefix
- [ ] Alternates with ALL 5 locales + x-default
- [ ] OpenGraph with localized title/description
- [ ] Twitter Card metadata

### Hreflang Implementation
- [ ] All 5 locales in alternates.languages
- [ ] x-default pointing to en-US (or primary market)
- [ ] Consistent URL structure across locales
- [ ] Self-referencing hreflang included

### Images
- [ ] All images have localized alt text from i18n
- [ ] Image file names descriptive (not random hashes)
- [ ] Next/Image with proper width/height
- [ ] WebP/AVIF format with fallbacks

### Links
- [ ] All internal links use next-intl Link component
- [ ] No hardcoded locale in href
- [ ] External links have rel="noopener noreferrer"
- [ ] Anchor text is descriptive, not "click here"

### Structured Data (JSON-LD)
- [ ] Organization schema on homepage
- [ ] Product/SoftwareApplication on pricing
- [ ] BreadcrumbList on all pages
- [ ] FAQ schema where applicable
- [ ] Localized @language property

### Sitemap & Robots
- [ ] app/sitemap.ts generates all locale URLs
- [ ] Priority: 1.0 for homepage, 0.8 for main pages
- [ ] Lastmod with actual update dates
- [ ] robots.ts allows indexing, points to sitemap

---

## Common SEO Patterns

### 1. Dynamic Metadata Template

```typescript
// app/[locale]/pricing/page.tsx
import { getTranslations } from 'next-intl/server';
import { Metadata } from 'next';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Pricing' });

  const baseUrl = 'https://tubespark.com';
  const path = '/pricing';

  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: {
      canonical: `${baseUrl}/${locale}${path}`,
      languages: {
        'pt-BR': `${baseUrl}/pt-BR${path}`,
        'en-US': `${baseUrl}/en-US${path}`,
        'es': `${baseUrl}/es${path}`,
        'fr': `${baseUrl}/fr${path}`,
        'zh-CN': `${baseUrl}/zh-CN${path}`,
        'x-default': `${baseUrl}/en-US${path}`,
      }
    },
    openGraph: {
      title: t('meta.title'),
      description: t('meta.description'),
      url: `${baseUrl}/${locale}${path}`,
      siteName: 'TubeSpark',
      locale: locale.replace('-', '_'),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: t('meta.title'),
      description: t('meta.description'),
    }
  };
}
```

### 2. Sitemap Generation

```typescript
// app/sitemap.ts
import { MetadataRoute } from 'next';

const locales = ['pt-BR', 'en-US', 'es', 'fr', 'zh-CN'];
const baseUrl = 'https://tubespark.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ['', '/pricing', '/features', '/blog'];

  return routes.flatMap(route =>
    locales.map(locale => ({
      url: `${baseUrl}/${locale}${route}`,
      lastModified: new Date(),
      changeFrequency: route === '' ? 'weekly' : 'monthly',
      priority: route === '' ? 1.0 : 0.8,
      alternates: {
        languages: Object.fromEntries(
          locales.map(l => [l, `${baseUrl}/${l}${route}`])
        )
      }
    }))
  );
}
```

### 3. JSON-LD Schema Component

```typescript
// components/seo/json-ld.tsx
type SchemaProps = {
  type: 'Organization' | 'SoftwareApplication' | 'FAQPage' | 'BreadcrumbList';
  data: Record<string, unknown>;
  locale: string;
};

export function JsonLd({ type, data, locale }: SchemaProps) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': type,
    '@language': locale,
    ...data
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
```

### 4. Robots.ts Configuration

```typescript
// app/robots.ts
import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/dashboard/', '/settings/'],
    },
    sitemap: 'https://tubespark.com/sitemap.xml',
  };
}
```

---

## Anti-Patterns to Avoid

### ❌ Common SEO Mistakes

```typescript
// ❌ 1. Hardcoded metadata (not localized)
export const metadata = {
  title: 'Pricing - TubeSpark',  // WRONG: hardcoded
};

// ❌ 2. Missing hreflang alternates
alternates: {
  canonical: 'https://example.com/pricing',
  // WRONG: missing languages object
}

// ❌ 3. Hardcoded alt text
<Image alt="pricing table" />  // WRONG: not localized

// ❌ 4. Regular anchor tags
<a href="/pt-BR/pricing">Preços</a>  // WRONG: not using Link

// ❌ 5. Missing x-default
languages: {
  'pt-BR': '...',
  'en-US': '...',
  // WRONG: missing x-default
}

// ❌ 6. Wrong locale format in OpenGraph
locale: 'pt-BR',  // WRONG: should be 'pt_BR' (underscore)
```

### ✅ Correct SEO Patterns

```typescript
// ✅ 1. Dynamic localized metadata
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'Pricing' });
  return { title: t('meta.title') };
}

// ✅ 2. Complete hreflang alternates
alternates: {
  canonical: `https://example.com/${locale}/pricing`,
  languages: {
    'pt-BR': 'https://example.com/pt-BR/pricing',
    'en-US': 'https://example.com/en-US/pricing',
    'es': 'https://example.com/es/pricing',
    'fr': 'https://example.com/fr/pricing',
    'zh-CN': 'https://example.com/zh-CN/pricing',
    'x-default': 'https://example.com/en-US/pricing',
  }
}

// ✅ 3. Localized alt text
<Image alt={t('images.pricingTable')} />

// ✅ 4. next-intl Link component
import { Link } from '@/i18n/routing';
<Link href="/pricing">{t('nav.pricing')}</Link>

// ✅ 5. Correct OpenGraph locale
locale: locale.replace('-', '_'),  // 'pt_BR', 'zh_CN'
```

---

## Pre-Delivery SEO Checklist

Before delivering any page, verify:

### Metadata Quality
- [ ] Title 50-60 characters, includes primary keyword
- [ ] Description 150-160 characters, compelling CTA
- [ ] Both are localized via i18n
- [ ] No duplicate titles across locales

### International SEO
- [ ] All 5 locales in alternates.languages
- [ ] x-default present and correct
- [ ] Canonical URLs are absolute (https://...)
- [ ] Self-referencing hreflang included

### Technical SEO
- [ ] No console errors on page load
- [ ] Images optimized with Next/Image
- [ ] All links use next-intl routing
- [ ] JSON-LD validates at schema.org validator

### Performance (Core Web Vitals)
- [ ] LCP < 2.5s (images above fold optimized)
- [ ] CLS < 0.1 (no layout shifts)
- [ ] FID < 100ms (no blocking JS)

---

## Tips for Better SEO Results

1. **Always search multiple domains** - Metadata + Hreflang + Schema = Complete SEO
2. **Check all 5 locales** - Each locale may have specific requirements
3. **Validate JSON-LD** - Use schema.org validator before delivery
4. **Test with Lighthouse** - Run SEO audit in Chrome DevTools
5. **Check mobile-first** - Google indexes mobile version first
6. **Monitor Core Web Vitals** - Use PageSpeed Insights

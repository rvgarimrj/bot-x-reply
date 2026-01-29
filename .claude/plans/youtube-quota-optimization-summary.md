# YouTube API Quota Optimization - Summary for Handoff

## Overview

This document summarizes the YouTube API quota optimization implemented to reduce the CRON job consumption from **60-66% daily quota** to **~310 units monthly** (99.8% reduction).

## Problem Identified

The `update-niche-metrics` CRON was consuming excessive YouTube API quota:

| Metric | Before | After | Savings |
|--------|--------|-------|---------|
| Quota per niche | 601 units | 1-2 units | 99.7% |
| Monthly total | ~186,000 units | ~310 units | 99.8% |
| Daily consumption | 6,000-6,600 (60-66%) | ~10/month | 99.9% |

### Root Cause

The old implementation used `search.list` (100 units each):
- Saturation calculation: 100 units
- Top videos search: 100 units
- Seasonality Q1-Q4: 400 units (4 × 100)
- Video stats: 1 unit
- **Total: 601 units per niche**

## Solution Implemented

### 1. New Optimized Analyzer Function

**File**: `src/lib/youtube/regional-niche-analyzer.ts`

Added `analyzeNicheByRegionOptimized()` function that uses:
- `videos.list` with `chart=mostPopular` (1 unit) instead of `search.list` (100 units)
- Removed seasonality calculation (saves 400 units)
- Uses YouTube category IDs for niche mapping

```typescript
// Key change: videos.list (1 unit) vs search.list (100 units)
const videosResponse = await youtube.videos.list({
  key: apiKey,
  part: ['snippet', 'statistics', 'contentDetails'],
  chart: 'mostPopular',
  regionCode: regionConfig.regionCode,
  videoCategoryId: categoryId, // Maps niches to YouTube categories
  maxResults: 50,
});
```

### 2. New Monthly CRON Endpoint

**File**: `src/app/api/cron/update-niche-metrics-optimized/route.ts`

- Runs monthly (1st day at 3:00 AM UTC)
- Processes all 31 niches × 5 locales = 155 combinations
- Total quota: ~310 units/month

### 3. Updated vercel.json

```json
{
  "crons": [
    { "path": "/api/cron/process-analysis-queue", "schedule": "* * * * *" },
    { "path": "/api/cron/check-model-deprecations", "schedule": "0 4 * * *" },
    { "path": "/api/cron/update-niche-metrics-optimized", "schedule": "0 3 1 * *" }
  ]
}
```

**Removed**:
- `/api/cron/update-niche-metrics` (daily, 6000-6600 units)
- `/api/cron/discover-niches` (weekly, ~250 units)

### 4. Cache TTL Update

**File**: `src/lib/youtube/niche-data-fetcher.ts`

- Set `CACHE_TTL_DAYS = 60` (2 months)
- Data is valid for 60 days to account for monthly update cycle

### 5. Deprecated Old Endpoint

**File**: `src/app/api/cron/update-niche-metrics/route.ts`

- Added deprecation notice in JSDoc
- GET endpoint now returns deprecation warning
- Kept for backwards compatibility but not in CRON schedule

## Files Modified

| File | Action | Description |
|------|--------|-------------|
| `vercel.json` | Modified | Removed old CRONs, added optimized monthly |
| `src/lib/youtube/regional-niche-analyzer.ts` | Modified | Added `analyzeNicheByRegionOptimized()` |
| `src/app/api/cron/update-niche-metrics-optimized/route.ts` | Created | New optimized monthly CRON |
| `src/lib/youtube/niche-data-fetcher.ts` | Modified | Added cache TTL configuration |
| `src/app/api/cron/update-niche-metrics/route.ts` | Modified | Added deprecation notices |

## Trade-offs

### What We Lost

1. **Exact keyword matching** - Uses YouTube categories instead of keyword search
2. **Seasonality calculation** - `timing_score` is now fixed at 5 (neutral)
3. **Exact totalVideos count** - Estimated from trending sample
4. **Daily updates** - Now monthly

### What We Kept

1. ✅ All 31 niches
2. ✅ All 5 locales (pt-BR, en-US, es, fr, zh-CN)
3. ✅ Engagement scores (calculated from trending videos)
4. ✅ Difficulty scores (based on video duration)
5. ✅ Metadata (best publish day, peak hours, avg views)
6. ✅ Full locale/region support

## Quota Available for Other Features

With this optimization, you now have:

| Resource | Daily Budget | Monthly Budget |
|----------|--------------|----------------|
| **Before optimization** | ~3,400 units | ~102,000 units |
| **After optimization** | ~9,990 units | ~299,700 units |

This quota can be used for:
- Competitor suggestions API (`/api/competitors/suggest`) - 200-300 units each
- Trending analysis - 101 units each
- Comment fetching - 1 unit per 100 comments
- Channel resolution - 1-101 units depending on URL type

## Testing

To test the optimized CRON:

```bash
# Health check
curl http://localhost:3000/api/cron/update-niche-metrics-optimized

# Manual trigger (requires CRON_SECRET)
curl -X POST http://localhost:3000/api/cron/update-niche-metrics-optimized \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## Next Steps for Other Claude

1. **Review other YouTube API consumers** in the codebase:
   - `src/lib/youtube/channel-resolver.ts` - Variable quota (1-101)
   - `src/lib/youtube/trending-analyzer.ts` - 101 units per call
   - `src/app/api/competitors/suggest/route.ts` - 200-300 units per request

2. **Consider implementing**:
   - Response caching for competitor suggestions
   - Rate limiting per user for API-heavy endpoints
   - Quota monitoring dashboard

3. **Monitor**:
   - First monthly CRON execution to verify quota usage
   - Data freshness in `niche_metrics_regional` table

## Commit Information

Checkpoint commit before changes:
```
c543364 chore: estado antes da otimização do CRON de nichos
```

This optimization was implemented on branch: `feature/new-scoring-system`

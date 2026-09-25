# Scaling Guide — ActionStation

> **Status: Current** · Last reconciled: 2026-09-25 (rate-limiter section corrected against code; the phased plans were not re-verified). Update this line whenever you re-verify the doc against the code or live system.

This document describes how to scale the AI proxy infrastructure as user count grows.
It is written as a phased plan: each phase has a clear trigger, a concrete action, and an estimated cost.

---

## The Core Problem: In-Memory Rate Limiting

**Correction 2026-09-25:** in production (`K_SERVICE` set) `rateLimiterFactory.ts` already selects the Firestore-backed limiter (`firestoreRateLimiter.ts`, shared across instances); the in-memory `Map` is used only by the emulator and tests. The section below describes the original in-memory problem and may overstate current risk. `rateLimiter.ts` in the sentence below is now the facade.

Originally, `rateLimiter.ts` used a `Map` stored in the Cloud Function process memory.

```
User A → Instance 1 (counter: 5)
User A → Instance 2 (counter: 1)  ← different instance, counter restarted
```

**Effect at low scale:** Inconsistent limiting. Users sometimes get 429s when they shouldn't, or bypass limits when hitting different instances.

**Effect at high scale:** Useless protection. With 10 instances, a determined user can effectively make 10x the limit.

The fix is a **distributed rate limiter** backed by a shared store. The phases below describe when and how to migrate.

---

## Phase 1 — Current: 0–500 Users

**Status:** Acceptable with the 60 req/min limit set in `securityConstants.ts`.

**What you have now:**
- In-memory rate limiter (per instance)
- 60 requests/minute per user
- 10 Cloud Function max instances
- Gemini 2.0 Flash via proxy

**Known limitations:**
- Rate limit is inconsistent across instances (not blocking, just imprecise)
- No per-user lifetime quota (a single user could generate unlimited content)
- No cost cap per user

**Action items:**
- [ ] Monitor Gemini API costs weekly in AI Studio billing
- [ ] Set a GCP budget alert at ₹500/month → notify you via email
- [ ] Keep `maxInstances: 10` in `geminiProxy.ts` to bound worst-case cost

**Cost estimate:** ~$0–5/month for light usage.

---

## Phase 2 — 500–5,000 Users

**Trigger:** Gemini API costs exceed $20/month OR you start seeing unexpected 429s in production.

### Step 1: Replace in-memory rate limiter with Redis (Upstash)

[Upstash](https://upstash.com) is a serverless Redis that charges per-request (no idle cost). It's purpose-built for Cloud Functions.

**Install:**
```bash
cd functions
npm install @upstash/redis
```

**Create account:** upstash.com → create a Redis database → copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

**Store secrets in GCP Secret Manager:**
```bash
echo -n "YOUR_URL" | gcloud secrets create UPSTASH_REDIS_URL --data-file=-
echo -n "YOUR_TOKEN" | gcloud secrets create UPSTASH_REDIS_TOKEN --data-file=-
```

**Replace `rateLimiter.ts`:**
```typescript
import { Redis } from '@upstash/redis';
import { defineSecret } from 'firebase-functions/params';

const redisUrl = defineSecret('UPSTASH_REDIS_URL');
const redisToken = defineSecret('UPSTASH_REDIS_TOKEN');

export async function checkRateLimit(
    userId: string,
    endpoint: string,
    maxRequests: number,
    windowMs: number,
): Promise<boolean> {
    const redis = new Redis({
        url: redisUrl.value(),
        token: redisToken.value(),
    });

    const key = `rl:${userId}:${endpoint}`;
    const now = Date.now();
    const windowSec = Math.ceil(windowMs / 1000);

    // Sliding window using sorted set
    const pipe = redis.pipeline();
    pipe.zremrangebyscore(key, 0, now - windowMs);
    pipe.zadd(key, { score: now, member: `${now}-${Math.random()}` });
    pipe.zcard(key);
    pipe.expire(key, windowSec);
    const results = await pipe.exec();

    const count = results[2] as number;
    return count <= maxRequests;
}
```

**Update `geminiProxy.ts`** to add secrets:
```typescript
import { redisUrl, redisToken } from './utils/redisSecrets.js';

export const geminiProxy = onRequest(
    {
        cors: true,
        maxInstances: 10,
        secrets: [geminiApiKey, redisUrl, redisToken], // add redis secrets
    },
    ...
);
```

**Cost estimate (Upstash free tier):** 10,000 requests/day free. At 5,000 users × 10 AI requests/day = 50,000 req/day → ~$0.20/day ($6/month).

### Step 2: Add per-user daily quota in Firestore

Prevent a single power user from generating 1,000 nodes/day and driving up your Gemini bill.

**Firestore structure:**
```
/usage/{userId}/daily/{YYYY-MM-DD}
  → aiGenerations: number   (increment on each call)
  → lastUpdated: timestamp
```

**Check in `geminiProxy.ts` before forwarding:**
```typescript
import { getFirestore } from 'firebase-admin/firestore';

const DAILY_AI_LIMIT = 100; // generous for power users

async function checkDailyQuota(uid: string): Promise<boolean> {
    const db = getFirestore();
    const today = new Date().toISOString().slice(0, 10);
    const ref = db.doc(`usage/${uid}/daily/${today}`);

    const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists ? (snap.data()?.aiGenerations ?? 0) : 0;
        if (current >= DAILY_AI_LIMIT) return false;
        tx.set(ref, { aiGenerations: current + 1, lastUpdated: new Date() }, { merge: true });
        return true;
    });

    return result;
}
```

Add to Firestore rules:
```javascript
match /usage/{userId}/daily/{day} {
  allow read: if request.auth.uid == userId;
  allow write: if false; // only Cloud Function writes
}
```

**Cost estimate:** Firestore transactions are ~$0.18/100K writes. At 5,000 users × 10 calls/day = 50K writes/day → ~$0.09/day ($2.70/month).

---

## Phase 3 — 5,000–50,000 Users

**Trigger:** Gemini API costs exceed $100/month OR you need user tiers (free vs. pro).

### Step 1: Introduce user tiers

Add a `tier` field to the user's Firestore document:

```typescript
// /users/{userId}
{
  tier: 'free' | 'pro' | 'team',
  // ...
}
```

**Adjust limits per tier in `securityConstants.ts`:**
```typescript
export const TIER_LIMITS = {
    free:  { rpm: 10, dailyAi: 20  },
    pro:   { rpm: 60, dailyAi: 200 },
    team:  { rpm: 120, dailyAi: 1000 },
} as const;
```

Read the user's tier in `geminiProxy.ts` and apply the matching limit.

### Step 2: Queue-based generation for free tier

Instead of rejecting free-tier requests over limit, enqueue them:

1. Client calls `/geminiQueue` (new Cloud Function) → returns a `jobId`
2. Function writes job to Firestore: `{ status: 'pending', prompt, userId, createdAt }`
3. A second function triggers on Firestore write → calls Gemini → updates `{ status: 'done', result }`
4. Client polls or uses Firestore `onSnapshot` listener to get the result

This prevents frustrated users from seeing errors and lets you process requests at a controlled rate.

**Tools:** Cloud Tasks (GCP) is the production-grade option. Firestore triggers work fine up to ~100 req/min.

### Step 3: Increase Gemini API quota

In AI Studio:
1. Go to **Rate Limit** → **Request a quota increase**
2. For Gemini 2.0 Flash: request 2,000 RPM and 10M RPD (10x current)
3. Google reviews and approves within 1–3 business days

### Step 4: Enable Cloud CDN caching (optional)

For nodes with identical prompts (unlikely but possible in templates), Cloud CDN can cache Gemini responses at the Cloud Function level. Set `Cache-Control: public, max-age=3600` on deterministic generation responses.

---

## Phase 4 — 50,000+ Users

**Trigger:** You have revenue. Hire a backend engineer. The below is for reference.

### Architecture shift: Dedicated backend service

Cloud Functions become a bottleneck at this scale. Migrate to:

```
Client → Cloud Load Balancer
           ├─ Cloud Run (Node.js API, autoscaled)
           │    ├─ Redis (Cloud Memorystore) for rate limiting
           │    ├─ Firestore for user data
           │    └─ Pub/Sub queue for AI requests
           └─ Cloud CDN for static assets
```

**Key changes:**
- Replace `checkRateLimit` with Redis `INCR` + `EXPIRE` (atomic, sub-millisecond)
- Replace per-user Firestore quota with Redis counters (cheaper at scale)
- Use Pub/Sub + Cloud Run workers for async Gemini generation
- Add Vertex AI as a Gemini alternative (better SLAs, enterprise quotas)

### Enable Firebase App Check (already partially configured)

Prevents non-app clients from calling your proxy. In `geminiProxy.ts`:
```typescript
import { App } from 'firebase-admin/app';
// enforce App Check token in the Authorization header
```
This alone eliminates a large class of abuse at any scale.

---

## Cost Reference Table

| Scale | Users | Gemini Cost | Redis Cost | Firestore Extra | Total/month |
|-------|-------|-------------|------------|-----------------|-------------|
| Phase 1 | 0–500 | ~$0–5 | $0 (in-memory) | $0 | ~$5 |
| Phase 2 | 500–5K | ~$20–80 | ~$6 (Upstash) | ~$3 | ~$89 |
| Phase 3 | 5K–50K | ~$200–500 | ~$25 | ~$20 | ~$545 |
| Phase 4 | 50K+ | Negotiate | ~$100 (Memorystore) | ~$100 | Variable |

*Gemini 2.0 Flash pricing: ~$0.10/1M input tokens, $0.40/1M output tokens (as of early 2026).*

---

## Monitoring Checklist (Do This Now)

Before Phase 2, set up these three alerts in GCP:

1. **Budget alert:** GCP Console → Billing → Budgets → create at ₹1,000/month with email notification
2. **Error rate alert:** Cloud Monitoring → Alerting → new policy → `cloudfunctions.googleapis.com/function/execution_count` with `status=error` > 50/min
3. **429 rate alert:** Logs-based metric → filter `httpRequest.status=429 AND resource.labels.function_name=geminiProxy` → alert if > 20/min

---

## Quick Reference: What to Change When

| When | Change |
|------|--------|
| Getting 429s now | Already fixed: `GEMINI_RATE_LIMIT = 60` in `securityConstants.ts` |
| 500+ users | Add Upstash Redis rate limiter (Phase 2, Step 1) |
| Gemini bill > $20/mo | Add per-user daily quota in Firestore (Phase 2, Step 2) |
| Launching paid tiers | Add tier-based limits (Phase 3, Step 1) |
| 5K+ users | Queue-based generation + request Gemini quota increase |
| 50K+ users | Migrate to Cloud Run + Redis + Pub/Sub |

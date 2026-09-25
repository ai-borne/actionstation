# Uptime Monitoring Setup Guide

> **Status: Current** · Last reconciled: 2026-09-25 (checked against checklist (uptime checks live since 2026-09-20)). Update this line whenever you re-verify the doc against the code or live system.

## Production setup (Google Cloud Monitoring)

Live since 2026-09-20 in project `actionstation-244f0`, created by `scripts/setup-uptime-checks.sh`
(idempotent; needs the `Eden Alerts` email channel from `scripts/setup-monitoring-alerts.sh`).

| Check | Target | Expects |
|-------|--------|---------|
| `ActionStation site (www)` | `https://www.actionstation.in/` | HTTP 2xx, valid SSL |
| `ActionStation /health` | `https://us-central1-actionstation-244f0.cloudfunctions.net/health` | HTTP 2xx and body contains `"status":"ok"` |

Both run every 5 minutes from all six probe regions with a 10 s timeout (the health function has a ~5 s
cold start because `minInstances` is 0). Alert policies `CRITICAL: Site Down (www.actionstation.in)` and
`CRITICAL: /health Down` email the channel when 2+ regions report failure. Cost is inside the free tier.

Verify probes are passing:

```bash
gcloud monitoring uptime list-configs --project=actionstation-244f0
# results: Monitoring API timeSeries for monitoring.googleapis.com/uptime_check/check_passed,
# filtered by metric.labels.check_id="<id from list-configs>"
```

The rest of this page describes the endpoint and alternative third-party services.

---
ActionStation exposes a public health endpoint for uptime monitoring services.
No authentication is required — the endpoint is rate-limited to 60 req/min per IP.

---

## Health Endpoint

| Property | Value |
|----------|-------|
| **URL** | `https://<VITE_CLOUD_FUNCTIONS_URL>/health` |
| **Method** | `GET` only (405 for all others) |
| **Auth** | None |
| **Rate limit** | 60 req/min per IP |

### Expected response (200 OK)

```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2026-03-28T06:00:00.000Z"
}
```

### Error responses

| Status | Meaning |
|--------|---------|
| `405 Method Not Allowed` | Non-GET request |
| `429 Too Many Requests` | Rate limit exceeded |

---

## Recommended Services

| Service | Free tier | Interval | Notes |
|---------|-----------|----------|-------|
| [BetterUptime](https://betteruptime.com) | 10 monitors | 3 min | Best Slack/PagerDuty integration |
| [Checkly](https://www.checklyhq.com) | 50K checks/mo | 1 min | Scriptable, supports response body assertions |
| [UptimeRobot](https://uptimerobot.com) | 50 monitors | 5 min | Simplest setup |

---

## Configuration (BetterUptime example)

1. **Create monitor** → Simple check → HTTP
2. **URL**: `https://<your-functions-url>/health`
3. **Method**: `GET`
4. **Expected status**: `200`
5. **Response body must contain**: `"status":"ok"`
6. **Check interval**: 3 minutes
7. **Alert channels**: Email + Slack (`#incidents` channel)

### Response body assertion (Checkly / BetterUptime)

```javascript
// Assert all three fields are present
const body = JSON.parse(response.body);
assert.equal(body.status, 'ok');
assert.match(body.version, /^\d+\.\d+\.\d+/);
assert.ok(new Date(body.timestamp).getTime() > 0);
```

---

## Multi-region monitoring

The Firebase Hosting domain (`https://actionstation-244f0.web.app`) also serves
as a secondary health signal. Configure a second monitor:

- **URL**: `https://www.actionstation.in`
- **Expected status**: `200`
- **Check interval**: 5 minutes

---

## Alert escalation policy

| Condition | Action |
|-----------|--------|
| Health endpoint down ≥ 2 consecutive checks | Page on-call via Slack + email |
| Health endpoint down ≥ 10 minutes | PagerDuty incident (P1) |
| Hosting CDN down | PagerDuty incident (P2) |

---

## Structural test

`functions/src/__tests__/infrastructure.structural.test.ts` verifies the health
endpoint is exported from `functions/src/index.ts`. If the export is removed, the
test fails the build before the monitoring gap can happen.

---

*Created: 28 March 2026 — Phase 1E deliverable*

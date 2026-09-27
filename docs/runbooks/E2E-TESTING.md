# End-to-End Tests (Playwright)

> **Status: Current** · Last reconciled: 2026-09-26 (verified by running the suite locally: 22 tests, 6 spec files; CI job `e2e` green on `main` for the first 18).

Golden-path suite for checklist G12 (also covers F2 and F3). It runs the real app against the Firebase **Auth, Firestore and Storage emulators**. It never touches production, a real Google account, Gemini or Razorpay.

## Run it

```bash
npm run e2e          # starts the emulators (needs a JDK 21), the app on :5199, runs all specs, stops everything
npm run e2e:ui       # Playwright UI mode (start the emulators yourself first)
```

Single spec: `npx --yes firebase-tools@15.30.2 emulators:exec --only auth,firestore,storage --project demo-actionstation "npx playwright test capture"`

## How it works

- The app connects to the emulators only in Vite's **`e2e` mode** (`src/config/firebaseEmulators.ts`). Production builds run in `production` mode, so no env var or URL can point real users at an emulator. `src/__tests__/e2eIsolation.structural.test.ts` enforces this.
- Project id is `demo-actionstation` (the `demo-` prefix makes the emulators refuse real network calls).
- `playwright.config.ts` pins every optional `VITE_*` flag. A local `.env.local` with `VITE_DEV_BYPASS_SUBSCRIPTION=true` once made every test user Pro.
- **Sign-in** goes through the Auth emulator's fake Google popup (`e2e/fixtures/app.ts`); no real account is needed.
- **First-run overlays** (welcome, demo cards, tour, What's New, analytics banner) are suppressed by pre-setting the app's own localStorage keys.
- **Gemini** (`geminiProxy`), **`createRazorpayOrder`** and **`onUserDeleted`** are stubbed with `page.route` (`e2e/fixtures/ai.ts`, `billing.ts`, `callable.ts`). The Functions emulator is not used.
- Persistence is proven by reading the Firestore emulator over REST (`readPersistedNodes`), not by the UI's "All changes saved" pill.

## What is covered

| Spec | Proves |
|------|--------|
| `auth` | sign-in reaches the canvas, session survives reload, sign-out |
| `capture` | double-click creates a card; title and note reach Firestore and survive reload |
| `resilience` | second tab is a warned follower that never saves; it takes over when the leader closes; with three tabs exactly one takes over (F2); an offline card is saved on reconnect; on emulated slow 3G a card saves and a reload reaches the canvas (F3) |
| `performance` | 500 seeded cards: the open time is printed but not asserted (4 s locally, 17-23 s on a CI runner, dev server); zoom holds >30 fps with no frame over 500 ms (F1). Numbers are printed as `F1 open ...` |
| `touch` | emulated touch (CDP): pinch zooms, one-finger drag pans the canvas, one-finger drag moves a card (F5) |
| `accessibility` | axe-core on the signed-in canvas (0 violations), skip link reachable and moves focus to the canvas, a card created with the keyboard alone (F6) |
| `ai` | prompt card gets an answer and is saved; the daily limit blocks the call; the upgrade button requests the annual plan |
| `limits` | free workspace stops at exactly 12 cards; a Pro user goes past it |
| `export-delete` | Export Workspace downloads JSON with the cards; delete-account calls cleanup, removes the Auth user, signs out; cancel keeps the account |

## Not covered (still open)

- Server-side erasure and the Firebase Functions themselves (unit-tested in `functions/`, stubbed here). `Export All My Data` (server export) is not exercised.
- Real Razorpay checkout and webhooks: see `docs/runbooks/PAYMENT-E2E-DRILL.md`.
- F1 (500+ nodes), F4 (Firefox/Safari/mobile), F5 (touch), F6 (accessibility). The suite runs Chromium only.
- A7 (production smoke): signed-in production paths cannot be automated with a real Google account.

## App bugs this suite found (fixed 2026-09-25)

- A card's title and note body were committed to the store only on blur, so text typed just before closing the tab was never saved. Both now also commit 400 ms after typing pauses (`EDIT_COMMIT_DELAY_MS`) and on unmount. Covered by `capture.spec.ts` ("saved while typing") and unit tests.
- The Add-Node button and double-click worked while the workspace was still loading, and the load then replaced the canvas, wiping the new card. Creation is now blocked (button disabled) until loading finishes. Covered by `limits.spec.ts` (early click) and unit tests.
- Two followers claimed leadership at the same moment when the editing tab closed, each yielded to the other, and no tab edited (4 of 6 three-tab runs). A leader now yields only to a lower tab id (`tabLeaderService.ts`). Covered by `resilience.spec.ts` (three tabs) and `tabLeader.tieBreak.test.ts`.

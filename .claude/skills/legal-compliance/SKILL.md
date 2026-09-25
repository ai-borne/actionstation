---
name: legal-compliance
description: Legal feature (terms, privacy, cookie consent) files and strings. Use when editing src/features/legal.
---

**Legal feature** (`src/features/legal/`):
- `LegalPage.tsx` — Routes to Terms/Privacy
- `TermsOfService.tsx` / `PrivacyPolicy.tsx` — Static content via `TermsContent.tsx` / `PrivacyContent.tsx`
- `CookieConsentBanner.tsx` — Consent UI
- `useConsentState` hook — Consent state management
- `consentService.ts` — Persistence + compliance tracking
- Strings: `src/shared/localization/legalStrings.ts`

# Google Calendar OAuth Migration Guide
## From Token API to Authorization Code Flow with Refresh Tokens

### Problem Statement
Current implementation uses Token API (implicit flow) which only provides 1-hour access tokens without refresh tokens, requiring users to re-authenticate every hour.

### Solution
Migrate to Authorization Code Flow to get refresh tokens that enable automatic silent token renewal.

---

## Architecture Changes

### Current (Token API - ❌ No Refresh)
```
User → Google OAuth Popup → Access Token (1hr) → localStorage
     ↓
   After 1hr: User must re-authenticate
```

### Target (Authorization Code Flow - ✅ Refresh Tokens)
```
User → Google OAuth Screen → Authorization Code
     ↓
Cloud Function → Exchange Code → Access Token + Refresh Token
     ↓
Firestore (encrypted) → Auto-refresh when expired
     ↓
No re-authentication needed (tokens last months/years)
```

---

## Implementation Steps

### 1. Google Cloud Console Configuration

**Add Redirect URI**:
```
https://yourdomain.com/auth/calendar/callback
```

**Update OAuth Scope**:
```
https://www.googleapis.com/auth/calendar.events.owned
```

**OAuth Consent Screen**:
- Set to "Internal" if Google Workspace org
- Or submit for verification if "External"

### 2. Cloud Function for Token Exchange

**File**: `functions/src/calendarAuth.ts`

```typescript
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { google } from 'googleapis';
import * as admin from 'firebase-admin';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

/**
 * Exchange authorization code for tokens
 * Returns access token to client, stores refresh token in Firestore
 */
export const exchangeCalendarCode = onCall(async (request) => {
  const { code } = request.data;
  const userId = request.auth?.uid;

  if (!userId) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  if (!code) {
    throw new HttpsError('invalid-argument', 'Authorization code required');
  }

  try {
    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new HttpsError('internal', 'Failed to obtain tokens');
    }

    // Store refresh token securely in Firestore (encrypted at rest)
    await admin.firestore()
      .collection('users')
      .doc(userId)
      .collection('integrations')
      .doc('calendar')
      .set({
        refreshToken: tokens.refresh_token,
        scope: tokens.scope,
        tokenType: tokens.token_type,
        expiryDate: tokens.expiry_date,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

    // Return access token to client (short-lived, safe to expose)
    return {
      accessToken: tokens.access_token,
      expiresIn: tokens.expiry_date
        ? Math.floor((tokens.expiry_date - Date.now()) / 1000)
        : 3600,
    };
  } catch (error) {
    console.error('Token exchange failed:', error);
    throw new HttpsError('internal', 'Failed to exchange authorization code');
  }
});

/**
 * Refresh access token using stored refresh token
 * Called automatically when access token expires
 */
export const refreshCalendarToken = onCall(async (request) => {
  const userId = request.auth?.uid;

  if (!userId) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    // Retrieve refresh token from Firestore
    const integrationDoc = await admin.firestore()
      .collection('users')
      .doc(userId)
      .collection('integrations')
      .doc('calendar')
      .get();

    if (!integrationDoc.exists) {
      throw new HttpsError('not-found', 'Calendar integration not found');
    }

    const { refreshToken } = integrationDoc.data() as { refreshToken: string };

    if (!refreshToken) {
      throw new HttpsError('failed-precondition', 'No refresh token available');
    }

    // Use refresh token to get new access token
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await oauth2Client.refreshAccessToken();

    if (!credentials.access_token) {
      throw new HttpsError('internal', 'Failed to refresh access token');
    }

    // Update expiry date in Firestore
    await integrationDoc.ref.update({
      expiryDate: credentials.expiry_date,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      accessToken: credentials.access_token,
      expiresIn: credentials.expiry_date
        ? Math.floor((credentials.expiry_date - Date.now()) / 1000)
        : 3600,
    };
  } catch (error) {
    console.error('Token refresh failed:', error);
    throw new HttpsError('internal', 'Failed to refresh access token');
  }
});
```

### 3. Frontend: Initiate Authorization Code Flow

**File**: `src/features/auth/services/calendarAuthService.ts`

```typescript
import { getFunctions, httpsCallable } from 'firebase/functions';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const REDIRECT_URI = `${window.location.origin}/auth/calendar/callback`;
const SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';

/**
 * Initiate OAuth Authorization Code flow
 * Opens Google consent screen, redirects back with authorization code
 */
export async function connectGoogleCalendar(): Promise<void> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;

  // Generate random state for CSRF protection
  const state = generateRandomString(32);
  sessionStorage.setItem('oauth_state', state);

  // Build authorization URL
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline', // ⚡ Critical: Request refresh token
    prompt: 'consent',      // ⚡ Force consent to get refresh token
    state: state,
  });

  // Redirect to Google OAuth screen
  window.location.href = `${GOOGLE_AUTH_URL}?${params}`;
}

/**
 * Handle OAuth callback with authorization code
 * Exchanges code for tokens via Cloud Function
 */
export async function handleCalendarCallback(
  searchParams: URLSearchParams
): Promise<boolean> {
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const storedState = sessionStorage.getItem('oauth_state');

  // Verify state to prevent CSRF attacks
  if (!code || !state || state !== storedState) {
    console.error('Invalid OAuth callback');
    return false;
  }

  sessionStorage.removeItem('oauth_state');

  try {
    // Exchange code for tokens via Cloud Function
    const functions = getFunctions();
    const exchangeCode = httpsCallable(functions, 'exchangeCalendarCode');
    const result = await exchangeCode({ code });

    const { accessToken, expiresIn } = result.data as {
      accessToken: string;
      expiresIn: number;
    };

    // Store access token in localStorage (short-lived, will auto-refresh)
    const expiryTime = Date.now() + (expiresIn - 60) * 1000;
    localStorage.setItem('eden_calendar_token', accessToken);
    localStorage.setItem('eden_calendar_expiry', expiryTime.toString());

    useAuthStore.getState().setCalendarConnected(true);
    return true;
  } catch (error) {
    console.error('Failed to exchange authorization code:', error);
    return false;
  }
}

/**
 * Refresh access token when expired
 * Called automatically by calendar client
 */
export async function refreshCalendarToken(): Promise<string | null> {
  try {
    const functions = getFunctions();
    const refresh = httpsCallable(functions, 'refreshCalendarToken');
    const result = await refresh();

    const { accessToken, expiresIn } = result.data as {
      accessToken: string;
      expiresIn: number;
    };

    // Update stored access token
    const expiryTime = Date.now() + (expiresIn - 60) * 1000;
    localStorage.setItem('eden_calendar_token', accessToken);
    localStorage.setItem('eden_calendar_expiry', expiryTime.toString());

    return accessToken;
  } catch (error) {
    console.error('Failed to refresh token:', error);
    return null;
  }
}

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}
```

### 4. Calendar Client: Auto-Refresh Token

**File**: `src/features/calendar/services/serverCalendarClient.ts`

```typescript
import { refreshCalendarToken } from '@/features/auth/services/calendarAuthService';

async function fetchGoogleApi<T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  let token = getCalendarToken();

  // Auto-refresh if token is expired
  if (!token) {
    token = await refreshCalendarToken();
    if (!token) {
      throw new Error(REAUTH_REQUIRED);
    }
  }

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const res = await fetch(`${GOOGLE_CALENDAR_API}${endpoint}`, {
    ...options,
    headers,
  });

  // If 401, try refreshing token once
  if (res.status === 401) {
    const newToken = await refreshCalendarToken();
    if (!newToken) {
      throw new Error(REAUTH_REQUIRED);
    }

    // Retry request with new token
    const retryRes = await fetch(`${GOOGLE_CALENDAR_API}${endpoint}`, {
      ...options,
      headers: {
        ...headers,
        'Authorization': `Bearer ${newToken}`,
      },
    });

    if (!retryRes.ok) {
      throw new Error(REAUTH_REQUIRED);
    }

    return (await retryRes.json()) as T;
  }

  if (!res.ok) {
    throw new Error('Calendar API request failed');
  }

  return (await res.json()) as T;
}
```

### 5. OAuth Callback Route

**File**: `src/features/auth/components/CalendarCallback.tsx`

```typescript
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { handleCalendarCallback } from '../services/calendarAuthService';

export function CalendarCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const handleCallback = async () => {
      const success = await handleCalendarCallback(searchParams);

      if (success) {
        // Redirect back to canvas or wherever user was
        navigate('/canvas', { replace: true });
      } else {
        // Show error
        navigate('/', { replace: true });
      }
    };

    handleCallback();
  }, [searchParams, navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
        <p className="mt-4">Connecting your calendar...</p>
      </div>
    </div>
  );
}
```

**File**: `src/App.tsx` (add route)

```typescript
<Route path="/auth/calendar/callback" element={<CalendarCallback />} />
```

### 6. Firestore Security Rules

**File**: `firestore.rules`

```javascript
match /users/{userId}/integrations/{integrationId} {
  allow read, write: if request.auth != null
                    && request.auth.uid == userId;
}
```

### 7. Environment Variables

**File**: `.env.local` (frontend)

```bash
VITE_GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
```

**Firebase Cloud Secret** (backend)

```bash
# Set via Firebase CLI
firebase functions:secrets:set GOOGLE_CLIENT_SECRET
# Paste your client secret when prompted

firebase functions:secrets:set GOOGLE_CLIENT_ID
# Paste your client ID

firebase functions:secrets:set GOOGLE_REDIRECT_URI
# Enter: https://yourdomain.com/auth/calendar/callback
```

**Update Cloud Function config**:

```typescript
// functions/src/calendarAuth.ts
export const exchangeCalendarCode = onCall({
  secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI']
}, async (request) => {
  // ... function code
});
```

---

## Testing Checklist

- [ ] Google Cloud Console redirect URI matches exactly
- [ ] `access_type: 'offline'` and `prompt: 'consent'` in auth URL
- [ ] Cloud Function receives authorization code correctly
- [ ] Refresh token stored in Firestore
- [ ] Access token auto-refreshes on expiry
- [ ] User doesn't need to re-auth after 1 hour
- [ ] Firestore security rules prevent unauthorized access
- [ ] Error handling for revoked tokens

---

## Why This Fixes the Looping Issue

**Common causes of looping (and how this fixes them)**:

1. **Wrong Redirect URI**: Exactly match Google Cloud Console config
2. **Missing `prompt: 'consent'`**: Always request refresh token
3. **State mismatch**: Proper CSRF protection with sessionStorage
4. **Token not stored**: Cloud Function persists refresh token before redirect
5. **Race conditions**: Single callback handler, atomic token exchange

---

## Benefits Over Current Implementation

| Feature | Token API (Current) | Auth Code Flow (Proposed) |
|---------|---------------------|---------------------------|
| User re-authentication | Every 1 hour ❌ | Once (until revoked) ✅ |
| Refresh tokens | No ❌ | Yes ✅ |
| Security | Client-side token | Server-side refresh token ✅ |
| User experience | Poor (frequent prompts) | Excellent ✅ |
| Token lifespan | 1 hour | Months/years ✅ |

---

## Migration Path

1. **Phase 1**: Implement Cloud Functions (week 1)
2. **Phase 2**: Add callback route and handler (week 1)
3. **Phase 3**: Test with single user (week 2)
4. **Phase 4**: Deploy to staging (week 2)
5. **Phase 5**: Roll out to production (week 3)

**Estimated effort**: 2-3 weeks for full migration

---

## Alternative: Quick Fix (Not Recommended)

If you absolutely cannot implement Authorization Code flow immediately:

**Option A: Extend token duration perception**
- Check token expiry before each request
- Silently re-auth in background popup (still requires user click)
- Not a real solution, just UX band-aid

**Option B: Service Account** (only if managing org calendars)
- Use service account with domain-wide delegation
- No user auth needed
- Only works for Google Workspace domains
- Cannot access personal Gmail calendars

**Recommendation**: Implement proper Authorization Code flow. It's the only sustainable solution.

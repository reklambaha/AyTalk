# AyTalk Security Migration

## Applied in this package
- Added Firebase Admin ID-token verification middleware (`server/auth/firebaseAuth.js`).
- Added additive `/auth/session` endpoint; existing LiveBridge behavior remains unchanged.
- Added `aytalk_accounts` table for stable AyTalk user IDs tied to verified Firebase UID/phone.
- Fixed background FCM profile refresh sending an empty display name.
- Stored LiveBridge name/language with the local profile so token refresh can re-register safely.
- Hardened optional Sentry handling so a DSN without the SDK cannot crash error paths.
- Corrected privacy text to match Render PostgreSQL and persisted matched contact display names.
- Added backend syntax verification to Android CI.

## Not yet enforced
Existing LiveBridge routes still accept the legacy phone-based request fields and `x-app-key`.
This is intentional for a non-breaking migration. The next phase is mobile phone OTP + bearer token,
then endpoint-by-endpoint authorization using the authenticated account.

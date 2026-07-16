# PCC Status Proxy Server

A tiny Express server that sits between the React app and the Delhi Police
PCC portal, so the browser never calls `pcccvr.delhipolice.gov.in` directly.

## Setup

```bash
cd server
npm install
npm start
```

Runs on `http://localhost:5000` by default. Override with a `PORT` env var.

## Endpoints

- `POST /api/pcc-status/search` — body `{ applicationNumber, applicantName, guardianName }`.
  Forwards to Delhi Police's `search-pcc-application` and returns the
  `applicationID` for the matched application.
- `POST /api/pcc-status/progress` — body `{ applicationID }`. **Placeholder** —
  see below.
- `POST /api/pcc-status/check` — convenience endpoint the frontend actually
  calls: does the search, then the progress lookup, in one round trip.

## What's still needed from you

The "progress" step (`get-pcc-application-status` or whatever it's actually
called) hasn't been confirmed yet — I don't have its real endpoint path,
request payload, or response shape. Right now `index.js` guesses at a path
and just forwards `{ applicationID }`, returning whatever comes back
unchanged.

Once you share:
1. The exact endpoint path/name for the status lookup.
2. The request payload it expects.
3. A sample response (or its shape — field names for stage/status,
   certificate URL, etc.)

...I'll update `progress` in `index.js` and the `mapToSteps()` function in
`src/pages/Applications.jsx` (frontend) so the stepper — Submitted → Field
Verification → Approved → Certificate Issued, plus the "Download
Certificate" button — reflects the real data instead of placeholders.

## Environment

- `DELHI_PCC_BASE_URL` — defaults to `https://pcccvr.delhipolice.gov.in/api/PccForm`.
- `PORT` — defaults to `5000`.
- `SUPABASE_URL` — your Supabase project URL (same one in `src/lib/supabase.js`).
- `SUPABASE_SERVICE_ROLE_KEY` — **secret**, from Settings → API → service_role.
  Only ever set this here, never in the React app. It's what lets this
  server create a login (email + password) for a dealer or dealer's
  sub-staff without them having to self-register first.

## Account-creation endpoints

- `POST /api/admin/create-dealer-login` — staff-only. Body:
  `{ accessToken, dealerId, email, password }`. Creates the dealer's
  primary login and links it, replacing the old "must sign up first, then
  admin links the email" flow.
- `POST /api/create-dealer-staff-login` — staff OR the dealer themself
  (only for their own `dealerId`). Body:
  `{ accessToken, dealerId, fullName, email, password }`. Creates a
  sub-staff login under that dealer (see `dealer_staff` table).

`accessToken` is the caller's current Supabase session access token
(`(await supabase.auth.getSession()).data.session.access_token` from the
React app) — used server-side to check whether they're staff or the dealer
in question before creating anything.

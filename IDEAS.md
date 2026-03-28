# Instagram Hurdle — Ideas & Future Work

---

## 🏃 Activity & Tracking

- **Support additional fitness providers** alongside Strava
  - **Polar** — Accesslink API, requires its own OAuth flow
  - **Whoop** — WHOOP API v1, sleep/recovery/workout data
  - **Oura** — Oura API v2, ring-based activity and readiness data
  - **Apple Watch / Apple Health** — via a companion iOS shortcut or HealthKit export; no direct browser API, but a local helper app or Shortcuts automation could write a daily summary to a shared location the extension reads
  - Each provider would need its own OAuth flow and activity-fetching logic
  - Could add a provider selector in the popup

- **Customizable activity type** — not just runs; let the user pick cycling,
  swimming, or any Strava sport type as the qualifying activity

- **Customizable distance threshold** — currently hardcoded at 2 miles;
  expose this as a setting in the popup so the user can dial it up or down

- **Multiple activities as the unlock condition** — e.g. "run AND a strength
  session" or "any two workouts" before Instagram unlocks

- **Alternative unlock conditions** — beyond just distance-based runs:
  - **Step count** — e.g. 10,000 steps as the qualifying threshold
  - **Calories burned** — set a daily active-calorie target to unlock
  - These require provider support (Apple Health, Whoop, Oura all expose
    daily step and calorie data)

---

## 🗺️ Map & Stats Display

- **Fix Leaflet + CARTO map rendering** — currently falling back to canvas
  because Chrome MV3 blocks CDN scripts; Leaflet is bundled locally in
  `libs/` but the tile images from `*.basemaps.cartocdn.com` need to be
  verified in the CSP (`img-src`)

- **Satellite map style** — swap CARTO Dark Matter for a satellite tile layer
  so you can literally see the streets and terrain you ran on

- **Heart rate zone overlay** — color the route line by heart rate zone
  (requires `average_heartrate` per GPS point, available via the detailed
  activity endpoint rather than the summary)

- **Streak counter on the gate page** — show a "🔥 5-day streak" badge to
  add a motivational element when you're blocked

---

## ⚙️ Settings & Configuration

- **Popup settings panel** — let the user configure all unlock parameters
  without touching code. Specific settings to expose:
  - **Distance threshold** — slider or number input (default 2 miles)
  - **Blocked website** — let the user swap `instagram.com` for any domain
    (e.g. `twitter.com`, `reddit.com`) or add multiple blocked sites
  - **Activity type** — run, ride, swim, walk, or any Strava sport type
  - **Today's unlocking exercises** — show a summary of which activities
    counted toward the unlock condition so the user can see what earned
    their access

- **DST / timezone edge case** — the "today" calculation uses local midnight;
  test behavior around Daylight Saving Time clock changes

---

## 🔒 Security & Distribution

- **Backend token proxy for public distribution**
  - Currently `STRAVA_CLIENT_SECRET` lives in `config.js` inside the
    extension bundle — anyone who installs a publicly distributed `.crx`
    can unzip it and read the secret
  - The secret alone can't access user data (OAuth still required) but it
    could be used to impersonate the app and burn your rate limit
  - **Solution:** a small serverless function (Cloudflare Worker or Vercel)
    that holds the secret server-side and proxies the token exchange:
    ```
    Extension ──► Your server (holds CLIENT_SECRET) ──► Strava API
    ```
  - Only needed if publishing to the Chrome Web Store for a large audience;
    overkill for personal or small-group use
  - If credentials are ever compromised: regenerate the Client Secret at
    strava.com/settings/api and update `config.js`

- **Publish to the Chrome Web Store** — requires resolving the credential
  exposure issue above and writing a store listing

---

## 🧪 Testing & Reliability

- **Dev/test mode** — a way to simulate "run logged" without actually having
  a Strava activity, to make it easier to test the unlock flow during
  development

- **Offline graceful degradation** — if Strava is unreachable (no internet),
  decide whether to block or allow Instagram rather than showing an API error

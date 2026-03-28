// Instagram Hurdle — Service Worker
// Blocks instagram.com until a 2+ mile run is logged on Strava today.

const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API_BASE = 'https://www.strava.com/api/v3';
const TWO_MILES_METERS = 3218.69;
const BLOCK_RULE_ID = 1;

// ─── Utilities ───────────────────────────────────────────────────────────────

function getTodayString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getTodayStartUnix() {
  const d = new Date();
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000);
}

function get(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function set(items) {
  return new Promise(resolve => chrome.storage.local.set(items, resolve));
}

// ─── Block Rule ───────────────────────────────────────────────────────────────

async function addBlockRule() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [BLOCK_RULE_ID],
    addRules: [{
      id: BLOCK_RULE_ID,
      priority: 1,
      action: {
        type: 'redirect',
        redirect: { extensionPath: '/blocked.html' }
      },
      condition: {
        urlFilter: '||instagram.com/',
        resourceTypes: ['main_frame']
      }
    }]
  });
}

async function removeBlockRule() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [BLOCK_RULE_ID]
  });
}

// ─── Strava Token Management ──────────────────────────────────────────────────

async function getValidAccessToken() {
  const data = await get([
    'stravaAccessToken',
    'stravaRefreshToken',
    'stravaTokenExpiry',
    'stravaClientId',
    'stravaClientSecret'
  ]);

  if (!data.stravaAccessToken || !data.stravaRefreshToken) return null;

  // Token still valid (with 60s buffer)
  if (data.stravaTokenExpiry && (Date.now() / 1000) < (data.stravaTokenExpiry - 60)) {
    return data.stravaAccessToken;
  }

  // Refresh
  return refreshAccessToken(
    data.stravaRefreshToken,
    data.stravaClientId,
    data.stravaClientSecret
  );
}

async function refreshAccessToken(refreshToken, clientId, clientSecret) {
  try {
    const resp = await fetch(STRAVA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });

    if (!resp.ok) return null;

    const data = await resp.json();
    await set({
      stravaAccessToken: data.access_token,
      stravaRefreshToken: data.refresh_token,
      stravaTokenExpiry: data.expires_at
    });

    return data.access_token;
  } catch {
    return null;
  }
}

// ─── Strava Activity Check ────────────────────────────────────────────────────

async function checkTodaysRun() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return { connected: false, hasRun: false };

  try {
    const after = getTodayStartUnix();
    const resp = await fetch(
      `${STRAVA_API_BASE}/athlete/activities?after=${after}&per_page=30`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!resp.ok) return { connected: true, hasRun: false, apiError: true };

    const activities = await resp.json();
    const qualifying = activities.find(
      a => (a.type === 'Run' || a.sport_type === 'Run') && a.distance >= TWO_MILES_METERS
    );

    if (!qualifying) return { connected: true, hasRun: false };

    // Extract only the fields we need so we don't store the full Strava payload
    const activity = {
      id:                    qualifying.id,
      name:                  qualifying.name,
      distance:              qualifying.distance,
      moving_time:           qualifying.moving_time,
      total_elevation_gain:  qualifying.total_elevation_gain,
      average_heartrate:     qualifying.average_heartrate || null,
      start_date_local:      qualifying.start_date_local,
      polyline:              qualifying.map?.summary_polyline || null
    };

    return { connected: true, hasRun: true, activity };
  } catch {
    return { connected: true, hasRun: false, apiError: true };
  }
}

// ─── Core Enforcement Logic ───────────────────────────────────────────────────

async function checkAndEnforceBlock() {
  const data = await get(['unlockedDate', 'stravaClientId']);
  const today = getTodayString();

  // Strava not configured yet
  if (!data.stravaClientId) {
    await addBlockRule();
    return { status: 'not_configured' };
  }

  // Already unlocked today — no need to hit the API again
  if (data.unlockedDate === today) {
    await removeBlockRule();
    const { lastRunActivity } = await get('lastRunActivity');
    return { status: 'unlocked', activity: lastRunActivity || null };
  }

  // Check Strava for today's run
  const result = await checkTodaysRun();

  if (result.hasRun) {
    await set({ unlockedDate: today, lastRunActivity: result.activity });
    await removeBlockRule();
    return { status: 'unlocked', activity: result.activity || null };
  }

  await addBlockRule();

  if (!result.connected) return { status: 'not_connected' };
  if (result.apiError) return { status: 'api_error' };
  return { status: 'no_run' };
}

// ─── Strava OAuth ─────────────────────────────────────────────────────────────

async function connectStrava(clientId, clientSecret) {
  // Save credentials first so they're available for token exchange
  await set({ stravaClientId: clientId, stravaClientSecret: clientSecret });

  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org`;
  const authUrl = [
    `${STRAVA_AUTH_URL}?client_id=${encodeURIComponent(clientId)}`,
    `redirect_uri=${encodeURIComponent(redirectUri)}`,
    'response_type=code',
    'approval_prompt=auto',
    'scope=activity:read_all'
  ].join('&');

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async responseUrl => {
      if (chrome.runtime.lastError || !responseUrl) {
        reject(chrome.runtime.lastError?.message || 'OAuth cancelled');
        return;
      }

      const code = new URL(responseUrl).searchParams.get('code');
      if (!code) {
        reject('No authorization code returned');
        return;
      }

      try {
        const resp = await fetch(STRAVA_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: 'authorization_code'
          })
        });

        if (!resp.ok) {
          reject('Token exchange failed');
          return;
        }

        const tokenData = await resp.json();
        await set({
          stravaAccessToken: tokenData.access_token,
          stravaRefreshToken: tokenData.refresh_token,
          stravaTokenExpiry: tokenData.expires_at
        });

        resolve(true);
      } catch (err) {
        reject(String(err));
      }
    });
  });
}

async function disconnectStrava() {
  await new Promise(resolve =>
    chrome.storage.local.remove(
      ['stravaAccessToken', 'stravaRefreshToken', 'stravaTokenExpiry', 'unlockedDate', 'lastRunActivity'],
      resolve
    )
  );
  await addBlockRule();
}

// ─── Message Handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.action) {
    case 'getStatus':
      checkAndEnforceBlock().then(sendResponse);
      return true;

    case 'connect':
      connectStrava(msg.clientId, msg.clientSecret)
        .then(() => checkAndEnforceBlock())
        .then(result => sendResponse({ success: true, ...result }))
        .catch(err => sendResponse({ success: false, error: String(err) }));
      return true;

    case 'disconnect':
      disconnectStrava()
        .then(() => sendResponse({ success: true, status: 'not_connected' }))
        .catch(err => sendResponse({ success: false, error: String(err) }));
      return true;

    case 'checkAgain':
      // Force re-check by clearing today's cached unlock, then re-enforce
      chrome.storage.local.remove(['unlockedDate', 'lastRunActivity'], () => {
        checkAndEnforceBlock().then(sendResponse);
      });
      return true;
  }
});

// ─── Lifecycle ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => checkAndEnforceBlock());
chrome.runtime.onStartup.addListener(() => checkAndEnforceBlock());

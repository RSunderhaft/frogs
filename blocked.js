// Gate page logic — communicates with the background service worker

const $ = id => document.getElementById(id);

const badge       = $('status-badge');
const statusText  = $('status-text');
const emoji       = $('emoji');
const title       = $('title');
const subtitle    = $('subtitle');

function setStatus(cls, text) {
  badge.className = `status-badge ${cls}`;
  statusText.textContent = text;
}

function showSection(id) {
  ['setup-section', 'no-run-section', 'reconnect-section'].forEach(s => {
    $(s).classList.toggle('hidden', s !== id);
  });
}

function hideAllSections() {
  ['setup-section', 'no-run-section', 'reconnect-section'].forEach(s =>
    $(s).classList.add('hidden')
  );
}

function applyStatus(result) {
  switch (result.status) {
    case 'unlocked':
      emoji.textContent = '✅';
      title.textContent = 'Unlocked!';
      subtitle.textContent = 'You earned it. Enjoy Instagram.';
      setStatus('unlocked', 'Run verified');
      hideAllSections();
      $('redirecting').classList.remove('hidden');
      setTimeout(() => { window.location.href = 'https://www.instagram.com/'; }, 1500);
      break;

    case 'no_run':
      emoji.textContent = '🏃';
      title.textContent = 'Not yet.';
      subtitle.textContent = 'Log a run of at least 2 miles on Strava first, then come back.';
      setStatus('no-run', 'No qualifying run today');
      showSection('no-run-section');
      break;

    case 'not_connected':
      emoji.textContent = '🔌';
      title.textContent = 'Connect Strava';
      subtitle.textContent = 'Your Strava session expired. Reconnect to continue.';
      setStatus('error', 'Not connected');
      showSection('reconnect-section');
      break;

    case 'not_configured':
      emoji.textContent = '⚙️';
      title.textContent = 'Setup required';
      subtitle.textContent = 'Connect your Strava account to get started.';
      setStatus('checking', 'Not configured');
      showSection('setup-section');
      // Show the callback domain so user knows what to enter in Strava
      $('callback-domain').textContent = `${chrome.runtime.id}.chromiumapp.org`;
      break;

    case 'api_error':
      emoji.textContent = '⚠️';
      title.textContent = 'Strava unavailable';
      subtitle.textContent = 'Could not reach the Strava API. Check your connection and try again.';
      setStatus('error', 'API error');
      showSection('no-run-section');
      break;

    default:
      setStatus('error', 'Unknown error');
      showSection('no-run-section');
  }
}

// ─── Initial status check ─────────────────────────────────────────────────────

setStatus('checking', 'Checking Strava...');
chrome.runtime.sendMessage({ action: 'getStatus' }, result => {
  if (chrome.runtime.lastError) {
    setStatus('error', 'Extension error');
    return;
  }
  applyStatus(result);
});

// ─── Check Again button ───────────────────────────────────────────────────────

$('check-btn').addEventListener('click', () => {
  $('check-btn').disabled = true;
  setStatus('checking', 'Checking Strava...');
  chrome.runtime.sendMessage({ action: 'checkAgain' }, result => {
    $('check-btn').disabled = false;
    applyStatus(result);
  });
});

// ─── Connect Strava (first-time setup) ───────────────────────────────────────

$('connect-btn').addEventListener('click', () => {
  const clientId     = $('client-id').value.trim();
  const clientSecret = $('client-secret').value.trim();

  if (!clientId || !clientSecret) {
    alert('Please enter both your Strava Client ID and Client Secret.');
    return;
  }

  $('connect-btn').disabled = true;
  $('connect-btn').textContent = 'Connecting...';
  setStatus('checking', 'Connecting to Strava...');

  chrome.runtime.sendMessage({ action: 'connect', clientId, clientSecret }, result => {
    $('connect-btn').disabled = false;
    $('connect-btn').textContent = 'Connect Strava';

    if (!result.success) {
      setStatus('error', 'Connection failed');
      alert(`Could not connect: ${result.error}`);
      return;
    }

    applyStatus(result);
  });
});

// ─── Reconnect button (token expired) ────────────────────────────────────────

$('reconnect-btn').addEventListener('click', () => {
  // Open the popup so the user can re-enter credentials if needed,
  // or just re-trigger OAuth if credentials are already stored.
  chrome.runtime.sendMessage({ action: 'connect' }, result => {
    if (result && result.success) applyStatus(result);
  });
});

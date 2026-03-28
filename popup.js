// Popup logic

const $ = id => document.getElementById(id);

function setStatusRow(dotEl, textEl, dotClass, text) {
  dotEl.className = `dot ${dotClass}`;
  textEl.textContent = text;
}

function applyStatus(result) {
  const stravaDot  = $('strava-status').querySelector('.dot');
  const stravaText = $('strava-status-text');
  const runDot     = $('run-status').querySelector('.dot');
  const runText    = $('run-status-text');
  const igDot      = $('ig-status').querySelector('.dot');
  const igText     = $('ig-status-text');

  switch (result.status) {
    case 'unlocked':
      setStatusRow(stravaDot, stravaText, 'dot-green', 'Connected');
      setStatusRow(runDot,    runText,    'dot-green', '2+ miles done');
      setStatusRow(igDot,     igText,     'dot-green', 'Unlocked');
      showConnected();
      break;

    case 'no_run':
      setStatusRow(stravaDot, stravaText, 'dot-green', 'Connected');
      setStatusRow(runDot,    runText,    'dot-red',   'No qualifying run yet');
      setStatusRow(igDot,     igText,     'dot-red',   'Blocked');
      showConnected();
      break;

    case 'not_connected':
      setStatusRow(stravaDot, stravaText, 'dot-gray', 'Not connected');
      setStatusRow(runDot,    runText,    'dot-gray', '—');
      setStatusRow(igDot,     igText,     'dot-red',  'Blocked');
      showSetup();
      break;

    case 'api_error':
      setStatusRow(stravaDot, stravaText, 'dot-yellow', 'Connected');
      setStatusRow(runDot,    runText,    'dot-yellow', 'API error');
      setStatusRow(igDot,     igText,     'dot-red',    'Blocked');
      showConnected();
      break;

    default:
      setStatusRow(stravaDot, stravaText, 'dot-gray', 'Unknown');
      setStatusRow(runDot,    runText,    'dot-gray', 'Unknown');
      setStatusRow(igDot,     igText,     'dot-gray', 'Unknown');
  }
}

function showSetup() {
  $('setup-section').classList.add('visible');
  $('disconnect-section').style.display = 'none';
}

function showConnected() {
  $('setup-section').classList.remove('visible');
  $('disconnect-section').style.display = 'block';
}

// ─── Initial load ─────────────────────────────────────────────────────────────

chrome.runtime.sendMessage({ action: 'getStatus' }, result => {
  if (chrome.runtime.lastError) return;
  applyStatus(result);
});

// ─── Check Now ────────────────────────────────────────────────────────────────

$('check-btn').addEventListener('click', () => {
  $('check-btn').disabled = true;
  $('check-btn').textContent = 'Checking...';

  chrome.runtime.sendMessage({ action: 'checkAgain' }, result => {
    $('check-btn').disabled = false;
    $('check-btn').textContent = 'Check Now';
    if (result) applyStatus(result);
  });
});

// ─── Connect Strava ───────────────────────────────────────────────────────────

$('connect-btn').addEventListener('click', () => {
  $('connect-btn').disabled = true;
  $('connect-btn').textContent = 'Connecting...';

  chrome.runtime.sendMessage({ action: 'connect' }, result => {
    $('connect-btn').disabled = false;
    $('connect-btn').textContent = 'Connect Strava';

    if (!result?.success) {
      alert(`Connection failed: ${result?.error || 'Unknown error'}`);
      return;
    }

    applyStatus(result);
  });
});

// ─── Disconnect ───────────────────────────────────────────────────────────────

$('disconnect-btn').addEventListener('click', () => {
  if (!confirm('Disconnect Strava? Instagram will be blocked until you reconnect.')) return;

  chrome.runtime.sendMessage({ action: 'disconnect' }, result => {
    if (result?.success) applyStatus(result);
  });
});

// Gate page logic — communicates with the background service worker

const $ = id => document.getElementById(id);

const badge      = $('status-badge');
const statusText = $('status-text');
const emoji      = $('emoji');
const title      = $('title');
const subtitle   = $('subtitle');

// ─── Status helpers ───────────────────────────────────────────────────────────

function setStatus(cls, text) {
  badge.className = `status-badge ${cls}`;
  statusText.textContent = text;
}

function showSection(id) {
  ['setup-section', 'no-run-section', 'reconnect-section'].forEach(s =>
    $(s).classList.toggle('hidden', s !== id)
  );
}

function hideAllSections() {
  ['setup-section', 'no-run-section', 'reconnect-section'].forEach(s =>
    $(s).classList.add('hidden')
  );
}

// ─── Polyline decoder (Google encoded polyline algorithm) ─────────────────────
// Used both for Mapbox (converts to GeoJSON) and canvas fallback.

function decodePolyline(encoded) {
  const coords = [];
  let index = 0, lat = 0, lng = 0;

  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0; result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    coords.push([lat / 1e5, lng / 1e5]); // [lat, lng]
  }

  return coords;
}

// ─── Leaflet + CARTO map ──────────────────────────────────────────────────────

function initLeafletMap(container, polyline) {
  // Leaflet uses [lat, lng] natively — no coordinate flip needed
  const coords = decodePolyline(polyline);

  const map = L.map(container, { zoomControl: true });

  // CARTO Dark Matter tiles — free, no API key
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' +
      ' &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);

  // ── Route: glow underlay + sharp line on top ─────────
  L.polyline(coords, {
    color: '#4ade80',
    weight: 10,
    opacity: 0.15
  }).addTo(map);

  L.polyline(coords, {
    color: '#4ade80',
    weight: 3.5,
    opacity: 1,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(map);

  // ── Fit camera to route ───────────────────────────────
  map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] });

  // ── Start marker (green circle) ───────────────────────
  L.circleMarker(coords[0], {
    radius: 7, fillColor: '#4ade80',
    color: '#fff', weight: 2, fillOpacity: 1
  }).addTo(map);

  // ── End marker (Strava orange circle) ─────────────────
  L.circleMarker(coords[coords.length - 1], {
    radius: 7, fillColor: '#fc4c02',
    color: '#fff', weight: 2, fillOpacity: 1
  }).addTo(map);
}

// ─── Canvas fallback (used when no Mapbox token is set) ───────────────────────

function drawRouteOnCanvas(container, polyline) {
  // Create a canvas that fills the container
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);

  if (!polyline) return;

  const coords = decodePolyline(polyline);
  if (coords.length < 2) return;

  const dpr = window.devicePixelRatio || 1;
  const W   = container.offsetWidth  || 440;
  const H   = container.offsetHeight || 280;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Bounding box
  const lats = coords.map(c => c[0]);
  const lngs = coords.map(c => c[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

  const latRange = maxLat - minLat || 0.001;
  const lngRange = maxLng - minLng || 0.001;

  const latMid      = (minLat + maxLat) / 2;
  const lngScale    = Math.cos(latMid * Math.PI / 180);
  const adjLngRange = lngRange * lngScale;

  const pad    = 24;
  const scaleX = (W - pad * 2) / adjLngRange;
  const scaleY = (H - pad * 2) / latRange;
  const scale  = Math.min(scaleX, scaleY);

  const drawnW = adjLngRange * scale;
  const drawnH = latRange    * scale;
  const offX   = (W - drawnW) / 2;
  const offY   = (H - drawnH) / 2;

  const toX = lng => offX + (lng - minLng) * lngScale * scale;
  const toY = lat => offY + (maxLat - lat)             * scale;

  // Background
  ctx.fillStyle = '#0c1a0c';
  ctx.fillRect(0, 0, W, H);

  // Glow
  ctx.save();
  ctx.shadowColor = '#4ade80';
  ctx.shadowBlur  = 8;
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth   = 2.5;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(toX(coords[0][1]), toY(coords[0][0]));
  for (let i = 1; i < coords.length; i++) {
    ctx.lineTo(toX(coords[i][1]), toY(coords[i][0]));
  }
  ctx.stroke();
  ctx.restore();

  // Start dot (green)
  ctx.beginPath();
  ctx.arc(toX(coords[0][1]), toY(coords[0][0]), 5, 0, Math.PI * 2);
  ctx.fillStyle = '#4ade80';
  ctx.fill();

  // End dot (Strava orange)
  const last = coords[coords.length - 1];
  ctx.beginPath();
  ctx.arc(toX(last[1]), toY(last[0]), 5, 0, Math.PI * 2);
  ctx.fillStyle = '#fc4c02';
  ctx.fill();

  // Hint to add a Mapbox token
  const hint = document.createElement('p');
  hint.className = 'map-token-hint';
  hint.innerHTML = 'Add a Mapbox token in the extension popup for a real map background';
  container.insertAdjacentElement('afterend', hint);
}

// ─── Stat formatters ──────────────────────────────────────────────────────────

function fmtDistance(meters) {
  return (meters / 1609.34).toFixed(2);
}

function fmtPace(meters, seconds) {
  const secsPerMile = seconds / (meters / 1609.34);
  const mins = Math.floor(secsPerMile / 60);
  const secs = Math.round(secsPerMile % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function fmtTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toString().padStart(2, '0');
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s}`;
  return `${m}:${s}`;
}

function fmtElevation(meters) {
  return Math.round(meters * 3.28084); // → feet
}

// ─── Run display renderer ─────────────────────────────────────────────────────

function renderRunDisplay(activity) {
  const display = $('run-display');
  display.style.display = 'block';

  if (!activity) return;

  // Run name + date
  const date    = new Date(activity.start_date_local);
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric'
  });
  $('run-name').textContent = `${activity.name} · ${dateStr}`;

  // Stat cards
  $('stat-distance').innerHTML =
    `${fmtDistance(activity.distance)}<span class="stat-unit">mi</span>`;
  $('stat-pace').innerHTML =
    `${fmtPace(activity.distance, activity.moving_time)}<span class="stat-unit">/mi</span>`;
  $('stat-time').textContent = fmtTime(activity.moving_time);
  $('stat-elev').innerHTML =
    `${fmtElevation(activity.total_elevation_gain)}<span class="stat-unit">ft</span>`;

  // Map — use Leaflet + CARTO if a polyline is available, canvas fallback otherwise
  const container = $('map-container');
  if (activity.polyline && typeof L !== 'undefined') {
    initLeafletMap(container, activity.polyline);
  } else {
    requestAnimationFrame(() => drawRouteOnCanvas(container, activity.polyline));
  }
}

// ─── Status handler ───────────────────────────────────────────────────────────

function applyStatus(result) {
  switch (result.status) {
    case 'unlocked':
      emoji.textContent    = '✅';
      title.textContent    = 'You earned it.';
      subtitle.textContent = 'Here\'s your run. Now go enjoy Instagram.';
      setStatus('unlocked', 'Run verified');
      hideAllSections();
      renderRunDisplay(result.activity || null);
      break;

    case 'no_run':
      emoji.textContent    = '🏃';
      title.textContent    = 'Not yet.';
      subtitle.textContent = 'Log a run of at least 2 miles on Strava first, then come back.';
      setStatus('no-run', 'No qualifying run today');
      showSection('no-run-section');
      break;

    case 'not_connected':
      emoji.textContent    = '🔌';
      title.textContent    = 'Connect Strava';
      subtitle.textContent = 'Your Strava session expired. Reconnect to continue.';
      setStatus('error', 'Not connected');
      showSection('reconnect-section');
      break;

    case 'not_configured':
      emoji.textContent    = '⚙️';
      title.textContent    = 'Setup required';
      subtitle.textContent = 'Connect your Strava account to get started.';
      setStatus('checking', 'Not configured');
      showSection('setup-section');
      $('callback-domain').textContent = `${chrome.runtime.id}.chromiumapp.org`;
      break;

    case 'api_error':
      emoji.textContent    = '⚠️';
      title.textContent    = 'Strava unavailable';
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

// ─── Check Again ──────────────────────────────────────────────────────────────

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

// ─── Reconnect (token expired) ────────────────────────────────────────────────

$('reconnect-btn').addEventListener('click', () => {
  chrome.storage.local.get(['stravaClientId', 'stravaClientSecret'], data => {
    if (!data.stravaClientId) {
      showSection('setup-section');
      return;
    }
    chrome.runtime.sendMessage(
      { action: 'connect', clientId: data.stravaClientId, clientSecret: data.stravaClientSecret },
      result => { if (result?.success) applyStatus(result); }
    );
  });
});

// ─── Open Instagram button ────────────────────────────────────────────────────

$('open-ig-btn').addEventListener('click', () => {
  window.location.href = 'https://www.instagram.com/';
});

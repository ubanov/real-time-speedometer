'use strict';

// --- Configuración ---
// La configuración se lee de secret.env. Ojo: en una web estática ese fichero
// no es privado; cualquier persona que abra la página puede descargarlo.
let SPOTIFY_CLIENT_ID = '';
const SPOTIFY_REDIRECT_URI = `${window.location.origin}${window.location.pathname.replace(/\/?$/, '/')}`;
const SPOTIFY_SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';
const NOW_PLAYING_POLL_MS = 8000;

const spotifyConnectBtn = document.getElementById('spotifyConnectBtn');
const spotifyControls = document.getElementById('spotifyControls');
const spotifyAlbum = document.getElementById('spotifyAlbum');
const spotifyTitle = document.getElementById('spotifyTitle');
const spotifyArtist = document.getElementById('spotifyArtist');
const spotifyTimeElapsed = document.getElementById('spotifyTimeElapsed');
const spotifyTimeRemaining = document.getElementById('spotifyTimeRemaining');
const spotifyProgressFill = document.getElementById('spotifyProgressFill');
const spotifyPrevBtn = document.getElementById('spotifyPrevBtn');
const spotifyPlayBtn = document.getElementById('spotifyPlayBtn');
const spotifyNextBtn = document.getElementById('spotifyNextBtn');
const spotifyOpenLink = document.getElementById('spotifyOpenLink');

let isPlaying = false;
let nowPlayingTimer = null;
let progressTimer = null;
let currentProgressMs = 0;
let currentDurationMs = 0;
let lastProgressSyncTime = 0;
let playbackOverrideUntil = 0;
let hasPlaybackSnapshot = false;

function renderPlaybackIcon() {
  if (!spotifyPlayBtn) return;
  spotifyPlayBtn.classList.toggle('is-playing', isPlaying);
  spotifyPlayBtn.setAttribute('aria-label', isPlaying ? 'Pausar' : 'Reproducir');
}

function setSpotifyOpenLinkVisible(visible) {
  if (!spotifyOpenLink) return;
  spotifyOpenLink.classList.toggle('is-hidden', !visible);
}

function renderNoActivePlayback() {
  isPlaying = false;
  lastProgressSyncTime = 0;
  renderPlaybackIcon();

  if (hasPlaybackSnapshot) {
    setSpotifyOpenLinkVisible(false);
    renderProgress(currentProgressMs, currentDurationMs);
    return;
  }

  currentProgressMs = 0;
  currentDurationMs = 0;
  if (spotifyTitle) spotifyTitle.textContent = 'Nada sonando';
  if (spotifyArtist) spotifyArtist.textContent = '';
  if (spotifyAlbum) spotifyAlbum.src = 'img/icon-192.png';
  if (spotifyOpenLink) spotifyOpenLink.href = 'https://open.spotify.com/';
  setSpotifyOpenLinkVisible(true);
  renderProgress(0, 0);
}

function parseEnv(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .reduce((config, line) => {
      const separator = line.indexOf('=');
      if (separator <= 0) return config;
      const key = line.slice(0, separator).trim();
      const rawValue = line.slice(separator + 1).trim();
      config[key] = rawValue.replace(/^['"]|['"]$/g, '');
      return config;
    }, {});
}

async function loadSpotifyConfig() {
  try {
    const res = await fetch('secret.env', { cache: 'no-store' });
    if (!res.ok) return;
    const config = parseEnv(await res.text());
    SPOTIFY_CLIENT_ID = (config.SPOTIFY_CLIENT_ID || '').trim();
  } catch (err) {
    console.warn('Spotify config:', err);
  }
}

function isSpotifyConfigured() {
  return Boolean(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_ID !== 'PON_AQUI_TU_CLIENT_ID');
}

// --- PKCE helpers ---

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomVerifier(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => chars[v % chars.length]).join('');
}

async function sha256(text) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}

// --- Almacenamiento de tokens ---

function getStoredTokens() {
  try {
    return JSON.parse(localStorage.getItem('spotifyTokens') || 'null');
  } catch {
    return null;
  }
}

function storeTokens(tokens) {
  localStorage.setItem('spotifyTokens', JSON.stringify(tokens));
}

function clearTokens() {
  localStorage.removeItem('spotifyTokens');
}

// --- Login (Authorization Code + PKCE) ---

async function startSpotifyLogin() {
  const verifier = randomVerifier(64);
  localStorage.setItem('spotifyVerifier', verifier);
  const challenge = base64UrlEncode(await sha256(verifier));

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT_URI,
    scope: SPOTIFY_SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const verifier = localStorage.getItem('spotifyVerifier');
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_verifier: verifier,
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) throw new Error('No se pudo canjear el código de Spotify');

  const data = await res.json();
  storeTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  });
}

async function refreshAccessToken() {
  const tokens = getStoredTokens();
  if (!tokens || !tokens.refresh_token) return null;

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    clearTokens();
    return null;
  }

  const data = await res.json();
  const updated = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  storeTokens(updated);
  return updated;
}

async function getValidAccessToken() {
  let tokens = getStoredTokens();
  if (!tokens) return null;
  if (Date.now() > tokens.expires_at - 10000) {
    tokens = await refreshAccessToken();
  }
  return tokens ? tokens.access_token : null;
}

// --- Llamadas a la Web API ---

async function spotifyApi(path, options = {}) {
  const token = await getValidAccessToken();
  if (!token) throw new Error('NOT_AUTHENTICATED');

  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (res.status === 204 || res.status === 202) return null;
  if (!res.ok) {
    if (res.status === 404) throw new Error('NO_ACTIVE_DEVICE');
    throw new Error(`SPOTIFY_HTTP_${res.status}`);
  }
  return res.json().catch(() => null);
}

async function refreshNowPlaying() {
  try {
    const data = await spotifyApi('/me/player');
    if (!data || !data.item) {
      renderNoActivePlayback();
      return;
    }
    hasPlaybackSnapshot = true;
    const artists = data.item.artists.map((a) => a.name).join(', ');
    if (spotifyTitle) spotifyTitle.textContent = data.item.name;
    if (spotifyArtist) spotifyArtist.textContent = artists;
    if (spotifyAlbum && data.item.album && data.item.album.images && data.item.album.images[0]) {
      spotifyAlbum.src = data.item.album.images[0].url;
    }
    if (spotifyOpenLink) {
      spotifyOpenLink.href = data.item.external_urls && data.item.external_urls.spotify
        ? data.item.external_urls.spotify
        : 'https://open.spotify.com/';
    }
    setSpotifyOpenLinkVisible(false);
    if (Date.now() >= playbackOverrideUntil) {
      isPlaying = Boolean(data.is_playing);
    }
    renderPlaybackIcon();

    if (typeof data.progress_ms === 'number' && data.item.duration_ms) {
      currentProgressMs = data.progress_ms;
      currentDurationMs = data.item.duration_ms;
      lastProgressSyncTime = Date.now();
      renderProgress(currentProgressMs, currentDurationMs);
    }
  } catch (err) {
    if (err.message === 'NO_ACTIVE_DEVICE') {
      renderNoActivePlayback();
    } else {
      console.warn('Spotify:', err);
    }
  }
}

function formatMs(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function renderProgress(progressMs, durationMs) {
  const safeDuration = Math.max(0, durationMs || 0);
  const safeProgress = Math.max(0, Math.min(progressMs || 0, safeDuration));
  const pct = safeDuration > 0 ? Math.max(0, Math.min(1, safeProgress / safeDuration)) : 0;
  if (spotifyProgressFill) spotifyProgressFill.style.width = `${(pct * 100).toFixed(1)}%`;
  if (spotifyTimeElapsed) spotifyTimeElapsed.textContent = formatMs(safeProgress);
  if (spotifyTimeRemaining) spotifyTimeRemaining.textContent = `-${formatMs(safeDuration - safeProgress)}`;
}

function tickLocalProgress() {
  if (!isPlaying || currentDurationMs <= 0 || lastProgressSyncTime <= 0) return;
  const elapsedSinceSync = Date.now() - lastProgressSyncTime;
  const liveProgress = Math.min(currentDurationMs, currentProgressMs + elapsedSinceSync);
  renderProgress(liveProgress, currentDurationMs);
}

async function togglePlayback() {
  try {
    const nextIsPlaying = !isPlaying;
    if (isPlaying && lastProgressSyncTime > 0) {
      currentProgressMs = Math.min(currentDurationMs, currentProgressMs + (Date.now() - lastProgressSyncTime));
      renderProgress(currentProgressMs, currentDurationMs);
    }
    await spotifyApi(isPlaying ? '/me/player/pause' : '/me/player/play', { method: 'PUT' });
    isPlaying = nextIsPlaying;
    lastProgressSyncTime = Date.now();
    playbackOverrideUntil = Date.now() + 2500;
    renderPlaybackIcon();
    setTimeout(refreshNowPlaying, 800);
  } catch (err) {
    if (err.message === 'NO_ACTIVE_DEVICE') {
      renderNoActivePlayback();
    } else {
      console.warn('Spotify:', err);
    }
  }
}

async function skipTrack(direction) {
  try {
    await spotifyApi(`/me/player/${direction}`, { method: 'POST' });
    setTimeout(refreshNowPlaying, 800);
  } catch (err) {
    console.warn('Spotify:', err);
  }
}

function showSpotifyControls() {
  spotifyConnectBtn.hidden = true;
  spotifyControls.hidden = false;
  refreshNowPlaying();
  clearInterval(nowPlayingTimer);
  clearInterval(progressTimer);
  nowPlayingTimer = setInterval(refreshNowPlaying, NOW_PLAYING_POLL_MS);
  progressTimer = setInterval(tickLocalProgress, 1000);
}

spotifyPlayBtn.addEventListener('click', togglePlayback);
spotifyNextBtn.addEventListener('click', () => skipTrack('next'));
spotifyPrevBtn.addEventListener('click', () => skipTrack('previous'));
renderPlaybackIcon();

// --- Arranque ---

(async function initSpotify() {
  await loadSpotifyConfig();

  if (!isSpotifyConfigured()) {
    spotifyConnectBtn.textContent = 'Falta configurar Spotify';
    spotifyConnectBtn.disabled = true;
    return;
  }

  spotifyConnectBtn.addEventListener('click', startSpotifyLogin);

  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');

  if (code) {
    try {
      await exchangeCodeForTokens(code);
    } catch (err) {
      console.warn('Spotify auth error:', err);
    }
    history.replaceState({}, '', window.location.pathname);
  }

  if (getStoredTokens()) {
    showSpotifyControls();
  }
})();

'use strict';

const APP_VERSION = '0.9.3';
const versionEl = document.getElementById('version');
const speedDiv = document.getElementById('speed');
const distanceValue = document.getElementById('distanceValue');
const distanceUnit = document.getElementById('distanceUnit');
const unitBtn = document.getElementById('unitBtn');
const accuracyText = document.getElementById('accuracyText');
const accuracyIcon = document.getElementById('accuracyIcon');
const gpsIcon = document.getElementById('gpsIcon');
const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const gaugeWrap = document.getElementById('gaugeWrap');
const ticksGroup = document.getElementById('ticks');
const arcGreen = document.getElementById('arcGreen');
const arcYellow = document.getElementById('arcYellow');
const arcRed = document.getElementById('arcRed');
const needle = document.getElementById('needle');
const needleGlow = document.getElementById('needleGlow');
const leanWrap = document.getElementById('leanWrap');
const leanGauge = document.getElementById('leanGauge');
const leanPlaceholder = document.getElementById('leanPlaceholder');
const accelBarFill = document.getElementById('accelBarFill');
const accelReadout = document.getElementById('accelReadout');
const leanArrow = document.getElementById('leanArrow');
const leanReadout = document.getElementById('leanReadout');
const leanInvalid = document.getElementById('leanInvalid');
const leanTicksGroup = document.getElementById('leanTicks');
const leanArcGreen = document.getElementById('leanArcGreen');
const leanArcYellowL = document.getElementById('leanArcYellowL');
const leanArcYellowR = document.getElementById('leanArcYellowR');
const leanArcRedL = document.getElementById('leanArcRedL');
const leanArcRedR = document.getElementById('leanArcRedR');
const cornerStats = document.getElementById('cornerStats');
const cornerClock = document.getElementById('cornerClock');
const cornerClockLabel = document.getElementById('cornerClockLabel');
const cornerTemp = document.getElementById('cornerTemp');
const cornerGps = document.getElementById('cornerGps');
// Suavizado exponencial basado en tiempo real transcurrido (no en número de
// lecturas): así la respuesta no depende de la cadencia con la que el GPS
// entregue posiciones. SPEED_TAU es la "constante de tiempo": con ~1s entre
// lecturas típico del GPS, converge al valor real en 1-2 lecturas.
const SPEED_TAU = 0.5;
const SPEED_STOP_THRESHOLD = 0.3; // m/s por debajo de esto se considera "parado"

// greenEnd/yellowEnd/max están alineados con el uso en moto: los límites
// de km/h son los de referencia (0-120-160-200) y el resto de unidades
// son la misma frontera física convertida.
const UNITS = [
  { key: 'kmh', label: 'km/h', distanceLabel: 'km', distanceFactor: 1, max: 200, majorStep: 20, greenEnd: 120, yellowEnd: 160, factor: 3.6 },
  { key: 'mph', label: 'mph', distanceLabel: 'mi', distanceFactor: 0.621371192, max: 125, majorStep: 25, greenEnd: 75, yellowEnd: 100, factor: 2.23693629205 },
  { key: 'kn', label: 'nudos', distanceLabel: 'nm', distanceFactor: 0.539956803, max: 110, majorStep: 10, greenEnd: 65, yellowEnd: 85, factor: 1.94384449244 },
  { key: 'ms', label: 'm/s', distanceLabel: 'm', distanceFactor: 1000, max: 60, majorStep: 10, greenEnd: 33, yellowEnd: 44, factor: 1 },
];

const CENTER = 100;
const START_ANGLE = -135;
const END_ANGLE = 135;
const SWEEP = END_ANGLE - START_ANGLE;

let watchId = null;
let wakeLock = null;
let lastFix = null; // { lat, lon, time }
let smoothedSpeedMs = null;
let lastSmoothTime = null;
let lastAccelSpeedMs = null;
let lastAccelSpeedTime = null;
let unitIndex = Number(localStorage.getItem('speedUnitIndex')) || 0;
if (unitIndex < 0 || unitIndex >= UNITS.length) unitIndex = 0;

const WEATHER_FETCH_MS = 10 * 60 * 1000;
const MOTO_GATEWAY_POLL_MS = 500;
const MOTO_GATEWAY_TIMEOUT_MS = 900;
let infoTimer = null;
let distanceKm = 0;
let temperatureC = null;
let tempUnit = localStorage.getItem('tempUnit') === 'F' ? 'F' : 'C';
let lastWeatherFetchTime = 0;
let lastTouchEndTime = 0;
let clockMode = localStorage.getItem('clockMode') === 'elapsed' ? 'elapsed' : 'time';
let sessionStartTime = null;
let motoGatewayTimer = null;
let motoGatewayStatusUrl = null;
let motoGatewayConfig = null;
let motoGatewayActive = false;
let motoGatewayBaseDistanceKm = null;
let motoGatewayLastSpeedTime = null;
let motoGatewayPollInFlight = false;

function lockPageZoom() {
  document.addEventListener('gesturestart', (event) => event.preventDefault());
  document.addEventListener('gesturechange', (event) => event.preventDefault());
  document.addEventListener('touchmove', (event) => {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });
  document.addEventListener('touchend', (event) => {
    const now = Date.now();
    if (now - lastTouchEndTime <= 320) event.preventDefault();
    lastTouchEndTime = now;
  }, { passive: false });
}

// --- Gauge geometry helpers ---

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function describeArc(r, startAngle, endAngle) {
  if (endAngle <= startAngle) return '';
  const start = polarToCartesian(CENTER, CENTER, r, startAngle);
  const end = polarToCartesian(CENTER, CENTER, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function angleForValue(value, max) {
  const clamped = Math.max(0, Math.min(value, max));
  return START_ANGLE + (clamped / max) * SWEEP;
}

function buildGauge(unit) {
  const greenAngle = angleForValue(unit.greenEnd, unit.max);
  const yellowAngle = angleForValue(unit.yellowEnd, unit.max);
  arcGreen.setAttribute('d', describeArc(84, START_ANGLE, greenAngle));
  arcYellow.setAttribute('d', describeArc(84, greenAngle, yellowAngle));
  arcRed.setAttribute('d', describeArc(84, yellowAngle, END_ANGLE));

  ticksGroup.innerHTML = '';
  const minorStep = unit.majorStep / 2;
  for (let v = 0; v <= unit.max; v += minorStep) {
    const isMajor = v % unit.majorStep === 0;
    const angle = angleForValue(v, unit.max);
    const outer = polarToCartesian(CENTER, CENTER, 90, angle);
    const inner = polarToCartesian(CENTER, CENTER, isMajor ? 77 : 83, angle);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', outer.x);
    line.setAttribute('y1', outer.y);
    line.setAttribute('x2', inner.x);
    line.setAttribute('y2', inner.y);
    line.setAttribute('class', isMajor ? 'tick-major' : 'tick-minor');
    ticksGroup.appendChild(line);

    if (isMajor) {
      const labelPos = polarToCartesian(CENTER, CENTER, 68, angle);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', labelPos.x);
      text.setAttribute('y', labelPos.y);
      text.textContent = String(v);
      ticksGroup.appendChild(text);
    }
  }
}

function setUnitButtonLabel() {
  unitBtn.textContent = UNITS[unitIndex].label;
}

function formatCompactDecimal(value, decimals, decimalClass) {
  const [integer, decimal] = value.toFixed(decimals).split('.');
  return `${integer}<span class="${decimalClass}">.${decimal}</span>`;
}

function renderTemperature() {
  if (!cornerTemp) return;

  if (temperatureC === null) {
    cornerTemp.innerHTML = `<span class="tempWhole">--</span><span class="tempMeta"><span class="tempUnit">°${tempUnit}</span><span class="tempDecimal">.</span></span>`;
    return;
  }

  const displayValue = tempUnit === 'F' ? temperatureC * 9 / 5 + 32 : temperatureC;
  const [integer, decimal] = displayValue.toFixed(1).split('.');
  cornerTemp.innerHTML = `<span class="tempWhole">${integer}</span><span class="tempMeta"><span class="tempUnit">°${tempUnit}</span><span class="tempDecimal">.${decimal}</span></span>`;
}

function formatElapsed(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${minutes.toString().padStart(2, '0')}`;
}

function renderClock(now) {
  if (clockMode === 'elapsed') {
    const startedAt = sessionStartTime || Date.now();
    cornerClock.textContent = formatElapsed(Date.now() - startedAt);
    cornerClockLabel.textContent = 'Tiempo';
    return;
  }

  cornerClock.textContent = now.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  cornerClockLabel.textContent = 'Reloj';
}

function renderNeedle(angle) {
  const inner = polarToCartesian(CENTER, CENTER, 64, angle);
  const outer = polarToCartesian(CENTER, CENTER, 88, angle);
  [needleGlow, needle].forEach((line) => {
    if (!line) return;
    line.setAttribute('x1', inner.x.toFixed(2));
    line.setAttribute('y1', inner.y.toFixed(2));
    line.setAttribute('x2', outer.x.toFixed(2));
    line.setAttribute('y2', outer.y.toFixed(2));
  });
}

function renderSpeed(speedMs) {
  const unit = UNITS[unitIndex];
  const displayValue = speedMs * unit.factor;
  const displayKmh = speedMs * UNITS[0].factor;
  const valueText = displayKmh >= 20 ? String(Math.round(displayValue)) : formatCompactDecimal(displayValue, 1, 'speedDecimal');
  if (speedDiv) speedDiv.innerHTML = valueText;
  renderNeedle(angleForValue(displayValue, unit.max));
}

function renderDistance() {
  const unit = UNITS[unitIndex];
  const displayDistance = distanceKm * unit.distanceFactor;
  if (distanceValue) distanceValue.innerHTML = formatCompactDecimal(displayDistance, 1, 'distanceDecimal');
  if (distanceUnit) distanceUnit.textContent = unit.distanceLabel;
}

function updateInfoPanel() {
  if (!cornerStats) return;

  const now = new Date();
  renderClock(now);
  renderTemperature();
  renderDistance();

  let gpsQuality = 0;
  if (accuracyText.textContent) {
    const accuracyNumber = Number.parseFloat(accuracyText.textContent.replace(/±| m/g, ''));
    if (Number.isFinite(accuracyNumber)) {
      gpsQuality = accuracyNumber <= 6 ? 3 : accuracyNumber <= 12 ? 2 : 1;
    }
  }
  if (cornerGps) {
    cornerGps.classList.remove('quality-0', 'quality-1', 'quality-2', 'quality-3');
    cornerGps.classList.add(`quality-${gpsQuality}`);
  }
}

function startInfoCycler() {
  clearInterval(infoTimer);
  infoTimer = window.setInterval(updateInfoPanel, 1000);
}

// --- ESP32 Moto Gateway ---

function uniqueUrls(urls) {
  return [...new Set(urls.filter(Boolean))];
}

function getMotoGatewayUrls() {
  const savedUrl = localStorage.getItem('motoGatewayStatusUrl');
  const urls = [
    savedUrl,
    'http://moto.local/api/v1/status',
    'http://192.168.10.1/api/v1/status',
    'http://moto.local/status',
    'http://192.168.10.1/status',
  ];

  if (location.protocol === 'http:' && location.hostname) {
    urls.unshift(`${location.origin}/api/v1/status`, `${location.origin}/status`);
  }

  return uniqueUrls(urls);
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

function configUrlFromStatusUrl(statusUrl) {
  return statusUrl.replace(/\/status(?:\?.*)?$/, '/config');
}

async function fetchMotoGatewayConfig() {
  if (!motoGatewayStatusUrl) return;

  try {
    const config = await fetchJsonWithTimeout(configUrlFromStatusUrl(motoGatewayStatusUrl), MOTO_GATEWAY_TIMEOUT_MS);
    if (
      Number.isFinite(config?.speedPulsesPerWheelRev) &&
      Number.isFinite(config?.wheelCircumferenceM)
    ) {
      motoGatewayConfig = config;
    }
  } catch (err) {
    console.warn('No se pudo leer /config del ESP32:', err);
  }
}

function gatewayDistanceKm(data) {
  if (!motoGatewayConfig) return null;
  if (!Number.isFinite(data?.totalSpeedPulses)) return null;

  const pulsesPerRev = Number(motoGatewayConfig.speedPulsesPerWheelRev);
  const circumferenceM = Number(motoGatewayConfig.wheelCircumferenceM);
  if (pulsesPerRev <= 0 || circumferenceM <= 0) return null;

  return (data.totalSpeedPulses / pulsesPerRev) * circumferenceM / 1000;
}

function updateDistanceFromGateway(data, speedMs, now) {
  const rawDistanceKm = gatewayDistanceKm(data);

  if (Number.isFinite(rawDistanceKm)) {
    if (motoGatewayBaseDistanceKm === null) {
      motoGatewayBaseDistanceKm = rawDistanceKm;
    }
    distanceKm = Math.max(0, rawDistanceKm - motoGatewayBaseDistanceKm);
    motoGatewayLastSpeedTime = now;
    updateInfoPanel();
    return;
  }

  if (motoGatewayLastSpeedTime !== null) {
    const dt = Math.max(0, (now - motoGatewayLastSpeedTime) / 1000);
    if (dt < 3) distanceKm += speedMs * dt / 1000;
  }
  motoGatewayLastSpeedTime = now;
  updateInfoPanel();
}

function applyMotoGatewayStatus(data) {
  if (!Number.isFinite(data?.speedKmh)) return;

  const now = Date.now();
  const speedMs = Math.max(0, data.speedKmh / 3.6);
  motoGatewayActive = true;
  smoothedSpeedMs = speedMs;
  lastSmoothTime = now;

  renderSpeed(speedMs);
  updateGpsAcceleration(speedMs, now);
  updateDistanceFromGateway(data, speedMs, now);
  setStatus('Moto Gateway activo', 'ok');
}

async function pollMotoGateway() {
  if (motoGatewayPollInFlight) return;
  motoGatewayPollInFlight = true;

  try {
    const urls = motoGatewayStatusUrl ? [motoGatewayStatusUrl, ...getMotoGatewayUrls()] : getMotoGatewayUrls();

    for (const url of uniqueUrls(urls)) {
      try {
        const data = await fetchJsonWithTimeout(url, MOTO_GATEWAY_TIMEOUT_MS);
        motoGatewayStatusUrl = url;
        localStorage.setItem('motoGatewayStatusUrl', url);
        if (!motoGatewayConfig) void fetchMotoGatewayConfig();
        applyMotoGatewayStatus(data);
        return;
      } catch (err) {
        // Silencioso a propósito: si el módulo no está, seguimos con GPS.
      }
    }

    motoGatewayActive = false;
    motoGatewayLastSpeedTime = null;
  } finally {
    motoGatewayPollInFlight = false;
  }
}

function startMotoGatewayPolling() {
  if (motoGatewayTimer !== null) return;

  void pollMotoGateway();
  motoGatewayTimer = window.setInterval(pollMotoGateway, MOTO_GATEWAY_POLL_MS);
}

async function fetchWeather(lat, lon) {
  const now = Date.now();
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  if (temperatureC !== null && now - lastWeatherFetchTime < WEATHER_FETCH_MS) return;

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m&timezone=auto`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (typeof data?.current?.temperature_2m === 'number') {
      temperatureC = data.current.temperature_2m;
      lastWeatherFetchTime = now;
      updateInfoPanel();
    }
  } catch (err) {
    console.warn('No se pudo obtener la temperatura:', err);
  }
}

unitBtn.addEventListener('click', () => {
  unitIndex = (unitIndex + 1) % UNITS.length;
  localStorage.setItem('speedUnitIndex', String(unitIndex));
  setUnitButtonLabel();
  buildGauge(UNITS[unitIndex]);
  renderSpeed(smoothedSpeedMs || 0);
  renderDistance();
});

cornerTemp.addEventListener('click', () => {
  tempUnit = tempUnit === 'C' ? 'F' : 'C';
  localStorage.setItem('tempUnit', tempUnit);
  renderTemperature();
});

cornerClock.addEventListener('click', () => {
  clockMode = clockMode === 'time' ? 'elapsed' : 'time';
  localStorage.setItem('clockMode', clockMode);
  updateInfoPanel();
});


// El panel de datos pasa a modo automático para uso en moto.
startInfoCycler();

// --- Geolocation + speed logic ---

function setStatus(text, tone) {
  if (tone === 'ok') {
    // Con GPS activo no hace falta un texto ocupando sitio: un icono en la
    // esquina del velocímetro basta.
    statusEl.textContent = '';
    statusEl.classList.remove('ok', 'error');
    gpsIcon.hidden = false;
    return;
  }
  gpsIcon.hidden = true;
  statusEl.textContent = text;
  statusEl.classList.remove('ok', 'error');
  if (tone) statusEl.classList.add(tone);
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function handleDistance(lat, lon, timestamp) {
  if (motoGatewayActive) {
    lastFix = { lat, lon, time: timestamp };
    return;
  }

  if (lastFix && Number.isFinite(lat) && Number.isFinite(lon)) {
    const dist = haversineMeters(lastFix.lat, lastFix.lon, lat, lon);
    if (Number.isFinite(dist) && dist < 2000) {
      distanceKm += dist / 1000;
    }
  }
  lastFix = { lat, lon, time: timestamp };
  updateInfoPanel();
}

function smoothAccelToward(targetG, now, tau) {
  const target = Math.max(-ACCEL_MAX_G, Math.min(ACCEL_MAX_G, targetG));
  if (lastAccelTime === null) {
    smoothedAccelG = target;
  } else {
    const dt = Math.max(0.001, (now - lastAccelTime) / 1000);
    const alpha = 1 - Math.exp(-dt / tau);
    smoothedAccelG = alpha * target + (1 - alpha) * smoothedAccelG;
  }
  lastAccelTime = now;
}

function updateGpsAcceleration(speedMs, timestamp) {
  if (lastAccelSpeedMs !== null && lastAccelSpeedTime !== null) {
    const dt = Math.max(0.2, (timestamp - lastAccelSpeedTime) / 1000);
    let gpsAccelG = (speedMs - lastAccelSpeedMs) / dt / G;
    if (Math.abs(gpsAccelG) < ACCEL_DEADZONE_G) gpsAccelG = 0;

    smoothAccelToward(gpsAccelG, performance.now(), ACCEL_GPS_TAU);
    renderAccel(smoothedAccelG);
  }

  lastAccelSpeedMs = speedMs;
  lastAccelSpeedTime = timestamp;
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (err) {
    console.warn('Wake Lock no disponible:', err);
  }
}

document.addEventListener('visibilitychange', () => {
  if (wakeLock !== null && document.visibilityState === 'visible' && watchId !== null) {
    requestWakeLock();
  }
});

function handlePosition(loc) {
  const { coords, timestamp } = loc;
  let speedMs = coords.speed;

  // iOS Safari a menudo no reporta coords.speed; lo calculamos a partir
  // de la distancia entre dos posiciones y el tiempo transcurrido.
  if (speedMs === null || speedMs === undefined) {
    if (lastFix) {
      const dt = (timestamp - lastFix.time) / 1000;
      if (dt > 0.2) {
        const dist = haversineMeters(lastFix.lat, lastFix.lon, coords.latitude, coords.longitude);
        speedMs = dist / dt;
      }
    }
  }
  handleDistance(coords.latitude, coords.longitude, timestamp);

  if (motoGatewayActive) {
    if (typeof coords.accuracy === 'number') {
      accuracyText.textContent = `±${coords.accuracy.toFixed(0)} m`;
      accuracyIcon.classList.remove('quality-1', 'quality-2', 'quality-3');
      if (coords.accuracy <= 6) accuracyIcon.classList.add('quality-3');
      else if (coords.accuracy <= 12) accuracyIcon.classList.add('quality-2');
      else accuracyIcon.classList.add('quality-1');
    }
    void fetchWeather(coords.latitude, coords.longitude);
    updateInfoPanel();
    setStatus('Moto Gateway activo', 'ok');
    return;
  }

  if (speedMs === null || speedMs === undefined || Number.isNaN(speedMs) || speedMs < SPEED_STOP_THRESHOLD) {
    speedMs = 0;
  }

  if (smoothedSpeedMs === null || lastSmoothTime === null) {
    smoothedSpeedMs = speedMs;
  } else {
    const dt = Math.max(0.05, (timestamp - lastSmoothTime) / 1000);
    const alpha = 1 - Math.exp(-dt / SPEED_TAU);
    smoothedSpeedMs = alpha * speedMs + (1 - alpha) * smoothedSpeedMs;
  }
  lastSmoothTime = timestamp;

  // Si la lectura real ya es "parado", no dejes que quede flotando un resto
  // asintótico del suavizado (p.ej. 0.4 km/h para siempre).
  if (speedMs === 0 && smoothedSpeedMs < SPEED_STOP_THRESHOLD) {
    smoothedSpeedMs = 0;
  }

  updateGpsAcceleration(smoothedSpeedMs, timestamp);
  renderSpeed(smoothedSpeedMs);

  if (typeof coords.accuracy === 'number') {
    accuracyText.textContent = `±${coords.accuracy.toFixed(0)} m`;
    accuracyIcon.classList.remove('quality-1', 'quality-2', 'quality-3');
    if (coords.accuracy <= 6) accuracyIcon.classList.add('quality-3');
    else if (coords.accuracy <= 12) accuracyIcon.classList.add('quality-2');
    else accuracyIcon.classList.add('quality-1');
  }

  void fetchWeather(coords.latitude, coords.longitude);
  updateInfoPanel();
  setStatus('GPS activo', 'ok');
}

function handleError(err) {
  lastFix = null;
  smoothedSpeedMs = null;
  lastSmoothTime = null;
  lastAccelSpeedMs = null;
  lastAccelSpeedTime = null;
  switch (err.code) {
    case err.PERMISSION_DENIED:
      setStatus('Permiso de ubicación denegado. Actívalo en Ajustes > Safari > Ubicación y vuelve a tocar Iniciar.', 'error');
      break;
    case err.POSITION_UNAVAILABLE:
      setStatus('Posición no disponible. Comprueba que el GPS esté activado.', 'error');
      break;
    case err.TIMEOUT:
      setStatus('Tiempo de espera agotado buscando señal GPS.', 'error');
      break;
    default:
      setStatus('Error obteniendo la ubicación.', 'error');
  }
}

// --- Inclinación lateral (lean angle) ---

const LEAN_RANGE = 60; // grados validos mostrados a cada lado
const LEAN_ARC_MAX = 60;
const LEAN_GREEN = 30;
const LEAN_YELLOW = 45;
const LEAN_SIGN = -1; // invertido para que derecha/izquierda coincidan con la moto
const LEAN_CENTER_X = 100;
const LEAN_CENTER_Y = 130;

// No guardamos un ángulo absoluto: guardamos el vector de gravedad (x,y) tal
// cual estaba cuando empezaste a rodar (o cuando calibras), y medimos cuánto
// ha girado desde ahí. Así el "0°" es siempre tu posición de referencia real,
// sin importar si el montaje es vertical u horizontal, y no hay riesgo de que
// la posición neutra caiga justo en el punto de corte ±180° (que es lo que
// causaba el salto de un lado a otro).
let leanRefX = null;
let leanRefY = null;
let leanOrientationOffset = null;
let hasOrientationLean = false;
let lastGravityX = 0;
let lastGravityY = 0;
let smoothedLean = 0;
let lastLeanTime = null;

// --- Aceleración derivada de velocidad GPS ---
const G = 9.80665;
const ACCEL_MAX_G = 0.5; // escala visual: 0.2g ya debe verse claramente
const ACCEL_DEADZONE_G = 0.015; // por debajo de esto, se muestra 0.00
let smoothedAccelG = 0;
let lastAccelTime = null;
let filteredGravityX = null;
let filteredGravityY = null;

// En moto el acelerómetro físico recoge demasiada vibración. Para aceleración
// usamos diferencia de velocidad; para inclinación priorizamos DeviceOrientation,
// que en iPhone suele venir de la fusión de sensores del sistema.
const LEAN_TAU = 0.65;
const ACCEL_GPS_TAU = 0.9;
const MOTION_RENDER_MS = 250;
let lastMotionRenderTime = 0;

function getScreenOrientationAngle() {
  const angle = screen.orientation && typeof screen.orientation.angle === 'number'
    ? screen.orientation.angle
    : Number(window.orientation) || 0;
  return ((angle % 360) + 360) % 360;
}

function normalizeGravityForScreen(x, y) {
  const rad = (getScreenOrientationAngle() * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  };
}

function normalizeAngle180(deg) {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

function screenAdjustedRoll(beta, gamma) {
  const angle = getScreenOrientationAngle();
  if (angle === 90) return beta;
  if (angle === 270) return -beta;
  if (angle === 180) return -gamma;
  return gamma;
}

function leanPolarToCartesian(r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: LEAN_CENTER_X + r * Math.sin(rad),
    y: LEAN_CENTER_Y - r * Math.cos(rad),
  };
}

function describeLeanArc(r, startAngle, endAngle) {
  if (endAngle <= startAngle) return '';
  const start = leanPolarToCartesian(r, startAngle);
  const end = leanPolarToCartesian(r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function buildLeanGauge() {
  if (!leanTicksGroup) return;

  leanArcRedL.setAttribute('d', describeLeanArc(72, -LEAN_RANGE, -LEAN_YELLOW));
  leanArcYellowL.setAttribute('d', describeLeanArc(72, -LEAN_YELLOW, -LEAN_GREEN));
  leanArcGreen.setAttribute('d', describeLeanArc(72, -LEAN_GREEN, LEAN_GREEN));
  leanArcYellowR.setAttribute('d', describeLeanArc(72, LEAN_GREEN, LEAN_YELLOW));
  leanArcRedR.setAttribute('d', describeLeanArc(72, LEAN_YELLOW, LEAN_RANGE));

  leanTicksGroup.innerHTML = '';
  for (let value = -LEAN_RANGE; value <= LEAN_RANGE; value += 10) {
    const isMajor = value % 30 === 0;
    const outer = leanPolarToCartesian(82, value);
    const inner = leanPolarToCartesian(isMajor ? 66 : 74, value);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', outer.x);
    line.setAttribute('y1', outer.y);
    line.setAttribute('x2', inner.x);
    line.setAttribute('y2', inner.y);
    line.setAttribute('class', isMajor ? 'tick-major' : 'tick-minor');
    leanTicksGroup.appendChild(line);

    if (isMajor) {
      const labelPos = leanPolarToCartesian(52, value);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', labelPos.x);
      text.setAttribute('y', labelPos.y);
      text.textContent = String(value);
      leanTicksGroup.appendChild(text);
    }
  }
}

function renderAccel(gForce) {
  const absG = Math.abs(gForce);
  const ratio = Math.max(0, Math.min(1, absG / ACCEL_MAX_G));
  accelBarFill.style.height = `${ratio * 50}%`;
  accelBarFill.style.top = gForce < 0 ? '50%' : 'auto';
  accelBarFill.style.bottom = gForce >= 0 ? '50%' : 'auto';
  accelBarFill.classList.remove('neutral', 'accelerating', 'braking', 'high', 'extreme');
  if (absG === 0) accelBarFill.classList.add('neutral');
  else accelBarFill.classList.add(gForce > 0 ? 'accelerating' : 'braking');
  if (absG > 0.55) accelBarFill.classList.add('high');
  if (absG > 0.9) accelBarFill.classList.add('extreme');
  accelReadout.textContent = `${gForce > 0 ? '+' : ''}${gForce.toFixed(2)}g`;
}

function renderLean(deg) {
  const absDeg = Math.abs(deg);
  const roundedDeg = Math.round(absDeg);
  const side = deg >= 0 ? 'R' : 'L';
  const invalid = absDeg > LEAN_RANGE;
  leanArrow.hidden = invalid;
  leanArrow.style.display = invalid ? 'none' : '';
  if (leanInvalid) leanInvalid.hidden = !invalid;
  const clampedDeg = Math.max(-LEAN_RANGE, Math.min(LEAN_RANGE, deg));
  leanArrow.setAttribute('transform', `rotate(${clampedDeg} ${LEAN_CENTER_X} ${LEAN_CENTER_Y})`);
  leanArrow.classList.remove('zone-green', 'zone-yellow', 'zone-red');
  if (invalid || absDeg >= LEAN_YELLOW) leanArrow.classList.add('zone-red');
  else if (absDeg >= LEAN_GREEN) leanArrow.classList.add('zone-yellow');
  else leanArrow.classList.add('zone-green');
  leanReadout.textContent = invalid ? `! ${roundedDeg}°` : roundedDeg === 0 ? '-' : `${roundedDeg}°${side}`;
}

// Ángulo (en grados) que ha girado el vector (x,y) respecto al vector de
// referencia (refX,refY), en el plano propio del teléfono. Al no depender de
// beta/gamma ni de la orientación de pantalla, no sufre gimbal lock ni
// necesita saber si el montaje es vertical u horizontal.
function angleBetween(x, y, refX, refY) {
  const cross = x * refY - y * refX;
  const dot = x * refX + y * refY;
  return (Math.atan2(cross, dot) * 180) / Math.PI;
}

function handleOrientation(event) {
  if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;

  const now = performance.now();
  const currentRoll = LEAN_SIGN * screenAdjustedRoll(event.beta, event.gamma);
  if (!Number.isFinite(currentRoll)) return;

  if (leanOrientationOffset === null) {
    leanOrientationOffset = currentRoll;
  }

  const raw = normalizeAngle180(currentRoll - leanOrientationOffset);
  hasOrientationLean = true;

  if (lastLeanTime === null) {
    smoothedLean = raw;
  } else {
    const dt = Math.max(0.001, (now - lastLeanTime) / 1000);
    const alpha = 1 - Math.exp(-dt / LEAN_TAU);
    smoothedLean = alpha * raw + (1 - alpha) * smoothedLean;
  }
  lastLeanTime = now;

  if (now - lastMotionRenderTime >= MOTION_RENDER_MS) {
    lastMotionRenderTime = now;
    renderLean(smoothedLean);
  }
}

function handleMotion(event) {
  if (hasOrientationLean) return;

  const now = performance.now();

  const g = event.accelerationIncludingGravity;
  if (g && g.x !== null && g.y !== null) {
    const gravity = normalizeGravityForScreen(g.x, g.y);
    const gravityMagnitude = Math.hypot(g.x || 0, g.y || 0, g.z || 0);
    const stableGravity = Math.abs(gravityMagnitude - G) < 2.2;

    if (filteredGravityX === null || filteredGravityY === null || lastLeanTime === null) {
      filteredGravityX = gravity.x;
      filteredGravityY = gravity.y;
    } else {
      const dt = Math.max(0.001, (now - lastLeanTime) / 1000);
      const baseAlpha = 1 - Math.exp(-dt / LEAN_TAU);
      const alpha = stableGravity ? baseAlpha : baseAlpha * 0.18;
      filteredGravityX = alpha * gravity.x + (1 - alpha) * filteredGravityX;
      filteredGravityY = alpha * gravity.y + (1 - alpha) * filteredGravityY;
    }

    lastGravityX = filteredGravityX;
    lastGravityY = filteredGravityY;

    if (leanRefX === null) {
      leanRefX = filteredGravityX;
      leanRefY = filteredGravityY;
    }

    const raw = LEAN_SIGN * angleBetween(filteredGravityX, filteredGravityY, leanRefX, leanRefY);

    if (lastLeanTime === null) {
      smoothedLean = raw;
    } else {
      const dt = Math.max(0.001, (now - lastLeanTime) / 1000);
      const alpha = 1 - Math.exp(-dt / LEAN_TAU);
      smoothedLean = alpha * raw + (1 - alpha) * smoothedLean;
    }
    lastLeanTime = now;
  }

  if (now - lastMotionRenderTime >= MOTION_RENDER_MS) {
    lastMotionRenderTime = now;
    renderLean(smoothedLean);
  }
}

function calibrateLean() {
  if (hasOrientationLean) {
    leanOrientationOffset = null;
  } else {
    leanRefX = lastGravityX;
    leanRefY = lastGravityY;
  }
  smoothedLean = 0;
  renderLean(0);
}

leanGauge.addEventListener('click', calibrateLean);

async function requestMotionPermission() {
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const result = await DeviceMotionEvent.requestPermission();
      return result === 'granted';
    } catch (err) {
      console.warn('Permiso de sensores de movimiento denegado:', err);
      return false;
    }
  }
  return 'DeviceMotionEvent' in window;
}

async function requestOrientationPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const result = await DeviceOrientationEvent.requestPermission();
      return result === 'granted';
    } catch (err) {
      console.warn('Permiso de orientación denegado:', err);
      return false;
    }
  }
  return 'DeviceOrientationEvent' in window;
}

// --- Arranque ---

async function start() {
  const gpsAvailable = window.isSecureContext && 'geolocation' in navigator;

  sessionStartTime = Date.now();
  startBtn.hidden = true;
  gaugeWrap.hidden = false;
  cornerStats.hidden = false;
  updateInfoPanel();
  startInfoCycler();
  startMotoGatewayPolling();
  setStatus(gpsAvailable ? 'Buscando señal GPS…' : 'Buscando Moto Gateway…');

  requestWakeLock();

  if (gpsAvailable) {
    watchId = navigator.geolocation.watchPosition(handlePosition, handleError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000,
    });
  } else {
    console.warn('GPS no disponible: la web necesita HTTPS o un origen seguro para usar geolocalizacion.');
  }

  const orientationGranted = window.isSecureContext && await requestOrientationPermission();
  const motionGranted = window.isSecureContext && await requestMotionPermission();
  if (orientationGranted) {
    window.addEventListener('deviceorientation', handleOrientation);
  }
  if (orientationGranted || motionGranted) {
    if (motionGranted) window.addEventListener('devicemotion', handleMotion);
    leanPlaceholder.hidden = true;
    leanWrap.hidden = false;
  }
}

startBtn.addEventListener('click', start, { once: true });

// --- Init ---

if (versionEl) versionEl.textContent = `v${APP_VERSION}`;
lockPageZoom();
setUnitButtonLabel();
buildGauge(UNITS[unitIndex]);
buildLeanGauge();
renderSpeed(0);
renderLean(0);
renderAccel(0);

// --- Offline support ---

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    // updateViaCache: 'none' obliga al navegador a comprobar siempre contra
    // el servidor si sw.js ha cambiado, en vez de fiarse de la caché HTTP.
    navigator.serviceWorker.register('sw.js?v=0.9.3', { updateViaCache: 'none' }).catch((err) => {
      console.warn('No se pudo registrar el Service Worker:', err);
    });
  });

  let hasReloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hasReloaded) return;
    hasReloaded = true;
    window.location.reload();
  });
}





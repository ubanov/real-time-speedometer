/*
  ESP32 Moto Gateway

  Firmware inicial para exponer datos de la moto por WiFi a la aplicacion web.
  Es una conversion del antiguo ejemplo BLE a una API HTTP sencilla.

  Endpoints:
    GET  /status
    GET  /config
    POST /command

  Por defecto crea un punto de acceso:
    SSID: MotoGateway
    PASS: moto12345
    URL:  http://192.168.4.1/status

  Si rellenas WIFI_SSID/WIFI_PASS, tambien intenta conectarse a esa red.
*/

#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>

#define FW_VERSION "0.1.0"
#define DEVICE_NAME "MotoGateway"

// --- WiFi ---

const char *WIFI_SSID = "";
const char *WIFI_PASS = "";

const char *AP_SSID = "MotoGateway";
const char *AP_PASS = "moto12345";
const char *MDNS_NAME = "moto";

// --- Pines provisionales ---
// Ajustar cuando definamos el cableado real. Evitamos pines de strapping
// delicados donde sea posible.

const uint8_t PIN_SPEED = 27;
const uint8_t PIN_RPM = 26;

const uint8_t PIN_TURN_LEFT = 32;
const uint8_t PIN_TURN_RIGHT = 33;
const uint8_t PIN_NEUTRAL = 25;
const uint8_t PIN_HIGH_BEAM = 14;
const uint8_t PIN_ENGINE_ON = 23;
const uint8_t PIN_KEY_ON = 13;

const uint8_t PIN_BUTTON_WAKE = 34;
const uint8_t PIN_BUTTON_ACTION = 35;

const uint8_t PIN_RELAY_LIGHT = 16;
const uint8_t PIN_RELAY_STARTER = 17;

const uint8_t PIN_BIKE_VOLTAGE = 36;
const uint8_t PIN_ESP_BATTERY = 39;

// --- Configuracion de medida ---

const uint16_t SPEED_PULSES_PER_WHEEL_REV = 4;
const float WHEEL_CIRCUMFERENCE_M = 2.05;
const uint16_t RPM_PULSES_PER_REV = 1;

const bool INPUT_ACTIVE_LOW = true;
const bool RELAY_ACTIVE_HIGH = true;

const uint32_t STATUS_SAMPLE_MS = 100;
const uint32_t SPEED_STALE_MS = 1500;
const uint32_t RPM_STALE_MS = 1500;
const uint32_t LIGHT_ON_DELAY_MS = 4000;
const uint32_t LIGHT_OFF_DELAY_MS = 4000;
const uint32_t WAKE_WINDOW_MS = 30000;
const uint32_t STARTER_DEFAULT_MS = 5000;
const uint32_t STARTER_MAX_MS = 8000;

WebServer server(80);

// --- Estado actualizado desde interrupciones ---

volatile uint32_t speedPulseCount = 0;
volatile uint32_t rpmPulseCount = 0;
volatile uint32_t lastSpeedPulseMs = 0;
volatile uint32_t lastRpmPulseMs = 0;

uint32_t lastSampleMs = 0;
uint32_t lastSpeedCount = 0;
uint32_t lastRpmCount = 0;

float speedKmh = 0;
uint16_t rpm = 0;
uint32_t totalSpeedPulses = 0;

bool turnLeft = false;
bool turnRight = false;
bool neutral = false;
bool highBeam = false;
bool engineOn = false;
bool keyOn = false;
bool buttonWake = false;
bool buttonAction = false;

bool relayLight = false;
bool relayStarter = false;
bool lightAuto = true;

uint32_t wakeWindowUntil = 0;
uint32_t starterUntil = 0;
uint32_t engineOnSince = 0;
uint32_t engineOffSince = 0;

float bikeVoltage = 0;
uint16_t espBatteryMv = 0;

// --- Utilidades ---

void IRAM_ATTR speedPulseIsr() {
  speedPulseCount++;
  lastSpeedPulseMs = millis();
}

void IRAM_ATTR rpmPulseIsr() {
  rpmPulseCount++;
  lastRpmPulseMs = millis();
}

bool activeRead(uint8_t pin) {
  const int value = digitalRead(pin);
  return INPUT_ACTIVE_LOW ? value == LOW : value == HIGH;
}

void setRelay(uint8_t pin, bool on) {
  digitalWrite(pin, on == RELAY_ACTIVE_HIGH ? HIGH : LOW);
}

void setRelayLight(bool on) {
  relayLight = on;
  setRelay(PIN_RELAY_LIGHT, relayLight);
}

void setRelayStarter(bool on) {
  relayStarter = on;
  setRelay(PIN_RELAY_STARTER, relayStarter);
}

String boolJson(bool value) {
  return value ? "true" : "false";
}

String powerMode() {
  if (engineOn) return "running";
  if (keyOn) return "standby";
  if (millis() < wakeWindowUntil) return "wakeWindow";
  return "sleep";
}

String ipToString(IPAddress ip) {
  return String(ip[0]) + "." + String(ip[1]) + "." + String(ip[2]) + "." + String(ip[3]);
}

float readBikeVoltage() {
  // Placeholder conservador. Ajustar divisor real.
  // Con 3.3 V ADC y divisor 100k/27k: factor aproximado 4.70.
  const float adc = analogRead(PIN_BIKE_VOLTAGE);
  return (adc / 4095.0f) * 3.3f * 4.70f;
}

uint16_t readEspBatteryMv() {
  // Placeholder. Ajustar si se usa un divisor o placa con medida de bateria.
  const float adc = analogRead(PIN_ESP_BATTERY);
  return (uint16_t)((adc / 4095.0f) * 3300.0f * 2.0f);
}

void addCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void sendJson(uint16_t code, const String &payload) {
  addCorsHeaders();
  server.send(code, "application/json", payload);
}

void handleOptions() {
  addCorsHeaders();
  server.send(204, "text/plain", "");
}

// --- Lectura de estado ---

void sampleInputs() {
  turnLeft = activeRead(PIN_TURN_LEFT);
  turnRight = activeRead(PIN_TURN_RIGHT);
  neutral = activeRead(PIN_NEUTRAL);
  highBeam = activeRead(PIN_HIGH_BEAM);
  engineOn = activeRead(PIN_ENGINE_ON);
  keyOn = activeRead(PIN_KEY_ON);
  buttonWake = activeRead(PIN_BUTTON_WAKE);
  buttonAction = activeRead(PIN_BUTTON_ACTION);

  if (buttonWake) {
    wakeWindowUntil = millis() + WAKE_WINDOW_MS;
  }

  bikeVoltage = readBikeVoltage();
  espBatteryMv = readEspBatteryMv();
}

void updatePulseDerivedValues() {
  const uint32_t now = millis();
  if (now - lastSampleMs < STATUS_SAMPLE_MS) return;

  const uint32_t currentSpeedCount = speedPulseCount;
  const uint32_t currentRpmCount = rpmPulseCount;
  const uint32_t dtMs = now - lastSampleMs;

  if (lastSampleMs > 0 && dtMs > 0) {
    const uint32_t speedDelta = currentSpeedCount - lastSpeedCount;
    const uint32_t rpmDelta = currentRpmCount - lastRpmCount;
    totalSpeedPulses = currentSpeedCount;

    if (now - lastSpeedPulseMs <= SPEED_STALE_MS) {
      const float pulsesPerSecond = speedDelta * 1000.0f / dtMs;
      const float wheelRevPerSecond = pulsesPerSecond / SPEED_PULSES_PER_WHEEL_REV;
      speedKmh = wheelRevPerSecond * WHEEL_CIRCUMFERENCE_M * 3.6f;
    } else {
      speedKmh = 0;
    }

    if (now - lastRpmPulseMs <= RPM_STALE_MS) {
      const float pulsesPerSecond = rpmDelta * 1000.0f / dtMs;
      rpm = (uint16_t)((pulsesPerSecond * 60.0f / RPM_PULSES_PER_REV) + 0.5f);
    } else {
      rpm = 0;
    }
  }

  lastSampleMs = now;
  lastSpeedCount = currentSpeedCount;
  lastRpmCount = currentRpmCount;
}

void updateRelays() {
  const uint32_t now = millis();

  if (engineOn) {
    engineOffSince = 0;
    if (engineOnSince == 0) engineOnSince = now;
  } else {
    engineOnSince = 0;
    if (engineOffSince == 0) engineOffSince = now;
  }

  if (lightAuto) {
    if (engineOn && engineOnSince > 0 && now - engineOnSince >= LIGHT_ON_DELAY_MS) {
      setRelayLight(true);
    }
    if (!engineOn && engineOffSince > 0 && now - engineOffSince >= LIGHT_OFF_DELAY_MS) {
      setRelayLight(false);
    }
  }

  if (relayStarter && now >= starterUntil) {
    setRelayStarter(false);
    starterUntil = 0;
  }
}

void refreshState() {
  sampleInputs();
  updatePulseDerivedValues();
  updateRelays();
}

// --- API ---

String statusJson() {
  String json = "{";
  json += "\"online\":true,";
  json += "\"device\":\"" DEVICE_NAME "\",";
  json += "\"version\":\"" FW_VERSION "\",";
  json += "\"uptimeMs\":";
  json += String(millis());
  json += ",";
  json += "\"speedKmh\":";
  json += String(speedKmh, 1);
  json += ",";
  json += "\"rpm\":";
  json += String(rpm);
  json += ",";
  json += "\"totalSpeedPulses\":";
  json += String(totalSpeedPulses);
  json += ",";
  json += "\"leds\":{";
  json += "\"turnLeft\":";
  json += boolJson(turnLeft);
  json += ",";
  json += "\"turnRight\":";
  json += boolJson(turnRight);
  json += ",";
  json += "\"neutral\":";
  json += boolJson(neutral);
  json += ",";
  json += "\"highBeam\":";
  json += boolJson(highBeam);
  json += ",";
  json += "\"engineOn\":";
  json += boolJson(engineOn);
  json += ",";
  json += "\"keyOn\":";
  json += boolJson(keyOn);
  json += "},";
  json += "\"buttons\":{";
  json += "\"wake\":";
  json += boolJson(buttonWake);
  json += ",";
  json += "\"action\":";
  json += boolJson(buttonAction);
  json += "},";
  json += "\"relays\":{";
  json += "\"light\":";
  json += boolJson(relayLight);
  json += ",";
  json += "\"lightAuto\":";
  json += boolJson(lightAuto);
  json += ",";
  json += "\"starter\":";
  json += boolJson(relayStarter);
  json += "},";
  json += "\"power\":{";
  json += "\"batteryMv\":";
  json += String(espBatteryMv);
  json += ",";
  json += "\"bikeVoltage\":";
  json += String(bikeVoltage, 1);
  json += ",";
  json += "\"mode\":\"";
  json += powerMode();
  json += "\"";
  json += "},";
  json += "\"network\":{";
  json += "\"staIp\":\"";
  json += ipToString(WiFi.localIP());
  json += "\",";
  json += "\"apIp\":\"";
  json += ipToString(WiFi.softAPIP());
  json += "\"";
  json += "}";
  json += "}";
  return json;
}

String configJson() {
  String json = "{";
  json += "\"device\":\"" DEVICE_NAME "\",";
  json += "\"version\":\"" FW_VERSION "\",";
  json += "\"speedPulsesPerWheelRev\":";
  json += String(SPEED_PULSES_PER_WHEEL_REV);
  json += ",";
  json += "\"wheelCircumferenceM\":";
  json += String(WHEEL_CIRCUMFERENCE_M, 3);
  json += ",";
  json += "\"rpmPulsesPerRev\":";
  json += String(RPM_PULSES_PER_REV);
  json += ",";
  json += "\"lightOnDelayMs\":";
  json += String(LIGHT_ON_DELAY_MS);
  json += ",";
  json += "\"lightOffDelayMs\":";
  json += String(LIGHT_OFF_DELAY_MS);
  json += ",";
  json += "\"wakeWindowMs\":";
  json += String(WAKE_WINDOW_MS);
  json += ",";
  json += "\"starterMaxMs\":";
  json += String(STARTER_MAX_MS);
  json += ",";
  json += "\"endpoints\":[\"/status\",\"/config\",\"/command\"]";
  json += "}";
  return json;
}

bool bodyContains(const String &needle) {
  return server.hasArg("plain") && server.arg("plain").indexOf(needle) >= 0;
}

uint32_t readCommandMs(const String &key, uint32_t fallback) {
  if (!server.hasArg("plain")) return fallback;

  const String body = server.arg("plain");
  const int pos = body.indexOf(key);
  if (pos < 0) return fallback;

  const int colon = body.indexOf(':', pos);
  if (colon < 0) return fallback;

  const int value = body.substring(colon + 1).toInt();
  if (value <= 0) return fallback;
  return (uint32_t)value;
}

void handleStatus() {
  refreshState();
  sendJson(200, statusJson());
}

void handleConfig() {
  sendJson(200, configJson());
}

void handleCommand() {
  refreshState();

  if (bodyContains("starterEnableMs")) {
    const uint32_t requestedMs = readCommandMs("starterEnableMs", STARTER_DEFAULT_MS);
    const uint32_t durationMs = requestedMs > STARTER_MAX_MS ? STARTER_MAX_MS : requestedMs;
    const bool wakeAllowed = millis() < wakeWindowUntil || keyOn || engineOn;

    if (!wakeAllowed) {
      sendJson(409, "{\"ok\":false,\"error\":\"wake_window_required\"}");
      return;
    }

    setRelayStarter(true);
    starterUntil = millis() + durationMs;
    sendJson(200, String("{\"ok\":true,\"starter\":true,\"durationMs\":") + String(durationMs) + "}");
    return;
  }

  if (bodyContains("\"light\":\"auto\"")) {
    lightAuto = true;
    sendJson(200, "{\"ok\":true,\"light\":\"auto\"}");
    return;
  }

  if (bodyContains("\"light\":true")) {
    lightAuto = false;
    setRelayLight(true);
    sendJson(200, "{\"ok\":true,\"light\":true}");
    return;
  }

  if (bodyContains("\"light\":false")) {
    lightAuto = false;
    setRelayLight(false);
    sendJson(200, "{\"ok\":true,\"light\":false}");
    return;
  }

  sendJson(400, "{\"ok\":false,\"error\":\"unknown_command\"}");
}

void handleNotFound() {
  sendJson(404, "{\"ok\":false,\"error\":\"not_found\"}");
}

// --- Setup ---

void setupPins() {
  pinMode(PIN_SPEED, INPUT_PULLUP);
  pinMode(PIN_RPM, INPUT_PULLUP);

  pinMode(PIN_TURN_LEFT, INPUT_PULLUP);
  pinMode(PIN_TURN_RIGHT, INPUT_PULLUP);
  pinMode(PIN_NEUTRAL, INPUT_PULLUP);
  pinMode(PIN_HIGH_BEAM, INPUT_PULLUP);
  pinMode(PIN_ENGINE_ON, INPUT_PULLUP);
  pinMode(PIN_KEY_ON, INPUT_PULLUP);
  pinMode(PIN_BUTTON_WAKE, INPUT);
  pinMode(PIN_BUTTON_ACTION, INPUT);

  pinMode(PIN_RELAY_LIGHT, OUTPUT);
  pinMode(PIN_RELAY_STARTER, OUTPUT);
  setRelayLight(false);
  setRelayStarter(false);

  attachInterrupt(digitalPinToInterrupt(PIN_SPEED), speedPulseIsr, RISING);
  attachInterrupt(digitalPinToInterrupt(PIN_RPM), rpmPulseIsr, RISING);
}

void setupWifi() {
  WiFi.mode(WIFI_AP_STA);

  WiFi.softAP(AP_SSID, AP_PASS);
  Serial.print("AP IP: ");
  Serial.println(WiFi.softAPIP());

  if (strlen(WIFI_SSID) > 0) {
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    Serial.print("Connecting to WiFi");
    const uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 8000) {
      delay(250);
      Serial.print(".");
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
      Serial.print("STA IP: ");
      Serial.println(WiFi.localIP());
    } else {
      Serial.println("STA WiFi not connected, AP remains active");
    }
  }

  if (MDNS.begin(MDNS_NAME)) {
    MDNS.addService("http", "tcp", 80);
    Serial.println("mDNS: http://moto.local/");
  }
}

void setupServer() {
  server.on("/status", HTTP_GET, handleStatus);
  server.on("/config", HTTP_GET, handleConfig);
  server.on("/command", HTTP_POST, handleCommand);
  server.on("/status", HTTP_OPTIONS, handleOptions);
  server.on("/config", HTTP_OPTIONS, handleOptions);
  server.on("/command", HTTP_OPTIONS, handleOptions);
  server.onNotFound(handleNotFound);
  server.begin();
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("Starting " DEVICE_NAME " " FW_VERSION);

  setupPins();
  setupWifi();
  setupServer();

  Serial.println("Ready");
}

void loop() {
  refreshState();
  server.handleClient();
  delay(5);
}

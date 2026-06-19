#include <bluefruit.h>
#include <Wire.h>
#include <LSM6DS3.h>
#include <math.h>
#include <nrf_soc.h>

#define BLE_DEVICE_NAME "XIAOChat"

// --- Gesture sequence (prototype logic) ---
#define MAX_GESTURES          5
#define GESTURE_DEBOUNCE_MS   500
#define GESTURE_COOLDOWN_MS   3000
#define G_TAP                 1
#define G_LEFT                2
#define G_RIGHT               3
#define TAP_JERK_THRESHOLD    0.40f
#define TILT_THRESHOLD        0.55f

LSM6DS3 imu(I2C_MODE, 0x6A);
bool imuReady = false;
unsigned long lastGestureDetectMs = 0;
unsigned long lastMatchSuccessMs = 0;
bool gestureRecognitionLocked = false;

int masterSequence[MAX_GESTURES];
int masterCount = 0;

int currentAttempt[MAX_GESTURES];
int currentAttemptCount = 0;

// --- Battery protection (deep sleep below 3.10 V) ---
#define BATTERY_CUTOFF_V           3.10f
#define BATTERY_CHECK_INTERVAL_MS  5000UL
#define BATTERY_ADC_SAMPLES        4
#define BATTERY_LOW_CONFIRM        2

unsigned long lastBatteryCheckMs = 0;
uint8_t lowBatteryCount = 0;

// --- IMU idle sleep (RAM retained — not SYSTEMOFF) ---
#define INACTIVITY_TIMEOUT_MS      30000UL
#define MOTION_ACTIVITY_THRESHOLD  0.30f
#define MOTION_DELTA_THRESHOLD     0.10f
#define MOTION_ACTIVITY_CONFIRM    3
#define MOTION_WAKE_THRESHOLD      0.40f
#define MOTION_WAKE_DELTA          0.18f
#define IMU_WAKE_POLL_MS           80UL
#define POWER_DEBUG_INTERVAL_MS    20000UL

#if defined(ARDUINO_Seeed_XIAO_nRF52840_Sense)
  #define IMU_INT_PIN 11
#else
  #define IMU_INT_PIN 2
#endif

unsigned long lastSignificantMotionMs = 0;
unsigned long lastPowerDebugMs = 0;
uint8_t motionActivityHits = 0;
bool idleSleepActive = false;
volatile bool imuWakeFlag = false;

// --- BLE diagnostics (advertising / connection audit) ---
#define MAX_BLE_CONNECTIONS   2
#define BLE_DIAG_INTERVAL_MS 10000
unsigned long lastBleDiag = 0;
uint32_t bleConnectEvents = 0;
uint32_t bleDisconnectEvents = 0;
uint32_t bleAdvRestartEvents = 0;

BLEService chatService = BLEService("12345678-1234-1234-1234-123456789012");
BLECharacteristic txCharacteristic = BLECharacteristic("87654321-4321-4321-4321-210987654321");
BLECharacteristic rxCharacteristic = BLECharacteristic("11111111-2222-3333-4444-555555555555");

BLEDis bledis;
BLEHidAdafruit blehid;

bool deviceConnected = false;
bool oldDeviceConnected = false;
uint16_t activeConnHandle = 0xFFFF;

String storedPassword = "";
String storedActivateBy = "";
String storedGestureSequence = "";
bool pendingTypePassword = false;

void resetLEDs() {
  digitalWrite(LED_RED, HIGH);
  digitalWrite(LED_GREEN, HIGH);
  digitalWrite(LED_BLUE, HIGH);
}

void flashLED(uint8_t led, uint16_t ms) {
  resetLEDs();
  digitalWrite(led, LOW);
  delay(ms);
  resetLEDs();
}

void notifyTx(uint16_t conn_hdl, const char* msg) {
  if (Bluefruit.connected() == 0) {
    return;
  }
  uint16_t len = strlen(msg);
  if (conn_hdl != BLE_CONN_HANDLE_INVALID) {
    txCharacteristic.notify(conn_hdl, msg, len);
  } else {
    txCharacteristic.notify(msg, len);
  }
}

// BLEHidAdafruit::keyPress(char) uses TinyUSB HID_ASCII_TO_KEYCODE — a US QWERTY
// ASCII → (shift, HID usage) table. The host (macOS Swiss French) maps physical
// key positions to different characters (e.g. HID_KEY_Y types "z"). We bypass
// keyPress() and send the correct physical key + modifiers for Swiss French.
void pressSwissFrenchChar(char ch) {
  uint8_t modifier = 0;
  uint8_t keycode = 0;

  if (ch >= 'a' && ch <= 'z') {
    if (ch == 'y') {
      keycode = HID_KEY_Z;
    } else if (ch == 'z') {
      keycode = HID_KEY_Y;
    } else {
      keycode = HID_KEY_A + (ch - 'a');
    }
  } else if (ch >= 'A' && ch <= 'Z') {
    modifier = KEYBOARD_MODIFIER_LEFTSHIFT;
    if (ch == 'Y') {
      keycode = HID_KEY_Z;
    } else if (ch == 'Z') {
      keycode = HID_KEY_Y;
    } else {
      keycode = HID_KEY_A + (ch - 'A');
    }
  } else if (ch >= '0' && ch <= '9') {
    blehid.keyPress(ch);
    return;
  } else {
    switch (ch) {
      case ' ':
        keycode = HID_KEY_SPACE;
        break;
      case ',':
        keycode = HID_KEY_COMMA;
        break;
      case '.':
        keycode = HID_KEY_PERIOD;
        break;
      case '-':
        keycode = HID_KEY_SLASH;
        break;
      case '_':
        keycode = HID_KEY_8;
        break;
      case '(':
        keycode = HID_KEY_5;
        break;
      case ')':
        keycode = HID_KEY_MINUS;
        break;
      case '$':
        keycode = HID_KEY_EQUAL;
        break;
      case '\'':
        keycode = HID_KEY_4;
        break;
      case '"':
        keycode = HID_KEY_3;
        break;
      case ';':
        modifier = KEYBOARD_MODIFIER_LEFTSHIFT;
        keycode = HID_KEY_COMMA;
        break;
      case ':':
        modifier = KEYBOARD_MODIFIER_LEFTSHIFT;
        keycode = HID_KEY_PERIOD;
        break;
      case '<':
        keycode = HID_KEY_EUROPE_1;
        break;
      case '>':
        modifier = KEYBOARD_MODIFIER_LEFTSHIFT;
        keycode = HID_KEY_EUROPE_1;
        break;
      case '?':
        modifier = KEYBOARD_MODIFIER_LEFTSHIFT;
        keycode = HID_KEY_MINUS;
        break;
      case '@':
        modifier = KEYBOARD_MODIFIER_LEFTALT;
        keycode = HID_KEY_2;
        break;
      case '#':
        modifier = KEYBOARD_MODIFIER_LEFTALT;
        keycode = HID_KEY_3;
        break;
      case '[':
        modifier = KEYBOARD_MODIFIER_LEFTALT;
        keycode = HID_KEY_BRACKET_LEFT;
        break;
      case ']':
        modifier = KEYBOARD_MODIFIER_LEFTALT;
        keycode = HID_KEY_BRACKET_RIGHT;
        break;
      case '{':
        modifier = KEYBOARD_MODIFIER_LEFTALT;
        keycode = HID_KEY_APOSTROPHE;
        break;
      case '}':
        modifier = KEYBOARD_MODIFIER_LEFTALT;
        keycode = HID_KEY_BACKSLASH;
        break;
      case '|':
        modifier = KEYBOARD_MODIFIER_LEFTALT;
        keycode = HID_KEY_1;
        break;
      case '\\':
        modifier = KEYBOARD_MODIFIER_LEFTALT;
        keycode = HID_KEY_EUROPE_1;
        break;
      default:
        blehid.keyPress(ch);
        return;
    }
  }

  if (keycode == 0) {
    return;
  }

  uint8_t keys[6] = { keycode, 0, 0, 0, 0, 0 };
  blehid.keyboardReport(modifier, keys);
}

void typePassword() {
  for (uint16_t i = 0; i < storedPassword.length(); i++) {
    pressSwissFrenchChar(storedPassword.charAt(i));
    delay(5);
    blehid.keyRelease();
    delay(5);
  }
}

void resetCurrentAttempt() {
  currentAttemptCount = 0;
  for (int i = 0; i < MAX_GESTURES; i++) {
    currentAttempt[i] = 0;
  }
}

void resetGestureRecognition() {
  resetCurrentAttempt();
  lastGestureDetectMs = millis();
}

void onSequenceMatch() {
  unsigned long now = millis();
  lastMatchSuccessMs = now;
  gestureRecognitionLocked = true;
  resetGestureRecognition();
  resetLEDs();

  Serial.println("MATCH: full gesture sequence matched");
  flashLED(LED_GREEN, 200);
  typePassword();
  notifyTx(BLE_CONN_HANDLE_INVALID, "ACK|MATCH");
}

void onSequenceFail() {
  resetGestureRecognition();
  Serial.println("MATCH_FAIL: wrong gesture in sequence");
  flashLED(LED_RED, 120);
  notifyTx(BLE_CONN_HANDLE_INVALID, "ACK|MATCH_FAIL");
}

int gestureNameToCode(String name) {
  name.trim();
  name.toLowerCase();
  if (name == "tap") return G_TAP;
  if (name == "left") return G_LEFT;
  if (name == "right") return G_RIGHT;
  return 0;
}

void parseGestureSequence(String seq) {
  masterCount = 0;
  seq.trim();
  if (seq.length() == 0 || seq == "none") {
    return;
  }

  int start = 0;
  while (start < (int)seq.length() && masterCount < MAX_GESTURES) {
    int comma = seq.indexOf(',', start);
    String token = (comma == -1) ? seq.substring(start) : seq.substring(start, comma);
    int code = gestureNameToCode(token);
    if (code > 0) {
      masterSequence[masterCount++] = code;
    }
    if (comma == -1) break;
    start = comma + 1;
  }

  Serial.print("masterSequence loaded (");
  Serial.print(masterCount);
  Serial.println(" steps)");
}

void parseSetPassword(String cmd) {
  cmd.trim();
  if (!cmd.startsWith("SET_PASSWORD|")) {
    return;
  }

  String payload = cmd.substring(13);
  payload.trim();

  storedPassword = "";
  storedActivateBy = "";
  storedGestureSequence = "";

  int first = payload.indexOf('|');
  if (first < 0) {
    storedPassword = payload;
  } else {
    int second = payload.indexOf('|', first + 1);
    storedPassword = payload.substring(0, first);
    if (second < 0) {
      storedActivateBy = payload.substring(first + 1);
    } else {
      storedActivateBy = payload.substring(first + 1, second);
      storedGestureSequence = payload.substring(second + 1);
    }
  }

  storedPassword.trim();
  storedActivateBy.trim();
  storedGestureSequence.trim();

  parseGestureSequence(storedGestureSequence);
  gestureRecognitionLocked = false;
  lastMatchSuccessMs = 0;
  resetGestureRecognition();

  Serial.print("SET_PASSWORD parsed — password=[");
  Serial.print(storedPassword);
  Serial.print("] activateBy=[");
  Serial.print(storedActivateBy);
  Serial.print("] gesture=[");
  Serial.print(storedGestureSequence);
  Serial.println("]");
}

float accelToG(float value, float magnitude) {
  return (magnitude > 4.0f) ? (value / 9.81f) : value;
}

int readGestureCode() {
  float ax = imu.readFloatAccelX();
  float ay = imu.readFloatAccelY();
  float az = imu.readFloatAccelZ();
  float rawMag = sqrtf(ax * ax + ay * ay + az * az);

  ax = accelToG(ax, rawMag);
  ay = accelToG(ay, rawMag);
  az = accelToG(az, rawMag);

  float mag = sqrtf(ax * ax + ay * ay + az * az);
  float jerk = fabsf(mag - 1.0f);

  if (jerk > TAP_JERK_THRESHOLD) {
    return G_TAP;
  }
  if (ax > TILT_THRESHOLD) {
    return G_RIGHT;
  }
  if (ax < -TILT_THRESHOLD) {
    return G_LEFT;
  }
  return 0;
}

void checkGestureSequence() {
  if (!imuReady || storedPassword.length() == 0) {
    return;
  }
  if (!storedActivateBy.equals("gesture") || masterCount == 0) {
    return;
  }

  unsigned long now = millis();

  if (gestureRecognitionLocked) {
    if (now - lastMatchSuccessMs < GESTURE_COOLDOWN_MS) {
      return;
    }
    gestureRecognitionLocked = false;
    resetGestureRecognition();
  }

  if (now - lastMatchSuccessMs < GESTURE_COOLDOWN_MS) {
    return;
  }

  int found = readGestureCode();
  if (found == 0) {
    return;
  }
  if (now - lastGestureDetectMs < GESTURE_DEBOUNCE_MS) {
    return;
  }
  lastGestureDetectMs = now;

  if (found == masterSequence[currentAttemptCount]) {
    currentAttempt[currentAttemptCount] = found;
    currentAttemptCount++;

    Serial.print("Gesture step ");
    Serial.print(currentAttemptCount);
    Serial.print("/");
    Serial.println(masterCount);
    flashLED(LED_BLUE, 80);

    if (currentAttemptCount >= masterCount) {
      onSequenceMatch();
    }
    return;
  }

  if (currentAttemptCount > 0) {
    Serial.println("MATCH_FAIL: sequence reset (wrong step)");
  }
  onSequenceFail();
}

void imuWakeISR() {
  imuWakeFlag = true;
}

void imuWriteReg(uint8_t reg, uint8_t value) {
#if defined(ARDUINO_Seeed_XIAO_nRF52840_Sense) || defined(ARDUINO_Seeed_XIAO_nRF52840)
  Wire1.beginTransmission(0x6A);
  Wire1.write(reg);
  Wire1.write(value);
  Wire1.endTransmission();
#else
  Wire.beginTransmission(0x6A);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
#endif
}

uint8_t imuReadReg(uint8_t reg) {
#if defined(ARDUINO_Seeed_XIAO_nRF52840_Sense) || defined(ARDUINO_Seeed_XIAO_nRF52840)
  Wire1.beginTransmission(0x6A);
  Wire1.write(reg);
  Wire1.endTransmission(false);
  Wire1.requestFrom(0x6A, (uint8_t)1);
  if (Wire1.available()) {
    return Wire1.read();
  }
#else
  Wire.beginTransmission(0x6A);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom(0x6A, (uint8_t)1);
  if (Wire.available()) {
    return Wire.read();
  }
#endif
  return 0;
}

float readAccelJerk() {
  float ax = imu.readFloatAccelX();
  float ay = imu.readFloatAccelY();
  float az = imu.readFloatAccelZ();
  float rawMag = sqrtf(ax * ax + ay * ay + az * az);

  ax = accelToG(ax, rawMag);
  ay = accelToG(ay, rawMag);
  az = accelToG(az, rawMag);

  float mag = sqrtf(ax * ax + ay * ay + az * az);
  return fabsf(mag - 1.0f);
}

float readMotionDelta() {
  static float prevAx = 0.0f;
  static float prevAy = 0.0f;
  static float prevAz = 0.0f;
  static bool havePrev = false;

  float ax = imu.readFloatAccelX();
  float ay = imu.readFloatAccelY();
  float az = imu.readFloatAccelZ();
  float rawMag = sqrtf(ax * ax + ay * ay + az * az);

  ax = accelToG(ax, rawMag);
  ay = accelToG(ay, rawMag);
  az = accelToG(az, rawMag);

  if (!havePrev) {
    prevAx = ax;
    prevAy = ay;
    prevAz = az;
    havePrev = true;
    return 0.0f;
  }

  float dx = ax - prevAx;
  float dy = ay - prevAy;
  float dz = az - prevAz;
  float delta = sqrtf(dx * dx + dy * dy + dz * dz);

  prevAx = ax;
  prevAy = ay;
  prevAz = az;

  return delta;
}

void resetMotionDeltaBaseline() {
  readMotionDelta();
}

bool isSignificantMotionSample() {
  float delta = readMotionDelta();
  float jerk = readAccelJerk();
  return delta >= MOTION_DELTA_THRESHOLD || jerk >= MOTION_ACTIVITY_THRESHOLD;
}

void updateMotionActivity() {
  if (!imuReady || idleSleepActive) {
    return;
  }

  if (isSignificantMotionSample()) {
    motionActivityHits++;
    if (motionActivityHits >= MOTION_ACTIVITY_CONFIRM) {
      lastSignificantMotionMs = millis();
      motionActivityHits = 0;
    }
    return;
  }

  motionActivityHits = 0;
}

bool pollImuMotionWake() {
  if (!imuReady) {
    return false;
  }
  return readMotionDelta() >= MOTION_WAKE_DELTA || readAccelJerk() >= MOTION_WAKE_THRESHOLD;
}

void logPowerIdleState() {
  if (!imuReady || idleSleepActive || deviceConnected || isUsbConnected()) {
    return;
  }

  unsigned long now = millis();
  if (now - lastPowerDebugMs < POWER_DEBUG_INTERVAL_MS) {
    return;
  }
  lastPowerDebugMs = now;

  float delta = readMotionDelta();
  float jerk = readAccelJerk();
  long idleSec = (long)((now - lastSignificantMotionMs) / 1000UL);
  long sleepInSec = (long)(INACTIVITY_TIMEOUT_MS / 1000UL) - idleSec;
  if (sleepInSec < 0) {
    sleepInSec = 0;
  }

  Serial.print("[POWER] delta=");
  Serial.print(delta, 3);
  Serial.print("g jerk=");
  Serial.print(jerk, 3);
  Serial.print("g idle=");
  Serial.print(idleSec);
  Serial.print("s sleep_in=");
  Serial.print(sleepInSec);
  Serial.println("s");
}

void configureImuWakeInterrupt() {
  imuWriteReg(0x10, 0x30);
  imuWriteReg(0x5B, 0x03);
  imuWriteReg(0x5C, 0x00);
  imuWriteReg(0x5E, 0x20);
  imuWriteReg(0x12, imuReadReg(0x12) | 0x08);

  pinMode(IMU_INT_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(IMU_INT_PIN), imuWakeISR, RISING);
}

void restoreImuGestureMode() {
  if (!imuReady) {
    return;
  }
  detachInterrupt(digitalPinToInterrupt(IMU_INT_PIN));
  imu.begin();
}

void wakeFromMotion() {
  Serial.println("[POWER] Motion detected - wake up");
  idleSleepActive = false;
  imuWakeFlag = false;
  lastSignificantMotionMs = millis();
  motionActivityHits = 0;
  resetMotionDeltaBaseline();
  restoreImuGestureMode();
  resetGestureRecognition();

  if (!deviceConnected) {
    ensureAdvertising("wake_motion");
  }
  updateConnectionState();
}

void enterIdleSleep() {
  if (idleSleepActive) {
    return;
  }

  idleSleepActive = true;
  Serial.println("[POWER] Entering IMU sleep");
  Serial.flush();

  if (Bluefruit.Advertising.isRunning()) {
    Bluefruit.Advertising.stop();
  }

  if (imuReady) {
    configureImuWakeInterrupt();
  }

  imuWakeFlag = false;
  unsigned long lastImuPollMs = 0;

  while (idleSleepActive) {
    checkBatteryProtection();

    unsigned long now = millis();
    if (imuWakeFlag || (imuReady && now - lastImuPollMs >= IMU_WAKE_POLL_MS && pollImuMotionWake())) {
      wakeFromMotion();
      break;
    }
    lastImuPollMs = now;

    sd_power_mode_set(NRF_POWER_MODE_LOWPWR);
    sd_app_evt_wait();
  }
}

bool shouldEnterIdleSleep() {
  if (!imuReady || idleSleepActive || deviceConnected || isUsbConnected() || pendingTypePassword) {
    return false;
  }
  return (millis() - lastSignificantMotionMs) >= INACTIVITY_TIMEOUT_MS;
}

void logDisconnectReason(uint8_t reason) {
  Serial.print("[BLE] disconnect reason=0x");
  Serial.print(reason, HEX);
  Serial.print(" (");
  switch (reason) {
    case BLE_HCI_CONNECTION_TIMEOUT:
      Serial.print("connection_timeout");
      break;
    case BLE_HCI_REMOTE_USER_TERMINATED_CONNECTION:
      Serial.print("remote_user_terminated");
      break;
    case BLE_HCI_LOCAL_HOST_TERMINATED_CONNECTION:
      Serial.print("local_host_terminated");
      break;
    default:
      Serial.print("other");
      break;
  }
  Serial.println(")");
}

void logPeerInfo(uint16_t conn_handle) {
  BLEConnection* conn = Bluefruit.Connection(conn_handle);
  if (!conn) {
    return;
  }

  char peerName[32];
  peerName[0] = '\0';
  conn->getPeerName(peerName, sizeof(peerName));

  uint8_t const* addr = conn->getPeerAddr().addr;
  Serial.print("[BLE] peer ");
  Serial.print(peerName[0] ? peerName : "(unknown)");
  Serial.print(" addr=");
  for (int i = 5; i >= 0; i--) {
    if (addr[i] < 16) Serial.print('0');
    Serial.print(addr[i], HEX);
    if (i > 0) Serial.print(':');
  }
  Serial.println();
}

void updateConnectionState() {
  uint8_t n = Bluefruit.connected();
  deviceConnected = (n > 0);
  if (n == 0) {
    activeConnHandle = 0xFFFF;
    digitalWrite(LED_GREEN, HIGH);
  } else {
    digitalWrite(LED_GREEN, LOW);
  }
}

void logBleState(const char* context) {
  bool advRunning = Bluefruit.Advertising.isRunning();
  uint8_t stackConnCount = Bluefruit.connected();
  uint8_t maxConn = MAX_BLE_CONNECTIONS;

  Serial.print("[BLE] state @ ");
  Serial.print(context);
  Serial.print(" | advertising=");
  Serial.print(advRunning ? "YES" : "NO");
  Serial.print(" | stack_connected=");
  Serial.print(stackConnCount);
  Serial.print("/");
  Serial.print(maxConn);
  Serial.print(" | deviceConnected=");
  Serial.print(deviceConnected ? "true" : "false");
  Serial.print(" | activeConnHandle=0x");
  Serial.print(activeConnHandle, HEX);
  Serial.print(" | connect_events=");
  Serial.print(bleConnectEvents);
  Serial.print(" | disconnect_events=");
  Serial.print(bleDisconnectEvents);
  Serial.print(" | adv_restarts=");
  Serial.println(bleAdvRestartEvents);

  if (stackConnCount >= maxConn && !advRunning) {
    Serial.println("[BLE] note: all slots full — advertising paused (Mac may monopolize slot 1)");
  } else if (stackConnCount > 0 && stackConnCount < maxConn && !advRunning) {
    Serial.println("[BLE] note: free slot available but advertising is OFF — will restart");
  }
}

void ensureAdvertising(const char* source) {
  if (Bluefruit.Advertising.isRunning()) {
    return;
  }

  Serial.print("[BLE] advertising STOPPED — restarting (@ ");
  Serial.print(source);
  Serial.println(")");

  Bluefruit.Advertising.start(0);
  bleAdvRestartEvents++;

  delay(20);
  logBleState("after_adv_restart");
}

void maybeRestartAdvertising(const char* source) {
  uint8_t stackConnCount = Bluefruit.connected();
  uint8_t maxConn = MAX_BLE_CONNECTIONS;

  if (stackConnCount >= maxConn) {
    return;
  }

  ensureAdvertising(source);
}

void auditBleConnectionState(const char* source) {
  uint8_t stackConnCount = Bluefruit.connected();

  if (deviceConnected && stackConnCount == 0) {
    Serial.print("[BLE] STALE STATE @ ");
    Serial.print(source);
    Serial.println(": deviceConnected=true but stack has 0 links — clearing flags");
    activeConnHandle = 0xFFFF;
    deviceConnected = false;
    digitalWrite(LED_GREEN, HIGH);
    ensureAdvertising(source);
    return;
  }

  maybeRestartAdvertising(source);
}

float getBatteryVoltage() {
  digitalWrite(VBAT_ENABLE, LOW);
  delay(2);

  uint32_t sum = 0;
  for (uint8_t i = 0; i < BATTERY_ADC_SAMPLES; i++) {
    sum += analogRead(PIN_VBAT);
    delay(2);
  }

  digitalWrite(VBAT_ENABLE, HIGH);

  float avg = (float)sum / BATTERY_ADC_SAMPLES;
  return avg * 3.6f / 4096.0f * 2.96f;
}

bool isUsbConnected() {
  return (NRF_POWER->USBREGSTATUS & POWER_USBREGSTATUS_VBUSDETECT_Msk) != 0;
}

void enterBatteryProtectionSleep() {
  float v = getBatteryVoltage();

  Serial.print("[BATT] Low battery (");
  Serial.print(v, 2);
  Serial.print(" V <= ");
  Serial.print(BATTERY_CUTOFF_V, 2);
  Serial.println(" V) — entering deep sleep");
  Serial.flush();
  delay(100);

  Bluefruit.Advertising.stop();
  while (Bluefruit.connected() > 0) {
    Bluefruit.disconnect(Bluefruit.connHandle());
    delay(20);
  }
  delay(50);

  sd_power_system_off();
}

void checkBatteryProtection() {
  if (isUsbConnected()) {
    lowBatteryCount = 0;
    return;
  }

  unsigned long now = millis();
  if (now - lastBatteryCheckMs < BATTERY_CHECK_INTERVAL_MS) {
    return;
  }
  lastBatteryCheckMs = now;

  float v = getBatteryVoltage();
  Serial.print("[BATT] ");
  Serial.print(v, 2);
  Serial.println(" V");

  if (v <= BATTERY_CUTOFF_V) {
    lowBatteryCount++;
    if (lowBatteryCount >= BATTERY_LOW_CONFIRM) {
      enterBatteryProtectionSleep();
    }
    return;
  }

  lowBatteryCount = 0;
}

void connect_callback(uint16_t conn_handle) {
  bleConnectEvents++;
  Serial.print("[BLE] connect_callback handle=0x");
  Serial.print(conn_handle, HEX);
  Serial.print(" (event #");
  Serial.print(bleConnectEvents);
  Serial.println(")");
  logPeerInfo(conn_handle);

  activeConnHandle = conn_handle;
  lastSignificantMotionMs = millis();
  updateConnectionState();
  maybeRestartAdvertising("connect_callback");
  logBleState("connect_callback");
}

void disconnect_callback(uint16_t conn_handle, uint8_t reason) {
  bleDisconnectEvents++;
  Serial.print("[BLE] disconnect_callback handle=0x");
  Serial.print(conn_handle, HEX);
  Serial.print(" expected=0x");
  Serial.print(activeConnHandle, HEX);
  Serial.print(" (event #");
  Serial.print(bleDisconnectEvents);
  Serial.println(")");
  logDisconnectReason(reason);

  updateConnectionState();
  logBleState("disconnect_callback_before_adv");
  maybeRestartAdvertising("disconnect_callback");
  auditBleConnectionState("disconnect_callback");
}

void rx_callback(uint16_t conn_hdl, BLECharacteristic *chr, uint8_t *data, uint16_t len) {
  (void)chr;

  String cmd = "";
  for (uint16_t i = 0; i < len; i++) {
    cmd += (char)data[i];
  }
  cmd.trim();

  Serial.print("[BLE] RX (");
  Serial.print(len);
  Serial.print("): ");
  Serial.println(cmd);

  if (cmd.startsWith("SET_PASSWORD|")) {
    parseSetPassword(cmd);
    notifyTx(conn_hdl, "ACK|SET_PASSWORD");
    return;
  }

  if (cmd == "TRIGGER") {
    if (storedPassword.length() == 0) {
      Serial.println("TRIGGER: no password in RAM");
      notifyTx(conn_hdl, "ERR|NO_PASSWORD");
      return;
    }

    Serial.println("TRIGGER: queued for HID typing");
    pendingTypePassword = true;
    notifyTx(conn_hdl, "ACK|TRIGGER");
    return;
  }

  if (cmd == "PING") {
    notifyTx(conn_hdl, "ACK|PONG");
    return;
  }

  notifyTx(conn_hdl, "ERR|UNKNOWN_CMD");
}

void setup() {
  Serial.begin(115200);
  unsigned long startWait = millis();
  while (!Serial && (millis() - startWait < 3000));

  pinMode(PIN_VBAT, INPUT);
  pinMode(VBAT_ENABLE, OUTPUT);
  analogReadResolution(12);

  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_BLUE, OUTPUT);

  digitalWrite(LED_RED, HIGH);
  digitalWrite(LED_GREEN, HIGH);
  digitalWrite(LED_BLUE, HIGH);

  Serial.println("--- DEMARRAGE DU SYSTEME ---");

  float initialVoltage = getBatteryVoltage();
  Serial.print("Tension lue au demarrage : ");
  Serial.print(initialVoltage);
  Serial.println(" V");

  if (initialVoltage <= BATTERY_CUTOFF_V && !isUsbConnected()) {
    enterBatteryProtectionSleep();
  }

  Serial.println("Initialisation du Bluetooth...");

#if defined(ARDUINO_Seeed_XIAO_nRF52840_Sense) || defined(ARDUINO_Seeed_XIAO_nRF52840)
  Wire1.begin();
#else
  Wire.begin();
#endif

  if (imu.begin() == 0) {
    imuReady = true;
    Serial.println("IMU ready — gesture sequence matching enabled");
    resetMotionDeltaBaseline();
  } else {
    Serial.println("IMU init failed — gesture disabled");
  }

  Bluefruit.configPrphBandwidth(BANDWIDTH_MAX);
  Bluefruit.begin(MAX_BLE_CONNECTIONS, 0);
  Bluefruit.setTxPower(4);
  Bluefruit.setName(BLE_DEVICE_NAME);
  Serial.print("[BLE] max peripheral connections: ");
  Serial.println(MAX_BLE_CONNECTIONS);

  Bluefruit.Periph.setConnectCallback(connect_callback);
  Bluefruit.Periph.setDisconnectCallback(disconnect_callback);
  Bluefruit.Periph.setConnInterval(12, 24);
  Bluefruit.Periph.setConnSlaveLatency(0);
  Bluefruit.Periph.setConnSupervisionTimeout(2000);

  bledis.begin();
  blehid.begin();

  chatService.begin();

  txCharacteristic.setProperties(CHR_PROPS_READ | CHR_PROPS_NOTIFY);
  txCharacteristic.setPermission(SECMODE_OPEN, SECMODE_OPEN);
  txCharacteristic.setMaxLen(256);
  txCharacteristic.begin();
  txCharacteristic.write("Ready", 5);

  rxCharacteristic.setProperties(CHR_PROPS_WRITE | CHR_PROPS_WRITE_WO_RESP);
  rxCharacteristic.setPermission(SECMODE_OPEN, SECMODE_OPEN);
  rxCharacteristic.setMaxLen(256);
  rxCharacteristic.setWriteCallback(rx_callback);
  rxCharacteristic.begin();

  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addAppearance(BLE_APPEARANCE_HID_KEYBOARD);
  Bluefruit.Advertising.addService(chatService);
  Bluefruit.Advertising.addService(blehid);
  Bluefruit.Advertising.addName();
  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.setInterval(32, 244);
  Bluefruit.Advertising.setFastTimeout(30);
  Bluefruit.Advertising.start(0);

  Serial.println("Bluetooth pret ! En attente de connexion...");
  logBleState("setup_complete");
  lastSignificantMotionMs = millis();
}

void loop() {
  checkBatteryProtection();

  if (shouldEnterIdleSleep()) {
    enterIdleSleep();
  }

  updateMotionActivity();
  logPowerIdleState();

  if (millis() - lastBleDiag >= BLE_DIAG_INTERVAL_MS) {
    lastBleDiag = millis();
    logBleState("periodic");
    auditBleConnectionState("periodic_watchdog");
  }

  if (!deviceConnected && oldDeviceConnected) {
    delay(500);
    oldDeviceConnected = deviceConnected;
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
  }

  if (pendingTypePassword) {
    pendingTypePassword = false;
    typePassword();
  }

  checkGestureSequence();
  delay(10);
}

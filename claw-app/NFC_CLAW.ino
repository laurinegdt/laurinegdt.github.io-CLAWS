/*
 * CLAW — XIAO nRF52840 NFC tag programmer
 *
 * Board package: Seeed nRF52 mbed-enabled Boards (2.9.x)
 * Board:         XIAO nRF52840 / XIAO nRF52840 Sense
 * Libraries:     NFCT (included), ArduinoBLE
 *
 * BLE GATT (same UUIDs as WEBBLECHATXIAO):
 *   SET_NFC|type|payload  →  ACK|SET_NFC
 *   PING                  →  ACK|PONG
 *
 * Battery: if VBAT <= 3.10 V, BLE/NFC stop and chip enters SYSTEM OFF
 * (deep sleep). Recharge the battery, then press reset to wake.
 */

#include <ArduinoBLE.h>
#include <NFCT.h>
#include <Wire.h>
#include <LSM6DS3.h>
#include <math.h>
#include <nrf_power.h>

extern "C" {
#include "nfc_t2t_lib.h"
#include "nfc_ndef_msg.h"
#include "nfc_ndef_record.h"
}

#define BLE_DEVICE_NAME "XIAONFC"
#define NFC_LANG        "fr"

// Battery protection — cut off before unprotected LiPo is damaged.
#define BATTERY_CUTOFF_V         3.10f
#define BATTERY_CHECK_INTERVAL_MS  5000UL
#define BATTERY_ADC_SAMPLES        4
#define BATTERY_LOW_CONFIRM        2

BLEService chatService("12345678-1234-1234-1234-123456789012");
BLEStringCharacteristic txCharacteristic(
  "87654321-4321-4321-4321-210987654321",
  BLERead | BLENotify,
  256);
BLEStringCharacteristic rxCharacteristic(
  "11111111-2222-3333-4444-555555555555",
  BLEWrite | BLEWriteWithoutResponse,
  256);

String storedNfcType = "";
String storedNfcPayload = "";
bool pendingNfcApply = false;
bool nfcRunning = false;

uint8_t ndefMsgBuf[256];
uint8_t wifiWscBuf[256];

unsigned long lastBatteryCheckMs = 0;
uint8_t lowBatteryCount = 0;

// --- Veille IMU (même logique que RECEPTRICE.ino) ---
#define INACTIVITY_TIMEOUT_MS    30000UL
#define MOTION_ACTIVITY_CONFIRM  2
#define RAW_MOTION_THRESHOLD     700
#define RAW_WAKE_THRESHOLD       200
#define IMU_POLL_MS              200

#define LSM6DS3_ADDR 0x6A

LSM6DS3 imu(I2C_MODE, LSM6DS3_ADDR);
bool imuReady = false;
bool imuAccelLive = false;
bool imuSleepArmed = false;
bool idleSleepActive = false;
bool motionBaselineReset = true;

unsigned long lastSignificantMotionMs = 0;
uint8_t motionActivityHits = 0;

void startBleStack();
void resumeNfcIfConfigured();
void applyNfcConfig();
void onRxWritten(BLEDevice central, BLECharacteristic characteristic);

bool isUsbConnected() {
  return (NRF_POWER->USBREGSTATUS & POWER_USBREGSTATUS_VBUSDETECT_Msk) != 0;
}

float readBatteryVoltage() {
  digitalWrite(PIN_VBAT_ENABLE, LOW);
  delay(2);

  uint32_t sum = 0;
  for (uint8_t i = 0; i < BATTERY_ADC_SAMPLES; i++) {
    sum += analogRead(PIN_VBAT);
    delay(2);
  }

  digitalWrite(PIN_VBAT_ENABLE, HIGH);

  float avg = (float)sum / BATTERY_ADC_SAMPLES;
  return avg * 3.6f / 4096.0f * 2.96f;
}

void enterBatteryProtectionSleep() {
  float v = readBatteryVoltage();

  Serial.print("[BATT] Low battery (");
  Serial.print(v, 2);
  Serial.print(" V <= ");
  Serial.print(BATTERY_CUTOFF_V, 2);
  Serial.println(" V) — entering deep sleep");
  Serial.flush();
  delay(100);

  if (nfcRunning) {
    NFC.stop();
    nfcRunning = false;
  }

  // Ne pas appeler BLE.end() : si SYSTEMOFF échoue, le BLE doit rester visible.
  nrf_power_system_off();
  delay(100);
  nrf_power_system_off();
}

void checkBatteryProtection() {
  if (isUsbConnected()) {
    lowBatteryCount = 0;
    return;
  }

  BLEDevice central = BLE.central();
  if (central && central.connected()) {
    return;
  }

  unsigned long now = millis();
  if (now - lastBatteryCheckMs < BATTERY_CHECK_INTERVAL_MS) {
    return;
  }
  lastBatteryCheckMs = now;

  float v = readBatteryVoltage();
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

// ---------- IMU (même logique que RECEPTRICE.ino) ----------
void enableImuPower() {
#if defined(PIN_LSM6DS3TR_C_POWER)
  pinMode(PIN_LSM6DS3TR_C_POWER, OUTPUT);
  digitalWrite(PIN_LSM6DS3TR_C_POWER, HIGH);
  delay(50);
#endif
}

bool verifyImuWhoAmI() {
  uint8_t who = 0;
  if (imu.readRegister(&who, LSM6DS3_ACC_GYRO_WHO_AM_I_REG) != IMU_SUCCESS) {
    return false;
  }
  return (who == LSM6DS3_ACC_GYRO_WHO_AM_I || who == LSM6DS3_C_ACC_GYRO_WHO_AM_I);
}

bool initImuBus() {
  enableImuPower();
  Wire.begin();
  delay(50);
  for (uint8_t attempt = 1; attempt <= 6; attempt++) {
    if (imu.begin() == 0 && verifyImuWhoAmI()) {
      return true;
    }
    delay(150);
  }
  return false;
}

bool readImuRawWithRetry(int16_t &x, int16_t &y, int16_t &z) {
  for (uint8_t i = 0; i < 20; i++) {
    x = imu.readRawAccelX();
    y = imu.readRawAccelY();
    z = imu.readRawAccelZ();
    if (x != 0 || y != 0 || z != 0) {
      return true;
    }
    delay(50);
  }
  return false;
}

bool waitImuAccelLive(uint16_t timeoutMs) {
  unsigned long start = millis();
  while (millis() - start < timeoutMs) {
    int16_t x = 0;
    int16_t y = 0;
    int16_t z = 0;
    if (readImuRawWithRetry(x, y, z)) {
      return true;
    }
    delay(100);
  }
  return false;
}

void tryMarkImuAccelLive() {
  if (imuAccelLive || !imuReady) {
    return;
  }
  int16_t x = imu.readRawAccelX();
  if (x != 0) {
    imuAccelLive = true;
    imuSleepArmed = true;
  }
}

bool sampleRawMotionDelta(int32_t &delta) {
  static int16_t prevX = 0;
  static int16_t prevY = 0;
  static int16_t prevZ = 0;
  static bool havePrev = false;
  static unsigned long lastSampleMs = 0;

  unsigned long now = millis();
  if (now - lastSampleMs < IMU_POLL_MS) {
    return false;
  }
  lastSampleMs = now;

  if (motionBaselineReset) {
    havePrev = false;
    motionBaselineReset = false;
  }

  int16_t x = imu.readRawAccelX();
  int16_t y = imu.readRawAccelY();
  int16_t z = imu.readRawAccelZ();
  if (x == 0 && y == 0 && z == 0) {
    return false;
  }

  if (!havePrev) {
    prevX = x;
    prevY = y;
    prevZ = z;
    havePrev = true;
    delta = 0;
    return true;
  }

  int32_t dx = x - prevX;
  int32_t dy = y - prevY;
  int32_t dz = z - prevZ;
  delta = (int32_t)sqrtf((float)(dx * dx + dy * dy + dz * dz));

  prevX = x;
  prevY = y;
  prevZ = z;
  return true;
}

void resetMotionBaseline() {
  motionBaselineReset = true;
  int32_t dummy = 0;
  sampleRawMotionDelta(dummy);
}

void noteMotionEvent() {
  imuSleepArmed = true;
  lastSignificantMotionMs = millis();
}

void updateMotionActivity() {
  if (!imuReady || idleSleepActive) {
    return;
  }

  int32_t delta = 0;
  if (sampleRawMotionDelta(delta)) {
    if (delta >= RAW_MOTION_THRESHOLD) {
      motionActivityHits++;
      if (motionActivityHits >= MOTION_ACTIVITY_CONFIRM) {
        noteMotionEvent();
        motionActivityHits = 0;
      }
    } else {
      motionActivityHits = 0;
    }
  }
}

bool bleBlocksIdleSleep() {
  if (pendingNfcApply) {
    return true;
  }
  BLEDevice central = BLE.central();
  return central && central.connected();
}

void wakeFromMotion() {
  Serial.println("[POWER] WAKE");
  idleSleepActive = false;
  startBleStack();
  resumeNfcIfConfigured();
  noteMotionEvent();
  motionActivityHits = 0;
  resetMotionBaseline();
}

void startIdleSleep() {
  if (idleSleepActive || !imuReady || !imuSleepArmed) {
    return;
  }

  Serial.println("[POWER] SLEEP");
  idleSleepActive = true;

  if (nfcRunning) {
    NFC.stop();
    nfcRunning = false;
  }
  BLE.end();
  resetMotionBaseline();
}

void serviceIdleSleep() {
  if (!idleSleepActive || !imuReady) {
    return;
  }

  static unsigned long lastBattCheck = 0;
  if (millis() - lastBattCheck > 30000) {
    checkBatteryProtection();
    lastBattCheck = millis();
  }

  Wire1.beginTransmission(LSM6DS3_ADDR);
  Wire1.write(0x10);
  Wire1.write(0x30);
  Wire1.endTransmission();
  delay(1);

  int32_t delta = 0;
  bool readOk = sampleRawMotionDelta(delta);

  if (readOk && delta >= RAW_WAKE_THRESHOLD) {
    wakeFromMotion();
    return;
  }

  delay(10);
}

bool shouldEnterIdleSleep() {
  if (!imuReady || !imuAccelLive || !imuSleepArmed || idleSleepActive || isUsbConnected() || bleBlocksIdleSleep()) {
    return false;
  }
  return (millis() - lastSignificantMotionMs) >= INACTIVITY_TIMEOUT_MS;
}

void startBleStack() {
  if (!BLE.begin()) {
    Serial.println("BLE init failed");
    while (1) {
      delay(1000);
    }
  }

  BLE.setLocalName(BLE_DEVICE_NAME);
  BLE.setDeviceName(BLE_DEVICE_NAME);
  BLE.setAdvertisedService(chatService);

  chatService.addCharacteristic(txCharacteristic);
  chatService.addCharacteristic(rxCharacteristic);
  BLE.addService(chatService);

  txCharacteristic.writeValue("Ready");
  rxCharacteristic.setEventHandler(BLEWritten, onRxWritten);
  BLE.advertise();
}

void resumeNfcIfConfigured() {
  if (storedNfcType.length() > 0 && !nfcRunning) {
    applyNfcConfig();
  }
}

void nfcEventCallback(void *context, nfc_t2t_event_t event, const uint8_t *data, size_t dataLength) {
  (void)context;
  (void)data;
  (void)dataLength;
  if (event == NFC_T2T_EVENT_FIELD_ON) {
    Serial.println("[NFC] field detected");
  } else if (event == NFC_T2T_EVENT_FIELD_OFF) {
    Serial.println("[NFC] field removed");
  }
}

// ArduinoBLE: writeValue() on a BLENotify characteristic sends the notification.
void notifyTx(const char *msg) {
  txCharacteristic.writeValue(msg);
}

size_t appendTlv(uint8_t *buf, size_t pos, uint16_t type, const uint8_t *val, uint16_t len) {
  buf[pos++] = (type >> 8) & 0xFF;
  buf[pos++] = type & 0xFF;
  buf[pos++] = (len >> 8) & 0xFF;
  buf[pos++] = len & 0xFF;
  memcpy(buf + pos, val, len);
  return pos + len;
}

size_t buildWifiWscPayload(const char *ssid, const char *password, uint8_t *out, size_t maxLen) {
  uint8_t inner[200];
  size_t innerPos = 0;
  uint8_t networkIndex = 1;
  uint8_t authOpen[2] = { 0x00, 0x01 };
  uint8_t authWpa[2] = { 0x00, 0x02 };
  uint16_t ssidLen = strlen(ssid);
  uint16_t passLen = strlen(password);

  innerPos = appendTlv(inner, innerPos, 0x1026, &networkIndex, 1);
  if (passLen > 0) {
    innerPos = appendTlv(inner, innerPos, 0x1022, authWpa, 2);
  } else {
    innerPos = appendTlv(inner, innerPos, 0x1022, authOpen, 2);
  }
  innerPos = appendTlv(inner, innerPos, 0x1045, (const uint8_t *)ssid, ssidLen);
  if (passLen > 0) {
    innerPos = appendTlv(inner, innerPos, 0x1027, (const uint8_t *)password, passLen);
  }

  size_t outPos = appendTlv(out, 0, 0x100E, inner, innerPos);
  return (outPos <= maxLen) ? outPos : 0;
}

void applyMimeNdef(const char *mimeType, const uint8_t *payload, size_t payloadLen) {
  nfc_t2t_setup(nfcEventCallback, NULL);
  uint32_t len = sizeof(ndefMsgBuf);

  NFC_NDEF_MSG_DEF(nfcMsg, 1);
  NFC_NDEF_RECORD_BIN_DATA_DEF(
    mimeRec,
    TNF_MEDIA_TYPE,
    NULL,
    0,
    (const uint8_t *)mimeType,
    strlen(mimeType),
    payload,
    payloadLen);
  nfc_ndef_msg_record_add(&NFC_NDEF_MSG(nfcMsg), &NFC_NDEF_RECORD_BIN_DATA(mimeRec));
  nfc_ndef_msg_encode(&NFC_NDEF_MSG(nfcMsg), ndefMsgBuf, &len);
  nfc_t2t_payload_set(ndefMsgBuf, len);
}

nfc_uri_id_t detectUriPrefix(const String &url) {
  if (url.startsWith("https://www.")) {
    return NFC_URI_HTTPS_WWW;
  }
  if (url.startsWith("http://www.")) {
    return NFC_URI_HTTP_WWW;
  }
  if (url.startsWith("https://")) {
    return NFC_URI_HTTPS;
  }
  if (url.startsWith("http://")) {
    return NFC_URI_HTTP;
  }
  if (url.startsWith("mailto:")) {
    return NFC_URI_MAILTO;
  }
  if (url.startsWith("tel:")) {
    return NFC_URI_TEL;
  }
  return NFC_URI_NONE;
}

String stripUriPrefix(const String &url, nfc_uri_id_t type) {
  if (type == NFC_URI_HTTPS_WWW) {
    return url.substring(12);
  }
  if (type == NFC_URI_HTTP_WWW) {
    return url.substring(11);
  }
  if (type == NFC_URI_HTTPS) {
    return url.substring(8);
  }
  if (type == NFC_URI_HTTP) {
    return url.substring(7);
  }
  if (type == NFC_URI_MAILTO) {
    return url.substring(7);
  }
  if (type == NFC_URI_TEL) {
    return url.substring(4);
  }
  return url;
}

String fieldAt(const String &payload, uint8_t index) {
  int start = 0;
  uint8_t field = 0;
  for (int i = 0; i <= (int)payload.length(); i++) {
    if (i == (int)payload.length() || payload.charAt(i) == ';') {
      if (field == index) {
        return payload.substring(start, i);
      }
      field++;
      start = i + 1;
    }
  }
  return "";
}

void applyNfcConfig() {
  if (storedNfcType.length() == 0) {
    Serial.println("[NFC] no configuration in RAM");
    return;
  }

  if (nfcRunning) {
    NFC.stop();
    nfcRunning = false;
    delay(20);
  }

  Serial.print("[NFC] apply type=[");
  Serial.print(storedNfcType);
  Serial.print("] payload=[");
  Serial.print(storedNfcPayload);
  Serial.println("]");

  if (storedNfcType == "url") {
    nfc_uri_id_t uriType = detectUriPrefix(storedNfcPayload);
    String uriBody = stripUriPrefix(storedNfcPayload, uriType);
    NFC.setURImessage(uriBody.c_str(), uriType);
  } else if (storedNfcType == "text" || storedNfcType == "custom") {
    NFC.setTXTmessage(storedNfcPayload.c_str(), NFC_LANG);
  } else if (storedNfcType == "contact") {
    String name = fieldAt(storedNfcPayload, 0);
    String phone = fieldAt(storedNfcPayload, 1);
    String email = fieldAt(storedNfcPayload, 2);
    String vcard = "BEGIN:VCARD\r\nVERSION:3.0\r\n";
    if (name.length() > 0) {
      vcard += "FN:";
      vcard += name;
      vcard += "\r\nN:";
      vcard += name;
      vcard += "\r\n";
    }
    if (phone.length() > 0) {
      vcard += "TEL:";
      vcard += phone;
      vcard += "\r\n";
    }
    if (email.length() > 0) {
      vcard += "EMAIL:";
      vcard += email;
      vcard += "\r\n";
    }
    vcard += "END:VCARD\r\n";
    applyMimeNdef("text/vcard", (const uint8_t *)vcard.c_str(), vcard.length());
  } else if (storedNfcType == "wifi") {
    String ssid = fieldAt(storedNfcPayload, 0);
    String password = fieldAt(storedNfcPayload, 1);
    size_t wscLen = buildWifiWscPayload(ssid.c_str(), password.c_str(), wifiWscBuf, sizeof(wifiWscBuf));
    if (wscLen == 0) {
      Serial.println("[NFC] WiFi payload too large");
      return;
    }
    applyMimeNdef("application/vnd.wfa.wsc", wifiWscBuf, wscLen);
  } else {
    Serial.println("[NFC] unknown type");
    return;
  }

  NFC.start();
  nfcRunning = true;
  Serial.println("[NFC] tag emulation started");
}

void parseSetNfc(String cmd) {
  cmd.trim();
  if (!cmd.startsWith("SET_NFC|")) {
    return;
  }

  String rest = cmd.substring(8);
  int sep = rest.indexOf('|');
  if (sep < 0) {
    return;
  }

  storedNfcType = rest.substring(0, sep);
  storedNfcPayload = rest.substring(sep + 1);
  storedNfcType.trim();
  storedNfcPayload.trim();
  pendingNfcApply = true;
  lastSignificantMotionMs = millis();

  Serial.print("SET_NFC parsed — type=[");
  Serial.print(storedNfcType);
  Serial.print("] payload=[");
  Serial.print(storedNfcPayload);
  Serial.println("]");
}

void onRxWritten(BLEDevice central, BLECharacteristic characteristic) {
  (void)central;
  (void)characteristic;

  String cmd = rxCharacteristic.value();
  cmd.trim();
  if (cmd.length() == 0) {
    return;
  }

  Serial.print("[BLE] RX: ");
  Serial.println(cmd);

  if (cmd.startsWith("SET_NFC|")) {
    parseSetNfc(cmd);
    notifyTx("ACK|SET_NFC");
    return;
  }

  if (cmd == "PING") {
    notifyTx("ACK|PONG");
    return;
  }

  notifyTx("ERR|UNKNOWN_CMD");
}

void setup() {
  Serial.begin(115200);
  unsigned long startWait = millis();
  while (!Serial && (millis() - startWait < 3000)) {
  }

  Serial.println("--- CLAW NFC ---");

  pinMode(PIN_VBAT, INPUT);
  pinMode(PIN_VBAT_ENABLE, OUTPUT);
  digitalWrite(PIN_VBAT_ENABLE, HIGH);
  analogReadResolution(12);

  float bootVoltage = readBatteryVoltage();
  Serial.print("[BATT] boot ");
  Serial.print(bootVoltage, 2);
  Serial.print(" V USB=");
  Serial.println(isUsbConnected() ? "yes" : "no");
  if (bootVoltage <= BATTERY_CUTOFF_V && !isUsbConnected()) {
    enterBatteryProtectionSleep();
  }

  imuReady = initImuBus();
  if (imuReady) {
    imuAccelLive = waitImuAccelLive(3000);
    if (imuAccelLive) {
      imuSleepArmed = true;
      Serial.println("[IMU] OK — idle sleep enabled");
      resetMotionBaseline();
    } else {
      Serial.println("[IMU] WHO_AM_I OK — accel pending");
    }
  } else {
    Serial.println("[IMU] init failed — idle sleep disabled");
    imuSleepArmed = false;
  }
  lastSignificantMotionMs = millis();

  startBleStack();
  Serial.println("BLE ready — waiting for SET_NFC");
}

void loop() {
  if (!idleSleepActive) {
    BLE.poll();
  }
  tryMarkImuAccelLive();

  if (idleSleepActive) {
    serviceIdleSleep();
    return;
  }

  checkBatteryProtection();

  if (shouldEnterIdleSleep()) {
    startIdleSleep();
    return;
  }

  updateMotionActivity();

  if (pendingNfcApply) {
    pendingNfcApply = false;
    applyNfcConfig();
  }
}

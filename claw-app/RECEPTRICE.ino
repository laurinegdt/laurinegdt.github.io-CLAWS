#include <ArduinoBLE.h>
#include <Wire.h>
#include <LSM6DS3.h>
#include <math.h>

#define VIB_PIN 2
#define LED_ROUGE LEDR
#define LED_VERT  LEDG
#define LED_BLEU  LEDB

// --- Protection batterie ---
#define SEUIL_BATTERIE_MIN 3.10f
#define BATTERY_ADC_SAMPLES 10
#define BATTERY_LOW_CONFIRM 2

unsigned long dernierCheckBatterie = 0;
const unsigned long INTERVALLE_CHECK_BAT = 15000;
uint8_t lowBatteryCount = 0;

// --- Veille ---
#define VIBRATION_MS 3000
#define INACTIVITY_TIMEOUT_MS    30000UL
#define MOTION_ACTIVITY_CONFIRM  2
#define RAW_MOTION_THRESHOLD     700
#define RAW_WAKE_THRESHOLD       200
#define IMU_POLL_MS              200

#define LSM6DS3_ADDR 0x6A

bool detectedRecently = false;
unsigned long lastDetection = 0;

LSM6DS3 imu(I2C_MODE, LSM6DS3_ADDR);
bool imuReady = false;
bool imuAccelLive = false;
bool imuSleepArmed = false;
bool idleSleepActive = false;
bool motionBaselineReset = true;

unsigned long lastSignificantMotionMs = 0;
uint8_t motionActivityHits = 0;

// ---------- FONCTIONS BATTERIE (SANS DEBUG_SLEEP) ----------
bool estConnecteUSB() {
  // Retourne l'état réel du détecteur USB
  return (NRF_POWER->USBREGSTATUS & POWER_USBREGSTATUS_VBUSDETECT_Msk) != 0;
}

float lireTensionBatterie() {
  digitalWrite(PIN_VBAT_ENABLE, LOW);   // PIN_VBAT_ENABLE = 13 sur XIAO Sense
  delay(5);
  uint32_t somme = 0;
  for (uint8_t i = 0; i < BATTERY_ADC_SAMPLES; i++) {
    somme += analogRead(PIN_VBAT);      // PIN_VBAT = 31
    delay(2);
  }
  digitalWrite(PIN_VBAT_ENABLE, HIGH);
  float adcMoyen = (float)somme / BATTERY_ADC_SAMPLES;
  return adcMoyen * 3.6f / 4096.0f * 2.96f;
}

void miseEnVeilleFatale() {
  digitalWrite(VIB_PIN, LOW);
  for (int i = 0; i < 5; i++) {
    digitalWrite(LED_ROUGE, LOW);
    delay(100);
    digitalWrite(LED_ROUGE, HIGH);
    delay(100);
  }
  digitalWrite(LED_ROUGE, HIGH);
  digitalWrite(LED_VERT, HIGH);
  digitalWrite(LED_BLEU, HIGH);
  Serial.println("[BATT] SYSTEM OFF");
  Serial.flush();
  delay(100);
  NRF_POWER->SYSTEMOFF = 1;
  delay(100);
  NRF_POWER->SYSTEMOFF = 1;
}

void verifierBatterie() {
  if (estConnecteUSB()) {
    lowBatteryCount = 0;
    return;
  }

  // Laisse la batterie récupérer après une vibration.
  if (detectedRecently || (millis() - lastDetection < 5000)) {
    return;
  }

  if (millis() - dernierCheckBatterie < INTERVALLE_CHECK_BAT) return;
  dernierCheckBatterie = millis();
  float v = lireTensionBatterie();
  Serial.print("[BATT] "); Serial.print(v, 2); Serial.println(" V");
  if (v <= SEUIL_BATTERIE_MIN) {
    lowBatteryCount++;
    if (lowBatteryCount >= BATTERY_LOW_CONFIRM) miseEnVeilleFatale();
  } else {
    lowBatteryCount = 0;
  }
}

// ---------- IMU ----------
void enableImuPower() {
#if defined(PIN_LSM6DS3TR_C_POWER)
  pinMode(PIN_LSM6DS3TR_C_POWER, OUTPUT);
  digitalWrite(PIN_LSM6DS3TR_C_POWER, HIGH);
  delay(50);
#endif
}

bool verifyImuWhoAmI() {
  uint8_t who = 0;
  if (imu.readRegister(&who, LSM6DS3_ACC_GYRO_WHO_AM_I_REG) != IMU_SUCCESS) return false;
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
    x = imu.readRawAccelX(); y = imu.readRawAccelY(); z = imu.readRawAccelZ();
    if (x != 0 || y != 0 || z != 0) return true;
    delay(50);
  }
  return false;
}

bool waitImuAccelLive(uint16_t timeoutMs) {
  unsigned long start = millis();
  while (millis() - start < timeoutMs) {
    int16_t x,y,z;
    if (readImuRawWithRetry(x,y,z)) return true;
    delay(100);
  }
  return false;
}

void tryMarkImuAccelLive() {
  if (imuAccelLive || !imuReady) return;
  int16_t x = imu.readRawAccelX();
  if (x != 0) { imuAccelLive = true; imuSleepArmed = true; }
}

// ---------- DÉTECTION DE MOUVEMENT ----------
bool sampleRawMotionDelta(int32_t &delta) {
  static int16_t prevX=0, prevY=0, prevZ=0;
  static bool havePrev = false;
  static unsigned long lastSampleMs = 0;
  unsigned long now = millis();
  if (now - lastSampleMs < IMU_POLL_MS) return false;
  lastSampleMs = now;

  if (motionBaselineReset) { havePrev = false; motionBaselineReset = false; }

  int16_t x = imu.readRawAccelX();
  int16_t y = imu.readRawAccelY();
  int16_t z = imu.readRawAccelZ();
  if (x == 0 && y == 0 && z == 0) return false;

  if (!havePrev) {
    prevX=x; prevY=y; prevZ=z; havePrev = true;
    delta = 0; return true;
  }
  int32_t dx = x - prevX, dy = y - prevY, dz = z - prevZ;
  delta = (int32_t)sqrtf((float)(dx*dx + dy*dy + dz*dz));
  prevX=x; prevY=y; prevZ=z;
  return true;
}

void resetMotionBaseline() { motionBaselineReset = true; int32_t dummy; sampleRawMotionDelta(dummy); }

void noteMotionEvent() {
  imuSleepArmed = true;
  lastSignificantMotionMs = millis();
}

void updateMotionActivity() {
  if (!imuReady || idleSleepActive) return;
  int32_t delta = 0;
  if (sampleRawMotionDelta(delta)) {
    if (delta >= RAW_MOTION_THRESHOLD) {
      motionActivityHits++;
      if (motionActivityHits >= MOTION_ACTIVITY_CONFIRM) {
        noteMotionEvent();
        motionActivityHits = 0;
        digitalWrite(LED_VERT, LOW); delay(40); digitalWrite(LED_VERT, HIGH);
      }
    } else {
      motionActivityHits = 0;
    }
  }
}

// ---------- BLE ET VEILLE ----------
bool bleBlocksIdleSleep() {
  return detectedRecently || (millis() - lastDetection < 5000);
}

void setScanLedActive(bool active) { digitalWrite(LED_BLEU, active ? LOW : HIGH); }

void wakeFromMotion() {
  Serial.println("[POWER] WAKE");
  idleSleepActive = false;
  resumeBleScanning();
  noteMotionEvent();
  motionActivityHits = 0;
  resetMotionBaseline();
  digitalWrite(LED_VERT, LOW); delay(80); digitalWrite(LED_VERT, HIGH);
}

void startIdleSleep() {
  if (idleSleepActive || !imuReady || !imuSleepArmed) return;
  Serial.println("[POWER] SLEEP (deep)");
  idleSleepActive = true;
  BLE.end();
  setScanLedActive(false);
  resetMotionBaseline();
}

void serviceIdleSleep() {
  if (!idleSleepActive || !imuReady) return;

  static unsigned long lastBattCheck = 0;
  if (millis() - lastBattCheck > 30000) {
    verifierBatterie();
    lastBattCheck = millis();
  }

  // Scan BLE par rafales : détecte l'émettrice même en veille IMU.
  static unsigned long lastScanBurstMs = 0;
  if (millis() - lastScanBurstMs >= 1500) {
    lastScanBurstMs = millis();
    resumeBleScanning();
    unsigned long burstUntil = millis() + 350;
    while (millis() < burstUntil) {
      BLE.poll();
      if (pollClawEmitter()) {
        idleSleepActive = false;
        return;
      }
      delay(10);
    }
    BLE.end();
    setScanLedActive(false);
  }

  Wire1.beginTransmission(LSM6DS3_ADDR);
  Wire1.write(0x10);
  Wire1.write(0x30);
  Wire1.endTransmission();
  delay(1);

  int32_t delta = 0;
  bool readOk = sampleRawMotionDelta(delta);

  static unsigned long lastBlink = 0;
  if (!readOk) {
    if (millis() - lastBlink > 1000) {
      lastBlink = millis();
      digitalWrite(LED_ROUGE, LOW);
      delay(50);
      digitalWrite(LED_ROUGE, HIGH);
    }
  }

  if (readOk && delta >= RAW_WAKE_THRESHOLD) {
    wakeFromMotion();
    return;
  }

  delay(10);
}

// ✅ VEILLE IMPOSSIBLE SI USB BRANCHÉ
bool shouldEnterIdleSleep() {
  if (!imuReady || !imuAccelLive || !imuSleepArmed || idleSleepActive || bleBlocksIdleSleep() || estConnecteUSB()) {
    return false;
  }
  return (millis() - lastSignificantMotionMs) >= INACTIVITY_TIMEOUT_MS;
}

// ---------- BLE ----------
bool serviceUuidMatchesClaw(const String &uuid) {
  if (uuid.length() == 0) {
    return false;
  }
  String normalized = uuid;
  normalized.toUpperCase();
  return normalized.indexOf("180F") >= 0;
}

bool localNameMatchesClaw(const String &name) {
  if (name.length() == 0) {
    return false;
  }
  String normalized = name;
  normalized.toUpperCase();
  return normalized.indexOf("CLAW") >= 0;
}

bool estEmetteurClaw(BLEDevice peripheral) {
  if (serviceUuidMatchesClaw(peripheral.advertisedServiceUuid())) {
    return true;
  }
  if (peripheral.hasLocalName() && localNameMatchesClaw(peripheral.localName())) {
    return true;
  }
  return false;
}

void triggerClawDetection() {
  if (detectedRecently) {
    return;
  }

  Serial.println("[CLAW] detected");
  digitalWrite(VIB_PIN, HIGH);
  digitalWrite(LED_BLEU, HIGH);
  digitalWrite(LED_VERT, LOW);
  detectedRecently = true;
  lastDetection = millis();
  noteMotionEvent();
}

bool pollClawEmitter() {
  BLEDevice peripheral = BLE.available();
  if (!peripheral) {
    return false;
  }
  if (!estEmetteurClaw(peripheral)) {
    return false;
  }
  triggerClawDetection();
  return true;
}

void resumeBleScanning() {
  if (!BLE.begin()) {
    Serial.println("[BLE] restart failed");
    return;
  }
  BLE.scan();
  setScanLedActive(true);
}

// ---------- SETUP ----------
void setup() {
  pinMode(VIB_PIN, OUTPUT); digitalWrite(VIB_PIN, LOW);
  pinMode(LED_ROUGE, OUTPUT); pinMode(LED_VERT, OUTPUT); pinMode(LED_BLEU, OUTPUT);
  digitalWrite(LED_ROUGE, HIGH); digitalWrite(LED_VERT, HIGH); digitalWrite(LED_BLEU, HIGH);

  pinMode(PIN_VBAT_ENABLE, OUTPUT);
  digitalWrite(PIN_VBAT_ENABLE, HIGH);
  pinMode(PIN_VBAT, INPUT);
  analogReadResolution(12);

  Serial.begin(115200);
  while (!Serial) delay(100);
  Serial.println("\n=== RECEPTRICE BOOT ===");

  float vbat = lireTensionBatterie();
  Serial.print("VBAT="); Serial.print(vbat, 2); Serial.println(" V");

  imuReady = initImuBus();
  if (imuReady) {
    imuAccelLive = waitImuAccelLive(3000);
    if (imuAccelLive) {
      imuSleepArmed = true;
      Serial.println("[IMU] OK");
      resetMotionBaseline();
    }
  } else {
    Serial.println("[IMU] FAIL");
    imuSleepArmed = false;
  }

  if (!BLE.begin()) {
    Serial.println("[BLE] FAIL");
    while (1);
  }
  BLE.scan();
  Serial.println("[BLE] scanning");
  lastSignificantMotionMs = millis();
  setScanLedActive(true);
}

void loop() {
  if (!idleSleepActive) {
    BLE.poll();
  }
  tryMarkImuAccelLive();

  // ✅ INDICATEUR CHARGE USB : LED rouge allumée quand USB branché
  if (estConnecteUSB()) {
    digitalWrite(LED_ROUGE, LOW);   // allume rouge (charge)
  } else {
    digitalWrite(LED_ROUGE, HIGH);  // éteint sur batterie
  }

  if (idleSleepActive) {
    serviceIdleSleep();
    return;
  }

  verifierBatterie();

  if (shouldEnterIdleSleep()) {
    startIdleSleep();
    return;
  }

  updateMotionActivity();

  if (detectedRecently && (millis() - lastDetection > VIBRATION_MS)) {
    digitalWrite(VIB_PIN, LOW);
    digitalWrite(LED_VERT, HIGH);
    setScanLedActive(true);
    detectedRecently = false;
    lastDetection = millis();
  }

  pollClawEmitter();
}
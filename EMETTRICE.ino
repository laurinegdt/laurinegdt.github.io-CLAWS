/*
 * CLAW — XIAO émettrice (proximity beacon)
 * Board: Seeeduino mbed — XIAO nRF52840 / Sense
 *
 * La réceptrice scanne le service 180F et/ou le nom « CLAW ».
 */

#include <ArduinoBLE.h>

BLEService customService("180F");

void setup() {
  pinMode(LEDB, OUTPUT);
  digitalWrite(LEDB, HIGH);

  if (!BLE.begin()) {
    while (1) {
      delay(1000);
    }
  }

  BLE.setLocalName("CLAW");
  BLE.setDeviceName("CLAW");
  BLE.addService(customService);
  BLE.setAdvertisedService(customService);
  BLE.advertise();

  digitalWrite(LEDB, LOW);
}

void loop() {
  BLE.poll();
}
/*
 * ESP8266 — A01NYUB ultrasonic + BMP280 + A7670C (4G LTE) -> Firebase
 * ---------------------------------------------------------------
 *   - A7670C modem   -> hardware UART0 @ 115200  (no IPR change needed)
 *   - A01NYUB sensor -> SoftwareSerial on D5 @ 9600
 *   - BMP280         -> I2C on D2 (SDA) / D1 (SCL)
 *   - Debug logs     -> hardware UART1 (D4, TX-only) @ 115200
 *
 * Requires the "Adafruit BMP280 Library" (Library Manager) — it pulls in
 * Adafruit Unified Sensor and Adafruit BusIO as dependencies.
 *
 * The modem gets the hardware UART because SoftwareSerial is unreliable at
 * 115200 (8.7us/bit — any interrupt corrupts the byte). The sensor runs at
 * 9600 (104us/bit), which SoftwareSerial handles comfortably.
 *
 * Only one SoftwareSerial port here, so no listen() juggling: the sensor is
 * always receiving, even while we talk to the modem.
 *
 * ---- WIRING ---- (all 3.3V logic — no level shifting needed)
 * A7670C modem:                      A01NYUB sensor:
 *   TXD  -> D9  (GPIO3, RX0)           Red (VCC)   -> 5V
 *   RXD  <- D10 (GPIO1, TX0)           Black (GND) -> GND
 *   VBAT -> 3.8-4.0V battery           Yellow (TX) -> D5 (GPIO14)
 *           (+1000uF cap)              White (RX)  -> unconnected
 *   GND  -> GND (common)
 *
 * BMP280 (I2C):
 *   VCC -> 3.3V   (NOT 5V — most breakouts are 3.3V only)
 *   GND -> GND
 *   SDA -> D2 (GPIO4)
 *   SCL -> D1 (GPIO5)
 *   SDO -> GND for address 0x76, or 3.3V for 0x77 (code tries both)
 *
 * Debug: D4 (GPIO2) -> USB-TTL adapter RX, monitor @ 115200.
 *
 * >>> BEFORE UPLOADING A SKETCH <<<
 *   Disconnect the modem's TXD from D9. It drives the same pin the USB
 *   bootloader uses and will corrupt the flash. Reconnect after uploading.
 *
 * ALL grounds common: sensor, modem, battery, ESP8266, USB-TTL adapter.
 */
#include <SoftwareSerial.h>
#include <Wire.h>
#include <Adafruit_BMP280.h>

SoftwareSerial sensor(D5, D6);   // A01NYUB: RX=D5 (sensor TX), TX=D6 unused
Adafruit_BMP280 bmp;             // BMP280 on I2C (D2=SDA, D1=SCL)

#define gsmSerial Serial         // A7670C on hardware UART0
#define debug     Serial1        // debug logs on UART1 (D4, TX-only)

// ---- Firebase / APN config ----
const char APN[]          = "airteliot.com";
const char FIREBASE_URL[] = "https://water-level-ae453-default-rtdb.asia-southeast1.firebasedatabase.app/water_monitor/current.json";

int   lastDistance = -1;                       // latest valid distance (mm)
bool  bmpReady     = false;                    // false if the BMP280 wasn't found
unsigned long lastUpload = 0;
const unsigned long UPLOAD_INTERVAL = 30000;   // upload every 30 s

// Standard sea-level pressure, used only for the absolute "altitude ASL"
// figure. Height-above-baseline does not depend on it.
const float SEALEVEL_PRESSURE_HPA = 1013.25;

// ---- BMP280 baseline (captured once in setup) ----
// Height is derived by comparing each reading against the pressure recorded
// at startup, so "0 m" always means "wherever the sensor was when it booted".
float baselinePressure = NAN;   // hPa at power-on
float baselineAltitude = NAN;   // m above sea level at power-on

void setup() {
  gsmSerial.begin(115200);   // modem — hardware UART0
  debug.begin(115200);       // debug  — hardware UART1 (TX-only)
  sensor.begin(9600);        // A01NYUB
  delay(5000);               // let the modem finish booting

  debug.println(F("\n===== ESP8266: Sensor + BMP280 + A7670C + Firebase ====="));

  setupBMP280();
  testModem();
  setupData();               // bring up LTE data connection once
  debug.println(F("--- Setup done ---"));
}

void loop() {
  readSensor();              // drain sensor frames -> lastDistance

  if (millis() - lastUpload >= UPLOAD_INTERVAL) {
    lastUpload = millis();

    float pressure    = NAN;   // hPa
    float temperature = NAN;   // degC
    float height      = NAN;   // m relative to startup position
    if (bmpReady) {
      pressure    = bmp.readPressure() / 100.0F;   // Pa -> hPa
      temperature = bmp.readTemperature();
      height      = heightFromBaseline(pressure);
    }

    debug.print(F("Latest distance: "));
    debug.print(lastDistance);
    debug.print(F(" mm | pressure: "));
    if (bmpReady) {
      debug.print(pressure, 2);
      debug.print(F(" hPa | temp: "));
      debug.print(temperature, 2);
      debug.print(F(" C | height vs baseline: "));
      debug.print(height, 2);
      debug.println(F(" m"));
    } else {
      debug.println(F("n/a"));
    }

    if (lastDistance >= 0) {
      uploadToFirebase(lastDistance, pressure, temperature, height);
    } else {
      debug.println(F("No valid sensor reading yet - skipping upload."));
    }
  }
}

// Bring up the BMP280. Breakouts ship at either 0x76 or 0x77 depending on
// how SDO is strapped, so try both before giving up.
void setupBMP280() {
  Wire.begin(D2, D1);            // SDA, SCL

  if (bmp.begin(0x76) || bmp.begin(0x77)) {
    bmpReady = true;
    bmp.setSampling(Adafruit_BMP280::MODE_NORMAL,
                    Adafruit_BMP280::SAMPLING_X2,    // temperature
                    Adafruit_BMP280::SAMPLING_X16,   // pressure
                    Adafruit_BMP280::FILTER_X16,
                    Adafruit_BMP280::STANDBY_MS_500);
    debug.println(F("BMP280 found."));
    calibrateBaseline();
  } else {
    debug.println(F("BMP280 NOT found - check wiring/address."));
  }
}

// Capture the startup pressure as the zero point for height measurements.
// A single sample is noisy (+/- a few Pa), and this value anchors every
// reading for the whole run, so average a batch of them.
void calibrateBaseline() {
  const int SAMPLES = 20;

  bmp.readPressure();            // discard the first conversion after config
  delay(100);

  float sum = 0;
  for (int i = 0; i < SAMPLES; i++) {
    sum += bmp.readPressure();   // Pa
    delay(50);
    yield();
  }

  baselinePressure = (sum / SAMPLES) / 100.0F;                    // hPa
  baselineAltitude = bmp.readAltitude(SEALEVEL_PRESSURE_HPA);     // m ASL

  debug.print(F("Baseline pressure: "));
  debug.print(baselinePressure, 2);
  debug.println(F(" hPa"));
  debug.print(F("Baseline altitude: "));
  debug.print(baselineAltitude, 2);
  debug.println(F(" m above sea level"));
}

// Height of the current reading relative to the startup position, in metres.
// Positive = higher than at boot. Uses the barometric formula rather than a
// fixed hPa-per-metre constant so it stays accurate over larger differences.
float heightFromBaseline(float pressureHPa) {
  if (isnan(baselinePressure) || isnan(pressureHPa)) return NAN;
  return 44330.0F * (1.0F - pow(pressureHPa / baselinePressure, 0.1903F));
}

void testModem() {
  sendAT("AT");
  sendAT("ATE0");
  sendAT("AT+CPIN?");
  sendAT("AT+CSQ");
  sendAT("AT+COPS?");
}

// Bring up the A7670C LTE data connection (run once in setup).
void setupData() {
  sendAT("AT+CGDCONT=1,\"IP\",\"" + String(APN) + "\"");
  sendAT("AT+CGATT=1", 10000);
  sendAT("AT+CGACT=1,1", 10000);
  sendAT("AT+CSOCKSETPN=1");       // point the socket layer at PDP context 1
  sendAT("AT+NETOPEN", 15000);     // "already opened" is fine
  sendAT("AT+IPADDR", 3000);
}

void sendAT(String cmd) { sendAT(cmd, 2000); }

void sendAT(String cmd, unsigned long wait) {
  debug.print(F(">> "));
  debug.println(cmd);
  gsmSerial.println(cmd);

  unsigned long start = millis();
  while (millis() - start < wait) {
    while (gsmSerial.available()) debug.write(gsmSerial.read());  // echo reply
    yield();                       // keep the ESP8266 watchdog happy
  }
  debug.println();
}

// Read A01NYUB frames and store the latest distance.
// Frame: 0xFF DATA_H DATA_L CHECKSUM  ->  distance_mm = (H<<8)|L
void readSensor() {
  // The sensor free-runs at ~10 Hz, so the buffer holds stale frames from
  // however long the last modem call took. Drop the backlog, keep the newest.
  while (sensor.available() > 4) sensor.read();

  unsigned long start = millis();
  while (millis() - start < 100) { // short window to catch a fresh frame
    while (sensor.available() >= 4) {
      if (sensor.read() == 0xFF) {
        byte high     = sensor.read();
        byte low      = sensor.read();
        byte checksum = sensor.read();
        if (((0xFF + high + low) & 0xFF) == checksum) {
          lastDistance = (high << 8) | low;
        }
      }
    }
    yield();
  }
}

// POST the readings to Firebase over the A7670C HTTP(S) engine.
// pressureHPa/temperatureC are NAN when the BMP280 is missing - those fields
// are then left out of the JSON rather than sent as null.
void uploadToFirebase(int distanceMM, float pressureHPa, float temperatureC,
                      float heightM) {
  String json = "{\"distance\":" + String(distanceMM);
  if (!isnan(pressureHPa))    json += ",\"pressure\":"    + String(pressureHPa, 2);
  if (!isnan(temperatureC))   json += ",\"temperature\":" + String(temperatureC, 2);
  if (!isnan(heightM))        json += ",\"height\":"      + String(heightM, 2);
  json += ",\"timestamp\":{\".sv\":\"timestamp\"}}";

  debug.println(F("--- Uploading to Firebase ---"));
  sendAT("AT+HTTPTERM", 1000);
  sendAT("AT+HTTPINIT", 3000);
  sendAT("AT+HTTPPARA=\"URL\",\"" + String(FIREBASE_URL) + "\"", 3000);
  sendAT("AT+HTTPPARA=\"CONTENT\",\"application/json\"", 2000);

  sendAT("AT+HTTPDATA=" + String(json.length()) + ",10000", 2000);
  gsmSerial.print(json);
  delay(1000);

  sendAT("AT+HTTPACTION=1", 10000);   // POST
  sendAT("AT+HTTPTERM", 2000);
}
/*
 * 7Semi ESP32-S3 + EC200U (LTE Cat-1) — water level bring-up test
 * ---------------------------------------------------------------
 * Staged self-test for the new board. setup() walks the stack one layer at a
 * time and stops at the first failure, so a bring-up problem tells you exactly
 * which layer broke instead of just "no data in Firebase":
 *
 *   1. modem responds to AT          5. PDP context / data attach
 *   2. SIM detected                  6. BMP280 detected (non-fatal)
 *   3. signal quality                7. ultrasonic sensor frame
 *   4. network registration          8. HTTPS POST to Firebase
 *
 * Once it passes, loop() posts a reading every 30 s.
 *
 * ---- LIBRARIES ----
 *   "Adafruit BMP280 Library" (Library Manager) - pulls in Adafruit Unified
 *   Sensor and Adafruit BusIO as dependencies.
 *
 * ---- ARDUINO IDE SETTINGS ----
 *   Board: "ESP32S3 Dev Module"
 *   USB CDC On Boot: **Enabled**   <- without this Serial prints nothing over USB
 *   Upload via the ESP32-S3 USB-C port (the one nearer the ESP32 module).
 *   The modem has its own USB-C port; it does NOT contend with flashing, so
 *   unlike the old ESP8266 board there is nothing to unplug before uploading.
 *
 * ---- WIRING ----
 * The ESP32-S3 and EC200U are already connected on the PCB. External wiring is
 * only the two sensors:
 *
 *   A01NYUB ultrasonic:            BMP280 (I2C):
 *     Red   (VCC) -> 3V3             VCC -> 3.3V  (NOT 5V - most breakouts
 *     Black (GND) -> GND                           are 3.3V only)
 *     Yellow (TX) -> GPIO 16         GND -> GND
 *     White  (RX) -> unconnected     SDA -> GPIO 4
 *                                    SCL -> GPIO 5
 *                                    SDO -> GND for 0x76, 3.3V for 0x77
 *                                           (the code tries both)
 *
 * The A01NYUB runs on 3.3-5 V. Use 3V3, not 5V: its UART output swings to
 * whatever it is powered at, and ESP32-S3 GPIOs are not 5 V tolerant. Powering
 * it at 5 V puts 5 V on GPIO 16.
 *
 * Note the I2C pins: several ESP32-S3 examples use GPIO 8/9 for I2C, but GPIO 9
 * is the modem's RESET line on this board. Do not put SCL there.
 *
 * !! VERIFY THE PIN MAP BELOW AGAINST THE BOARD SILKSCREEN BEFORE FLASHING !!
 * The 7Semi manual's wiring table (GPIO16/17, 5 V, level shifter) describes a
 * separate modem, not this board, and contradicts its own page 7. The values
 * here come from the bottom-side silkscreen legend, read off a photo in the
 * manual - so treat them as "very likely" rather than confirmed.
 */
#include <Wire.h>
#include <Adafruit_BMP280.h>

// ---- EC200U link: fixed by the PCB, per the bottom-side silkscreen ----
#define EC200U_RX_PIN 12  // ESP32 RX1 <- 4G TX
#define EC200U_TX_PIN 13  // ESP32 TX1 -> 4G RX
#define EC200U_PWRKEY 18  // 4G ON/OFF
#define EC200U_RESET   9  // 4G RESET

// ---- A01NYUB ultrasonic: any free header pins ----
#define SENSOR_RX_PIN 16
#define SENSOR_TX_PIN 17  // unused; the sensor's RX stays disconnected

// ---- BMP280 I2C ----
#define BMP_SDA_PIN 4
#define BMP_SCL_PIN 5

HardwareSerial modem(1);   // UART1 -> EC200U
HardwareSerial sensor(2);  // UART2 -> A01NYUB
Adafruit_BMP280 bmp;
#define debug Serial       // native USB CDC

// ---- Config ----
const char APN[] = "airteliot.com";
const char FIREBASE_URL[] =
    "https://water-level-ae453-default-rtdb.asia-southeast1.firebasedatabase.app/water_monitor/current.json";

const unsigned long UPLOAD_INTERVAL_MS = 30000;

/*
 * A reading older than this is treated as missing. Without it, `lastDistanceMm`
 * would hold the last good value forever: if the sensor is unplugged or fails,
 * the board would keep posting a stale reading with a fresh timestamp and the
 * dashboard would show a healthy device holding a perfectly steady level.
 */
const unsigned long READING_MAX_AGE_MS = 90000;

int lastDistanceMm = -1;
unsigned long lastDistanceAtMs = 0;
unsigned long lastUploadMs = 0;

// ---- BMP280 baseline (captured once in setup) ----
// Height is derived by comparing each reading against the pressure recorded at
// startup, so "0 m" always means "wherever the sensor was when it booted".
bool bmpReady = false;
float baselinePressure = NAN;  // hPa at power-on

// ---------------------------------------------------------------- modem I/O

/*
 * Collects modem output until `expect` appears, an ERROR arrives, or we time
 * out. Returning as soon as the token lands is what makes this reliable - the
 * old fixed-delay approach either wasted seconds or truncated slow replies.
 */
bool waitFor(const char *expect, uint32_t timeoutMs, String *out) {
  String buf;
  uint32_t start = millis();

  while (millis() - start < timeoutMs) {
    while (modem.available()) {
      char c = (char)modem.read();
      // Cap the buffer so a chatty URC storm can't exhaust the heap.
      if (buf.length() < 1024) buf += c;
    }
    if (buf.indexOf(expect) != -1) {
      if (out) *out = buf;
      return true;
    }
    if (buf.indexOf("ERROR") != -1) {
      if (out) *out = buf;
      debug.print(F("  << "));
      debug.println(buf);
      return false;
    }
    delay(5);
  }

  if (out) *out = buf;
  debug.print(F("  << (timeout) "));
  debug.println(buf);
  return false;
}

bool waitFor(const char *expect, uint32_t timeoutMs) {
  return waitFor(expect, timeoutMs, nullptr);
}

/*
 * Like waitFor, but also waits for the end of the line the tag appears on.
 * Needed whenever the values we want follow the tag: waitFor returns the
 * instant "+QHTTPPOST:" arrives, which is typically before the status code
 * behind it has been received, leaving nothing to parse.
 */
bool waitForLine(const char *tag, uint32_t timeoutMs, String *out) {
  String buf;
  uint32_t start = millis();

  while (millis() - start < timeoutMs) {
    while (modem.available()) {
      char c = (char)modem.read();
      if (buf.length() < 1024) buf += c;
    }
    int at = buf.indexOf(tag);
    if (at != -1 && buf.indexOf('\n', at) != -1) {
      if (out) *out = buf;
      return true;
    }
    if (buf.indexOf("ERROR") != -1) {
      if (out) *out = buf;
      debug.print(F("  << "));
      debug.println(buf);
      return false;
    }
    delay(5);
  }

  if (out) *out = buf;
  debug.print(F("  << (timeout) "));
  debug.println(buf);
  return false;
}

// Overloads rather than default arguments: the Arduino preprocessor generates
// its own prototypes for .ino functions, and defaults in both places clash.
bool sendAT(const String &cmd, const char *expect, uint32_t timeoutMs) {
  while (modem.available()) modem.read();  // drop stale URCs before asking
  debug.print(F("  >> "));
  debug.println(cmd);
  modem.println(cmd);
  return waitFor(expect, timeoutMs);
}

bool sendAT(const String &cmd, const char *expect) {
  return sendAT(cmd, expect, 3000);
}

bool sendAT(const String &cmd) {
  return sendAT(cmd, "OK", 3000);
}

/** Issues a command and hands back the whole reply for parsing. */
bool queryAT(const String &cmd, String *out, uint32_t timeoutMs) {
  while (modem.available()) modem.read();
  modem.println(cmd);
  return waitFor("OK", timeoutMs, out);
}

bool queryAT(const String &cmd, String *out) {
  return queryAT(cmd, out, 3000);
}

/** Quick liveness probe used to decide whether the modem still needs starting. */
bool modemAlive() {
  for (int i = 0; i < 3; i++) {
    if (sendAT("AT", "OK", 1000)) return true;
  }
  return false;
}

/*
 * Holds PWRKEY at `assertLevel` for a second, then releases it. The EC200U
 * needs >500 ms to latch on.
 */
void pulsePwrkey(int assertLevel) {
  int idle = (assertLevel == LOW) ? HIGH : LOW;

  pinMode(EC200U_PWRKEY, OUTPUT);
  digitalWrite(EC200U_PWRKEY, idle);
  delay(100);
  digitalWrite(EC200U_PWRKEY, assertLevel);
  delay(1200);
  digitalWrite(EC200U_PWRKEY, idle);  // release - never leave PWRKEY asserted,
                                      // a long hold is the power-OFF condition
}

/*
 * Brings the modem up. Whether the KEY pad drives PWRKEY directly (assert LOW)
 * or through an inverting transistor (assert HIGH) is undocumented for this
 * board, so try one, check, then try the other rather than guessing.
 *
 * Requires a jumper from EC200U_PWRKEY to the EC200U header's KEY pad. Without
 * it this pulses a pin connected to nothing and the modem never starts.
 *
 * EC200U_RESET is deliberately left alone: GPIO 9 is not broken out on either
 * header, so it cannot reach the RST pad no matter what we do with it.
 */
void powerOnModem() {
  debug.println(F("Checking whether the modem is already running..."));
  if (modemAlive()) {
    debug.println(F("Modem already up."));
    return;
  }

  const int polarities[2] = {LOW, HIGH};
  for (int i = 0; i < 2; i++) {
    debug.print(F("PWRKEY pulse, asserting "));
    debug.print(polarities[i] == LOW ? F("LOW") : F("HIGH"));
    debug.println(F(" - waiting for boot..."));

    pulsePwrkey(polarities[i]);
    delay(8000);  // cold boot to AT-ready takes several seconds

    if (modemAlive()) {
      debug.print(F("Modem started. PWRKEY asserts "));
      debug.println(polarities[i] == LOW ? F("LOW") : F("HIGH"));
      return;
    }
  }

  debug.println(F("Modem did not answer on either PWRKEY polarity."));
}

// ---------------------------------------------------------- modem telemetry

/*
 * Raw GSM signal quality from +CSQ: <rssi>,<ber>. Returns the CSQ value 0-31,
 * or 99 for "not detectable" - the dashboard renders both correctly. -1 means
 * the modem did not answer at all, and the field is then omitted.
 */
int readSignalCsq() {
  String r;
  if (!queryAT("AT+CSQ", &r)) return -1;

  int tag = r.indexOf("+CSQ:");
  if (tag == -1) return -1;
  int comma = r.indexOf(',', tag);
  if (comma == -1) return -1;

  return r.substring(tag + 5, comma).toInt();
}

/*
 * Supply voltage from +CBC. Quectel normally answers <bcs>,<bcl>,<mV> but some
 * firmware returns the millivolts alone, so take the last integer on the line
 * either way. Returns volts, or NAN if unavailable.
 */
float readBatteryVolts() {
  String r;
  if (!queryAT("AT+CBC", &r)) return NAN;

  int tag = r.indexOf("+CBC:");
  if (tag == -1) return NAN;

  // Walk the line collecting integers; the millivolt figure is the last one.
  int lastValue = -1;
  int i = tag + 5;
  while (i < (int)r.length() && r[i] != '\r' && r[i] != '\n') {
    if (isDigit(r[i])) {
      int start = i;
      while (i < (int)r.length() && isDigit(r[i])) i++;
      lastValue = r.substring(start, i).toInt();
    } else {
      i++;
    }
  }

  return lastValue > 0 ? lastValue / 1000.0f : NAN;
}

// ---------------------------------------------------------------- BMP280

/*
 * Captures the startup pressure as the zero point for height measurements. A
 * single sample is noisy (+/- a few Pa) and this value anchors every reading
 * for the whole run, so average a batch of them.
 */
void calibrateBaseline() {
  const int SAMPLES = 20;

  bmp.readPressure();  // discard the first conversion after config
  delay(100);

  float sum = 0;
  for (int i = 0; i < SAMPLES; i++) {
    sum += bmp.readPressure();  // Pa
    delay(50);
  }

  baselinePressure = (sum / SAMPLES) / 100.0f;  // hPa
  debug.print(F("  Baseline pressure: "));
  debug.print(baselinePressure, 2);
  debug.println(F(" hPa"));
}

// Breakouts ship at either 0x76 or 0x77 depending on how SDO is strapped.
void setupBMP280() {
  // setPins before begin, not Wire.begin(sda, scl): Adafruit's begin() calls
  // Wire.begin() with no arguments internally, which can re-init the bus on the
  // board's default pins. setPins makes 4/5 stick across any later begin().
  Wire.setPins(BMP_SDA_PIN, BMP_SCL_PIN);
  Wire.begin();

  if (bmp.begin(0x76) || bmp.begin(0x77)) {
    bmpReady = true;
    bmp.setSampling(Adafruit_BMP280::MODE_NORMAL,
                    Adafruit_BMP280::SAMPLING_X2,   // temperature
                    Adafruit_BMP280::SAMPLING_X16,  // pressure
                    Adafruit_BMP280::FILTER_X16,
                    Adafruit_BMP280::STANDBY_MS_500);
    calibrateBaseline();
  }
}

/*
 * Height of the current reading relative to the startup position, in metres.
 * Positive = higher than at boot. Uses the barometric formula rather than a
 * fixed hPa-per-metre constant so it stays accurate over larger differences.
 *
 * Worth knowing: on a fixed installation this mostly tracks weather, not
 * movement - a barometer cannot tell "the device rose" from "pressure fell".
 */
float heightFromBaseline(float pressureHPa) {
  if (isnan(baselinePressure) || isnan(pressureHPa)) return NAN;
  return 44330.0f * (1.0f - pow(pressureHPa / baselinePressure, 0.1903f));
}

// ---------------------------------------------------------------- sensor

/*
 * A01NYUB frame: 0xFF DATA_H DATA_L CHECKSUM, distance = (H<<8)|L in MILLIMETRES.
 * Note that unit: the dashboard divides `distance` by 1000. The older HC-SR04
 * firmware reported centimetres, which is why that conversion was wrong.
 */
void readSensor() {
  // The sensor free-runs at ~10 Hz, so the buffer holds stale frames from
  // however long the last modem call took. Drop the backlog, keep the newest.
  while (sensor.available() > 4) sensor.read();

  unsigned long start = millis();
  while (millis() - start < 150) {
    while (sensor.available() >= 4) {
      if (sensor.read() == 0xFF) {
        byte high = sensor.read();
        byte low = sensor.read();
        byte checksum = sensor.read();
        if (((0xFF + high + low) & 0xFF) == checksum) {
          lastDistanceMm = (high << 8) | low;
          lastDistanceAtMs = millis();
        }
      }
    }
    delay(1);
  }
}

bool haveFreshReading() {
  return lastDistanceMm >= 0 && (millis() - lastDistanceAtMs) < READING_MAX_AGE_MS;
}

// ---------------------------------------------------------------- HTTP

/*
 * Quectel's HTTP engine, which is a different command set from the SIMCom
 * AT+HTTPINIT/HTTPPARA/HTTPACTION flow the old A7670C firmware used.
 * URL and body are each sent as raw bytes after the modem answers CONNECT.
 */
bool httpPost(const String &url, const String &body, int *httpStatus) {
  *httpStatus = -1;

  sendAT("AT+QHTTPCFG=\"contextid\",1");
  sendAT("AT+QHTTPCFG=\"responseheader\",0");
  // 4 = application/json. Older firmware lacks it; the POST still works without.
  sendAT("AT+QHTTPCFG=\"contenttype\",4");

  // Firebase is HTTPS-only, so the TLS context has to be configured or the
  // POST fails with a bare ERROR that looks like a URL problem.
  sendAT("AT+QHTTPCFG=\"sslctxid\",1");
  sendAT("AT+QSSLCFG=\"sslversion\",1,4");        // TLS 1.2
  sendAT("AT+QSSLCFG=\"ciphersuite\",1,0xFFFF");  // let the server choose
  // seclevel 0 = do not verify the server certificate. Fine for bring-up; see
  // the note at the bottom of this file before shipping it.
  sendAT("AT+QSSLCFG=\"seclevel\",1,0");

  // Hand over the URL. Drain first: these bypass sendAT, so any tail left over
  // from the config commands above would otherwise sit in the buffer.
  while (modem.available()) modem.read();
  debug.print(F("  >> AT+QHTTPURL="));
  debug.println(url.length());
  modem.println("AT+QHTTPURL=" + String(url.length()) + ",30");
  if (!waitFor("CONNECT", 5000)) {
    debug.println(F("  !! modem never sent CONNECT for the URL"));
    return false;
  }
  modem.print(url);
  if (!waitFor("OK", 5000)) {
    debug.println(F("  !! URL not accepted"));
    return false;
  }

  // Hand over the body.
  while (modem.available()) modem.read();
  debug.print(F("  >> AT+QHTTPPOST="));
  debug.println(body.length());
  modem.println("AT+QHTTPPOST=" + String(body.length()) + ",30,60");
  if (!waitFor("CONNECT", 10000)) {
    debug.println(F("  !! modem never sent CONNECT for the body"));
    return false;
  }
  modem.print(body);

  // Reply looks like: +QHTTPPOST: <err>,<http_status>,<content_len>
  // waitForLine, not waitFor - we need the whole line, not just the tag.
  String resp;
  if (!waitForLine("+QHTTPPOST:", 65000, &resp)) {
    debug.println(F("  !! no POST result"));
    return false;
  }

  int tag = resp.indexOf("+QHTTPPOST:");
  int firstComma = resp.indexOf(',', tag);
  if (firstComma != -1) {
    int secondComma = resp.indexOf(',', firstComma + 1);
    String status = (secondComma == -1) ? resp.substring(firstComma + 1)
                                        : resp.substring(firstComma + 1, secondComma);
    *httpStatus = status.toInt();
  }

  debug.print(F("  HTTP status: "));
  debug.println(*httpStatus);
  return *httpStatus == 200;
}

/*
 * Builds the payload and posts it. Every field is gathered before the HTTP
 * transaction starts - AT+CBC or AT+CSQ issued midway through a QHTTPPOST
 * would land in the middle of the body upload.
 *
 * Fields the hardware can't supply are omitted rather than sent as null or -1;
 * the dashboard renders a missing field as an em dash.
 */
bool uploadReading(int distanceMm) {
  String body = "{\"distance\":" + String(distanceMm);

  if (bmpReady) {
    float pressure = bmp.readPressure() / 100.0f;  // Pa -> hPa
    float temperature = bmp.readTemperature();
    float height = heightFromBaseline(pressure);

    if (!isnan(pressure))    body += ",\"pressure\":" + String(pressure, 2);
    if (!isnan(temperature)) body += ",\"temperature\":" + String(temperature, 2);
    if (!isnan(height))      body += ",\"height\":" + String(height, 2);
  }

  float volts = readBatteryVolts();
  if (!isnan(volts)) body += ",\"battery_voltage\":" + String(volts, 2);

  int csq = readSignalCsq();
  if (csq >= 0) body += ",\"signal_strength\":" + String(csq);

  body += ",\"timestamp\":{\".sv\":\"timestamp\"}}";

  debug.print(F("  body: "));
  debug.println(body);

  int status = 0;
  return httpPost(String(FIREBASE_URL), body, &status);
}

// ---------------------------------------------------------------- self-test

bool step(int n, const char *name, bool ok) {
  debug.print(ok ? F("[PASS] ") : F("[FAIL] "));
  debug.print(n);
  debug.print(F(". "));
  debug.println(name);
  return ok;
}

bool runSelfTest() {
  // 1. Is the modem alive and talking at 115200?
  bool alive = false;
  for (int i = 0; i < 5 && !alive; i++) alive = sendAT("AT", "OK", 2000);
  if (!step(1, "Modem responds to AT", alive)) {
    debug.println(F("      -> check EC200U_RX_PIN/EC200U_TX_PIN, then PWRKEY polarity"));
    return false;
  }
  sendAT("ATE0");  // echo off, so responses parse cleanly

  // 2. SIM present and unlocked?
  if (!step(2, "SIM ready", sendAT("AT+CPIN?", "+CPIN: READY", 5000))) {
    debug.println(F("      -> seat the SIM; a PIN-locked SIM also fails here"));
    return false;
  }

  // 3. Signal. 99 means "not detectable" - an antenna or coverage problem.
  int csq = readSignalCsq();
  debug.print(F("      CSQ = "));
  debug.println(csq);
  if (!step(3, "Signal detectable", csq >= 0 && csq != 99)) {
    debug.println(F("      -> check the antenna on the MAIN connector"));
    return false;
  }

  // 4. Registered to the network? +CEREG: <n>,<stat> with stat 1 = home,
  // 5 = roaming. Parse the field rather than substring-matching ",1", which
  // would also match the <n> field or anything in a trailing cell ID.
  bool registered = false;
  for (int i = 0; i < 30 && !registered; i++) {
    String r;
    queryAT("AT+CEREG?", &r, 2000);
    int tag = r.indexOf("+CEREG:");
    if (tag != -1) {
      int comma = r.indexOf(',', tag);
      if (comma != -1) {
        int stat = r.substring(comma + 1, comma + 2).toInt();
        registered = (stat == 1 || stat == 5);
      }
    }
    if (!registered) delay(2000);
  }
  if (!step(4, "Registered to LTE network", registered)) {
    debug.println(F("      -> check that the SIM is activated for data"));
    return false;
  }

  // 5. Data context. QICSGP configures it; QIACT brings it up.
  sendAT("AT+QICSGP=1,1,\"" + String(APN) + "\",\"\",\"\",1", "OK", 5000);
  sendAT("AT+QIACT=1", "OK", 30000);
  bool hasIp = false;
  {
    String r;
    queryAT("AT+QIACT?", &r, 5000);
    hasIp = r.indexOf("+QIACT: 1,1") != -1;
    debug.print(F("  << "));
    debug.println(r);
  }
  if (!step(5, "PDP context active (has IP)", hasIp)) {
    debug.println(F("      -> wrong APN is the usual cause"));
    return false;
  }

  // 6. BMP280 is optional: without it the board still reports water level, it
  // just omits pressure, temperature and height. Never abort on this.
  if (!step(6, "BMP280 detected (optional)", bmpReady)) {
    debug.println(F("      -> check 3.3V and SDA/SCL on GPIO 4/5; continuing without it"));
  }

  // 7. Ultrasonic sensor.
  for (int i = 0; i < 10 && !haveFreshReading(); i++) readSensor();
  if (!step(7, "Ultrasonic frame received", haveFreshReading())) {
    debug.println(F("      -> check the sensor's yellow wire lands on SENSOR_RX_PIN"));
    return false;
  }
  debug.print(F("      distance = "));
  debug.print(lastDistanceMm);
  debug.println(F(" mm"));

  // 8. End-to-end POST.
  if (!step(8, "HTTPS POST to Firebase", uploadReading(lastDistanceMm))) {
    debug.println(F("      -> a non-200 status usually means Firebase rules reject the write"));
    return false;
  }

  return true;
}

// ---------------------------------------------------------------- lifecycle

void setup() {
  debug.begin(115200);
  delay(3000);  // give the USB CDC port time to enumerate before printing

  debug.println(F("\n===== ESP32-S3 + EC200U water level bring-up ====="));

  modem.begin(115200, SERIAL_8N1, EC200U_RX_PIN, EC200U_TX_PIN);
  sensor.begin(9600, SERIAL_8N1, SENSOR_RX_PIN, SENSOR_TX_PIN);

  setupBMP280();
  powerOnModem();

  if (runSelfTest()) {
    debug.println(F("\n===== ALL CHECKS PASSED - entering upload loop =====\n"));
    lastUploadMs = millis();
  } else {
    debug.println(F("\n===== SELF-TEST FAILED - fix the step above and reset ====="));
    debug.println(F("Continuing anyway so you can watch the sensor output.\n"));
  }
}

void loop() {
  readSensor();

  if (millis() - lastUploadMs >= UPLOAD_INTERVAL_MS) {
    lastUploadMs = millis();

    if (!haveFreshReading()) {
      debug.println(F("No fresh sensor reading - skipping upload."));
      return;
    }

    debug.print(F("Distance: "));
    debug.print(lastDistanceMm);
    debug.println(F(" mm"));

    if (uploadReading(lastDistanceMm)) {
      debug.println(F("Uploaded.\n"));
    } else {
      debug.println(F("Upload failed.\n"));
    }
  }
}

/*
 * BEFORE THIS GOES ON A REAL SITE
 * -------------------------------
 * - seclevel 0 disables TLS certificate verification, so the connection is
 *   encrypted but not authenticated. Raise it to 2 and load the CA with
 *   AT+QFUPL / AT+QSSLCFG="cacert" once bring-up is done.
 * - The Firebase URL carries no auth token, so the database rules must allow
 *   unauthenticated writes. Same exposure as the current firmware - worth
 *   closing separately.
 * - There is no retry or backoff: a failed POST is simply dropped and the next
 *   one goes out 30 s later.
 * - Battery and signal are queried on every upload. If you later move to a
 *   longer interval to save power, consider polling them less often than the
 *   water level, as the old A7670C firmware did.
 */

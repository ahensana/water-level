/*
 * lora_display_receiver.ino - LoRa display unit for the Umiam water-level site
 *
 * Hardware (control station):
 *   ESP32-C3 Super Mini + Ai-Thinker Ra-02 (433 MHz) + 1.3" I2C OLED (SH1106, 128x64)
 *
 * Receives "MWL,<seq>,<distance_mm>" from the site unit (lora_link.h) and shows:
 *
 *   UMIAM WATER LEVEL
 *   3203.05 ft          (big)   or LINK LOST / SENSOR FAULT
 *   -87dBm   12s ago
 *
 * WIRING (ESP32-C3 Super Mini)
 *   Ra-02 3.3V -> 3V3        OLED VCC -> 3V3
 *   Ra-02 GND  -> GND        OLED GND -> GND
 *   Ra-02 SCK  -> GPIO 4     OLED SCL -> GPIO 0
 *   Ra-02 MISO -> GPIO 5     OLED SDA -> GPIO 1
 *   Ra-02 MOSI -> GPIO 6
 *   Ra-02 NSS  -> GPIO 7
 *   Ra-02 RST  -> GPIO 10
 *   Ra-02 DIO0 -> GPIO 3
 *   GPIO 2, 8 and 9 are left free on purpose: they set the boot mode
 *   (8 is also the on-board LED, 9 the BOOT button).
 *
 * Arduino IDE: board "ESP32C3 Dev Module", Tools > USB CDC On Boot: Enabled
 * (otherwise Serial Monitor stays blank).
 *
 * Libraries (Library Manager):
 *   - "LoRa" by Sandeep Mistry
 *   - "U8g2" by oliver
 *
 * Radio settings below MUST match lora_link.h on the site unit.
 *
 * !! Fit the 433 MHz antenna to the Ra-02 before powering it. !!
 */
#include <SPI.h>
#include <Wire.h>
#include <LoRa.h>
#include <U8g2lib.h>

// ---------------------------------------------------------------- pins
#if CONFIG_IDF_TARGET_ESP32C3
#define LORA_SCK    4
#define LORA_MISO   5
#define LORA_MOSI   6
#define LORA_NSS    7
#define LORA_RST   10
#define LORA_DIO0   3
#define OLED_SDA    1
#define OLED_SCL    0
#elif CONFIG_IDF_TARGET_ESP32S3
#define LORA_SCK   39
#define LORA_MISO  40
#define LORA_MOSI  41
#define LORA_NSS   42
#define LORA_RST   21
#define LORA_DIO0  14
#define OLED_SDA    4
#define OLED_SCL    5
#else  // classic ESP32 DevKit
#define LORA_SCK   18
#define LORA_MISO  19
#define LORA_MOSI  23
#define LORA_NSS    5
#define LORA_RST   14
#define LORA_DIO0  26
#define OLED_SDA   21
#define OLED_SCL   22
#endif

// 1.3" I2C OLEDs almost always use the SH1106 chip. If the picture is shifted
// by two pixels or shows noise down one side, the module is SSD1306: swap the
// comment on these two lines.
U8G2_SH1106_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE, OLED_SCL, OLED_SDA);
// U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE, OLED_SCL, OLED_SDA);

// ---------------------------------------------------------------- radio (match lora_link.h)
#define LORA_FREQ_HZ   433500000L
#define LORA_SF        10
#define LORA_BW_HZ     125000L
#define LORA_CR_DENOM  5
#define LORA_SYNC_WORD 0x5A

// ---------------------------------------------------------------- calibration
// waterLevelFt = SENSOR_ELEVATION_FT - (distance_mm / 1000) * 3.28084
// Keep equal to sensorElevationFt in app/src/config.ts; update both when the
// mount is re-fitted.
const float SENSOR_ELEVATION_FT = 3208.57f;

// No packet for this long = LINK LOST (site sends every 30 s).
const unsigned long LINK_LOST_MS = 180000UL;

long lastDistanceMm = -1;
int lastRssi = 0;
float lastSnr = 0;
uint32_t lastSeq = 0;
uint32_t missedPackets = 0;
unsigned long lastPacketMs = 0;
bool havePacket = false;
bool radioOk = false;

void scanI2C() {
  Serial.print(F("I2C devices:"));
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      Serial.print(F(" 0x"));
      Serial.print(a, HEX);
    }
  }
  Serial.println(F("   (OLED should be 0x3C)"));
}

void showMessage(const char *top, const char *big, const char *bottom) {
  oled.clearBuffer();
  oled.setFont(u8g2_font_6x10_tr);
  oled.drawStr(0, 10, top);
  oled.setFont(u8g2_font_helvB12_tr);
  oled.drawStr(0, 40, big);
  oled.setFont(u8g2_font_6x10_tr);
  oled.drawStr(0, 63, bottom);
  oled.sendBuffer();
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println(F("\n== Umiam LoRa display unit =="));

  Wire.begin(OLED_SDA, OLED_SCL);
  scanI2C();
  oled.begin();
  showMessage("UMIAM WATER LEVEL", "Starting...", "");

  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);
  LoRa.setPins(LORA_NSS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ_HZ)) {
    Serial.println(F("Ra-02 not found - check 3V3, SPI wires and NSS/RST"));
    showMessage("UMIAM WATER LEVEL", "LoRa FAULT", "Check Ra-02 wiring");
    while (true) delay(1000);
  }
  LoRa.setSpreadingFactor(LORA_SF);
  LoRa.setSignalBandwidth(LORA_BW_HZ);
  LoRa.setCodingRate4(LORA_CR_DENOM);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.enableCrc();
  radioOk = true;

  Serial.println(F("Listening on 433.5 MHz"));
}

void handlePacket() {
  char buf[48];
  int n = 0;
  while (LoRa.available() && n < (int)sizeof(buf) - 1) buf[n++] = (char)LoRa.read();
  while (LoRa.available()) LoRa.read();  // drop anything too long
  buf[n] = '\0';

  unsigned long seq;
  long dist;
  if (sscanf(buf, "MWL,%lu,%ld", &seq, &dist) != 2) {
    Serial.print(F("Ignored packet: "));
    Serial.println(buf);
    return;
  }

  if (havePacket && seq > lastSeq + 1) missedPackets += seq - lastSeq - 1;
  lastSeq = seq;
  lastDistanceMm = dist;
  lastRssi = LoRa.packetRssi();
  lastSnr = LoRa.packetSnr();
  lastPacketMs = millis();
  havePacket = true;

  Serial.printf("#%lu distance=%ld mm RSSI=%d dBm SNR=%.1f dB missed=%lu\n",
                seq, dist, lastRssi, lastSnr, (unsigned long)missedPackets);
}

void refreshDisplay() {
  if (!havePacket) {
    showMessage("UMIAM WATER LEVEL", "Waiting...", "No data from site yet");
    return;
  }

  unsigned long ageS = (millis() - lastPacketMs) / 1000;
  char bottom[24];
  if (ageS < 100) snprintf(bottom, sizeof(bottom), "%ddBm   %lus ago", lastRssi, ageS);
  else            snprintf(bottom, sizeof(bottom), "%ddBm   %lumin ago", lastRssi, ageS / 60);

  if (millis() - lastPacketMs > LINK_LOST_MS) {
    showMessage("UMIAM WATER LEVEL", "LINK LOST", bottom);
    return;
  }
  if (lastDistanceMm < 0) {
    showMessage("UMIAM WATER LEVEL", "SENSOR FAULT", bottom);
    return;
  }

  float levelFt = SENSOR_ELEVATION_FT - (lastDistanceMm / 1000.0f) * 3.28084f;
  char level[16];
  snprintf(level, sizeof(level), "%.2f", levelFt);

  oled.clearBuffer();
  oled.setFont(u8g2_font_6x10_tr);
  oled.drawStr(0, 10, "UMIAM WATER LEVEL");
  oled.setFont(u8g2_font_logisoso20_tn);      // big digits
  oled.drawStr(0, 42, level);
  int w = oled.getStrWidth(level);
  oled.setFont(u8g2_font_6x10_tr);
  oled.drawStr(w + 4, 42, "ft");
  oled.drawStr(0, 63, bottom);
  oled.sendBuffer();
}

void loop() {
  if (radioOk && LoRa.parsePacket() > 0) handlePacket();

  static unsigned long lastDrawMs = 0;
  if (millis() - lastDrawMs >= 1000) {
    lastDrawMs = millis();
    refreshDisplay();
  }
}

/*
 * lora_link.h - LoRa point-to-point sender for the site unit
 * (7Semi ESP32-S3 + EC200U board, Ai-Thinker Ra-02 433 MHz module)
 *
 * The site unit broadcasts a short packet every LORA_SEND_EVERY_MS. A second
 * ESP32 with an Ra-02 and a 16x2 LCD (lora_display_receiver.ino) shows it.
 * This runs alongside the 4G upload and does not depend on it: if the modem
 * is down, the LCD still updates.
 *
 * This is plain LoRa radio, not LoRaWAN. LoRaWAN needs a gateway and a
 * network server; two Ra-02s talk to each other directly.
 *
 * WIRING  Ra-02  ->  ESP32-S3 board
 *   3.3V  -> 3V3        (NOT 5 V; the Ra-02 is a 3.3 V part)
 *   GND   -> GND
 *   SCK   -> GPIO 39
 *   MISO  -> GPIO 40
 *   MOSI  -> GPIO 41
 *   NSS   -> GPIO 42
 *   RST   -> GPIO 21
 *   DIO0  -> GPIO 14
 *   DIO1..DIO5 unconnected
 *
 * Why these pins: the default ESP32-S3 SPI pins (11/12/13) clash with the
 * EC200U UART on 12/13, and 16/17 (sensor), 4/5 (I2C), 18 (PWRKEY) and 9 are
 * already used. 39-42, 21 and 14 are all on the board's lower header.
 *
 * !! Fit a 433 MHz antenna to the Ra-02's IPEX connector BEFORE powering it.
 *    Transmitting with no antenna can damage the PA. !!
 *
 * RADIO SETTINGS must match the receiver exactly (frequency, SF, bandwidth,
 * coding rate, sync word). In India 433.05-434.79 MHz is licence-exempt for
 * low-power devices at up to 10 mW, so TX power is set to 10 dBm, not the
 * module's +18 dBm maximum.
 *
 * Library: "LoRa" by Sandeep Mistry (Arduino Library Manager).
 *
 * Packet (plain text, CRC checked by the radio):
 *   MWL,<seq>,<distance_mm>
 * distance_mm is -1 when the sensor has no fresh reading, so the display can
 * tell a sensor fault apart from a radio fault.
 */
#pragma once

#include <SPI.h>
#include <LoRa.h>

#define LORA_SCK   39
#define LORA_MISO  40
#define LORA_MOSI  41
#define LORA_NSS   42
#define LORA_RST   21
#define LORA_DIO0  14

#define LORA_FREQ_HZ       433500000L  // middle of the 433.05-434.79 MHz band
#define LORA_TX_DBM        10
#define LORA_SF            10          // 7 = faster/shorter range, 12 = slowest/longest
#define LORA_BW_HZ         125000L
#define LORA_CR_DENOM      5           // coding rate 4/5
#define LORA_SYNC_WORD     0x5A        // keeps other LoRa traffic out
#define LORA_SEND_EVERY_MS 30000UL

static SPIClass loraSPI(HSPI);  // separate bus so it never touches the default SPI
static bool loraReady = false;
static uint32_t loraSeq = 0;
static unsigned long loraLastSendMs = 0;

bool loraSetup() {
  loraSPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);
  LoRa.setSPI(loraSPI);
  LoRa.setPins(LORA_NSS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(LORA_FREQ_HZ)) {
    Serial.println(F("[LoRa] Ra-02 not found - check 3V3, SPI wires and NSS/RST"));
    loraReady = false;
    return false;
  }

  LoRa.setTxPower(LORA_TX_DBM);
  LoRa.setSpreadingFactor(LORA_SF);
  LoRa.setSignalBandwidth(LORA_BW_HZ);
  LoRa.setCodingRate4(LORA_CR_DENOM);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.enableCrc();

  Serial.println(F("[LoRa] ready on 433.5 MHz"));
  loraReady = true;
  // Send the first packet straight away so the LCD fills on power-up.
  loraLastSendMs = millis() - LORA_SEND_EVERY_MS;
  return true;
}

// Call every pass through loop(). Sends at most once per LORA_SEND_EVERY_MS.
// Blocks for roughly 0.3-0.4 s while the packet is on air at SF10.
void loraTick(int distanceMm, bool fresh) {
  if (!loraReady) return;
  if (millis() - loraLastSendMs < LORA_SEND_EVERY_MS) return;
  loraLastSendMs = millis();

  loraSeq++;
  int d = fresh ? distanceMm : -1;

  LoRa.beginPacket();
  LoRa.print(F("MWL,"));
  LoRa.print(loraSeq);
  LoRa.print(',');
  LoRa.print(d);
  LoRa.endPacket();  // blocking send

  Serial.print(F("[LoRa] sent #"));
  Serial.print(loraSeq);
  Serial.print(F(" distance="));
  Serial.println(d);
}

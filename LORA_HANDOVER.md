# LoRa display link: handover (27 Oct 2026)

Continue from here in a new session. Repo: https://github.com/ahensana/water-level

## Goal
4G (EC200U) is unreliable at the Umiam site. Add a LoRa point-to-point link from the
sensor unit to a control station about 400 m away, show the water level on a small
display there, and later relay readings to the server from the control station
(Bluetooth to staff phones, and/or Wi-Fi).

## Hardware
| Unit | Parts |
|---|---|
| Sensor side | 7Semi ESP32-S3-WROOM-1 + Quectel EC200U board, A01NYUB ultrasonic, BMP280 (optional), Ai-Thinker Ra-02 (433 MHz), 2 LiPo pouch cells on a "Rev2.0" charger/5V boost board |
| Control station | ESP32-C3 SuperMini (HW-466AB), Ra-02 (433 MHz), 1.3" I2C OLED (GND VCC SCL SDA, addr 0x78/0x3C, likely SH1106), TP4056 HW-373 (with protection) + one 18650 (2000 mAh) in a single-cell holder |

Plain LoRa (not LoRaWAN, no gateway). Both Ra-02s need a 433 MHz antenna on the IPEX connector before power-up.

## Files (all in repo root unless noted)
- `lora_link.h`: sender for the sensor unit. Sends `MWL,<seq>,<distance_mm>` every 30 s; distance is -1 when the sensor has no fresh reading. Independent of 4G.
- `esp32s3_ec200u_test.ino`: 3 lines added: `#include "lora_link.h"`, `loraSetup();` in setup() before `powerOnModem()`, `loraTick(lastDistanceMm, haveFreshReading());` in loop() after `readSensor()`.
- `lora_display_receiver/lora_display_receiver.ino`: control-station receiver. Auto-selects pins for ESP32-C3 / ESP32-S3 / classic ESP32. U8g2 display, SH1106 by default (swap to the commented SSD1306 line if needed). Computes level = `SENSOR_ELEVATION_FT (3208.57) - distance_mm/1000 * 3.28084`; keep that constant equal to `sensorElevationFt` in `app/src/config.ts`. Shows LINK LOST after 180 s without packets, SENSOR FAULT when distance is -1.

Libraries: "LoRa" by Sandeep Mistry, "U8g2" by oliver. Neither sketch has been compiled yet (no toolchain in the cloud session); compile both first.

## Radio settings (must match on both ends)
433.5 MHz, SF10, BW 125 kHz, CR 4/5, sync word 0x5A, CRC on, TX 10 dBm.
433.05-434.79 MHz is licence-exempt in India at up to 10 mW, hence 10 dBm. At 400 m, SF9 is an option if line of sight is clear.

## Wiring: sensor unit (Ra-02 -> 7Semi ESP32-S3 board)
| Ra-02 | ESP32-S3 |
|---|---|
| 3.3V | 3V3 |
| GND | GND |
| SCK | GPIO 39 |
| MISO | GPIO 40 |
| MOSI | GPIO 41 |
| NSS | GPIO 42 |
| RST | GPIO 21 |
| DIO0 | GPIO 14 |

Already used on this board: GPIO 12/13 (EC200U UART), 18 (PWRKEY), 9 (RESET), 16/17 (A01NYUB, yellow TX -> 16, powered from 3V3), 4/5 (BMP280 I2C). LoRa uses its own `SPIClass(HSPI)`.

## Wiring: control station (labels as printed on the boards)
| From | To ESP32-C3 SuperMini |
|---|---|
| Ra-02 3.3U | 3.3 |
| Ra-02 GND | G |
| Ra-02 SCK | 4 |
| Ra-02 MISO | 5 |
| Ra-02 MOSI | 6 |
| Ra-02 NSS | 7 |
| Ra-02 RST | 10 |
| Ra-02 DIO0 | 3 |
| OLED GND | G |
| OLED VCC | 3.3 |
| OLED SCL | 0 |
| OLED SDA | 1 |
| TP4056 OUT+ | 5V |
| TP4056 OUT- | G |

Battery holder red -> TP4056 B+, black -> B-. Leave C3 pins 2, 8, 9 (boot strapping, LED, BOOT button), 20 and 21 free. Ra-02 DIO1-DIO5 not connected.
Charge only via the TP4056's USB-C; do not plug USB into the C3 while OUT+ is on its 5V pin (USB 5 V back-feeds the cell on many SuperMini boards). Disconnect OUT+/OUT- while flashing over USB.
Arduino IDE: board "ESP32C3 Dev Module", Tools > USB CDC On Boot: Enabled.

## Current status
- Sensor-side battery checked; multimeter fault found (red lead was in the 10A jack; meter later replaced/fixed).
- 3-cell holder turned out to be series (11.98 V), so not usable with the TP4056; switched to a single 18650 holder. TP4056 charging confirmed (red LED).
- Control station wired on the bench. **OLED is blank.** Next step: open Serial Monitor at 115200, press RST, read the `I2C devices:` line.
  - Nothing printed: sketch not uploaded or USB CDC On Boot disabled.
  - No address: check SCL->0 / SDA->1 not swapped, VCC on 3.3, jumpers seated (3.3 and G each carry several wires).
  - 0x3C found but blank: switch to the SSD1306 constructor line.
- LoRa link not yet tested end to end.

## Next work
1. Get the OLED working, then bench-test the link (expect `#1 distance=... RSSI=...` on the C3 within 30 s of the sensor unit booting).
2. Bluetooth relay from the control station (C3 has BLE): keep a backlog of readings, a Web Bluetooth page in the existing dashboard (Android Chrome) pulls it and posts to `ingest` over the phone's data. Design points agreed so far:
   - The C3 signs each reading (HMAC) with a key that never leaves the C3; `ingest` verifies, so the phone cannot forge readings.
   - Database rules only accept `timestamp === now`; `ingest` must accept a bounded age (<= 24 h) from the signed packet and store the real measurement time.
   - Dedupe by `seq` so readings arriving via both 4G and LoRa are stored once.
3. Optionally Wi-Fi forwarding from the control station if it has Wi-Fi.
4. Open items carried over from `claude/water-level-handover.md` (deploy, lock rules, make repo private, fix the sensor mount).

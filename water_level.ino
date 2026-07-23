#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ============================================================================
//  HARDWARE-UART build: the SIM900A is on the ESP8266's hardware serial
//  (TX=GPIO1, RX=GPIO3 - the pins marked TX/RX on the NodeMCU).
//
//  Consequences of using the hardware UART for the modem:
//    * There is NO USB serial log anymore - all AT traffic goes to the modem,
//      not the PC. The OLED is the only status display.
//    * To UPLOAD new firmware you MUST disconnect the wire from RX (GPIO3),
//      because the USB uploader drives the same pin. Reconnect after flashing.
//
//  Wiring:
//    SIM900A TXD -> RX (GPIO3)      SIM900A RXD -> TX (GPIO1)   (crossed)
//    SIM900A GND -> GND             SIM900A VCC -> external 5V 2A
// ============================================================================

// Modem talks on the hardware UART. Aliased so the rest of the code reads
// naturally and the modem baud is set once in setup().
#define sim900 Serial

// HC-SR04 ultrasonic sensor
#define TRIG_PIN D1
#define ECHO_PIN D2

// 0.96" SSD1306 OLED, I2C address 0x3C. D1/D2 are taken by the HC-SR04, so
// the I2C bus is remapped to SDA=D3, SCL=D4 (both idle high, safe for boot).
#define OLED_SDA D3
#define OLED_SCL D4

Adafruit_SSD1306 display(128, 64, &Wire, -1);
bool oledOk = false;

// Overwrite the single /current node on every upload (no history kept).
// The SIM900 HTTP stack can only POST, and Firebase treats a POST as a push
// that creates a new child each time - so the upload also sends an
// "X-HTTP-Method-Override: PUT" header, which makes Firebase treat it as a
// PUT and replace the node instead.
String firebaseURL =
    "https://water-level-ae453-default-rtdb.asia-southeast1.firebasedatabase.app/water_monitor/current.json";

String apn = "www"; // Vodafone/Vi SIM (was airteliot.com for Airtel IoT)

unsigned long uploadInterval = 60000;  // 1 minute
unsigned long statsInterval = 3600000; // 1 hour
unsigned long lastStatsRead = 0;

float lastBatteryVoltage = -1;
int lastSignalStrength = -1;

// Latest state shown on the OLED.
float lastDistanceM = -1;
String netStatus = "BOOT";
String uploadStatus = "--";

// Redraw the whole status screen from the globals above. Called at every
// point where one of them changes, so the display always reflects the last
// known state even while the modem is busy. This is the ONLY status output
// in this build - there is no serial log.
void drawStatus()
{
  if (!oledOk)
    return;

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("WATER LEVEL");

  display.setTextSize(2);
  display.setCursor(0, 12);
  if (lastDistanceM < 0)
    display.println("--.-- m");
  else
  {
    display.print(lastDistanceM, 2);
    display.println(" m");
  }

  display.setTextSize(1);

  display.setCursor(0, 34);
  display.print("Sig: ");
  if (lastSignalStrength >= 0 && lastSignalStrength != 99)
  {
    display.print(lastSignalStrength);
    display.print("/31");
  }
  else
    display.print("--");

  display.print("  Bat: ");
  if (lastBatteryVoltage > 0)
  {
    display.print(lastBatteryVoltage, 1);
    display.print("V");
  }
  else
    display.print("--");

  display.setCursor(0, 45);
  display.print("Net: ");
  display.println(netStatus);

  display.setCursor(0, 55);
  display.print("Up:  ");
  display.println(uploadStatus);

  display.display();
}

// Send an AT command to the modem and collect its reply for waitTime ms.
// No echo to a serial log exists in this build (the log IS the modem).
String sendAT(String cmd, unsigned long waitTime)
{
  String response = "";

  sim900.println(cmd);

  unsigned long start = millis();

  while (millis() - start < waitTime)
  {
    while (sim900.available())
    {
      char c = sim900.read();
      response += c;
    }
    yield();
  }

  return response;
}

float readDistanceCM()
{
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);

  if (duration == 0)
    return -1;

  return duration * 0.0343 / 2.0;
}

// Extract the <stat> digit from a "+CREG: <n>,<stat>" style reply.
// Returns -1 if the reply is missing or malformed.
int registrationStatus(String res)
{
  int i = res.indexOf("+CREG:");
  if (i == -1)
    return -1;

  int comma = res.indexOf(",", i);
  if (comma == -1)
    return -1;

  return res.substring(comma + 1, comma + 2).toInt();
}

// Block until the modem is registered on the network (stat 1 = home,
// 5 = roaming) and GPRS-attached, or the timeout expires. Registration
// after a cold boot or a brownout reset routinely takes 10-30 seconds,
// so firing SAPBR immediately always failed with +CREG: 0,2 / +CGATT: 0.
bool waitForNetwork(unsigned long timeoutMs)
{
  unsigned long start = millis();

  netStatus = "SEARCHING";
  drawStatus();

  bool registered = false;

  while (millis() - start < timeoutMs)
  {
    // Refresh the live signal reading while searching, so the OLED shows CSQ
    // even before registration - this is what you watch to aim the antenna.
    lastSignalStrength = getSignalStrength();

    String res = sendAT("AT+CREG?", 2000);
    int stat = registrationStatus(res);

    netStatus = "SEARCHING";
    drawStatus();

    if (stat == 1 || stat == 5)
    {
      registered = true;
      break;
    }
  }

  if (!registered)
  {
    netStatus = "NO NETWORK";
    drawStatus();
    return false;
  }

  netStatus = "REGISTERED";
  drawStatus();

  while (millis() - start < timeoutMs)
  {
    String res = sendAT("AT+CGATT?", 2000);

    if (res.indexOf("+CGATT: 1") != -1)
    {
      netStatus = "GPRS OK";
      drawStatus();
      return true;
    }
  }

  netStatus = "NO GPRS";
  drawStatus();
  return false;
}

// True if AT+SAPBR=2,1 reports the bearer open (status 1) with a real IP.
// A closed bearer reports status 3 and IP "0.0.0.0".
bool bearerIsOpen()
{
  String res = sendAT("AT+SAPBR=2,1", 3000);

  int i = res.indexOf("+SAPBR: 1,");
  if (i == -1)
    return false;

  char status = res.charAt(i + 10);

  return status == '1' && res.indexOf("\"0.0.0.0\"") == -1;
}

bool openBearer()
{
  sendAT("AT+SAPBR=3,1,\"Contype\",\"GPRS\"", 3000);
  sendAT("AT+SAPBR=3,1,\"APN\",\"" + apn + "\"", 3000);

  for (int attempt = 0; attempt < 3; attempt++)
  {
    sendAT("AT+SAPBR=1,1", 15000);

    // The bearer can take a moment to report open after AT+SAPBR=1,1, so
    // re-check a few times before declaring the attempt failed rather than
    // giving up on the first (often too-early) status read.
    for (int check = 0; check < 4; check++)
    {
      if (bearerIsOpen())
      {
        netStatus = "ONLINE";
        drawStatus();
        return true;
      }
    }

    // Close any half-open bearer so the next attempt starts clean.
    sendAT("AT+SAPBR=0,1", 3000);
  }

  netStatus = "NO BEARER";
  drawStatus();
  return false;
}

// Make sure a live data connection exists before an upload. When the modem
// has rebooted (e.g. after a power brownout) the bearer is gone and GPRS is
// detached, so this re-registers and reopens the bearer from scratch.
bool ensureConnection()
{
  if (bearerIsOpen())
    return true;

  if (!waitForNetwork(60000))
    return false;

  return openBearer();
}

String getNetworkTime()
{
  String res = sendAT("AT+CCLK?", 3000);

  int firstQuote = res.indexOf("\"");
  int secondQuote = res.indexOf("\"", firstQuote + 1);

  if (firstQuote == -1 || secondQuote == -1)
  {
    return "Unknown";
  }

  String raw = res.substring(firstQuote + 1, secondQuote);

  String year = "20" + raw.substring(0, 2);
  String month = raw.substring(3, 5);
  String day = raw.substring(6, 8);
  String time = raw.substring(9, 17);

  String monthName = "";

  if (month == "01")
    monthName = "Jan";
  else if (month == "02")
    monthName = "Feb";
  else if (month == "03")
    monthName = "Mar";
  else if (month == "04")
    monthName = "Apr";
  else if (month == "05")
    monthName = "May";
  else if (month == "06")
    monthName = "Jun";
  else if (month == "07")
    monthName = "Jul";
  else if (month == "08")
    monthName = "Aug";
  else if (month == "09")
    monthName = "Sep";
  else if (month == "10")
    monthName = "Oct";
  else if (month == "11")
    monthName = "Nov";
  else if (month == "12")
    monthName = "Dec";

  return day + "-" + monthName + "-" + year + " " + time;
}

int getSignalStrength()
{
  String res = sendAT("AT+CSQ", 2000);

  int index = res.indexOf("+CSQ:");
  if (index == -1)
    return -1;

  int commaIndex = res.indexOf(",", index);
  if (commaIndex == -1)
    return -1;

  String value = res.substring(index + 6, commaIndex);
  value.trim();

  return value.toInt();
}

float getBatteryVoltage()
{
  String res = sendAT("AT+CBC", 2000);

  int lastComma = res.lastIndexOf(",");
  if (lastComma == -1)
    return -1;

  String voltageStr = res.substring(lastComma + 1);
  voltageStr.trim();

  float voltageMv = voltageStr.toFloat();

  if (voltageMv <= 0)
    return -1;

  return voltageMv / 1000.0;
}

void setupGPRS()
{
  sendAT("AT", 2000);
  sendAT("AT+CPIN?", 2000);

  // Show signal on the OLED right away, before we even try to register.
  lastSignalStrength = getSignalStrength();
  drawStatus();

  // Network time sync; takes effect once registered.
  sendAT("AT+CLTS=1", 2000);
  sendAT("AT&W", 2000);

  ensureConnection();
}

// Send AT+HTTPACTION=1 (POST) and wait for the asynchronous
// "+HTTPACTION: 1,<code>,<len>" result line, which can arrive up to ~30 s
// after the initial "OK" on weak signal. Returns the HTTP status code, or
// -1 if no result line arrived within timeoutMs.
int sendHttpAction(unsigned long timeoutMs)
{
  // Drain any stale bytes left in the buffer so they cannot be mistaken for
  // this command's response (this was corrupting the parse before).
  while (sim900.available())
  {
    sim900.read();
  }

  sim900.println("AT+HTTPACTION=1");

  String response = "";
  unsigned long start = millis();

  while (millis() - start < timeoutMs)
  {
    while (sim900.available())
    {
      char c = sim900.read();
      response += c;
    }

    // Only look for the result line AFTER a newline follows it, so we don't
    // grab a truncated "+HTTPACTION:" before the status has fully arrived.
    int i = response.indexOf("+HTTPACTION:");
    if (i != -1)
    {
      int lineEnd = response.indexOf("\n", i);
      if (lineEnd != -1)
      {
        // Layout: +HTTPACTION: <method>,<status>,<datalen>
        int firstComma = response.indexOf(",", i);
        int secondComma = (firstComma != -1) ? response.indexOf(",", firstComma + 1) : -1;
        if (firstComma != -1 && secondComma != -1)
        {
          String code = response.substring(firstComma + 1, secondComma);
          code.trim();
          return code.toInt();
        }
      }
    }
    yield();
  }

  return -1;
}

void sendToFirebase(float distanceM)
{
  if (!ensureConnection())
  {
    uploadStatus = "NO CONN";
    drawStatus();
    return;
  }

  bool includeStats = false;

  if (lastBatteryVoltage < 0 || millis() - lastStatsRead >= statsInterval)
  {
    lastBatteryVoltage = getBatteryVoltage();
    lastSignalStrength = getSignalStrength();
    lastStatsRead = millis();
    includeStats = true;
  }

  String timestamp = getNetworkTime();

  String json = "{";

  json += "\"distance_m\":";
  json += String(distanceM, 2);

  json += ",\"timestamp\":\"";
  json += timestamp;
  json += "\"";

  if (includeStats)
  {
    if (lastBatteryVoltage > 0)
    {
      json += ",\"battery_voltage\":";
      json += String(lastBatteryVoltage, 2);
    }

    if (lastSignalStrength >= 0)
    {
      json += ",\"signal_strength\":";
      json += String(lastSignalStrength);
    }
  }

  json += "}";

  uploadStatus = "SENDING...";
  drawStatus();

  // Attempt the upload, retrying once if it does not succeed.
  for (int attempt = 0; attempt < 2; attempt++)
  {
    sendAT("AT+HTTPTERM", 1000);
    sendAT("AT+HTTPINIT", 3000);

    // Firebase requires HTTPS. Older SIM900A firmware has no SSL support and
    // answers ERROR here - surface that on the OLED instead of failing later
    // with a cryptic 6xx code.
    String sslRes = sendAT("AT+HTTPSSL=1", 3000);
    if (sslRes.indexOf("ERROR") != -1)
    {
      uploadStatus = "NO SSL FW";
      drawStatus();
    }
    sendAT("AT+HTTPPARA=\"CID\",1", 3000);
    sendAT("AT+HTTPPARA=\"URL\",\"" + firebaseURL + "\"", 3000);
    sendAT("AT+HTTPPARA=\"CONTENT\",\"application/json\"", 3000);
    // Turn the POST into a PUT on Firebase's side so /current is replaced
    // instead of a new pushed child being created (see firebaseURL comment).
    sendAT("AT+HTTPPARA=\"USERDATA\",\"X-HTTP-Method-Override: PUT\"", 3000);

    sim900.print("AT+HTTPDATA=");
    sim900.print(json.length());
    sim900.println(",10000");

    // Wait for the modem's "DOWNLOAD" prompt before streaming the body so the
    // JSON is not sent before the modem is ready to receive it.
    String prompt = "";
    bool ready = false;
    unsigned long promptStart = millis();
    while (millis() - promptStart < 5000)
    {
      while (sim900.available())
      {
        char c = sim900.read();
        prompt += c;
      }
      if (prompt.indexOf("DOWNLOAD") != -1)
      {
        ready = true;
        break;
      }
      yield();
    }

    // If the prompt never arrived, abort this attempt and retry rather than
    // sending the body into a modem that is not ready to receive it.
    if (!ready)
    {
      sendAT("AT+HTTPTERM", 1000);
      continue;
    }

    sim900.print(json);

    // Fire the POST and capture the "+HTTPACTION: 1,<code>,<len>" line.
    // On weak signal the line can take ~90 s, so we wait generously.
    int httpCode = sendHttpAction(120000);

    sendAT("AT+HTTPREAD", 10000);
    sendAT("AT+HTTPTERM", 2000);

    // Only the HTTPACTION status code proves storage. Do NOT trust the
    // HTTPREAD body: when the action never completes the modem echoes its own
    // buffered request JSON, which looks exactly like a Firebase PUT echo
    // (verified 2026-07-12: body echoed while the database stayed empty).
    if (httpCode == 200 || httpCode == 201)
    {
      uploadStatus = "OK " + String(httpCode);
      drawStatus();
      return;
    }

    uploadStatus = "FAIL " + String(httpCode);
    drawStatus();

    // The attempt failed; if the modem lost the connection (or rebooted
    // mid-upload) rebuild it before retrying.
    if (!ensureConnection())
    {
      uploadStatus = "NO CONN";
      drawStatus();
      return;
    }
  }

  uploadStatus = "FAILED";
  drawStatus();
}

void setup()
{
  // The modem owns the hardware UART. It must run at the modem's baud (9600),
  // NOT 115200 - there is no separate PC log in this build.
  sim900.begin(9600);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  Wire.begin(OLED_SDA, OLED_SCL);
  oledOk = display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  drawStatus();

  delay(5000);

  setupGPRS();
}

void loop()
{
  float distanceCm = readDistanceCM();

  if (distanceCm < 0)
  {
    lastDistanceM = -1;
    drawStatus();
  }
  else
  {
    float distanceM = distanceCm / 100.0;

    lastDistanceM = distanceM;

    // Refresh signal strength every cycle so the OLED always shows a
    // current value (the hourly statsInterval only gates what gets
    // uploaded to Firebase, not what is displayed).
    lastSignalStrength = getSignalStrength();
    drawStatus();

    sendToFirebase(distanceM);
  }

  delay(uploadInterval);
}

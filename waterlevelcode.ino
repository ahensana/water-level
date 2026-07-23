#include <SoftwareSerial.h>
#include <Wire.h>
#include <Adafruit_BMP280.h>

// --- Pins ---
#define SIM_RX D7 // ESP8266 RX <- SIM800L TX
#define SIM_TX D8 // ESP8266 TX -> SIM800L RX
#define TRIG_PIN D5
#define ECHO_PIN D6

// One-wire link FROM the Node B LoRa-receiver Nano.
// Only NANO_RX is actually wired (Nano TX -> ESP RX). This link is one-way.
// IMPORTANT: Nano TX is 5V, ESP8266 is 3.3V -> use a level shifter or a
//            1k/2k voltage divider on this line, or you will damage the ESP.
#define NANO_RX D3 // ESP8266 RX <- Nano TX (through level shifter/divider!)
#define NANO_TX D4 // not connected (dummy TX; link is one-way)

SoftwareSerial sim800(SIM_RX, SIM_TX);
SoftwareSerial nanoSerial(NANO_RX, NANO_TX);
Adafruit_BMP280 bmp;

float remotePressure = -1; // pressure received from Node A (via LoRa -> Nano)

// --- Config ---
// --- APN settings ---
// Airtel IoT/M2M SIMs use a dedicated APN. Confirm the exact one printed on your
// SIM paperwork / Airtel IoT portal. Common values:
//   "airtelgprs.com"  -> standard Airtel consumer data
//   "iot.airtel.com"  -> many Airtel IoT plans
//   custom.airtel.com -> some enterprise/custom M2M plans
const char APN[] = "airteliot.com"; // Airtel IoT/M2M private APN (per Airtel KYC email)
const char APN_USER[] = "";         // leave "" unless Airtel gave you a username
const char APN_PWD[] = "";          // leave "" unless Airtel gave you a password
const char FIREBASE_URL[] = "https://water-level-ae453-default-rtdb.asia-southeast1.firebasedatabase.app/water_monitor/current.json";

bool bmpOK = false;

// Send an AT command, print the modem's reply, and report whether
// the expected keyword was seen within the timeout window.
bool sendAT(const String &cmd, const char *expected, uint32_t timeout)
{
    while (sim800.available())
        sim800.read(); // flush stale bytes

    Serial.print(">> ");
    Serial.println(cmd);
    sim800.println(cmd);

    String response = "";
    uint32_t start = millis();
    while (millis() - start < timeout)
    {
        while (sim800.available())
        {
            response += (char)sim800.read();
        }
        if (expected != nullptr && response.indexOf(expected) != -1)
        {
            break;
        }
    }

    response.trim();
    if (response.length())
    {
        Serial.println(response);
    }

    if (expected == nullptr)
        return true;
    return response.indexOf(expected) != -1;
}

// Query signal quality (AT+CSQ) and return RSSI in dBm.
// Returns 0 if unknown / no signal.
int getSignalStrength()
{
    while (sim800.available())
        sim800.read();
    sim800.println("AT+CSQ");

    String response = "";
    uint32_t start = millis();
    while (millis() - start < 2000)
    {
        while (sim800.available())
            response += (char)sim800.read();
        if (response.indexOf("OK") != -1)
            break;
    }

    int idx = response.indexOf("+CSQ:");
    if (idx == -1)
    {
        Serial.println("Signal: no response from modem");
        return 0;
    }

    int comma = response.indexOf(',', idx);
    int rssiRaw = response.substring(idx + 6, comma).toInt();

    if (rssiRaw == 99)
    {
        Serial.println("Signal: not detectable (99)");
        return 0;
    }

    int dbm = -113 + (rssiRaw * 2); // per SIM800 datasheet mapping
    Serial.print("Signal: ");
    Serial.print(rssiRaw);
    Serial.print(" (");
    Serial.print(dbm);
    Serial.print(" dBm) - ");
    if (rssiRaw >= 20)
        Serial.println("Excellent");
    else if (rssiRaw >= 15)
        Serial.println("Good");
    else if (rssiRaw >= 10)
        Serial.println("OK");
    else
        Serial.println("Weak");

    return dbm;
}

// Wait until the module has registered on the network (CREG 0,1 or 0,5).
bool waitForNetwork(uint32_t timeout)
{
    Serial.println("Searching for network...");
    uint32_t start = millis();

    while (millis() - start < timeout)
    {
        while (sim800.available())
            sim800.read();
        sim800.println("AT+CREG?");

        String response = "";
        uint32_t t = millis();
        while (millis() - t < 2000)
        {
            while (sim800.available())
                response += (char)sim800.read();
            if (response.indexOf("OK") != -1)
                break;
        }

        if (response.indexOf("+CREG: 0,1") != -1 ||
            response.indexOf("+CREG: 0,5") != -1)
        {
            Serial.println("Network registered.");
            getSignalStrength();
            return true;
        }

        Serial.println("...still searching");
        getSignalStrength();
        delay(2000);
    }

    Serial.println("Network registration TIMED OUT.");
    return false;
}

void setupGPRS()
{
    Serial.println("Configuring GPRS...");
    sendAT("AT+SAPBR=0,1", nullptr, 2000); // Close bearer if open
    sendAT("AT+SAPBR=3,1,\"Contype\",\"GPRS\"", "OK", 2000);
    sendAT("AT+SAPBR=3,1,\"APN\",\"" + String(APN) + "\"", "OK", 2000);
    if (strlen(APN_USER) > 0)
    {
        sendAT("AT+SAPBR=3,1,\"USER\",\"" + String(APN_USER) + "\"", "OK", 2000);
    }
    if (strlen(APN_PWD) > 0)
    {
        sendAT("AT+SAPBR=3,1,\"PWD\",\"" + String(APN_PWD) + "\"", "OK", 2000);
    }
    sendAT("AT+SAPBR=1,1", "OK", 8000); // Open bearer
    sendAT("AT+SAPBR=2,1", "OK", 3000); // Query assigned IP
}

bool isGPRSConnected()
{
    while (sim800.available())
        sim800.read();
    sim800.println("AT+SAPBR=2,1");

    String response = "";
    uint32_t start = millis();
    while (millis() - start < 2000)
    {
        while (sim800.available())
            response += (char)sim800.read();
        if (response.indexOf("OK") != -1)
            break;
    }

    // If it contains "0.0.0.0" (or no IP at all), we are not connected
    if (response.indexOf("0.0.0.0") != -1)
        return false;
    if (response.indexOf("+SAPBR:") == -1)
        return false;
    return true;
}

float readDistanceCM()
{
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);
    long duration = pulseIn(ECHO_PIN, HIGH, 30000);
    return (duration == 0) ? -1 : duration * 0.0343 / 2.0;
}

void printSensorReadings()
{
    Serial.println("--- Sensor Readings ---");

    if (bmpOK)
    {
        Serial.print("BMP280 Temp     : ");
        Serial.print(bmp.readTemperature(), 2);
        Serial.println(" C");

        Serial.print("BMP280 Pressure : ");
        Serial.print(bmp.readPressure() / 100.0, 2);
        Serial.println(" hPa");
    }
    else
    {
        Serial.println("BMP280          : NOT DETECTED");
    }

    float distance = readDistanceCM();
    Serial.print("Ultrasonic Dist : ");
    if (distance < 0)
        Serial.println("out of range / no echo");
    else
    {
        Serial.print(distance, 1);
        Serial.println(" cm");
    }
    Serial.println("-----------------------");
}

// Listen briefly to the Node B Nano and grab the latest pressure value.
// The Nano sends lines like:  P:1013.25\n
// Returns the parsed pressure, or the previous value if nothing arrived.
float readNanoPressure(uint32_t windowMs)
{
    nanoSerial.listen(); // switch the active SoftwareSerial to the Nano
    String line = "";
    float latest = remotePressure; // keep last known if no new data
    uint32_t start = millis();

    while (millis() - start < windowMs)
    {
        while (nanoSerial.available())
        {
            char c = (char)nanoSerial.read();
            if (c == '\n' || c == '\r')
            {
                line.trim();
                int idx = line.indexOf("P:");
                if (idx != -1)
                {
                    latest = line.substring(idx + 2).toFloat();
                }
                line = "";
            }
            else
            {
                line += c;
            }
        }
    }

    sim800.listen(); // hand the radio back to the SIM800L
    return latest;
}

void setup()
{
    Serial.begin(115200);
    sim800.begin(9600);
    nanoSerial.begin(9600);
    sim800.listen(); // SIM is the default active listener
    Wire.begin(D2, D1);

    pinMode(TRIG_PIN, OUTPUT);
    pinMode(ECHO_PIN, INPUT);

    Serial.println("\n--- System Initializing ---");

    // 1. Sensors
    bmpOK = bmp.begin(0x76) || bmp.begin(0x77);
    if (!bmpOK)
    {
        Serial.println("BMP280 sensor not detected!");
    }
    printSensorReadings();

    // 2. Wait for the SIM800L to respond to AT before doing anything else
    Serial.println("Waiting for SIM800L...");
    bool modemReady = false;
    for (int i = 0; i < 10 && !modemReady; i++)
    {
        modemReady = sendAT("AT", "OK", 1000);
        if (!modemReady)
            delay(1000);
    }
    if (!modemReady)
    {
        Serial.println("SIM800L not responding! Check power (needs strong 4V/2A) & wiring.");
    }

    sendAT("ATE0", "OK", 1000);     // turn off command echo for cleaner logs
    sendAT("AT+CPIN?", "OK", 2000); // SIM status
    sendAT("AT+COPS?", "OK", 3000); // current operator

    // 3. Signal + network registration
    getSignalStrength();
    waitForNetwork(60000);

    // 4. GPRS
    setupGPRS();

    Serial.println("--- Init complete ---\n");
}

void loop()
{
    // 1. Show live sensor + signal status each cycle
    printSensorReadings();
    getSignalStrength();

    // 2. Connectivity Check
    if (!isGPRSConnected())
    {
        Serial.println("GPRS not connected, reconnecting...");
        waitForNetwork(60000);
        setupGPRS();
    }

    // 3. Read local sensors for payload
    float pressure = bmpOK ? (bmp.readPressure() / 100.0) : -1;
    float distance = readDistanceCM();

    // 3b. Grab the latest remote pressure from Node A (via the Node B Nano)
    remotePressure = readNanoPressure(2000);
    Serial.print("Remote pressure (Node A): ");
    Serial.println(remotePressure);

    // 4. Prepare JSON
    String payload = "{\"pressure\":" + String(pressure) +
                     ",\"distance\":" + String(distance) +
                     ",\"remote_pressure\":" + String(remotePressure) +
                     ",\"timestamp\":{\".sv\":\"timestamp\"}}";

    Serial.println("Sending to Firebase...");
    sendToFirebase(payload);

    delay(30000); // 30-second interval
}

void sendToFirebase(String data)
{
    sendAT("AT+HTTPTERM", nullptr, 1000); // make sure no stale session is open
    sendAT("AT+HTTPINIT", "OK", 2000);
    sendAT("AT+HTTPSSL=1", "OK", 2000); // REQUIRED: Firebase is HTTPS
    sendAT("AT+HTTPPARA=\"CID\",1", "OK", 2000);
    sendAT("AT+HTTPPARA=\"URL\",\"" + String(FIREBASE_URL) + "\"", "OK", 2000);
    sendAT("AT+HTTPPARA=\"CONTENT\",\"application/json\"", "OK", 2000);

    sendAT("AT+HTTPDATA=" + String(data.length()) + ",10000", "DOWNLOAD", 3000);
    sim800.println(data);
    delay(1000);

    // PUT overwrites current.json (0=GET, 1=POST, 2=HEAD... use POST to append,
    // change to 2 for PUT if your firmware supports it). Keeping POST here.
    while (sim800.available())
        sim800.read();
    Serial.println(">> AT+HTTPACTION=1");
    sim800.println("AT+HTTPACTION=1");

    // Wait for the COMPLETE +HTTPACTION line (HTTPS over 2G can be slow).
    String response = "";
    uint32_t start = millis();
    int httpStatus = -1;
    while (millis() - start < 60000)
    {
        while (sim800.available())
            response += (char)sim800.read();

        int idx = response.indexOf("+HTTPACTION:");
        if (idx != -1)
        {
            // Line format: +HTTPACTION: <method>,<status>,<datalen>
            int nl = response.indexOf('\n', idx);
            if (nl != -1)
            { // full line has arrived
                int firstComma = response.indexOf(',', idx);
                int secondComma = response.indexOf(',', firstComma + 1);
                if (firstComma != -1 && secondComma != -1)
                {
                    httpStatus = response.substring(firstComma + 1, secondComma).toInt();
                }
                break;
            }
        }
    }

    response.trim();
    if (response.length())
        Serial.println(response);

    Serial.print("HTTP status: ");
    Serial.println(httpStatus);

    if (httpStatus == 200 || httpStatus == 204)
    {
        Serial.println(">> Success: Data sent to Firebase!");
    }
    else
    {
        Serial.print(">> Error: send failed (status ");
        Serial.print(httpStatus);
        Serial.println("). See SIM800L HTTP status codes.");
    }

    sendAT("AT+HTTPTERM", "OK", 2000);
}

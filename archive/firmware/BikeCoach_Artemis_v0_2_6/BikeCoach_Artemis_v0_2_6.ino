/*
  Bike Coach Artemis firmware v0.2.6

  Reconstructed from the Bike Coach v0.2.4/v0.2.5 protocol used by the
  current web app. This release adds:
    - BLE advertising immediately on battery-only boot (no Serial wait)
    - VIN/battery reporting through INFO: VBAT=<mV>,BAT=<percent>
    - POWER_OFF command: close log, stop peripherals, enter deep sleep
    - Physical RESET button is the intended wake mechanism
    - Existing legacy six-byte BLE file-transfer framing
    - SD file listing / selected-file transfer

  Target hardware: SparkFun OpenLog Artemis DEV-16832, red V10 board.

  IMPORTANT: This source is intentionally kept in the repo so future firmware
  changes are not dependent on temporary ChatGPT files. Compile and hardware
  test before relying on it for a ride.
*/

#include <ArduinoBLE.h>
#include <SPI.h>
#include <SdFat.h>
#include "ICM_20948.h"
#include "am_mcu_apollo.h"

#define FW_VERSION "0.2.6"

// ---- OpenLog Artemis V10 pins ----
const uint8_t PIN_MICROSD_CHIP_SELECT = 23;
const uint8_t PIN_MICROSD_POWER = 15;
const uint8_t PIN_IMU_POWER = 27;
const uint8_t PIN_PWR_LED = 29;
const uint8_t PIN_QWIIC_POWER = 18;
const uint8_t PIN_VIN_MONITOR = 34;
const uint8_t PIN_IMU_INT = 37;
const uint8_t PIN_IMU_CHIP_SELECT = 44;

// VIN monitor calibration used by SparkFun OLA firmware for the 1M/2M divider.
const float VIN_CORRECTION = 1.47f;
const float LOW_BATTERY_V = 3.40f;

// ---- BLE protocol ----
const char *SERVICE_UUID = "7b7e1000-6f1d-4f35-9f55-42494b45434f";
const char *COMMAND_UUID = "7b7e1001-6f1d-4f35-9f55-42494b45434f";
const char *STATUS_UUID  = "7b7e1002-6f1d-4f35-9f55-42494b45434f";
const char *DATA_UUID    = "7b7e1003-6f1d-4f35-9f55-42494b45434f";

BLEService bikeService(SERVICE_UUID);
BLECharacteristic commandChar(COMMAND_UUID, BLEWrite | BLEWriteWithoutResponse, 128);
BLECharacteristic statusChar(STATUS_UUID, BLERead | BLENotify, 180);
BLECharacteristic dataChar(DATA_UUID, BLENotify, 180);

// ---- SD / IMU ----
SdFat32 sd;
File32 logFile;
ICM_20948_SPI imu;

bool sdReady = false;
bool imuReady = false;
bool logging = false;
bool transferActive = false;
char activeFile[25] = "";
char latestFile[25] = "";
uint32_t lastSampleMs = 0;
uint32_t lastFlushMs = 0;
uint32_t lastBatteryCheckMs = 0;
uint8_t lowBatteryCount = 0;

// Phone sets this before a GPS-enabled ride. We only need enough clock support
// to make valid Artemis CSV timestamps and SD filenames deterministic.
bool epochValid = false;
uint32_t epochAtSet = 0;
uint32_t millisAtSet = 0;

const uint16_t SAMPLE_PERIOD_MS = 20; // ~50 Hz
const uint16_t TRANSFER_PAYLOAD = 174; // 6-byte legacy header + payload <= 180

void sendStatus(const String &s) {
  statusChar.writeValue((const uint8_t *)s.c_str(), s.length());
}

void setPowerLED(bool on) {
  pinMode(PIN_PWR_LED, OUTPUT);
  digitalWrite(PIN_PWR_LED, on ? HIGH : LOW);
}

void imuPower(bool on) {
  pinMode(PIN_IMU_POWER, OUTPUT);
  digitalWrite(PIN_IMU_POWER, on ? HIGH : LOW);
}

void sdPower(bool on) {
  pinMode(PIN_MICROSD_POWER, OUTPUT);
  // V10 OLA uses active-low SD power enable.
  digitalWrite(PIN_MICROSD_POWER, on ? LOW : HIGH);
}

void qwiicPower(bool on) {
  pinMode(PIN_QWIIC_POWER, OUTPUT);
  digitalWrite(PIN_QWIIC_POWER, on ? HIGH : LOW);
}

float readBatteryVoltage() {
  // Apollo3 ADC is 14-bit over a nominal 2.0V full-scale range.
  int raw = analogRead(PIN_VIN_MONITOR);
  float vin = (float)raw * 3.0f * 2.0f / 16384.0f;
  return vin * VIN_CORRECTION;
}

uint8_t batteryPercent(float v) {
  // Practical LiPo resting-voltage approximation. This is intentionally
  // conservative; exact SOC varies with load and cell chemistry.
  if (v <= 3.40f) return 0;
  if (v < 3.60f) return (uint8_t)((v - 3.40f) / 0.20f * 10.0f);
  if (v < 3.70f) return 10 + (uint8_t)((v - 3.60f) / 0.10f * 15.0f);
  if (v < 3.80f) return 25 + (uint8_t)((v - 3.70f) / 0.10f * 25.0f);
  if (v < 3.90f) return 50 + (uint8_t)((v - 3.80f) / 0.10f * 20.0f);
  if (v < 4.00f) return 70 + (uint8_t)((v - 3.90f) / 0.10f * 15.0f);
  if (v < 4.10f) return 85 + (uint8_t)((v - 4.00f) / 0.10f * 10.0f);
  if (v < 4.20f) return 95 + (uint8_t)((v - 4.10f) / 0.10f * 5.0f);
  return 100;
}

void sendInfo() {
  float v = readBatteryVoltage();
  uint16_t mv = (uint16_t)constrain((int)lroundf(v * 1000.0f), 0, 65535);
  uint8_t pct = batteryPercent(v);
  String s = "BIKECOACH,FW=" FW_VERSION ",STATE=";
  s += logging ? "LOGGING" : "IDLE";
  s += ",FILE=";
  s += logging ? activeFile : latestFile;
  s += ",GPS=1,TRANSFER=LEGACY6,VBAT=";
  s += mv;
  s += ",BAT=";
  s += pct;
  sendStatus(s);
}

bool safeRecordingName(const char *name) {
  if (!name || !name[0]) return false;
  size_t n = strlen(name);
  if (n > 24) return false;
  for (size_t i = 0; i < n; i++) {
    char c = name[i];
    if (!(isalnum(c) || c == '_' || c == '-' || c == '.')) return false;
  }
  const char *dot = strrchr(name, '.');
  if (!dot) return false;
  return !strcasecmp(dot, ".CSV") || !strcasecmp(dot, ".TXT") || !strcasecmp(dot, ".BIN");
}

uint32_t boardMillis32() { return (uint32_t)millis(); }

uint32_t currentEpoch() {
  if (!epochValid) return 1767225600UL + boardMillis32() / 1000UL; // 2026-01-01 fallback
  return epochAtSet + (uint32_t)((boardMillis32() - millisAtSet) / 1000UL);
}

// Convert Unix epoch to UTC calendar fields. The phone supplies epoch seconds;
// timezone is irrelevant because the parser only needs monotonic timestamps.
void epochToFields(uint32_t t, int &year, int &month, int &day, int &hour, int &minute, int &second) {
  uint32_t days = t / 86400UL;
  uint32_t rem = t % 86400UL;
  hour = rem / 3600UL;
  rem %= 3600UL;
  minute = rem / 60UL;
  second = rem % 60UL;

  int64_t z = (int64_t)days + 719468;
  int64_t era = (z >= 0 ? z : z - 146096) / 146097;
  unsigned doe = (unsigned)(z - era * 146097);
  unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  int y = (int)yoe + (int)era * 400;
  unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  unsigned mp = (5 * doy + 2) / 153;
  day = (int)(doy - (153 * mp + 2) / 5 + 1);
  month = (int)(mp + (mp < 10 ? 3 : -9));
  year = y + (month <= 2);
}

void timestampStrings(char *dateOut, size_t dateLen, char *timeOut, size_t timeLen) {
  int y, mo, d, h, mi, s;
  epochToFields(currentEpoch(), y, mo, d, h, mi, s);
  snprintf(dateOut, dateLen, "%d/%d/%04d", mo, d, y);
  snprintf(timeOut, timeLen, "%02d:%02d:%02d.%03lu", h, mi, s, (unsigned long)(boardMillis32() % 1000UL));
}

bool beginIMU() {
  SPI.begin();
  SPI.beginTransaction(SPISettings(4000000, MSBFIRST, SPI_MODE0));
  SPI.transfer(0x00);
  SPI.endTransaction();

  pinMode(PIN_IMU_CHIP_SELECT, OUTPUT);
  digitalWrite(PIN_IMU_CHIP_SELECT, HIGH);
  pinMode(PIN_IMU_INT, INPUT_PULLUP);

  imuPower(false);
  delay(10);
  imuPower(true);
  delay(100);

  for (int attempt = 0; attempt < 5; attempt++) {
    imu.begin(PIN_IMU_CHIP_SELECT, SPI, 4000000);
    if (imu.status == ICM_20948_Stat_Ok) {
      imu.swReset();
      delay(250);
      imu.sleep(false);
      imu.lowPower(false);
      imu.setSampleMode((ICM_20948_Internal_Acc | ICM_20948_Internal_Gyr), ICM_20948_Sample_Mode_Continuous);
      ICM_20948_fss_t fss;
      fss.a = gpm16;       // MTB impacts: avoid the old +/-2g clipping
      fss.g = dps2000;
      imu.setFullScale((ICM_20948_Internal_Acc | ICM_20948_Internal_Gyr), fss);
      return true;
    }
    imuPower(false);
    delay(20);
    imuPower(true);
    delay(100);
  }
  return false;
}

bool beginSD() {
  sdPower(true);
  delay(100);
  return sd.begin(SdSpiConfig(PIN_MICROSD_CHIP_SELECT, SHARED_SPI, SD_SCK_MHZ(24)));
}

void findNextFile(char *out, size_t outLen) {
  for (uint16_t i = 0; i < 10000; i++) {
    snprintf(out, outLen, "ride%04u.CSV", i);
    if (!sd.exists(out)) return;
  }
  snprintf(out, outLen, "ride9999.CSV");
}

void writeHeader(const char *rideId) {
  if (rideId && strlen(rideId) == 16) {
    logFile.print("# BikeCoachRide={\"id\":\"");
    logFile.print(rideId);
    logFile.print("\",\"startBoardMs\":");
    logFile.print(boardMillis32());
    logFile.println("}");
  }
  logFile.println("rtcDate,rtcTime,aX,aY,aZ,gX,gY,gZ,mX,mY,mZ,imu_degC,output_Hz");
}

bool startRide(const char *rideId) {
  if (logging || transferActive || !sdReady || !imuReady) return false;
  findNextFile(activeFile, sizeof(activeFile));
  if (!logFile.open(activeFile, O_WRONLY | O_CREAT | O_EXCL)) return false;
  writeHeader(rideId);
  logFile.sync();
  logging = true;
  lastSampleMs = boardMillis32();
  lastFlushMs = lastSampleMs;
  sendStatus(String("LOGGING,") + activeFile);
  return true;
}

void stopRide(bool notify = true) {
  if (!logging) {
    if (notify) sendStatus("IDLE");
    return;
  }
  logFile.sync();
  logFile.close();
  strncpy(latestFile, activeFile, sizeof(latestFile));
  latestFile[sizeof(latestFile) - 1] = 0;
  logging = false;
  if (notify) sendStatus(String("SAVED,") + latestFile);
}

void sampleIMU() {
  if (!logging || !imuReady) return;
  uint32_t now = boardMillis32();
  if ((uint32_t)(now - lastSampleMs) < SAMPLE_PERIOD_MS) return;
  lastSampleMs += SAMPLE_PERIOD_MS;

  if (!imu.dataReady()) return;
  imu.getAGMT();
  char dateBuf[16], timeBuf[20];
  timestampStrings(dateBuf, sizeof(dateBuf), timeBuf, sizeof(timeBuf));
  logFile.print(dateBuf); logFile.print(',');
  logFile.print(timeBuf); logFile.print(',');
  logFile.print(imu.accX(), 3); logFile.print(',');
  logFile.print(imu.accY(), 3); logFile.print(',');
  logFile.print(imu.accZ(), 3); logFile.print(',');
  logFile.print(imu.gyrX(), 3); logFile.print(',');
  logFile.print(imu.gyrY(), 3); logFile.print(',');
  logFile.print(imu.gyrZ(), 3); logFile.print(',');
  logFile.print(imu.magX(), 3); logFile.print(',');
  logFile.print(imu.magY(), 3); logFile.print(',');
  logFile.print(imu.magZ(), 3); logFile.print(',');
  logFile.print(imu.temp(), 2); logFile.print(',');
  logFile.println(50.0, 1);

  if ((uint32_t)(now - lastFlushMs) >= 1000) {
    logFile.sync();
    lastFlushMs = now;
  }
}

uint16_t countRecordings() {
  if (!sdReady) return 0;
  File32 root;
  if (!root.open("/")) return 0;
  uint16_t count = 0;
  File32 entry;
  char name[64];
  while (entry.openNext(&root, O_RDONLY)) {
    if (!entry.isDir()) {
      entry.getName(name, sizeof(name));
      if (safeRecordingName(name)) count++;
    }
    entry.close();
  }
  root.close();
  return count;
}

bool recordingAtIndex(uint16_t wanted, char *nameOut, size_t nameLen, uint32_t &sizeOut) {
  File32 root;
  if (!root.open("/")) return false;
  uint16_t index = 0;
  File32 entry;
  char name[64];
  bool found = false;
  while (entry.openNext(&root, O_RDONLY)) {
    if (!entry.isDir()) {
      entry.getName(name, sizeof(name));
      if (safeRecordingName(name)) {
        if (index == wanted) {
          strncpy(nameOut, name, nameLen);
          nameOut[nameLen - 1] = 0;
          sizeOut = (uint32_t)entry.fileSize();
          found = true;
          entry.close();
          break;
        }
        index++;
      }
    }
    entry.close();
  }
  root.close();
  return found;
}

void listFile(uint16_t index) {
  if (logging || transferActive) { sendStatus("ERR,BUSY"); return; }
  uint16_t total = countRecordings();
  if (index >= total) {
    sendStatus(String("FILES_END,") + total);
    return;
  }
  char name[25];
  uint32_t size = 0;
  if (!recordingAtIndex(index, name, sizeof(name), size)) { sendStatus("ERR,FILE_LIST"); return; }
  String s = "FILE,";
  s += index; s += ','; s += total; s += ','; s += name; s += ','; s += size;
  sendStatus(s);
}

void sendLegacyFile(const char *name) {
  if (logging || transferActive) { sendStatus("ERR,BUSY"); return; }
  if (!safeRecordingName(name) || !sd.exists(name)) { sendStatus("ERR,FILE"); return; }

  File32 f;
  if (!f.open(name, O_RDONLY)) { sendStatus("ERR,OPEN"); return; }
  uint32_t size = (uint32_t)f.fileSize();
  transferActive = true;
  sendStatus(String("FILE_BEGIN,") + name + "," + size);
  delay(30);

  uint8_t packet[180];
  uint16_t seq = 0;
  uint32_t offset = 0;
  while (offset < size) {
    BLE.poll();
    uint16_t want = (uint16_t)min((uint32_t)TRANSFER_PAYLOAD, size - offset);
    int got = f.read(packet + 6, want);
    if (got <= 0) break;
    packet[0] = (uint8_t)(seq & 0xff);
    packet[1] = (uint8_t)(seq >> 8);
    packet[2] = (uint8_t)(offset & 0xff);
    packet[3] = (uint8_t)((offset >> 8) & 0xff);
    packet[4] = (uint8_t)((offset >> 16) & 0xff);
    packet[5] = (uint8_t)((offset >> 24) & 0xff);
    dataChar.writeValue(packet, got + 6);
    offset += got;
    seq++;
    delay(8);
  }
  f.close();

  if (offset == size) sendStatus(String("FILE_END,") + name + "," + size + ",CHUNKS=" + seq);
  else sendStatus("ERR,TRANSFER");
  transferActive = false;
}

void powerDownUntilReset() {
  stopRide(false);
  sendStatus("POWERING_OFF");
  delay(250); // let the phone receive confirmation

  BLE.stopAdvertise();
  BLE.end();

  if (logFile) { logFile.sync(); logFile.close(); }
  delay(100); // critical: let SD finish writes

  imuPower(false);
  qwiicPower(false);
  sdPower(false);
  setPowerLED(false);
  SPI.end();
  powerControlADC(false);

  // Match SparkFun's OLA deep-sleep approach. We deliberately do not configure
  // a wake interrupt: the physical RESET button is the wake mechanism.
  am_hal_pwrctrl_periph_disable(AM_HAL_PWRCTRL_PERIPH_IOM0);
  am_hal_pwrctrl_periph_disable(AM_HAL_PWRCTRL_PERIPH_IOM1);
  am_hal_pwrctrl_periph_disable(AM_HAL_PWRCTRL_PERIPH_IOM2);
  am_hal_pwrctrl_periph_disable(AM_HAL_PWRCTRL_PERIPH_IOM3);
  am_hal_pwrctrl_periph_disable(AM_HAL_PWRCTRL_PERIPH_IOM4);
  am_hal_pwrctrl_periph_disable(AM_HAL_PWRCTRL_PERIPH_IOM5);
  am_hal_pwrctrl_periph_disable(AM_HAL_PWRCTRL_PERIPH_ADC);
  am_hal_pwrctrl_periph_disable(AM_HAL_PWRCTRL_PERIPH_UART0);
  am_hal_pwrctrl_periph_disable(AM_HAL_PWRCTRL_PERIPH_UART1);

  am_hal_pwrctrl_memory_deepsleep_powerdown(AM_HAL_PWRCTRL_MEM_ALL);
  am_hal_pwrctrl_memory_deepsleep_retain(AM_HAL_PWRCTRL_MEM_SRAM_384K);
  am_hal_stimer_config(AM_HAL_STIMER_CFG_CLEAR | AM_HAL_STIMER_CFG_FREEZE);
  am_hal_stimer_config(AM_HAL_STIMER_XTAL_32KHZ);

  while (1) am_hal_sysctrl_sleep(AM_HAL_SYSCTRL_SLEEP_DEEP);
}

void handleCommand(String cmd) {
  cmd.trim();
  if (!cmd.length()) return;

  if (cmd == "INFO") { sendInfo(); return; }
  if (cmd == "GET_CLOCK") { sendStatus(String("CLOCK,") + boardMillis32()); return; }

  if (cmd.startsWith("SET_TIME,")) {
    uint32_t value = (uint32_t)strtoul(cmd.c_str() + 9, nullptr, 10);
    if (value < 1577836800UL) { sendStatus("ERR,TIME"); return; }
    epochAtSet = value;
    millisAtSet = boardMillis32();
    epochValid = true;
    sendStatus("TIME_SET");
    return;
  }

  if (cmd == "START_RIDE" || cmd.startsWith("START_RIDE,")) {
    const char *rideId = nullptr;
    if (cmd.length() > 11) rideId = cmd.c_str() + 11;
    if (!startRide(rideId)) sendStatus("ERR,START");
    return;
  }

  if (cmd == "STOP_RIDE") { stopRide(true); return; }

  if (cmd == "GET_LATEST" || cmd.startsWith("GET_LATEST,")) {
    if (!latestFile[0]) {
      // Find the last recording in deterministic root order.
      uint16_t total = countRecordings();
      uint32_t size = 0;
      if (!total || !recordingAtIndex(total - 1, latestFile, sizeof(latestFile), size)) {
        sendStatus("ERR,NO_FILE"); return;
      }
    }
    sendLegacyFile(latestFile);
    return;
  }

  if (cmd.startsWith("LIST_FILES,")) {
    uint16_t index = (uint16_t)strtoul(cmd.c_str() + 11, nullptr, 10);
    listFile(index);
    return;
  }

  if (cmd.startsWith("GET_FILE,")) {
    String rest = cmd.substring(9);
    int comma = rest.indexOf(',');
    if (comma >= 0) rest = rest.substring(0, comma); // ignore newer packet-limit args
    sendLegacyFile(rest.c_str());
    return;
  }

  if (cmd == "CANCEL_TRANSFER") {
    // Legacy v0.2.x transfer is synchronous. This is retained for protocol
    // compatibility; a disconnect will abort the BLE link immediately.
    sendStatus("CANCELLED");
    return;
  }

  if (cmd == "POWER_OFF") {
    if (transferActive) { sendStatus("ERR,BUSY"); return; }
    powerDownUntilReset();
    return;
  }

  sendStatus("ERR,UNKNOWN");
}

void checkBatteryProtection() {
  uint32_t now = boardMillis32();
  if ((uint32_t)(now - lastBatteryCheckMs) < 5000) return;
  lastBatteryCheckMs = now;
  float v = readBatteryVoltage();
  if (v < LOW_BATTERY_V) {
    if (++lowBatteryCount >= 6) {
      sendStatus("LOW_BATTERY,POWERING_OFF");
      delay(100);
      powerDownUntilReset();
    }
  } else {
    lowBatteryCount = 0;
  }
}

void setup() {
  // Do not wait for USB Serial. Battery-only boot must reach BLE advertising.
  setPowerLED(true);
  qwiicPower(false);
  analogReadResolution(14);

  sdReady = beginSD();
  imuReady = beginIMU();

  if (!BLE.begin()) {
    // Remain alive; RESET gives another attempt. Do not block on Serial/USB.
    while (1) delay(1000);
  }

  BLE.setLocalName("BikeCoach");
  BLE.setDeviceName("BikeCoach");
  BLE.setAdvertisedService(bikeService);
  bikeService.addCharacteristic(commandChar);
  bikeService.addCharacteristic(statusChar);
  bikeService.addCharacteristic(dataChar);
  BLE.addService(bikeService);
  statusChar.writeValue("BOOTING");
  BLE.advertise();

  sendInfo();
}

void loop() {
  BLE.poll();

  if (commandChar.written()) {
    int n = commandChar.valueLength();
    if (n > 0 && n < 128) {
      char buf[129];
      commandChar.readValue((uint8_t *)buf, n);
      buf[n] = 0;
      handleCommand(String(buf));
    }
  }

  sampleIMU();
  checkBatteryProtection();
}

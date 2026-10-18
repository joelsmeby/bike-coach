/* Bike Coach firmware v0.2.11 for SparkFun OpenLog Artemis (red v1.0 / DEV-16832)
   Purpose: built-in ICM-20948 -> microSD CSV at 250 Hz + BLE control/status.
   Required libraries: SparkFun ICM-20948 IMU, SdFat by Bill Greiman, ArduinoBLE.
   Board: SparkFun Apollo3 > RedBoard Artemis ATP.
*/
#include <SPI.h>
#include <SdFat.h>
#include "ICM_20948.h"
#include <ArduinoBLE.h>
#include "RTC.h"

// OpenLog Artemis v1.0 hardware pins (from SparkFun OLA 2.11 source)
const uint8_t PIN_SD_CS = 23;
const uint8_t PIN_SD_POWER = 15;
const uint8_t PIN_IMU_POWER = 27;
const uint8_t PIN_IMU_CS = 44;
const uint8_t PIN_STAT_LED = 19;
const uint8_t PIN_VIN_MONITOR = 34;

SdFat sd;
File logFile;
ICM_20948_SPI imu;

const size_t MAX_RECORDING_NAME = 64;
char logName[MAX_RECORDING_NAME + 1] = "";
bool logging = false;
uint32_t nextSampleUs = 0;
uint32_t lastSampleUs = 0;
const uint32_t SAMPLE_PERIOD_US = 4000; // 250 Hz

BLEService bikeService("7b7e1000-6f1d-4f35-9f55-42494b45434f");
BLEStringCharacteristic commandChar("7b7e1001-6f1d-4f35-9f55-42494b45434f", BLEWrite | BLEWriteWithoutResponse, 40);
BLEStringCharacteristic statusChar("7b7e1002-6f1d-4f35-9f55-42494b45434f", BLERead | BLENotify, 180);
BLECharacteristic fileChar("7b7e1003-6f1d-4f35-9f55-42494b45434f", BLERead | BLENotify, 180);
BLEStringCharacteristic powerChar("7b7e1004-6f1d-4f35-9f55-42494b45434f", BLERead, 20);
uint32_t lastPowerMs = 0;

void updatePower() {
  // SparkFun OLA's shared VIN measurement: pin 34, 14-bit ADC, VIN/3
  // divider, 2 V ADC reference, and their empirical 1.47 correction factor.
  // https://github.com/sparkfun/OpenLog_Artemis/blob/main/Firmware/Test%20Sketches/GNSS_Data_Logging/GNSS_Data_Logging.ino
  uint32_t sum = 0;
  for (uint8_t i = 0; i < 8; i++) sum += analogRead(PIN_VIN_MONITOR);
  float mv = (sum / 8.0f) * (3.0f * 2.0f * 1.47f * 1000.0f / 16384.0f);
  powerChar.writeValue(String("POWER,") + (unsigned long)(mv + 0.5f));
  lastPowerMs = millis();
}

bool transferActive = false;
File transferFile;
char transferName[MAX_RECORDING_NAME + 1] = "";
uint32_t transferSize = 0;
uint32_t transferSent = 0;
uint32_t transferSeq = 0; // header wraps at 16 bits; final CHUNKS retains full count
uint32_t transferLastMs = 0;
uint16_t transferChunkData = 174;
bool transferReady = false;
String stagedCommand = "";
uint32_t stagedAt = 0;

void status(const String &s) {
  Serial.println(s);
  if (BLE.connected()) statusChar.writeValue(s);
}

bool chooseNextFile() {
  for (uint32_t n = 0; n < 100000; n++) {
    snprintf(logName, sizeof(logName), "dataLog%05lu.TXT", (unsigned long)n);
    if (!sd.exists(logName)) return true;
  }
  return false;
}

void writeHeader() {
  logFile.println("rtcDate,rtcTime,aX,aY,aZ,gX,gY,gZ,mX,mY,mZ,imu_degC,output_Hz,");
  logFile.flush();
}

bool startRide() {
  if (transferActive) { status("ERR,TRANSFER_ACTIVE"); return false; }
  if (logging) return true;
  if (!chooseNextFile()) { status("ERR,NO_FILENAME"); return false; }
  logFile = sd.open(logName, O_WRONLY | O_CREAT | O_EXCL);
  if (!logFile) { status("ERR,OPEN_FILE"); return false; }
  writeHeader();
  logging = true;
  nextSampleUs = micros();
  lastSampleUs = 0;
  digitalWrite(PIN_STAT_LED, HIGH);
  status(String("LOGGING,") + logName);
  return true;
}

void stopRide() {
  if (!logging) { status("IDLE"); return; }
  logFile.flush();
  logFile.close();
  logging = false;
  digitalWrite(PIN_STAT_LED, LOW);
  status(String("SAVED,") + logName);
}

void print2(File &f, int v) { if (v < 10) f.print('0'); f.print(v); }

void sampleIMU() {
  if (!logging || !imu.dataReady()) return;
  uint32_t now = micros();
  if ((int32_t)(now - nextSampleUs) < 0) return;
  nextSampleUs += SAMPLE_PERIOD_US;
  if ((int32_t)(now - nextSampleUs) > (int32_t)SAMPLE_PERIOD_US) nextSampleUs = now + SAMPLE_PERIOD_US;

  imu.getAGMT();
  rtc.getTime();

  // Match the CSV shape already used by the Bike Coach analyzer.
  print2(logFile, rtc.month); logFile.print('/');
  print2(logFile, rtc.dayOfMonth); logFile.print('/');
  logFile.print(2000 + rtc.year); logFile.print(',');
  print2(logFile, rtc.hour); logFile.print(':');
  print2(logFile, rtc.minute); logFile.print(':');
  print2(logFile, rtc.seconds); logFile.print('.');
  print2(logFile, rtc.hundredths); logFile.print(',');

  logFile.print(imu.accX(), 2); logFile.print(',');
  logFile.print(imu.accY(), 2); logFile.print(',');
  logFile.print(imu.accZ(), 2); logFile.print(',');
  logFile.print(imu.gyrX(), 2); logFile.print(',');
  logFile.print(imu.gyrY(), 2); logFile.print(',');
  logFile.print(imu.gyrZ(), 2); logFile.print(',');
  logFile.print(imu.magX(), 2); logFile.print(',');
  logFile.print(imu.magY(), 2); logFile.print(',');
  logFile.print(imu.magZ(), 2); logFile.print(',');
  logFile.print(imu.temp(), 2); logFile.print(',');

  float hz = 0.0f;
  if (lastSampleUs != 0 && now != lastSampleUs) hz = 1000000.0f / (float)(now - lastSampleUs);
  lastSampleUs = now;
  logFile.print(hz, 1); logFile.println(',');

  static uint16_t sinceFlush = 0;
  if (++sinceFlush >= 250) { logFile.flush(); sinceFlush = 0; } // about once/sec
}


bool isRecordingName(const char *name) {
  size_t length = strlen(name);
  if (length < 5 || length > MAX_RECORDING_NAME || !isalnum((unsigned char)name[0])) return false;
  for (size_t i = 0; i < length; i++) {
    char c = name[i];
    if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
          (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.')) return false;
  }
  const char *ext = strrchr(name, '.');
  if (!ext || strlen(ext) != 4) return false;
  char a = toupper(ext[1]), b = toupper(ext[2]), c = toupper(ext[3]);
  return (a == 'B' && b == 'I' && c == 'N') ||
         (a == 'T' && b == 'X' && c == 'T') ||
         (a == 'C' && b == 'S' && c == 'V');
}

void listFileAt(uint16_t target) {
  if (logging) { status("ERR,STOP_RIDE_FIRST"); return; }
  File dir = sd.open("/", O_RDONLY);
  if (!dir) { status("ERR,OPEN_ROOT"); return; }
  File entry;
  uint16_t total = 0;
  char chosen[MAX_RECORDING_NAME + 1] = "";
  uint32_t chosenSize = 0;
  while (entry.openNext(&dir, O_RDONLY)) {
    char name[MAX_RECORDING_NAME + 2] = "";
    entry.getName(name, sizeof(name));
    if (!entry.isDir() && isRecordingName(name)) {
      if (total == target) { strncpy(chosen, name, sizeof(chosen) - 1); chosenSize = entry.size(); }
      if (total < 10000) total++;
    }
    entry.close();
  }
  dir.close();
  if (target < total && chosen[0]) status(String("FILE,") + target + "," + total + "," + chosen + "," + chosenSize);
  else if (target == total) status(String("FILES_END,") + total);
  else status("ERR,FILE_INDEX");
}

void stopTransfer(const char *msg) {
  if (transferFile) transferFile.close();
  transferActive = false;
  if (msg) status(msg);
}

bool beginFileTransfer(const char *name, uint16_t packetLimit) {
  if (logging) { status("ERR,STOP_RIDE_FIRST"); return false; }
  if (packetLimit != 20 && packetLimit != 180) { status("ERR,PACKET_SIZE"); return false; }
  if (!isRecordingName(name) || !sd.exists(name)) { status("ERR,NO_FILE"); return false; }
  if (transferActive) stopTransfer(NULL);
  transferFile = sd.open(name, O_RDONLY);
  if (!transferFile) { status("ERR,OPEN_FILE"); return false; }
  strncpy(transferName, name, sizeof(transferName) - 1); transferName[sizeof(transferName) - 1] = '\0';
  transferSize = transferFile.size();
  transferChunkData = packetLimit - 6;
  transferReady = false;
  transferSent = 0; transferSeq = 0; transferLastMs = 0; transferActive = true;
  status(String("FILE_BEGIN,") + transferName + "," + String(transferSize));
  return true;
}

bool beginLatestTransfer(uint16_t packetLimit) {
  if (!logName[0] || !sd.exists(logName)) { status("ERR,NO_LATEST_FILE"); return false; }
  return beginFileTransfer(logName, packetLimit);
}

void renameRecording(const char *oldName, const char *newName) {
  if (logging) { status("ERR,STOP_RIDE_FIRST"); return; }
  if (transferActive) { status("ERR,TRANSFER_ACTIVE"); return; }
  if (!isRecordingName(oldName) || !isRecordingName(newName)) { status("ERR,FILE_NAME"); return; }
  for (uint8_t i = 0; i < 4; i++) {
    if (toupper(oldName[strlen(oldName)-4+i]) != toupper(newName[strlen(newName)-4+i])) {
      status("ERR,KEEP_EXTENSION"); return;
    }
  }
  File source = sd.open(oldName, O_RDONLY);
  if (!source || source.isDir()) { source.close(); status("ERR,NO_FILE"); return; }
  source.close(); // SdFat requires all source handles closed before rename.
  if (strcmp(oldName, newName) == 0) { status(String("RENAMED,") + oldName + "," + newName); return; }
  if (sd.exists(newName)) { status("ERR,NAME_EXISTS"); return; }
  if (!sd.rename(oldName, newName)) { status("ERR,RENAME_FAILED"); return; }
  if (strcmp(logName, oldName) == 0) {
    strncpy(logName, newName, sizeof(logName)-1); logName[sizeof(logName)-1] = '\0';
  }
  status(String("RENAMED,") + oldName + "," + newName);
}

void serviceFileTransfer() {
  if (!transferActive || !transferReady || !BLE.connected()) return;
  // Conservative pacing for the first transfer test. This avoids overrunning
  // the Apollo3 BLE notification queue while still moving a small test log quickly.
  if (millis() - transferLastMs < 15) return;
  transferLastMs = millis();
  uint8_t packet[180];
  int n = transferFile.read(packet + 6, transferChunkData);
  if (n < 0) { stopTransfer("ERR,FILE_READ"); return; }
  if (n == 0) {
    transferFile.close(); transferActive = false;
    status(String("FILE_END,") + transferName + "," + String(transferSize) + ",CHUNKS=" + String(transferSeq));
    return;
  }
  // Header: little-endian sequence number + little-endian byte offset.
  packet[0] = (uint8_t)(transferSeq & 0xFF);
  packet[1] = (uint8_t)(transferSeq >> 8);
  packet[2] = (uint8_t)(transferSent & 0xFF);
  packet[3] = (uint8_t)((transferSent >> 8) & 0xFF);
  packet[4] = (uint8_t)((transferSent >> 16) & 0xFF);
  packet[5] = (uint8_t)((transferSent >> 24) & 0xFF);
  if (!fileChar.writeValue(packet, n + 6)) { stopTransfer("ERR,BLE_WRITE"); return; }
  transferSent += n; transferSeq++;
}

void handleBLE() {
  BLE.poll();
  if (!commandChar.written()) return;
  String raw = commandChar.value(); raw.trim();
  String cmd = raw; cmd.toUpperCase();
  // Each staging write is <=20 bytes and acknowledged before the next one.
  // This avoids relying on long-write or notification MTU negotiation.
  if (cmd == "CMD_CLEAR") { stagedCommand = ""; stagedAt = millis(); status("CMD_READY"); return; }
  if (cmd.startsWith("CMD_ADD,")) {
    if (millis() - stagedAt > 10000 || stagedCommand.length() + raw.length() - 8 > 160) {
      stagedCommand = ""; status("ERR,COMMAND_SIZE"); return;
    }
    stagedCommand += raw.substring(8); stagedAt = millis(); status("CMD_READY"); return;
  }
  if (cmd == "CMD_RUN") {
    if (!stagedCommand.length() || millis() - stagedAt > 10000) { stagedCommand = ""; status("ERR,COMMAND_EXPIRED"); return; }
    raw = stagedCommand; stagedCommand = ""; cmd = raw; cmd.toUpperCase();
  }
  if (cmd == "PING") status("PONG");
  else if (cmd == "INFO") status(String("BIKECOACH,FW=0.2.11,TRANSFER=LEGACY6,FILES=1,STATE=") + (logging ? "LOGGING" : "IDLE") + ",FILE=" + logName);
  else if (cmd == "START_RIDE") startRide();
  else if (cmd == "STOP_RIDE") stopRide();
  else if (cmd == "GET_LATEST" || cmd.startsWith("GET_LATEST,")) {
    if (cmd == "GET_LATEST") beginLatestTransfer(180);
    else if (cmd == "GET_LATEST,20") beginLatestTransfer(20);
    else if (cmd == "GET_LATEST,180") beginLatestTransfer(180);
    else status("ERR,PACKET_SIZE");
  }
  else if (cmd == "FILE_READY") { if (transferActive) transferReady = true; else status("ERR,NO_TRANSFER"); }
  else if (cmd.startsWith("LIST_FILES,")) {
    String number = cmd.substring(11);
    if (!number.length() || number.length() > 5 || number.indexOf(',') >= 0) status("ERR,FILE_INDEX");
    else { bool valid = true; for (unsigned int i = 0; i < number.length(); i++) if (!isDigit(number[i])) valid = false;
      if (valid && number.toInt() <= 10000) listFileAt((uint16_t)number.toInt()); else status("ERR,FILE_INDEX"); }
  }
  else if (cmd.startsWith("GET_FILE,")) {
    String name = raw.substring(9); int comma = name.indexOf(','); uint16_t limit = 180;
    if (comma >= 0) {
      String size = name.substring(comma+1); name = name.substring(0, comma);
      if (size == "20") limit = 20; else if (size != "180") { status("ERR,PACKET_SIZE"); return; }
    }
    if (isRecordingName(name.c_str())) beginFileTransfer(name.c_str(), limit); else status("ERR,FILE_NAME");
  }
  else if (cmd.startsWith("RENAME_FILE,")) {
    String names = raw.substring(12); int comma = names.indexOf(',');
    if (comma < 1 || names.indexOf(',', comma+1) >= 0) status("ERR,FILE_NAME");
    else renameRecording(names.substring(0, comma).c_str(), names.substring(comma+1).c_str());
  }
  else if (cmd == "CANCEL_TRANSFER") stopTransfer("TRANSFER_CANCELLED");
  else status("ERR,UNKNOWN_COMMAND");
}

void setup() {
  Serial.begin(115200);
  delay(500);
  analogReadResolution(14);
  pinMode(PIN_STAT_LED, OUTPUT); digitalWrite(PIN_STAT_LED, LOW);
  pinMode(PIN_SD_POWER, OUTPUT); digitalWrite(PIN_SD_POWER, LOW); // SD power ON on OLA v1.0

  // Match SparkFun OLA 2.11 built-in IMU initialization: explicitly configure
  // Apollo3 GPIOs, deselect the IMU, then power-cycle it before SPI begin.
  pinMode(PIN_IMU_POWER, OUTPUT);
  pin_config(PinName(PIN_IMU_POWER), g_AM_HAL_GPIO_OUTPUT);
  pinMode(PIN_IMU_CS, OUTPUT);
  pin_config(PinName(PIN_IMU_CS), g_AM_HAL_GPIO_OUTPUT);
  digitalWrite(PIN_IMU_CS, HIGH);
  digitalWrite(PIN_IMU_POWER, LOW);
  delay(10);
  digitalWrite(PIN_IMU_POWER, HIGH);
  delay(25);

  pinMode(PIN_SD_CS, OUTPUT); digitalWrite(PIN_SD_CS, HIGH);
  SPI.begin();
  if (!sd.begin(SdSpiConfig(PIN_SD_CS, SHARED_SPI, SD_SCK_MHZ(24)))) {
    Serial.println("FATAL,SD_INIT");
    while (1) delay(1000);
  }

  // SparkFun OLA 2.11 does this immediately after beginSD(). The built-in
  // ICM-20948 shares the SPI bus with the microSD card and requires the CIPO
  // (MISO) line to be pulled high before the IMU identity read.
  const uint8_t PIN_SPI_CIPO = 6;
  am_hal_gpio_pincfg_t cipoPinCfg = g_AM_BSP_GPIO_IOM0_MISO;
  cipoPinCfg.ePullup = AM_HAL_GPIO_PIN_PULLUP_1_5K;
  pin_config(PinName(PIN_SPI_CIPO), cipoPinCfg);

  imu.begin(PIN_IMU_CS, SPI, 4000000);
  if (imu.status != ICM_20948_Stat_Ok) {
    // SparkFun's stock firmware retries after a longer power-cycle delay.
    Serial.print("WARN,IMU_INIT_RETRY,"); Serial.println(imu.statusString());
    digitalWrite(PIN_IMU_POWER, LOW);
    delay(10);
    digitalWrite(PIN_IMU_POWER, HIGH);
    delay(100);
    imu.begin(PIN_IMU_CS, SPI, 4000000);
  }
  if (imu.status != ICM_20948_Stat_Ok) {
    Serial.print("FATAL,IMU_INIT,"); Serial.println(imu.statusString());
    while (1) delay(1000);
  }
  // Stock OLA performs the full non-DMP startup after begin().
  ICM_20948_Status_e imuStartup = imu.startupDefault(false);
  if (imuStartup != ICM_20948_Stat_Ok) {
    Serial.println("FATAL,IMU_STARTUP_DEFAULT");
    while (1) delay(1000);
  }

  // startupDefault resets the ranges to +/-2 g and +/-250 dps.
  // Apply ride settings afterwards, and fail visibly if configuration fails.
  ICM_20948_fss_t rideRange = {};
  rideRange.a = gpm16;
  rideRange.g = dps2000;
  if (imu.setFullScale(ICM_20948_Internal_Acc | ICM_20948_Internal_Gyr, rideRange) != ICM_20948_Stat_Ok) {
    Serial.println("FATAL,IMU_FULL_SCALE");
    while (1) delay(1000);
  }
  // Continuous mode and default unfiltered sensor output are faster than
  // the 250 Hz logging schedule; each logged row waits for dataReady().

  if (!BLE.begin()) {
    Serial.println("FATAL,BLE_INIT");
    while (1) delay(1000);
  }
  BLE.setLocalName("BikeCoach");
  BLE.setDeviceName("BikeCoach");
  BLE.setAdvertisedService(bikeService);
  bikeService.addCharacteristic(commandChar);
  bikeService.addCharacteristic(statusChar);
  bikeService.addCharacteristic(fileChar);
  bikeService.addCharacteristic(powerChar);
  BLE.addService(bikeService);
  updatePower();
  statusChar.writeValue("READY");
  BLE.advertise();

  Serial.println("READY,BikeCoach v0.2.11");
  Serial.println("BLE commands: INFO, START_RIDE, STOP_RIDE, LIST_FILES, GET_FILE, GET_LATEST, FILE_READY, RENAME_FILE, CMD_CLEAR, CMD_ADD, CMD_RUN, CANCEL_TRANSFER");
  // Power on idle. Only an explicit START_RIDE command opens a recording.
  status("IDLE");
}

void loop() {
  handleBLE();
  if (!BLE.connected()) { stagedCommand = ""; if (transferActive) stopTransfer(NULL); }
  sampleIMU();
  serviceFileTransfer();
  if (!transferActive && millis() - lastPowerMs >= 10000) updatePower();
}


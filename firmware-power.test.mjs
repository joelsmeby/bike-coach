// Run real startup/shutdown/power-policy functions against controllable hardware
// doubles. This exercises failure paths; it does not measure physical sleep current.
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const source=await readFile(new URL('./firmware/OpenLog_Artemis_BikeCoach/OpenLog_Artemis_BikeCoach.ino',import.meta.url),'utf8');
function extract(signature){const start=source.indexOf(signature+' {');if(start<0)throw Error(signature);let body=source.indexOf('{',start),n=1,end=body+1;for(;n;end++){if(source[end]==='{')n++;if(source[end]==='}')n--;}return source.slice(start,end);}
const functions=['void stopRide()','void powerDownUntilReset(bool lowBattery)','void checkBatteryProtection()','void sendInfo()','bool beginBluetooth()','void initializeStorageAndIMU()','void setup()','void loop()'];
const cpp=String.raw`
#include <string>
#include <vector>
#include <cstdint>
#include <cassert>
#include <cmath>
#include <iostream>
#include <algorithm>
using std::string;
std::vector<string> calls;
class String {public:string s;String(const char*p=""):s(p){} String(unsigned long n):s(std::to_string(n)){} friend String operator+(String a,const String&b){a.s+=b.s;return a;}};
`+source.slice(source.indexOf('const uint8_t PIN_SD_CS'),source.indexOf('SdFat sd;'))+String.raw`
uint32_t clockMs=0,lastPowerMs=0;uint32_t millis(){return clockMs;}
void delay(unsigned n){clockMs+=n;}
struct Sleep{};
struct {void begin(int){calls.push_back("serial");}void end(){calls.push_back("serialOff");}void println(const char*){}} Serial;
const int OUTPUT=1,HIGH=1,LOW=0;
int pins[50]={};
void pinMode(int,int){}void digitalWrite(int p,int v){pins[p]=v;}
void analogReadResolution(int){}int desiredMv=3800;
int analogRead(int){return std::lround(desiredMv*16384.0/8820);}
int PinName(int p){return p;}
struct am_hal_gpio_pincfg_t {int ePullup=0;};
am_hal_gpio_pincfg_t g_AM_HAL_GPIO_OUTPUT,g_AM_BSP_GPIO_IOM0_MISO;
const int AM_HAL_GPIO_PIN_PULLUP_1_5K=1,g_AM_HAL_GPIO_DISABLE=0;
void pin_config(int,am_hal_gpio_pincfg_t){}void am_hal_gpio_pinconfig(int,int){}
struct {void begin(){}void end(){calls.push_back("spiOff");}} SPI;
int SdSpiConfig(int,int,int){return 0;}const int SHARED_SPI=0;int SD_SCK_MHZ(int x){return x;}
struct {bool succeeds=true;int tries=0;bool begin(int){tries++;calls.push_back("sdBegin");return succeeds;}} sd;
struct {bool syncOK=true,closeOK=true;bool sync(){calls.push_back("sync");return syncOK;}bool close(){calls.push_back("close");return closeOK;}} logFile;
bool logging=false,transferActive=false;String stagedCommand;const char*logName="ride.TXT";
const int ICM_20948_Stat_Ok=0,gpm16=16,dps2000=2000,ICM_20948_Internal_Acc=1,ICM_20948_Internal_Gyr=2;
struct ICM_20948_fss_t{int a,g;};
struct {int status=0,tries=0,startup=0,range=0;void begin(int,decltype(SPI)&,int){tries++;}int startupDefault(bool){return startup;}int setFullScale(int,ICM_20948_fss_t r){assert(r.a==16&&r.g==2000);return range;}} imu;
struct Characteristic {string value;void writeValue(const char*s){value=s;}void writeValue(String s){value=s.s;}} statusChar,commandChar,fileChar,powerChar;
struct {void addCharacteristic(Characteristic&){}} bikeService;
struct {bool succeeds=true,advertising=false;int tries=0;bool begin(){tries++;calls.push_back("bleBegin");return succeeds;}void end(){advertising=false;calls.push_back("bleOff");}void stopAdvertise(){advertising=false;}void setLocalName(const char*){}void setDeviceName(const char*){}void setAdvertisedService(decltype(bikeService)&){}void addService(decltype(bikeService)&){}void advertise(){advertising=true;calls.push_back("advertise");}void poll(){}bool connected(){return true;}} BLE;
string lastStatus;void status(const String&s){lastStatus=s.s;if(bleReady)statusChar.writeValue(s);}
void stopTransfer(const char*){transferActive=false;calls.push_back("cancelTransfer");}
void powerControlADC(bool){calls.push_back("adcOff");}
struct {uint32_t CTRL=1;} systick;auto SysTick=&systick;
struct {uint32_t ICER[8]={},ICPR[8]={};} nvic;auto NVIC=&nvic;
void __disable_irq(){}
const int AM_HAL_PWRCTRL_PERIPH_IOM0=0,AM_HAL_PWRCTRL_PERIPH_IOM1=1,AM_HAL_PWRCTRL_PERIPH_IOM2=2,AM_HAL_PWRCTRL_PERIPH_IOM3=3,AM_HAL_PWRCTRL_PERIPH_IOM4=4,AM_HAL_PWRCTRL_PERIPH_IOM5=5,AM_HAL_PWRCTRL_PERIPH_ADC=6,AM_HAL_PWRCTRL_PERIPH_UART0=7,AM_HAL_PWRCTRL_PERIPH_UART1=8,AM_HAL_PWRCTRL_MEM_ALL=0,AM_HAL_PWRCTRL_MEM_SRAM_384K=1,AM_HAL_STIMER_CFG_CLEAR=1,AM_HAL_STIMER_CFG_FREEZE=2,AM_HAL_STIMER_XTAL_32KHZ=4,AM_HAL_SYSCTRL_SLEEP_DEEP=1;
void am_hal_pwrctrl_periph_disable(int){}void am_hal_pwrctrl_memory_deepsleep_powerdown(int){}void am_hal_pwrctrl_memory_deepsleep_retain(int){}void am_hal_stimer_config(int){}
void am_hal_sysctrl_sleep(int){calls.push_back("sleep");throw Sleep{};}
void handleBLE(){}void sampleIMU(){}void serviceFileTransfer(){}
`+extract('void updatePower()')+'\n'+functions.map(extract).join('\n')+String.raw`
void reset(){calls.clear();clockMs=0;lastPowerMs=0;sdReady=imuReady=bleReady=false;startupFault="BOOTING";supplyMv=lowBatteryCount=0;logging=transferActive=false;sd.succeeds=BLE.succeeds=true;sd.tries=imu.tries=BLE.tries=0;imu.status=imu.startup=imu.range=0;desiredMv=3800;logFile.syncOK=logFile.closeOK=true;BLE.advertising=false;}
void tick(int mv){desiredMv=mv;clockMs+=POWER_INTERVAL_MS;checkBatteryProtection();}
size_t at(string s){return std::find(calls.begin(),calls.end(),s)-calls.begin();}
int main(){
 reset();setup();assert(BLE.advertising&&sdReady&&imuReady&&!logging);assert(at("advertise")<at("sdBegin"));assert(pins[PIN_PWR_LED]==HIGH);assert(lastStatus.find("STATE=IDLE")!=string::npos);
 reset();sd.succeeds=false;setup();assert(BLE.advertising&&!sdReady&&imuReady&&sd.tries==2);assert(lastStatus.find("FAULT=SD_INIT")!=string::npos);
 reset();imu.status=1;setup();assert(BLE.advertising&&sdReady&&!imuReady&&imu.tries==2);assert(lastStatus.find("FAULT=IMU_INIT")!=string::npos);
 reset();imu.startup=1;setup();assert(BLE.advertising&&!imuReady&&imu.tries==2);assert(lastStatus.find("FAULT=IMU_STARTUP")!=string::npos);
 reset();imu.range=1;setup();assert(BLE.advertising&&!imuReady&&imu.tries==2);assert(lastStatus.find("FAULT=IMU_RANGE")!=string::npos);
 reset();BLE.succeeds=false;setup();assert(!bleReady&&sdReady&&imuReady);BLE.succeeds=true;clockMs+=5000;loop();assert(bleReady&&BLE.advertising&&BLE.tries==2);
 reset();setup();logging=true;transferActive=true;calls.clear();try{powerDownUntilReset(true);assert(false);}catch(Sleep&){}assert(!logging&&!transferActive&&!bleReady);assert(at("sync")<at("close")&&at("close")<at("bleOff")&&at("bleOff")<at("spiOff")&&at("spiOff")<at("sleep"));assert(pins[PIN_SD_POWER]==HIGH&&pins[PIN_IMU_POWER]==LOW&&pins[PIN_QWIIC_POWER]==LOW);
 reset();setup();logging=true;logFile.syncOK=false;calls.clear();powerDownUntilReset(false);assert(logging&&bleReady&&BLE.advertising&&at("sleep")==calls.size());assert(lastStatus=="ERR,SD_SYNC");
 reset();setup();logging=true;logFile.closeOK=false;calls.clear();powerDownUntilReset(false);assert(logging&&bleReady&&lastStatus=="ERR,SD_CLOSE");
 reset();setup();tick(3300);tick(3300);assert(lowBatteryCount==2);tick(3800);assert(lowBatteryCount==0);tick(3300);tick(5000);assert(lowBatteryCount==0);tick(0);assert(lowBatteryCount==0);
 tick(3300);tick(3300);logging=true;transferActive=true;try{tick(3300);assert(false);}catch(Sleep&){}assert(!logging&&!transferActive&&lastStatus=="LOW_BATTERY,POWERING_OFF");
 // New hardware RESET re-enters startup, restoring rails and advertising idle.
 reset();setup();assert(BLE.advertising&&pins[PIN_SD_POWER]==LOW&&pins[PIN_IMU_POWER]==HIGH&&!logging);
 std::cout<<"PASS: real startup faults/retries, BLE recovery, idle boot, shutdown ordering/save failures, rail control, battery debounce/USB/invalid readings and reset startup.\n";
}
`;
const dir=await mkdtemp(join(tmpdir(),'bikecoach-power-test-'));
await writeFile(join(dir,'power.cpp'),cpp);
execFileSync(process.env.CXX||'g++',['-std=c++14','-Wall','-Wextra',join(dir,'power.cpp'),'-o',join(dir,'power')],{stdio:'pipe'});
process.stdout.write(execFileSync(join(dir,'power')));

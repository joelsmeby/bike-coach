// Exercise the actual sketch's rename policy and BLE command handler on a host.
// This is not an Apollo3 compile: storage, Arduino String and BLE are test doubles.
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const source=await readFile(new URL('./firmware/OpenLog_Artemis_BikeCoach/OpenLog_Artemis_BikeCoach.ino',import.meta.url),'utf8');
function extract(signature){const start=source.indexOf(signature);if(start<0)throw Error('Missing '+signature);const body=source.indexOf('{',start);let n=1,end=body+1;for(;n&&end<source.length;end++){if(source[end]==='{')n++;if(source[end]==='}')n--;}return source.slice(start,end);}
const harness=String.raw`
#include <string>
#include <map>
#include <algorithm>
#include <cctype>
#include <cstring>
#include <cstdint>
#include <cassert>
#include <iostream>
class String {
 public: std::string s;
 String(const char* p=""):s(p){} String(std::string p):s(p){}
 unsigned int length()const{return s.size();} const char* c_str()const{return s.c_str();}
 void trim(){auto a=s.find_first_not_of(" \r\n\t");if(a==std::string::npos)s="";else s=s.substr(a,s.find_last_not_of(" \r\n\t")-a+1);}
 void toUpperCase(){for(auto& c:s)c=std::toupper((unsigned char)c);}
 bool startsWith(const char* p)const{return s.rfind(p,0)==0;}
 int indexOf(char c,int from=0)const{auto p=s.find(c,from);return p==std::string::npos?-1:(int)p;}
 String substring(int from)const{return s.substr(from);} String substring(int from,int to)const{return s.substr(from,to-from);}
 long toInt()const{try{return std::stol(s);}catch(...){return 0;}}
 char operator[](unsigned int i)const{return s[i];}
 String& operator+=(const String& other){s+=other.s;return *this;}
 friend String operator+(String a,const String& b){a.s+=b.s;return a;}
 friend bool operator==(const String& a,const char* b){return a.s==b;}
 friend bool operator!=(const String& a,const char* b){return a.s!=b;}
};
bool isDigit(char c){return c>='0'&&c<='9';}
uint32_t clockMs=100;uint32_t millis(){return clockMs;}
std::string lastStatus;void status(const String& s){lastStatus=s.s;}
struct File {bool valid=false,dir=false;operator bool()const{return valid;}bool isDir(){return dir;}void close(){valid=false;}};
struct Storage {
 std::map<std::string,bool> files;int renames=0;
 static std::string lower(std::string x){for(auto& c:x)c=std::tolower((unsigned char)c);return x;}
 auto find(const char* p){return std::find_if(files.begin(),files.end(),[&](auto& x){return lower(x.first)==lower(p);});}
 File open(const char* p,int){auto i=find(p);return {i!=files.end(),i!=files.end()&&i->second};}
 bool exists(const char* p){return find(p)!=files.end();}
 bool rename(const char* a,const char* b){auto i=find(a);if(i==files.end()||exists(b))return false;bool dir=i->second;files.erase(i);files[b]=dir;renames++;return true;}
} sd;
const int O_RDONLY=0;const size_t MAX_RECORDING_NAME=64;
char logName[65]="dataLog00042.TXT";bool logging=false,transferActive=false,transferReady=false;
String stagedCommand;uint32_t stagedAt=0;
struct {bool ready=false;String raw;bool written(){bool r=ready;ready=false;return r;}String value(){return raw;}} commandChar;
struct {void poll(){}} BLE;
int requestedLimit=0;std::string requestedFile;
void startRide(){} void stopRide(){} void listFileAt(uint16_t){}
void stopTransfer(const char*){transferActive=false;}
bool beginLatestTransfer(uint16_t limit){requestedLimit=limit;return true;}
bool beginFileTransfer(const char* name,uint16_t limit){requestedFile=name;requestedLimit=limit;return true;}
`+extract('bool isRecordingName(')+'\n'+extract('void renameRecording(')+'\n'+extract('void handleBLE()')+String.raw`
void send(std::string cmd){commandChar.raw=cmd;commandChar.ready=true;handleBLE();}
int main(){
 sd.files["dataLog00042.TXT"]=false;sd.files["Existing.TXT"]=false;sd.files["Folder.TXT"]=true;
 renameRecording("dataLog00042.TXT","Existing.TXT");assert(lastStatus=="ERR,NAME_EXISTS"&&sd.renames==0);
 renameRecording("dataLog00042.TXT","Trail.CSV");assert(lastStatus=="ERR,KEEP_EXTENSION");
 renameRecording("dataLog00042.TXT","../Trail.TXT");assert(lastStatus=="ERR,FILE_NAME");
 renameRecording("Folder.TXT","Trail.TXT");assert(lastStatus=="ERR,NO_FILE");
 logging=true;renameRecording("dataLog00042.TXT","Trail.TXT");assert(lastStatus=="ERR,STOP_RIDE_FIRST");logging=false;
 transferActive=true;renameRecording("dataLog00042.TXT","Trail.TXT");assert(lastStatus=="ERR,TRANSFER_ACTIVE");transferActive=false;
 const std::string name=std::string(60,'A')+".TXT";
 const std::string cmd="RENAME_FILE,dataLog00042.TXT,"+name;
 send("CMD_CLEAR");for(size_t i=0;i<cmd.size();i+=12){send("CMD_ADD,"+cmd.substr(i,12));assert(lastStatus=="CMD_READY");}
 send("CMD_RUN");assert(lastStatus=="RENAMED,dataLog00042.TXT,"+name);assert(sd.renames==1&&sd.exists(name.c_str()));assert(std::string(logName)==name);
 send("CMD_RUN");assert(lastStatus=="ERR,COMMAND_EXPIRED"&&sd.renames==1);
 send("CMD_CLEAR");for(int i=0;i<14;i++)send("CMD_ADD,xxxxxxxxxxxx");assert(lastStatus=="ERR,COMMAND_SIZE");send("CMD_RUN");assert(lastStatus=="ERR,COMMAND_EXPIRED");
 send("CMD_CLEAR");send("CMD_ADD,GET_LATEST,20");clockMs+=10001;send("CMD_RUN");assert(lastStatus=="ERR,COMMAND_EXPIRED");
 send("GET_LATEST,20");assert(requestedLimit==20);send("GET_LATEST,19");assert(lastStatus=="ERR,PACKET_SIZE");
 send("CMD_CLEAR");std::string get="GET_FILE,"+name+",20";for(size_t i=0;i<get.size();i+=12)send("CMD_ADD,"+get.substr(i,12));send("CMD_RUN");assert(requestedFile==name&&requestedLimit==20);
 transferActive=true;send("FILE_READY");assert(transferReady);
 std::cout<<"PASS: actual firmware rename guards, filename bounds, latest-file tracking, staged commands, overflow/expiry, packet size and transfer-ready handling.\n";
}
`;
const dir=await mkdtemp(join(tmpdir(),'bikecoach-firmware-test-'));
await writeFile(join(dir,'commands.cpp'),harness);
execFileSync('g++',['-std=c++14','-Wall','-Wextra',join(dir,'commands.cpp'),'-o',join(dir,'commands')],{stdio:'pipe'});
process.stdout.write(execFileSync(join(dir,'commands')));

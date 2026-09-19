import {validCalibration,hasLevelReference,usesDeviceAxes,DEVICE_AXES_VERSION} from './calibration.mjs?v=9';

export const PROFILE_FORMAT='BikeCoachProfiles2';
const cleanName=name=>String(name||'').trim().replace(/\s+/g,' ').slice(0,40);

export function validProfile(profile){
 return !!profile&&typeof profile.id==='string'&&profile.id.length>0&&cleanName(profile.name)===profile.name&&
  profile.deviceAxesVersion===DEVICE_AXES_VERSION&&Number.isFinite(profile.mountPitch)&&Number.isFinite(profile.mountRoll)&&hasLevelReference(profile.calibration)&&usesDeviceAxes(profile.calibration)&&
  typeof profile.createdAt==='string'&&typeof profile.updatedAt==='string';
}

export function createProfile({id,name,calibration,mountPitch,mountRoll,createdAt=new Date().toISOString(),updatedAt=createdAt}){
 const profile={id:String(id||''),name:cleanName(name),deviceAxesVersion:DEVICE_AXES_VERSION,mountPitch:Number(mountPitch),mountRoll:Number(mountRoll),createdAt,updatedAt,calibration:structuredClone(calibration)};
 if(!validProfile(profile))throw Error('The bike profile is incomplete.');
 return profile;
}

export function updateProfile(existing,{name=existing.name,calibration=existing.calibration,mountPitch=existing.mountPitch,mountRoll=existing.mountRoll,updatedAt=new Date().toISOString()}={}){
 return createProfile({id:existing.id,name,calibration,mountPitch,mountRoll,createdAt:existing.createdAt,updatedAt});
}

export function exportProfiles(profiles){
 if(!Array.isArray(profiles)||!profiles.every(validProfile))throw Error('Bike profiles could not be exported.');
 return JSON.stringify({format:PROFILE_FORMAT,exportedAt:new Date().toISOString(),profiles},null,2);
}

export function importProfiles(text){
 let data;try{data=JSON.parse(text);}catch{throw Error('That file is not valid JSON.');}
 if(data?.format!==PROFILE_FORMAT||!Array.isArray(data.profiles)||!data.profiles.length||!data.profiles.every(validProfile))throw Error('That file does not contain valid Bike Coach profiles.');
 const unique=new Map(data.profiles.map(profile=>[profile.id,structuredClone(profile)]));
 return [...unique.values()];
}

// Association is explicit: capture a copy when START_RIDE is confirmed.
// A disconnect invalidates the in-flight association, because firmware reuses
// filenames after resets and exposes no persistent ride or boot ID.
export class RideWorkflow {
  constructor(){this.calibration=null;this.pending=null;}
  setCalibration(c){this.calibration=c?structuredClone(c):null;}
  start(name){if(!this.calibration)throw Error('Calibrate before starting a ride.');this.pending={name,calibration:structuredClone(this.calibration),stopped:false};}
  stop(name){if(this.pending?.name===name)this.pending.stopped=true;else this.pending=null;}
  forFile(name){return this.pending?.stopped&&this.pending.name===name?structuredClone(this.pending.calibration):null;}
  completed(name){if(this.pending?.name===name)this.pending=null;}
  disconnected(){this.pending=null;this.calibration=null;}
}

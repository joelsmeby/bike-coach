// No live IMU stream: this guides acquisition; validation happens after download.
export class GuidedStart {
  constructor({send,waitStatus,show,now=()=>Date.now()}){Object.assign(this,{send,waitStatus,show,now});this.token=0;this.active=false;}
  cancel(){this.token++;this.active=false;}
  async start(){
    const token=++this.token;this.active=true;this.deadline=null;
    const command=async(text,prefix)=>{
      const status=this.waitStatus(prefix);
      // Observe rejection even when send fails before the status wait is awaited.
      status.catch(()=>{});
      await this.send(text);await status;
      if(token!==this.token)throw Error('Calibration interrupted. Start again.');
    };
    try{
      this.show('Hold the bike upright and still on level ground. Starting a fresh recording…');
      await command('STOP_RIDE',['SAVED,','IDLE']);
      await command('START_RIDE','LOGGING,');
      this.deadline=this.now()+6000;this.tick();
    }catch(e){if(token===this.token)this.cancel();throw e;}
  }
  tick(){if(!this.active||this.deadline===null)return;const remaining=Math.ceil((this.deadline-this.now())/1000);
    if(remaining>0)this.show(`Hold still — ${remaining} seconds. Keep the bike upright on level ground.`);
    else{this.active=false;this.show('You can ride now. Calibration will be checked when you download the recording.');}
  }
}

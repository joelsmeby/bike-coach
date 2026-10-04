document.getElementById('exportRide').onclick=async()=>{
 const current=window.bikeCoachExport?.();if(!current?.csv)return;
 const name=(current.name||'BikeCoach-ride').replace(/\.[^.]+$/,'')+'.csv',blob=new Blob([current.csv],{type:'text/csv'}),status=document.getElementById('exportStatus');
 try{const file=new File([blob],name,{type:'text/csv'});if(navigator.share&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'Bike Coach ride'});status.textContent='If you chose Save to Files, your ride is saved there.';return;}}
 catch(e){if(e.name==='AbortError'){status.textContent='Save cancelled. Your downloaded ride remains in this browser.';return;}}
 const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);status.textContent='Sent to browser downloads. Includes recorded GPS and bike calibration.';
};

"""Small generated cases for Node/browser versus desktop-runtime contract tests."""
import json
import sys
import tempfile
from dataclasses import asdict
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

from bike_workbench.analysis import Settings, analyze, load_ride
from bike_workbench.shared_engine import call
from test_analysis import write_csv
from test_gps import metadata
from test_gyro import ride, GyroTests


def csv_for(r):
    start = datetime(2000, 1, 1)
    lines = ['rtcDate,rtcTime,aX,aY,aZ,gX,gY,gZ,mX,mY,mZ,imu_degC,output_Hz,']
    for t, a, g in zip(r.time, r.accel, r.gyro):
        stamp = start + timedelta(seconds=float(t))
        values = [stamp.strftime('%m/%d/%Y'), stamp.strftime('%H:%M:%S.%f'), *[format(float(x*1000), '.17g') for x in a], *[format(float(x), '.17g') for x in g], '0','0','0','20','50','']
        lines.append(','.join(values))
    return '\n'.join(lines)


def cases():
    result = []
    for hz in (50, 250):
        result.append((f'quiet-{hz}', csv_for(ride(hz)), {}))
    result += [('rough', csv_for(ride(quiet=False)), {}), ('gyro-join', csv_for(GyroTests().split_flight()), {'merge_gap_s': .1}), ('acceleration-only', csv_for(GyroTests().split_flight()), {'merge_gap_s': .1, 'gyro_detection': 'off'})]
    r = ride(); r.gyro[62, 0] = 250
    result.append(('clipping', csv_for(r), {}))
    r = ride(); r.time[r.time >= .8] += .5
    result.append(('recording-gap', csv_for(r), {}))
    r = ride(); r.calibration = {'forward':[1,0,0],'left':[0,1,0],'up':[0,0,1],'bias':[0,2,0]}
    result.append(('pitch', '# BikeCoachCalibration='+json.dumps(r.calibration)+'\n'+csv_for(r), {'gyro_channel':'pitch'}))
    for f in ('raw','mean','butterworth'):
        result.append((f, csv_for(ride()), {'filter': f}))
    result.append(('threshold', csv_for(ride()), {'mode':'threshold'}))
    result.append(('uniform-override', csv_for(ride()), {'uniform_hz':250}))
    for kind, step in [('dense',.1),('sparse',1),('missing-speed',.1),('sync',.1),('segment',.1)]:
        meta,gps = metadata(step)
        if kind == 'missing-speed':
            for p in gps['points']: p['speed'] = None
        if kind == 'sync': gps['sync']['uncertaintyMs']=1000
        if kind == 'segment':
            for p in gps['points']:
                if p['timestamp'] >= gps['sync']['phoneEpochMs']+1400:p['segment']=1
        result.append(('gps-'+kind, '# BikeCoachRide='+json.dumps(meta)+'\n# BikeCoachGPS='+json.dumps(gps)+'\n'+csv_for(ride()), {}))
    with tempfile.TemporaryDirectory() as d:
        path=Path(d)/'quantized.csv';write_csv(path,count=1001,hz=250,rounded=True)
        result.append(('quantized-rtc',path.read_text(),{}))
    return result


def main():
    output=[]
    with tempfile.TemporaryDirectory() as d:
        for name, csv, values in cases():
            path=Path(d)/'fixture.csv';path.write_text(csv)
            r=load_ride(path);settings=Settings(**values);out=analyze(r,settings)
            output.append({'name':name,'csv':csv,'settings':asdict(settings),
                           'expected':{'events':out['events'],'filtered':out['filtered'].tolist(),
                                       'gyro_vibration':[float(x) if np.isfinite(x) else None for x in out['gyro_vibration']],
                                       'gyro_rates':out['gyro_rates'].tolist(),'time':out['time'].tolist(),'sample_hz':out['sample_hz'],'gap_count':out['gap_count']}})
    print(json.dumps({'metadata':call('metadata'),'python_defaults':asdict(Settings()),'cases':output},allow_nan=False))

if __name__=='__main__':main()

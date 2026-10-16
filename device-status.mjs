// Notifications may contain only MTU-3 bytes. Read the stored characteristic
// before interpreting status, even if a shortened numeric field looks valid.
export async function completeStatusReply(notification, readValue) {
  const full = new TextDecoder().decode(await readValue()).replace(/\0+$/, '');
  if (!full || !full.startsWith(notification.replace(/\0+$/, ''))) {
    throw Error(`Board status changed before it could be read: ${full || '(empty)'}`);
  }
  return full;
}

export function powerDescription(reply) {
  const match = /^POWER,(\d+)$/.exec(reply);
  const mv = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(mv) || mv < 2500 || mv > 6500) return 'Battery: voltage unavailable';
  const volts = `${(mv / 1000).toFixed(2)} V`;
  // OLA measures the shared VIN rail, so USB power masks the battery voltage.
  if (mv > 4350) return `External power: ${volts} · battery % unavailable`;
  const curve = [[3300,0],[3500,5],[3600,10],[3700,20],[3750,35],[3800,50],
    [3850,60],[3900,70],[4000,80],[4100,90],[4200,100]];
  let percent = mv <= curve[0][0] ? 0 : 100;
  for (let i = 1; i < curve.length; i++) {
    if (mv <= curve[i][0]) {
      const [low, p] = curve[i-1], [high, q] = curve[i];
      percent = p + (q-p) * (mv-low) / (high-low);
      break;
    }
  }
  return `Battery: ~${Math.round(percent)}% · ${volts} (voltage estimate)`;
}

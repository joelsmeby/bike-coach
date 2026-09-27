// Candidate flight detection from the low specific force measured by an IMU.
// A single IMU cannot establish ground speed or a reliable jump trajectory.
const magnitude = row => Math.hypot(Number(row.aX), Number(row.aY), Number(row.aZ));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function analyzeJumps(rows, {calibrated = false, lowG = 0.45, minFlight = 0.12, maxFlight = 3} = {}) {
  if (!Array.isArray(rows) || rows.length < 3) return [];
  const flights = [];
  let start = -1;
  function finish(end) {
    if (start < 1 || end >= rows.length - 1) return;
    const duration = rows[end].ts - rows[start].ts;
    if (duration < minFlight || duration > maxFlight) return;
    // Integrate measured angular velocity only within the flight interval.
    const rotation = {roll: 0, pitch: 0, yaw: 0};
    const rotationTravel = {roll: 0, pitch: 0, yaw: 0};
    const axes = calibrated ? ['rollRate', 'pitchRate', 'yawRate'] : ['gX', 'gY', 'gZ'];
    let valid = true;
    for (let i = start + 1; i <= end; i++) {
      const dt = rows[i].ts - rows[i - 1].ts;
      if (!(dt > 0 && dt <= 0.12)) { valid = false; break; }
      for (const [index, key] of ['roll', 'pitch', 'yaw'].entries()) {
        const axis = axes[index];
        const a = Number(rows[i - 1][axis]), b = Number(rows[i][axis]);
        if (!Number.isFinite(a) || !Number.isFinite(b)) { valid = false; break; }
        rotation[key] += (a + b) * dt / 2;
        rotationTravel[key] += (Math.abs(a) + Math.abs(b)) * dt / 2;
      }
      if (!valid) break;
    }
    if (!valid) return;
    const trough = Math.min(...rows.slice(start, end + 1).map(magnitude)) / 1000;
    const impact = Math.max(...rows.slice(end + 1, Math.min(rows.length, end + 12)).map(magnitude)) / 1000;
    flights.push({start: rows[start].ts - rows[0].ts, end: rows[end].ts - rows[0].ts,
      duration, minG: trough, landingG: impact, rotation, rotationTravel,
      confidence: trough < 0.25 && impact > 1.5 ? 'strong candidate' : 'review candidate'});
  }
  for (let i = 0; i < rows.length; i++) {
    const low = Number.isFinite(magnitude(rows[i])) && magnitude(rows[i]) < clamp(lowG, 0.1, 0.8) * 1000;
    const continuous = i === 0 || (rows[i].ts > rows[i - 1].ts && rows[i].ts - rows[i - 1].ts <= 0.12);
    if (!continuous && start >= 0) { finish(i - 1); start = -1; }
    if (low && start < 0) start = i;
    if (!low && start >= 0) { finish(i - 1); start = -1; }
  }
  return flights;
}

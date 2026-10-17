export function includeZero(low, high) { return [Math.min(0, low), Math.max(0, high)]; }
export function tickDecimals(step) {
  for (let digits=0; digits<6; digits++) {
    const scaled=step*10**digits;
    if(Math.abs(scaled-Math.round(scaled))<1e-7)return digits;
  }
  return 6;
}

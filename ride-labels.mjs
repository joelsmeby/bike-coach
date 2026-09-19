export const MOVEMENT_LABELS = [
  ["stationary", "Stationary"],
  ["normal_riding", "Normal riding"],
  ["acceleration", "Acceleration"],
  ["braking", "Braking"],
  ["accel_brake", "Acceleration / braking (combined)"],
  ["turn_left", "Left turn"],
  ["turn_right", "Right turn"],
  ["turns_slalom", "Turning / slalom (combined)"],
  ["walk_bike", "Walking the bike"],
  ["rough_impact", "Rough surface / impact"],
  ["unknown", "Unknown / unsure"]
];

export function cleanRideLabels(segments, duration = Infinity) {
  const valid = new Set(MOVEMENT_LABELS.map(([value]) => value));
  return (segments || []).map(segment => ({
    label: valid.has(segment.label) ? segment.label : "unknown",
    start: Math.max(0, Number(segment.start)),
    end: Math.min(duration, Number(segment.end))
  })).filter(segment => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start)
    .sort((a, b) => a.start - b.start);
}

export function compareRideLabels(predicted, truth, duration) {
  let compared = 0, correct = 0;
  const mismatches = {};
  for (let second = 0.5; second < duration; second += 1) {
    const expected = truth.find(segment => second >= segment.start && second < segment.end)?.label;
    const actual = predicted.find(segment => second >= segment.start && second < segment.end)?.label;
    if (!expected || !actual) continue;
    compared += 1;
    if (expected === actual) correct += 1;
    else {
      const key = `${expected}->${actual}`;
      mismatches[key] = (mismatches[key] || 0) + 1;
    }
  }
  return { comparedSeconds: compared, correctSeconds: correct, accuracy: compared ? correct / compared : null, mismatches };
}

export function labelFile(sourceFile, duration, segments) {
  return {
    schemaVersion: 1,
    sourceFile,
    durationSeconds: duration,
    createdAt: new Date().toISOString(),
    labelSource: "Rider correction in Bike Coach analyzer",
    segments: cleanRideLabels(segments, duration).map(({ label, start, end }) => ({ label, startSeconds: start, endSeconds: end }))
  };
}

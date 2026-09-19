const LABELS = ["stationary", "normal_riding", "accel_brake", "turns_slalom", "walk_bike"];

const mean = values => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const rms = values => Math.sqrt(mean(values.map(value => value * value)));
const stdev = values => {
  const average = mean(values);
  return Math.sqrt(mean(values.map(value => (value - average) ** 2)));
};
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0;
};
const differences = values => values.slice(1).map((value, index) => value - values[index]);
const crossingRate = values => {
  const average = mean(values);
  let crossings = 0;
  for (let index = 1; index < values.length; index += 1) {
    if ((values[index - 1] - average) * (values[index] - average) < 0) crossings += 1;
  }
  return crossings / Math.max(1, values.length - 1);
};

export const FEATURE_NAMES = [
  "accelMagnitudeSd", "accelMagnitudeRange", "accelJerkRms",
  "gyroMagnitudeMean", "gyroMagnitudeSd", "gyroMagnitudeP90", "gyroJerkRms",
  "accelAxisSdHigh", "accelAxisSdMid", "accelAxisSdLow",
  "gyroAxisSdHigh", "gyroAxisSdMid", "gyroAxisSdLow", "gyroCrossingRate"
];

export function extractActivityFeatures(rows) {
  if (!Array.isArray(rows) || rows.length < 5) throw new Error("An activity window needs at least five samples.");
  const accelAxes = ["aX", "aY", "aZ"].map(key => rows.map(row => Number(row[key])));
  const gyroAxes = ["gX", "gY", "gZ"].map(key => rows.map(row => Number(row[key])));
  const accelMagnitude = rows.map(row => Math.hypot(row.aX, row.aY, row.aZ));
  const gyroMagnitude = rows.map(row => Math.hypot(row.gX, row.gY, row.gZ));
  const accelAxisSd = accelAxes.map(stdev).sort((a, b) => b - a);
  const gyroAxisSd = gyroAxes.map(stdev).sort((a, b) => b - a);
  const dominantGyro = gyroAxes[gyroAxes.map(stdev).indexOf(Math.max(...gyroAxes.map(stdev)))];
  return [
    stdev(accelMagnitude), Math.max(...accelMagnitude) - Math.min(...accelMagnitude), rms(differences(accelMagnitude)),
    mean(gyroMagnitude), stdev(gyroMagnitude), percentile(gyroMagnitude, 0.9), rms(differences(gyroMagnitude)),
    ...accelAxisSd, ...gyroAxisSd, crossingRate(dominantGyro)
  ];
}

function normalizedDistance(a, b, scale) {
  return Math.sqrt(mean(a.map((value, index) => ((value - b[index]) / scale[index]) ** 2)));
}

export function classifyActivityFeatures(features, model) {
  if (!model || model.schemaVersion !== 1) throw new Error("Unsupported activity model.");
  const nearest = model.examples
    .map(example => ({ label: example.label, distance: normalizedDistance(features, example.features, model.featureScale) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.min(model.neighbors, model.examples.length));
  const votes = new Map();
  for (const item of nearest) votes.set(item.label, (votes.get(item.label) || 0) + 1 / Math.max(item.distance, 0.001));
  const ranked = [...votes].map(([label, vote]) => ({ label, vote })).sort((a, b) => b.vote - a.vote);
  const total = ranked.reduce((sum, item) => sum + item.vote, 0);
  return { label: ranked[0].label, confidence: ranked[0].vote / total, neighbors: nearest };
}

export function classifyActivityWindow(rows, model) {
  return classifyActivityFeatures(extractActivityFeatures(rows), model);
}

export function activityLabel(label) {
  return ({ stationary: "Stationary", normal_riding: "Normal riding", accel_brake: "Acceleration / braking", turns_slalom: "Turning / slalom", walk_bike: "Walking the bike" })[label] || label;
}

export { LABELS as ACTIVITY_LABELS };

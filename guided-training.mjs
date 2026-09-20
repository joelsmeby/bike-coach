export const GUIDED_PROTOCOL_ID = "bike-movement-3min-v1";

export const GUIDED_PROTOCOL = [
  { startSeconds: 0, endSeconds: 15, label: "stationary", instruction: "Remain completely still" },
  { startSeconds: 15, endSeconds: 20, label: "acceleration", instruction: "Accelerate smoothly" },
  { startSeconds: 20, endSeconds: 35, label: "normal_riding", instruction: "Ride straight at a steady pace" },
  { startSeconds: 35, endSeconds: 40, label: "acceleration", instruction: "Accelerate smoothly again" },
  { startSeconds: 40, endSeconds: 50, label: "normal_riding", instruction: "Maintain a steady pace" },
  { startSeconds: 50, endSeconds: 55, label: "braking", instruction: "Brake smoothly to a stop" },
  { startSeconds: 55, endSeconds: 65, label: "stationary", instruction: "Remain stopped" },
  { startSeconds: 65, endSeconds: 70, label: "acceleration", instruction: "Accelerate smoothly" },
  { startSeconds: 70, endSeconds: 85, label: "normal_riding", instruction: "Ride straight at a steady pace" },
  { startSeconds: 85, endSeconds: 105, label: "turns_slalom", instruction: "Make gentle alternating turns" },
  { startSeconds: 105, endSeconds: 120, label: "normal_riding", instruction: "Ride straight at a steady pace" },
  { startSeconds: 120, endSeconds: 125, label: "braking", instruction: "Brake smoothly to a stop" },
  { startSeconds: 125, endSeconds: 135, label: "exclude", instruction: "Dismount and prepare to walk" },
  { startSeconds: 135, endSeconds: 150, label: "walk_bike", instruction: "Walk the bike" },
  { startSeconds: 150, endSeconds: 160, label: "exclude", instruction: "Remount and prepare to ride" },
  { startSeconds: 160, endSeconds: 165, label: "acceleration", instruction: "Accelerate smoothly" },
  { startSeconds: 165, endSeconds: 175, label: "normal_riding", instruction: "Ride straight at a steady pace" },
  { startSeconds: 175, endSeconds: 180, label: "braking", instruction: "Brake smoothly to a stop" }
];

export const GUIDED_DURATION_SECONDS = GUIDED_PROTOCOL.at(-1).endSeconds;

export function guidedTrainingLabels(sourceFile) {
  return {
    schemaVersion: 1,
    protocolId: GUIDED_PROTOCOL_ID,
    sourceFile,
    durationSeconds: GUIDED_DURATION_SECONDS,
    createdAt: new Date().toISOString(),
    labelSource: "Bike Coach guided training protocol",
    segments: GUIDED_PROTOCOL.map(({ label, startSeconds, endSeconds }) => ({ label, startSeconds, endSeconds }))
  };
}

export function trainingCsv(csv, labels) {
  if (!labels) return csv;
  return `# BikeCoachTraining=${JSON.stringify(labels)}\n${csv}`;
}

export function trainingLabelsFromCsv(csv) {
  const line = String(csv || "").split(/\r?\n/).find(value => value.startsWith("# BikeCoachTraining="));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line.slice("# BikeCoachTraining=".length));
    return parsed?.schemaVersion === 1 && Array.isArray(parsed.segments) ? parsed : null;
  } catch {
    return null;
  }
}

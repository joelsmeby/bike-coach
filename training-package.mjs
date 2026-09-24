export const TRAINING_PACKAGE_TYPE = "bikecoach-training-package";

export async function sha256Text(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

export function trainingPackageName(sourceFile) {
  const base = String(sourceFile || "bikecoach-ride").split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
  return `${base || "bikecoach-ride"}.bikecoach-training.json`;
}

export async function buildTrainingPackage({ sourceFile, csv, calibration = null, labels, durationSeconds, sampleCount }) {
  if (!String(csv || "").trim()) throw new Error("Training package needs sensor data.");
  if (!labels?.segments?.length) throw new Error("Training package needs corrected movement labels.");
  const sensorCsv = String(csv);
  return {
    schemaVersion: 1,
    packageType: TRAINING_PACKAGE_TYPE,
    createdAt: new Date().toISOString(),
    sourceFile: String(sourceFile || "ride.csv"),
    durationSeconds: Number(durationSeconds),
    sampleCount: Number(sampleCount),
    calibration: calibration ? structuredClone(calibration) : null,
    labels: structuredClone(labels),
    sensorData: {
      format: "bikecoach-csv-v1",
      sha256: await sha256Text(sensorCsv),
      csv: sensorCsv
    }
  };
}

export async function validateTrainingPackage(value) {
  if (value?.schemaVersion !== 1 || value?.packageType !== TRAINING_PACKAGE_TYPE) return false;
  if (!value.labels?.segments?.length || value.sensorData?.format !== "bikecoach-csv-v1" || typeof value.sensorData.csv !== "string") return false;
  return value.sensorData.sha256 === await sha256Text(value.sensorData.csv);
}

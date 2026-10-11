/**
 * Provenance and qualification labels that must travel with a reading's
 * number wherever it is visible, including a collapsed summary: an unscored
 * pulse, a simulated reading, a suspect signal. Pure (unit-tested).
 */
import type { Measurement } from "@/lib/client/api";
import { isSimulatedMeasurement, isSuspectMeasurement } from "@/lib/client/format";
import { measurementBadge } from "../monitoring/monitoring-view";

export type ReadingProvenance = "unscored" | "simulated" | "suspect";

export function readingProvenance(measurement: Measurement): ReadingProvenance[] {
  const labels: ReadingProvenance[] = [];
  if (measurementBadge(measurement).kind === "unscored") labels.push("unscored");
  if (isSimulatedMeasurement(measurement)) labels.push("simulated");
  if (isSuspectMeasurement(measurement)) labels.push("suspect");
  return labels;
}

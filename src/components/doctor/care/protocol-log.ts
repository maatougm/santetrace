/**
 * Protocol application log view. `not_triggered` is a definite no-trigger
 * reading: no task, message or action was created. It is quiet (hidden by
 * default with a counter) and never counts as an application, a block or a
 * review need.
 */
import type { ProtocolApplication } from "@/contracts/monitoring";

export function applicationLogView(
  applications: readonly ProtocolApplication[],
  showNotTriggered: boolean,
): { rows: ProtocolApplication[]; hiddenNotTriggered: number } {
  const sorted = [...applications].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const rows = showNotTriggered ? sorted : sorted.filter((a) => a.state !== "not_triggered");
  return { rows, hiddenNotTriggered: showNotTriggered ? 0 : sorted.length - rows.length };
}

/** The server counts delivered applications against maxApplications. */
export function deliveredCount(applications: readonly ProtocolApplication[], protocolId: string): number {
  return applications.filter((a) => a.protocolId === protocolId && a.state === "delivered").length;
}

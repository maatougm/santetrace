"use client";

import { Button } from "@/components/ui";
import type { RecordNavCopy } from "./record-nav-copy";

export type RecordShortcut = "messages" | "alerts";

interface RecordActionsProps {
  messagesShared: boolean;
  /** Open (new + acknowledged) alerts in this record; null = alerts not shared (unknown, never 0). */
  openAlerts: number | null;
  onOpen: (section: RecordShortcut) => void;
  copy: Pick<RecordNavCopy, "writeToPatient" | "messagesNotShared" | "alertsShortcut">;
}

/**
 * Header shortcuts, in the clinician shell's language. "Écrire au patient" is
 * the primary action; when the patient did not share messages it says so
 * instead of pretending to work. Alerts appear only for a real, shared open
 * count: hidden when not shared and when the shared count is 0.
 */
export function RecordActions({ messagesShared, openAlerts, onOpen, copy }: RecordActionsProps) {
  return (
    <>
      {messagesShared ? (
        <Button iconStart="message" onClick={() => onOpen("messages")}>
          {copy.writeToPatient}
        </Button>
      ) : (
        <Button variant="secondary" iconStart="lock" disabled>
          {copy.messagesNotShared}
        </Button>
      )}
      {openAlerts !== null && openAlerts > 0 ? (
        <Button variant="secondary" iconStart="bell" onClick={() => onOpen("alerts")}>
          {copy.alertsShortcut(openAlerts)}
        </Button>
      ) : null}
    </>
  );
}

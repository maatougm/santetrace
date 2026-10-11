"use client";

import { Button } from "@/components/ui";

export type RecordShortcut = "messages" | "alerts";

interface RecordActionsProps {
  messagesShared: boolean;
  /** Open (new + acknowledged) alerts visible in this record. */
  openAlerts: number;
  onOpen: (section: RecordShortcut) => void;
}

/**
 * Header shortcuts. "Message" is the primary action; when the patient did not
 * share messages it says so instead of pretending to work.
 */
export function RecordActions({ messagesShared, openAlerts, onOpen }: RecordActionsProps) {
  return (
    <>
      {messagesShared ? (
        <Button iconStart="message" onClick={() => onOpen("messages")}>
          Message
        </Button>
      ) : (
        <Button variant="secondary" iconStart="lock" disabled>
          Messages non partagés
        </Button>
      )}
      {openAlerts > 0 ? (
        <Button variant="secondary" iconStart="bell" onClick={() => onOpen("alerts")}>
          Alertes ({openAlerts})
        </Button>
      ) : null}
    </>
  );
}

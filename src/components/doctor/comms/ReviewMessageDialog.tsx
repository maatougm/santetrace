"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { runFenced, type AccessFence } from "@/lib/client/access-fence";
import type { PatientRecord } from "@/lib/client/api";
import { getCarePlan, reviewMessage, type CareMessage } from "@/lib/client/care-api";
import { createClientId } from "@/lib/client/ids";
import { toApiError } from "@/lib/client/transport";
import type { RevisionGuard } from "@/contracts/monitoring";
import { errorText } from "../shared/ApiErrorState";
import { STALE_ANSWER, reviewGuardFrom } from "./message-state";
import { ReasonDialog } from "./ReasonDialog";
import styles from "./Comms.module.css";

interface ReviewMessageDialogProps {
  /** Message to review; the dialog is open while it is set. */
  message: CareMessage | null;
  patientId: string;
  record: PatientRecord;
  fence: AccessFence;
  onClose: () => void;
  onReviewed: (message: CareMessage) => void;
  /** Reload the record and the thread after a conflict. */
  onReload: () => void;
}

const NO_GUARD =
  "Le serveur n’a pas fourni la révision actuelle du dossier : la revue ne peut pas être rattachée à un état précis. Rechargez le dossier puis réessayez.";

/** Server guard from the record; when it carries none, the care plan's (also server-built), asked once. */
async function resolveGuard(record: PatientRecord, patientId: string, fence: AccessFence): Promise<RevisionGuard | null | "stale"> {
  const fromRecord = reviewGuardFrom(record);
  if (fromRecord) return fromRecord;
  const plan = await runFenced(fence, () => getCarePlan(patientId));
  if (plan.status === "stale") return "stale";
  return reviewGuardFrom(record, plan.value);
}

function excerpt(text: string): string {
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

/** Explicit clinical-context review of one patient message (primary with care authority only). */
export function ReviewMessageDialog({ message, patientId, record, fence, onClose, onReviewed, onReload }: ReviewMessageDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<ReactNode | null>(null);
  // Same payload, same key: a retry after a lost answer cannot record a second review.
  const attemptRef = useRef<{ payload: string; clientId: string } | null>(null);

  const close = () => {
    setFailure(null);
    onClose();
  };

  const submit = async (reason: string) => {
    if (!message) return;
    setSubmitting(true);
    setFailure(null);
    try {
      const guard = await resolveGuard(record, patientId, fence);
      if (guard === "stale") {
        setFailure(STALE_ANSWER);
        return;
      }
      if (!guard) {
        setFailure(NO_GUARD);
        return;
      }
      const payload = JSON.stringify([message.id, message.revision, guard, reason]);
      const clientId = attemptRef.current?.payload === payload ? attemptRef.current.clientId : createClientId("message-review");
      attemptRef.current = { payload, clientId };
      const result = await runFenced(fence, () =>
        reviewMessage(message.id, { expectedRevision: message.revision, expectedGuard: guard, reason, clientId }),
      );
      if (result.status === "stale") {
        setFailure(STALE_ANSWER);
        return;
      }
      attemptRef.current = null;
      onReviewed(result.value.message);
      close();
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.isConflict) {
        attemptRef.current = null;
        setFailure(
          <span className={styles.stack}>
            <span>Le dossier ou ce message a changé depuis l’affichage : rechargez, relisez le message, puis réessayez.</span>
            <span>
              <Button size="sm" variant="secondary" iconStart="refresh" onClick={onReload}>
                Recharger
              </Button>
            </span>
          </span>,
        );
      } else {
        setFailure(errorText(apiError));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ReasonDialog
      key={message?.id ?? "none"}
      open={message !== null}
      title="Marquer le contexte clinique comme revu"
      confirmLabel="Marquer comme revu"
      submitting={submitting}
      failure={failure}
      onClose={close}
      onSubmit={(reason) => void submit(reason)}
      description={
        <>
          {message ? <p className={styles.messageText}>« {excerpt(message.text)} »</p> : null}
          <p className={styles.mutedBlock}>
            Vous déclarez avoir pris en compte le contexte clinique de ce message, avec votre nom et votre motif. Ce n’est pas un
            accusé de lecture. Cela ne résout aucune alerte et ne réactive aucun protocole suspendu : un protocole demande une
            révision explicite.
          </p>
          {message?.forwardedFromMessageId ? (
            <p className={styles.mutedBlock}>
              Copie transférée par le patient : la revue lève le signalement « contexte clinique non évalué » de ce message,
              sans réautoriser de protocole ni donner accès au reste de la conversation d’origine.
            </p>
          ) : null}
        </>
      }
    />
  );
}

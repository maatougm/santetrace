"use client";

/**
 * Owner-authorized forwarding of ONE of the patient's own clinical messages,
 * from a secondary doctor's thread to the active primary referent. Explicit
 * per message, never automatic; nothing else of the thread is sent. Online
 * only, through the access fence, one clientId per attempt reused on retry.
 */
import { useState } from "react";
import { Button, Notice } from "@/components/ui";
import type { CareMessage } from "@/contracts/monitoring";
import { runFenced } from "@/lib/client/access-fence";
import { forwardMessage } from "@/lib/client/care-api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { createClientId } from "@/lib/client/ids";
import { describeApiError, toApiError, type ErrorDescription, type Language } from "@/lib/client/transport";
import { Ltr, When } from "../bits";
import { usePatientRuntime } from "../PatientRuntime";
import type { ForwardOption } from "./contact-view";
import patientStyles from "../patient.module.css";

interface ForwardControlProps {
  message: CareMessage;
  option: ForwardOption;
  lang: Language;
  /** Re-reads the thread so the server's forward record replaces the local one. */
  onForwarded: () => void;
}

export function ForwardControl({ message, option, lang, onForwarded }: ForwardControlProps) {
  const { data, online } = usePatientRuntime();
  const copy = CARE_COPY[lang].contact;
  const [clientId, setClientId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [failure, setFailure] = useState<ErrorDescription | null>(null);

  if (option.kind === "forwarded" || recorded) {
    return (
      <p className={patientStyles.metaLine}>
        {copy.forwarded}
        {option.kind === "forwarded" ? (
          <>
            {" "}
            <When iso={option.at} lang={lang} />
          </>
        ) : null}
      </p>
    );
  }
  if (option.kind !== "offer") return null;

  const forward = async () => {
    const attempt = clientId ?? createClientId("forward");
    setClientId(attempt);
    setBusy(true);
    setFailure(null);
    try {
      const result = await runFenced(data.fence, () =>
        forwardMessage(message.id, { clinicianId: option.targetClinicianId, clientId: attempt }),
      );
      if (result.status === "stale") return;
      setRecorded(true);
      setClientId(null);
      onForwarded();
    } catch (caught) {
      const apiError = toApiError(caught);
      setFailure(describeApiError(apiError, lang));
      // The referent or the message changed: a later try is a new attempt.
      if (apiError.isConflict) setClientId(null);
    } finally {
      setBusy(false);
    }
  };

  const hintId = `forward-hint-${message.id}`;
  return (
    <div className={patientStyles.stackSm}>
      <p id={hintId} className={patientStyles.metaLine}>
        {copy.forwardHint}
      </p>
      <div className={patientStyles.inlineActions}>
        <Button
          variant="secondary"
          iconStart="send"
          loading={busy}
          disabled={!online || busy}
          aria-describedby={hintId}
          onClick={() => void forward()}
        >
          {busy ? copy.forwarding : copy.forwardAction}
        </Button>
      </div>
      {failure ? (
        <Notice tone="neutral" icon="x-circle" role="alert" title={failure.title}>
          {failure.message} <Ltr>{failure.code}</Ltr>
        </Notice>
      ) : null}
    </div>
  );
}

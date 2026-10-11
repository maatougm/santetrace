"use client";

/**
 * Request to be contacted (spec 006 FR-016, story 5 scenario 3). It is a
 * request the doctor can see, never a call: no state reads "connected" or
 * "call in progress". Online only; one clientId per attempt, reused on retry.
 */
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, ErrorState, Notice } from "@/components/ui";
import type { ContactRequest } from "@/contracts/monitoring";
import { runFenced } from "@/lib/client/access-fence";
import { listContactRequests, requestContact, updateContact } from "@/lib/client/care-api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { createClientId } from "@/lib/client/ids";
import { describeApiError, toApiError, type ErrorDescription, type Language } from "@/lib/client/transport";
import { Ltr, When } from "../bits";
import { usePatientRuntime } from "../PatientRuntime";
import { useFencedResource } from "../plan/useFencedResource";
import { canCancelContact, contactStateLabel, mergeContactRequests, type Recipient } from "./contact-view";
import patientStyles from "../patient.module.css";
import styles from "./contact.module.css";

interface ContactRequestCardProps {
  patientId: string;
  clinicianId: string;
  recipients: readonly Recipient[];
  lang: Language;
}

type Attempt = { target: string; clientId: string };

const CONTACT_REFRESH_MS = 15_000;

function useContactRequests(patientId: string) {
  const { data } = usePatientRuntime();
  const load = useCallback(
    (signal: AbortSignal) => listContactRequests(patientId, { signal }).then((r) => r.contactRequests),
    [patientId],
  );
  const listed = useFencedResource<ContactRequest[]>(data.fence, `contacts:${patientId}`, load);
  // Requests created during this visit (shown alone if the list route is not shipped yet).
  const [created, setCreated] = useState<ContactRequest[]>([]);
  const denied = listed.error?.isAccessDenied ?? false;
  const unavailable = listed.error?.isUnavailable ?? false;
  const { reload } = listed;

  // The doctor may acknowledge meanwhile: refresh slowly while visible (not after a denial or a missing route).
  useEffect(() => {
    if (denied || unavailable) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, CONTACT_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [denied, unavailable, reload]);

  const requests = denied ? [] : mergeContactRequests(listed.value ?? [], created);
  const remember = (request: ContactRequest) => setCreated((current) => mergeContactRequests(current, [request]));
  return { listed, denied, requests, remember };
}

export function ContactRequestCard({ patientId, clinicianId, recipients, lang }: ContactRequestCardProps) {
  const { data, online, t } = usePatientRuntime();
  const copy = CARE_COPY[lang].contact;
  const { listed, denied, requests, remember } = useContactRequests(patientId);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<ErrorDescription | null>(null);
  const nameOf = (id: string) => recipients.find((r) => r.clinicianId === id)?.name ?? copy.fromDoctor;
  const openForTarget = requests.some((r) => r.clinicianId === clinicianId && canCancelContact(r));

  const run = async (target: string, work: (clientId: string) => Promise<{ contactRequest: ContactRequest }>) => {
    const current = attempt && attempt.target === target ? attempt : { target, clientId: createClientId("contact") };
    setAttempt(current);
    setBusy(target);
    setFailure(null);
    try {
      const result = await runFenced(data.fence, () => work(current.clientId));
      if (result.status === "stale") return;
      remember(result.value.contactRequest);
      setAttempt(null);
    } catch (caught) {
      const apiError = toApiError(caught);
      setFailure(describeApiError(apiError, lang));
      if (apiError.isConflict) {
        setAttempt(null);
        listed.reload();
      }
    } finally {
      setBusy(null);
    }
  };

  const ask = () => run(`new:${clinicianId}`, (clientId) => requestContact(patientId, { clinicianId, clientId }));
  const cancel = (request: ContactRequest) =>
    run(request.id, (clientId) =>
      updateContact(request.id, { action: "cancel", expectedRevision: request.revision, reason: copy.contactCancel, clientId }),
    );

  const listError = listed.error && !listed.error.isUnavailable ? describeApiError(listed.error, lang) : null;
  return (
    <Card title={copy.contactTitle} description={copy.contactBody}>
      <div className={patientStyles.stack}>
        {!openForTarget ? (
          <Button
            variant="secondary"
            size="lg"
            iconStart="bell"
            fullWidth
            loading={busy === `new:${clinicianId}`}
            disabled={!online || busy !== null || denied}
            onClick={() => void ask()}
          >
            {busy === `new:${clinicianId}` ? copy.contactRequesting : copy.contactRequest}
          </Button>
        ) : null}
        {failure ? (
          <Notice tone="neutral" icon="x-circle" role="alert" title={failure.title}>
            {failure.message} <Ltr>{failure.code}</Ltr>
          </Notice>
        ) : null}
        {listError ? (
          <ErrorState compact title={listError.title} message={listError.message} code={listError.code} onRetry={listed.reload} retryLabel={t.common.retry} />
        ) : null}
        <h3 className={patientStyles.sectionTitle}>{copy.contactHistory}</h3>
        {requests.length === 0 ? (
          <p className={patientStyles.emptyLine}>{copy.contactEmpty}</p>
        ) : (
          <ul className={styles.requests}>
            {requests.map((request) => {
              const label = contactStateLabel(request.state, lang);
              return (
                <li key={request.id} className={styles.request}>
                  <span className={styles.requestText}>
                    <span className={styles.requestName}>{nameOf(request.clinicianId)}</span>
                    <When iso={request.createdAt} lang={lang} />
                  </span>
                  {label ? <Badge tone={canCancelContact(request) ? "outline" : "muted"}>{label}</Badge> : null}
                  {canCancelContact(request) ? (
                    <Button variant="ghost" iconStart="x" loading={busy === request.id} disabled={!online || busy !== null} onClick={() => void cancel(request)}>
                      {copy.contactCancel}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

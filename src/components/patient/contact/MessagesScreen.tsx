"use client";

/**
 * Patient Contact (spec 006 story 5, FR-016): messages with a doctor who holds
 * an active grant with the "messages" scope, and a request to be contacted.
 * No reply delay is promised; nothing is sent offline; "recorded" is never
 * shown as "read".
 */
import { useCallback, useState } from "react";
import { Card, EmptyState, ErrorState, Field, LinkButton, Notice, PageHeader, Select } from "@/components/ui";
import type { CareMessage } from "@/contracts/monitoring";
import type { CareGrant } from "@/contracts/patient-platform";
import type { PatientRecord } from "@/lib/client/api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { listGrants } from "@/lib/client/grants-api";
import { describeApiError } from "@/lib/client/transport";
import { HOME_COPY } from "../home/home-copy";
import { usePatientRuntime } from "../PatientRuntime";
import { LoadingBlock, RecordGate } from "../RecordGate";
import { useDoctorDirectory } from "../plan/useDoctorDirectory";
import { useFencedResource } from "../plan/useFencedResource";
import { ContactRequestCard } from "./ContactRequestCard";
import { MessageComposer } from "./MessageComposer";
import { MessageThreadView } from "./MessageThread";
import { mergeMessages, messageRecipients, type Recipient } from "./contact-view";
import { useMessageThread } from "./useMessageThread";
import patientStyles from "../patient.module.css";

const RECIPIENT_ID = "contact-recipient";

function NoRecipient() {
  const { lang } = usePatientRuntime();
  const copy = CARE_COPY[lang];
  return (
    <EmptyState
      icon="message"
      title={copy.contact.noRecipient}
      action={
        <LinkButton href="/patient/doctors" variant="secondary" iconStart="user-plus">
          {copy.noReferent.action}
        </LinkButton>
      }
    />
  );
}

interface ConversationProps {
  patientId: string;
  recipient: Recipient;
  grants: readonly CareGrant[];
}

function Conversation({ patientId, recipient, grants }: ConversationProps) {
  const { data, lang } = usePatientRuntime();
  const copy = CARE_COPY[lang].contact;
  const thread = useMessageThread(data.fence, patientId, recipient.clinicianId);
  const { mutate } = thread;
  const onSent = useCallback(
    (message: CareMessage) =>
      mutate((current) => (current ? { ...current, messages: mergeMessages(current.messages, [message]) } : current)),
    [mutate],
  );
  return (
    <Card title={copy.threadTitle(recipient.name ?? copy.fromDoctor)}>
      <div className={patientStyles.stack}>
        <MessageThreadView thread={thread} clinicianId={recipient.clinicianId} grants={grants} lang={lang} />
        <MessageComposer key={recipient.clinicianId} patientId={patientId} clinicianId={recipient.clinicianId} lang={lang} onSent={onSent} />
      </div>
    </Card>
  );
}

function ContactBody({ record }: { record: PatientRecord }) {
  const { data, lang, online, t } = usePatientRuntime();
  const copy = CARE_COPY[lang].contact;
  const patientId = record.patient.id;
  const load = useCallback((signal: AbortSignal) => listGrants(patientId, { signal }).then((r) => r.grants), [patientId]);
  const grants = useFencedResource<CareGrant[]>(data.fence, `grants:${patientId}`, load);
  const doctors = useDoctorDirectory();
  const [selected, setSelected] = useState<string | null>(null);

  if (grants.error) {
    if (grants.error.isOffline) return <Notice tone="neutral" icon="wifi-off">{copy.offline}</Notice>;
    const description = describeApiError(grants.error, lang);
    return (
      <ErrorState title={description.title} message={description.message} code={description.code} onRetry={grants.reload} retryLabel={t.common.retry} />
    );
  }
  if (!grants.value) return <LoadingBlock label={t.common.loading} />;

  const recipients = messageRecipients(grants.value, doctors);
  if (recipients.length === 0) return <NoRecipient />;
  const recipient = recipients.find((r) => r.clinicianId === selected) ?? recipients[0];

  return (
    <>
      {!online ? <Notice tone="neutral" icon="wifi-off">{copy.offline}</Notice> : null}
      {recipients.length > 1 ? (
        <Field label={copy.recipientLabel} htmlFor={RECIPIENT_ID}>
          <Select id={RECIPIENT_ID} value={recipient.clinicianId} onChange={(event) => setSelected(event.target.value)}>
            {recipients.map((r) => (
              <option key={r.clinicianId} value={r.clinicianId}>
                {r.name ?? copy.fromDoctor}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Conversation key={recipient.clinicianId} patientId={patientId} recipient={recipient} grants={grants.value} />
      <ContactRequestCard patientId={patientId} clinicianId={recipient.clinicianId} recipients={recipients} lang={lang} />
    </>
  );
}

export function MessagesScreen() {
  const { lang } = usePatientRuntime();
  const copy = CARE_COPY[lang].contact;
  return (
    <div className={patientStyles.page}>
      {/* Same label as the bottom tab ("Messages"); the request to be contacted lives here too. */}
      <PageHeader title={HOME_COPY[lang].messagesTitle} description={copy.description} />
      <RecordGate>{(record) => <ContactBody record={record} />}</RecordGate>
    </div>
  );
}

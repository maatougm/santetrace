"use client";

/**
 * "Mon dossier" hub (spec 006 story 1): the no-referent state, links to the
 * record's sub-pages and the patient's declared facts (current versions, with
 * provenance and history), which the patient can add to or correct. Facts are
 * not kept on the device: a device copy shows the online-only state, never "none".
 */
import { useState } from "react";
import { Button, Card, EmptyState, LinkButton, Notice, PageHeader } from "@/components/ui";
import type { MedicalFact } from "@/contracts/monitoring";
import type { PatientRecord } from "@/lib/client/api";
import { CARE_COPY } from "@/lib/client/copy/care";
import type { Language } from "@/lib/client/transport";
import { SectionTitle } from "../bits";
import { RECORD_LINKS } from "../patient-nav";
import { usePatientRuntime } from "../PatientRuntime";
import { RecordGate } from "../RecordGate";
import { ExternalNotes } from "./ExternalNotes";
import { FactDialog } from "./FactDialog";
import { FactItem } from "./FactItem";
import { currentFacts, previousVersions, referentStatus, type ReferentStatus } from "./record-model";
import { useOwnerGrants } from "./useOwnerGrants";
import styles from "../patient.module.css";
import rec from "./record.module.css";

function NoReferentNotice({ lang }: { lang: Language }) {
  const copy = CARE_COPY[lang].noReferent;
  return (
    <Notice
      tone="info"
      icon="user-plus"
      role="note"
      title={copy.title}
      action={
        <LinkButton href="/patient/doctors" variant="secondary" iconStart="user-plus">
          {copy.action}
        </LinkButton>
      }
    >
      {copy.body}
    </Notice>
  );
}

function RecordLinks({ lang }: { lang: Language }) {
  const copy = CARE_COPY[lang].record;
  return (
    <nav className={styles.stack} aria-labelledby="record-sections">
      <SectionTitle id="record-sections">{copy.sectionsTitle}</SectionTitle>
      <ul className={rec.links}>
        {RECORD_LINKS.map((link) => (
          <li key={link.href}>
            <LinkButton href={link.href} variant="secondary" fullWidth iconStart={link.icon} iconEnd="chevron-right">
              {copy[link.key]}
            </LinkButton>
          </li>
        ))}
      </ul>
    </nav>
  );
}

type DialogState = { key: number; fact: MedicalFact | null } | null;

function FactsCard({ record }: { record: PatientRecord }) {
  const { lang, data } = usePatientRuntime();
  const copy = CARE_COPY[lang];
  const [dialog, setDialog] = useState<DialogState>(null);
  const [saved, setSaved] = useState(false);
  const online = data.origin === "server";
  const facts = currentFacts(record.medicalFacts);
  // Correct the latest known version of the fact being edited.
  const editing = dialog?.fact ? (record.medicalFacts.find((f) => f.id === dialog.fact?.id) ?? dialog.fact) : null;

  const open = (fact: MedicalFact | null) => {
    setSaved(false);
    setDialog((current) => ({ key: (current?.key ?? 0) + 1, fact }));
  };

  // The dialog has already echoed the fact through its own fence-bound mutate.
  const onSaved = () => {
    setDialog(null);
    setSaved(true);
  };

  const add = online ? (
    <Button variant="secondary" iconStart="plus" onClick={() => open(null)}>
      {copy.record.addFact}
    </Button>
  ) : null;

  return (
    <Card id="record-facts" title={copy.record.factsTitle} actions={add}>
      <div className={rec.cardStack}>
        {!online ? (
          <Notice tone="neutral" icon="cloud-off">
            {copy.monitoring.onlineOnly}
          </Notice>
        ) : (
          <>
            <p className={styles.metaLine}>{copy.record.unknownIsNotNo}</p>
            {saved ? (
              <Notice tone="success" icon="check">
                {copy.record.saved}
              </Notice>
            ) : null}
            {facts.length === 0 ? (
              <EmptyState
                compact
                icon="clipboard"
                title={copy.record.factsEmpty}
                action={
                  <LinkButton href="/patient/onboarding" variant="primary" iconStart="edit">
                    {copy.record.startOnboarding}
                  </LinkButton>
                }
              />
            ) : (
              <>
                <ul className={rec.factList}>
                  {facts.map((fact) => (
                    <FactItem key={fact.id} fact={fact} history={previousVersions(record.medicalFacts, fact)} lang={lang} onCorrect={open} />
                  ))}
                </ul>
                <LinkButton href="/patient/onboarding" variant="secondary" iconStart="edit">
                  {copy.record.continueOnboarding}
                </LinkButton>
              </>
            )}
          </>
        )}
      </div>
      {dialog ? (
        <FactDialog
          key={dialog.key}
          patientId={record.patient.id}
          fact={editing}
          onClose={() => setDialog(null)}
          onSaved={onSaved}
        />
      ) : null}
    </Card>
  );
}

function RecordContent({ record }: { record: PatientRecord }) {
  const { lang, t, data } = usePatientRuntime();
  // Device copies never carry external notes: nothing extra is shown offline.
  const externalNotes = data.origin === "server" ? (record.externalNotes ?? []) : [];
  const grants = useOwnerGrants(record, data.origin, data.fence);
  // A device copy carries neither grants nor plan: the referent state is unknown there.
  const referent: ReferentStatus =
    data.origin !== "server" || grants.status === "loading"
      ? "unknown"
      : referentStatus(grants.status === "ready" ? grants.grants : null, record.plan);

  return (
    <>
      {referent === "none" ? <NoReferentNotice lang={lang} /> : null}
      <RecordLinks lang={lang} />
      <FactsCard record={record} />
      {externalNotes.length > 0 ? <ExternalNotes notes={externalNotes} lang={lang} receivedLabel={t.common.receivedAt} /> : null}
    </>
  );
}

export function RecordHub() {
  const { lang, data } = usePatientRuntime();
  const copy = CARE_COPY[lang].record;
  return (
    <div className={styles.page}>
      <PageHeader title={copy.title} description={copy.description} />
      {/* Keyed by actor+patient: a switch drops open dialogs, notices and held reads. */}
      <RecordGate>{(record) => <RecordContent key={data.fence.key ?? record.patient.id} record={record} />}</RecordGate>
    </div>
  );
}

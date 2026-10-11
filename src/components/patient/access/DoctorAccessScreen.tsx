"use client";

/**
 * "Médecins et accès" (spec 006 story 1, FR-002/024/027): the owner invites a
 * fictional doctor with a one-time code, changes a secondary doctor's
 * sections, revokes access and reads the access journal. Owner only and
 * online only: grants are never cached on the device. Every result passes the
 * access fence; a 409 reloads the list and says so.
 */
import { useCallback, useMemo, useReducer, useState } from "react";
import { Card, ErrorState, Notice, PageHeader } from "@/components/ui";
import type { CareGrant, DoctorProfile, GrantIssueResult } from "@/contracts/patient-platform";
import type { PatientRecord } from "@/lib/client/api";
import { ACCESS_COPY } from "@/lib/client/copy/access";
import { CARE_COPY } from "@/lib/client/copy/care";
import { listDoctors, listGrants } from "@/lib/client/grants-api";
import { describeApiError } from "@/lib/client/transport";
import { usePatientRuntime } from "../PatientRuntime";
import { LoadingBlock, RecordGate } from "../RecordGate";
import { useFencedRead } from "../record/use-fenced-read";
import { AccessJournal } from "./AccessJournal";
import { HIDDEN_REVEAL, revealReducer, upsertGrant } from "./access-model";
import { GrantList } from "./GrantList";
import { InviteDoctorForm } from "./InviteDoctorForm";
import { TokenRevealPanel } from "./TokenRevealPanel";
import patient from "../patient.module.css";

const readDoctors = (signal: AbortSignal) => listDoctors({ signal }).then((response) => response.doctors);

function AccessPanel({ patientId }: { patientId: string }) {
  const { lang, t, data } = usePatientRuntime();
  const copy = ACCESS_COPY[lang].doctors;
  // This panel is keyed by its fence: `fence` and `refresh` always belong to its own actor+patient.
  const { fence, refresh } = data;
  const readGrants = useCallback((signal: AbortSignal) => listGrants(patientId, { signal }).then((response) => response.grants), [patientId]);
  const directory = useFencedRead(fence, readDoctors);
  const grants = useFencedRead(fence, readGrants);
  // The one-time token lives only in this reducer state, until hidden or unmounted.
  const [reveal, dispatchReveal] = useReducer(revealReducer, HIDDEN_REVEAL);
  const [conflict, setConflict] = useState(false);
  const [journalKey, setJournalKey] = useState(0);

  const doctorsById = useMemo(
    () => new Map<string, DoctorProfile>((directory.state.status === "ready" ? directory.state.value : []).map((d) => [d.id, d])),
    [directory.state],
  );

  // Access changes move the authority revision: the record poll (and its fence) follow.
  const afterChange = () => {
    if (fence.denied()) return;
    setJournalKey((key) => key + 1);
    void refresh();
  };
  const onConflict = () => {
    setConflict(true);
    grants.reload();
    afterChange();
  };
  const onIssued = (result: GrantIssueResult) => {
    setConflict(false);
    grants.update((current) => upsertGrant(current, result.grant));
    dispatchReveal({ type: "issued", result });
    afterChange();
  };
  // The answer arrived after the authority moved: nothing from it is shown.
  const onIssueDiscarded = (answered: boolean) => {
    if (answered) dispatchReveal({ type: "discarded" });
    grants.reload();
    afterChange();
  };
  const onUpdated = (grant: CareGrant) => {
    setConflict(false);
    grants.update((current) => upsertGrant(current, grant));
    afterChange();
  };
  const onUpdateDiscarded = () => {
    grants.reload();
    afterChange();
  };

  const list = grants.state.status === "ready" ? grants.state.value : [];
  const revealedGrant = reveal.kind === "hidden" || !reveal.grantId ? null : list.find((grant) => grant.id === reveal.grantId);
  // Shown above everything else, so a re-read of the list never hides a code not yet handed over.
  // Keyed per invitation: a new code gets fresh copy states and focus.
  const revealPanel =
    reveal.kind === "hidden" ? null : (
      <TokenRevealPanel
        key={`${reveal.kind}-${reveal.grantId ?? "discarded"}`}
        reveal={reveal}
        doctorName={revealedGrant ? (doctorsById.get(revealedGrant.clinicianId)?.displayName ?? null) : null}
        lang={lang}
        dismissLabel={t.common.dismiss}
        onHide={() => dispatchReveal({ type: "hide" })}
      />
    );

  const ready = grants.state.status === "ready";

  return (
    <>
      {conflict && ready ? (
        <Notice tone="neutral" icon="refresh" role="alert">
          {copy.conflict}
        </Notice>
      ) : null}
      {revealPanel}
      {grants.state.status === "loading" ? <LoadingBlock label={t.common.loading} /> : null}
      {grants.state.status === "error" ? (
        <ErrorState {...describeApiError(grants.state.error, lang)} onRetry={grants.retry} retryLabel={t.common.retry} />
      ) : null}
      {ready ? (
        <>
          <Card id="access-grants" title={copy.grantsTitle}>
            <GrantList
              grants={list}
              doctorsById={doctorsById}
              onUpdated={onUpdated}
              onConflict={onConflict}
              onDiscarded={onUpdateDiscarded}
            />
          </Card>
          <Card id="access-invite" title={copy.inviteTitle}>
            <InviteDoctorForm
              patientId={patientId}
              directory={directory.state}
              grants={list}
              onRetryDirectory={directory.retry}
              onIssued={onIssued}
              onDiscarded={onIssueDiscarded}
              onConflict={onConflict}
            />
          </Card>
          <AccessJournal patientId={patientId} reloadKey={journalKey} />
        </>
      ) : null}
    </>
  );
}

function AccessContent({ record }: { record: PatientRecord }) {
  const { lang, data } = usePatientRuntime();
  if (!record.access.owner) {
    return (
      <Notice tone="neutral" icon="lock">
        {ACCESS_COPY[lang].doctors.ownerOnly}
      </Notice>
    );
  }
  if (data.origin !== "server") {
    return (
      <Notice tone="neutral" icon="cloud-off">
        {CARE_COPY[lang].monitoring.onlineOnly}
      </Notice>
    );
  }
  // One panel per actor+patient fence: a new key drops any held token and results.
  return <AccessPanel key={data.fence.key ?? record.patient.id} patientId={record.patient.id} />;
}

export function DoctorAccessScreen() {
  const { lang } = usePatientRuntime();
  const copy = ACCESS_COPY[lang].doctors;
  return (
    <div className={patient.page}>
      <PageHeader
        title={copy.title}
        description={copy.description}
        back={{ href: "/patient/record", label: CARE_COPY[lang].onboarding.backToRecord }}
      />
      <RecordGate>{(record) => <AccessContent record={record} />}</RecordGate>
    </div>
  );
}

"use client";

/**
 * Invite a fictional doctor: who, which role, which sections. A primary gets
 * every section; a second primary is blocked while one is pending or active;
 * missing composite sections block submission. A retry resends the same
 * request (same clientId); any edit starts a new one. The server's answer,
 * including the one-time code, is handed to the parent and never kept here.
 */
import { useRef, useState, type FormEvent } from "react";
import { Button, ErrorState, Field, Notice, Select, describedBy } from "@/components/ui";
import type { CareGrant, DoctorProfile, GrantIssue, GrantIssueResult, Relationship } from "@/contracts/patient-platform";
import { ACCESS_COPY } from "@/lib/client/copy/access";
import { issueDoctorInvitation } from "@/lib/client/grants-api";
import { createClientId } from "@/lib/client/ids";
import { describeApiError, staleResponseError, type ApiError } from "@/lib/client/transport";
import { usePatientRuntime } from "../PatientRuntime";
import { ApiErrorNotice } from "../record/ApiErrorNotice";
import { ChoiceGroup, choiceId } from "../record/ChoiceGroup";
import { fencedCall } from "../record/fenced-call";
import type { ReadState } from "../record/use-fenced-read";
import {
  doctorChoices,
  hasOpenPrimary,
  initialInviteDraft,
  toGrantIssue,
  upsertGrant,
  validateInvite,
  type InviteDraft,
} from "./access-model";
import { ScopePicker, scopeInputId } from "./ScopePicker";
import styles from "./access.module.css";

const IDS = { doctor: "invite-doctor", relationship: "invite-relationship", scopes: "invite-scope" };
const RELATIONSHIPS: readonly Relationship[] = ["primary", "generalist", "specialist"];

interface InviteDoctorFormProps {
  patientId: string;
  directory: ReadState<DoctorProfile[]>;
  grants: readonly CareGrant[];
  onRetryDirectory: () => void;
  onIssued: (result: GrantIssueResult) => void;
  /** The answer came back after the authority moved and was not shown (`answered`: the server did create it). */
  onDiscarded: (answered: boolean) => void;
  onConflict: () => void;
}

export function InviteDoctorForm({ patientId, directory, grants, onRetryDirectory, onIssued, onDiscarded, onConflict }: InviteDoctorFormProps) {
  const { lang, t, data } = usePatientRuntime();
  const copy = ACCESS_COPY[lang];
  const [draft, setDraft] = useState<InviteDraft>(() => initialInviteDraft(grants));
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const pending = useRef<GrantIssue | null>(null);

  const doctors = directory.status === "ready" ? directory.value : [];
  const choices = doctorChoices(doctors, grants);
  const validation = validateInvite(draft, grants);
  const primaryTaken = hasOpenPrimary(grants);
  const takenState = choices.find((choice) => choice.doctor.id === draft.doctorId)?.openState ?? null;
  const doctorError = !showErrors
    ? null
    : validation.errors.doctor === "required"
      ? copy.auth.required
      : takenState
        ? copy.grantState[takenState]
        : null;
  const canSubmit = directory.status === "ready" && doctors.length > 0;

  const update = (patch: Partial<InviteDraft>) => {
    pending.current = null;
    setFailure(null);
    setDraft((current) => ({ ...current, ...patch }));
  };

  const focusFirstError = () => {
    const { errors } = validation;
    const target = errors.doctor
      ? IDS.doctor
      : errors.relationship
        ? choiceId(IDS.relationship, "generalist")
        : errors.scopes
          ? scopeInputId(IDS.scopes, validation.missing[0] ?? "status")
          : null;
    if (target) document.getElementById(target)?.focus();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !canSubmit) return;
    if (!validation.valid) {
      setShowErrors(true);
      focusFirstError();
      return;
    }
    const input = pending.current ?? toGrantIssue(draft, createClientId("grant"));
    pending.current = input;
    // Captured once: after the await only this fence decides (a switch retires it).
    const fence = data.fence;
    setBusy(true);
    setFailure(null);
    const result = await fencedCall(fence, () => issueDoctorInvitation(patientId, input));
    setBusy(false);
    if (result.status === "stale") {
      if (fence.denied()) return;
      if (result.answered) {
        // Created but withheld: the draft is done; the list is re-read by the parent.
        pending.current = null;
        setShowErrors(false);
        setDraft(initialInviteDraft(grants));
      } else {
        // Nothing confirmed: say so; a retry resends the same request.
        setFailure(staleResponseError());
      }
      onDiscarded(result.answered);
      return;
    }
    if (result.status === "error") {
      if (result.error.isConflict) {
        pending.current = null;
        onConflict();
      } else {
        setFailure(result.error);
      }
      return;
    }
    pending.current = null;
    setShowErrors(false);
    setDraft(initialInviteDraft(upsertGrant(grants, result.value.grant)));
    onIssued(result.value);
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
      {directory.status === "error" ? (
        <ErrorState
          compact
          {...describeApiError(directory.error, lang)}
          onRetry={onRetryDirectory}
          retryLabel={t.common.retry}
        />
      ) : null}
      {directory.status === "ready" && doctors.length === 0 ? <Notice tone="neutral">{copy.doctors.directoryEmpty}</Notice> : null}
      <Field label={copy.doctors.doctorLabel} htmlFor={IDS.doctor} error={doctorError} required requiredLabel={t.common.required}>
        <Select
          id={IDS.doctor}
          value={draft.doctorId}
          disabled={!canSubmit}
          invalid={Boolean(doctorError)}
          aria-describedby={describedBy(IDS.doctor, { error: doctorError })}
          onChange={(event) => update({ doctorId: event.target.value })}
        >
          <option value="">{directory.status === "loading" ? t.common.loading : copy.doctors.doctorPlaceholder}</option>
          {choices.map(({ doctor, openState }) => (
            <option key={doctor.id} value={doctor.id} disabled={openState !== null}>
              {doctor.displayName} — {doctor.specialty}
              {openState ? ` (${copy.grantState[openState]})` : ""}
            </option>
          ))}
        </Select>
      </Field>
      <ChoiceGroup
        idPrefix={IDS.relationship}
        legend={copy.doctors.relationshipLabel}
        smallLegend
        options={RELATIONSHIPS.map((relationship) => {
          const blocked = relationship === "primary" && primaryTaken;
          return {
            value: relationship,
            label: copy.relationship[relationship],
            description: blocked ? copy.doctors.primaryExists : copy.relationshipHint[relationship],
            disabled: blocked,
          };
        })}
        value={draft.relationship}
        onChange={(relationship) => update({ relationship })}
        error={validation.errors.relationship ? copy.doctors.primaryExists : null}
      />
      <ScopePicker
        idPrefix={IDS.scopes}
        lang={lang}
        selected={validation.scopes}
        locked={draft.relationship === "primary"}
        missing={validation.missing}
        emptyError={showErrors && validation.errors.scopes === "empty"}
        onChange={(scopes) => update({ scopes })}
      />
      {failure ? <ApiErrorNotice error={failure} lang={lang} /> : null}
      <Button type="submit" variant="primary" size="lg" fullWidth iconStart="user-plus" loading={busy} disabled={!canSubmit}>
        {busy ? copy.doctors.inviting : copy.doctors.invite}
      </Button>
    </form>
  );
}

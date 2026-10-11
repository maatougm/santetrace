"use client";

/**
 * Add or correct a declared fact. The API needs the patient's current context
 * revision: taken from the live server record (`record.revision`), or read
 * fresh with GET onboarding when the record lacks it. The poll can lag, so a
 * 409 reloads the record and keeps the form. A retry resends the identical
 * input (same clientId and revision); editing the form starts a new action.
 * A correction appends a version; the server keeps the old one.
 */
import { useRef, useState, type FormEvent } from "react";
import { Button, Dialog, Field, Notice, Select, TextArea, TextInput, describedBy } from "@/components/ui";
import type { FactCorrection, FactInput, MedicalFact } from "@/contracts/monitoring";
import type { AccessFence } from "@/lib/client/access-fence";
import type { PatientRecord } from "@/lib/client/api";
import { correctFact, getOnboarding, recordFact } from "@/lib/client/care-api";
import { CARE_COPY, factDisplayLabel } from "@/lib/client/copy/care";
import { createClientId } from "@/lib/client/ids";
import { staleResponseError, type ApiError } from "@/lib/client/transport";
import { colon } from "../bits";
import { usePatientRuntime } from "../PatientRuntime";
import { ApiErrorNotice } from "./ApiErrorNotice";
import { ChoiceGroup, choiceId } from "./ChoiceGroup";
import { captureAction, fencedCall, runAction, type ActionScope, type FencedCall } from "./fenced-call";
import { EmergencyLine } from "./EmergencyLine";
import { factNeedsEmergencyLine, polarityLabel } from "./onboarding-model";
import {
  FACT_KINDS,
  FACT_LIMITS,
  POLARITIES,
  applySavedFact,
  contextRevisionSource,
  draftFromFact,
  emptyFactDraft,
  toFactCorrection,
  toFactInput,
  validateFactDraft,
  type ContextRevisionSource,
  type FactDraft,
  type FactDraftErrors,
} from "./record-model";
import rec from "./record.module.css";

type PendingSave = { kind: "add"; input: FactInput } | { kind: "correct"; factId: string; input: FactCorrection };
type Outcome = { kind: "idle" } | { kind: "conflict" } | { kind: "error"; error: ApiError };

const FORM_ID = "fact-form";
const IDS = { kind: "fact-kind", label: "fact-label", polarity: "fact-polarity", value: "fact-value", reason: "fact-reason" };
const FOCUS_ORDER = ["label", "polarity", "reason"] as const;

interface FactDialogProps {
  patientId: string;
  /** null: declare a new fact. */
  fact: MedicalFact | null;
  onClose: () => void;
  /** The server saved the fact (already echoed into the record by the dialog). */
  onSaved: () => void;
}

export function FactDialog({ patientId, fact, onClose, onSaved }: FactDialogProps) {
  const { lang, t, data } = usePatientRuntime();
  const copy = CARE_COPY[lang];
  const mode = fact ? "correct" : "add";
  const [draft, setDraft] = useState<FactDraft>(() => (fact ? draftFromFact(fact) : emptyFactDraft()));
  const [errors, setErrors] = useState<FactDraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const pending = useRef<PendingSave | null>(null);
  // Bumped on every edit: an input prepared from an older draft is never kept for a retry.
  const draftVersion = useRef(0);

  const update = (patch: Partial<FactDraft>) => {
    pending.current = null;
    draftVersion.current += 1;
    setDraft((current) => ({ ...current, ...patch }));
    setErrors(({ label, polarity, reason }) => ({
      label: "label" in patch ? undefined : label,
      polarity: "polarity" in patch ? undefined : polarity,
      reason: "reason" in patch ? undefined : reason,
    }));
  };

  const fetchContextRevision = async (fence: AccessFence): Promise<FencedCall<number>> => {
    const read = () => fencedCall(fence, () => getOnboarding(patientId), (r) => r.meta.guard.authorityRevision);
    let context = await read();
    // Discarded because the authority moved: ask once more under the current authority.
    if (context.status === "stale" && !fence.denied()) context = await read();
    return context.status === "current" ? { status: "current", value: context.value.meta.guard.contextRevision } : context;
  };

  const prepare = async (fence: AccessFence, source: ContextRevisionSource): Promise<FencedCall<PendingSave>> => {
    if (pending.current) return { status: "current", value: pending.current };
    const version = draftVersion.current;
    // The live record (already admitted by the fence) carries the revision; fetch only without it.
    const context: FencedCall<number> =
      source.kind === "record" ? { status: "current", value: source.contextRevision } : await fetchContextRevision(fence);
    if (context.status !== "current") return context;
    const revision = context.value;
    const clientId = createClientId("fact");
    const save: PendingSave = fact
      ? { kind: "correct", factId: fact.id, input: toFactCorrection(draft, fact, revision, clientId) }
      : { kind: "add", input: toFactInput(draft, revision, clientId) };
    if (draftVersion.current === version) pending.current = save;
    return { status: "current", value: save };
  };

  // The saved fact is echoed only through this action's own (fence-bound) mutate.
  const send = (action: ActionScope<PatientRecord>, save: PendingSave) =>
    runAction(
      action,
      () => (save.kind === "add" ? recordFact(patientId, save.input) : correctFact(save.factId, save.input)),
      ({ fact: saved }) =>
        (current: PatientRecord) => ({ ...current, medicalFacts: applySavedFact(current.medicalFacts, saved) }),
    );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const found = validateFactDraft(draft, mode);
    setErrors(found);
    const first = FOCUS_ORDER.find((key) => found[key]);
    if (first) {
      document.getElementById(first === "polarity" ? choiceId(IDS.polarity, POLARITIES[0]) : IDS[first])?.focus();
      return;
    }
    // Everything after the first await uses only what is captured here.
    const action = captureAction(data);
    const source = contextRevisionSource(data.record, data.origin);
    setBusy(true);
    setOutcome({ kind: "idle" });
    const prepared = await prepare(action.fence, source);
    const result = prepared.status === "current" ? await send(action, prepared.value) : prepared;
    setBusy(false);
    if (result.status === "stale") {
      if (action.fence.denied()) return;
      // Saved but withheld (authority moved): show the record as the server now serves it.
      if (result.answered && prepared.status === "current") {
        pending.current = null;
        void action.refresh();
        onClose();
        return;
      }
      // Nothing confirmed: say so; a retry resends the same input.
      setOutcome({ kind: "error", error: staleResponseError() });
      return;
    }
    if (result.status === "error") {
      if (result.error.isConflict) {
        // The record moved on: reload it now; the patient's input stays in the form.
        pending.current = null;
        void action.refresh();
        setOutcome({ kind: "conflict" });
        return;
      }
      setOutcome({ kind: "error", error: result.error });
      return;
    }
    pending.current = null;
    onSaved();
  };

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>
        {t.common.cancel}
      </Button>
      <Button type="submit" form={FORM_ID} variant="primary" iconStart="check" loading={busy}>
        {busy ? copy.record.saving : copy.record.save}
      </Button>
    </>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={fact ? copy.record.correctionTitle : copy.record.addFact}
      description={fact ? copy.record.correctionHint : copy.record.unknownIsNotNo}
      footer={footer}
      closeLabel={t.common.close}
      closeOnBackdrop={false}
    >
      <form id={FORM_ID} className={rec.dialogForm} onSubmit={(event) => void submit(event)} noValidate>
        {fact ? (
          // The name shown is the display label; the input below keeps the stored label unchanged.
          <p className={rec.readonlyKind}>
            {copy.record.kindLabel}
            {colon(lang)}
            {copy.factKind[fact.kind]} · <bdi>{factDisplayLabel(fact, lang)}</bdi>
          </p>
        ) : (
          <Field label={copy.record.kindLabel} htmlFor={IDS.kind} required requiredLabel={t.common.required}>
            <Select id={IDS.kind} value={draft.kind} onChange={(event) => update({ kind: event.target.value as FactDraft["kind"] })}>
              {FACT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {copy.factKind[kind]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {factNeedsEmergencyLine(fact ? fact.kind : draft.kind) ? <EmergencyLine lang={lang} /> : null}
        <Field
          label={copy.record.labelLabel}
          htmlFor={IDS.label}
          error={errors.label ? copy.record.labelRequired : null}
          required
          requiredLabel={t.common.required}
        >
          <TextInput
            id={IDS.label}
            value={draft.label}
            maxLength={FACT_LIMITS.label}
            invalid={Boolean(errors.label)}
            aria-describedby={describedBy(IDS.label, { error: errors.label })}
            onChange={(event) => update({ label: event.target.value })}
          />
        </Field>
        <ChoiceGroup
          idPrefix={IDS.polarity}
          legend={copy.record.polarityLabel}
          smallLegend
          inline
          options={POLARITIES.map((polarity) => ({ value: polarity, label: polarityLabel(polarity, lang) }))}
          value={draft.polarity}
          onChange={(polarity) => update({ polarity })}
          error={errors.polarity ? copy.onboarding.required : null}
        />
        <Field label={copy.record.valueLabel} htmlFor={IDS.value}>
          <TextArea id={IDS.value} rows={3} value={draft.value} maxLength={FACT_LIMITS.value} onChange={(event) => update({ value: event.target.value })} />
        </Field>
        {fact ? (
          <Field
            label={copy.record.reasonLabel}
            htmlFor={IDS.reason}
            error={errors.reason ? copy.record.reasonRequired : null}
            required
            requiredLabel={t.common.required}
          >
            <TextArea
              id={IDS.reason}
              rows={2}
              value={draft.reason}
              maxLength={FACT_LIMITS.reason}
              invalid={Boolean(errors.reason)}
              aria-describedby={describedBy(IDS.reason, { error: errors.reason })}
              onChange={(event) => update({ reason: event.target.value })}
            />
          </Field>
        ) : null}
        {outcome.kind === "conflict" ? (
          <Notice
            tone="neutral"
            icon="refresh"
            role="alert"
            action={
              <Button variant="secondary" iconStart="refresh" onClick={() => void data.refresh()}>
                {t.common.refresh}
              </Button>
            }
          >
            {copy.onboarding.conflict}
          </Notice>
        ) : null}
        {outcome.kind === "error" ? <ApiErrorNotice error={outcome.error} lang={lang} /> : null}
      </form>
    </Dialog>
  );
}

"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Button, Dialog, Field, Notice, TextArea, describedBy, errorId } from "@/components/ui";
import type { CareProposal, ReusableProtocol } from "@/contracts/monitoring";
import { runFenced, type AccessFence } from "@/lib/client/access-fence";
import type { PatientRecord } from "@/lib/client/api";
import { PROTOCOL_FORM_LIMITS, createProtocol, reviseProtocol } from "@/lib/client/assist-api";
import { createClientId } from "@/lib/client/ids";
import { errorText } from "../shared/ApiErrorState";
import { fmtDateTime } from "../shared/time";
import { currentConditions } from "./coverage";
import type { CurrentContext } from "./use-current-context";
import { nextAttempt, type Attempt } from "./idempotency";
import { DISCARDED_OUTCOME, classifyConflict, type Outcome } from "./outcome";
import { PredicateEditor, type PredicateOptions } from "./PredicateEditor";
import {
  buildProtocolAuthorization,
  buildProtocolRevision,
  draftFromProtocol,
  eligibleSourceProposals,
  emptyProtocolDraft,
  type PredicateDraft,
  type PredicateListKey,
  type ProtocolFormDraft,
  type ProtocolFormErrors,
  type ProtocolFormField,
} from "./protocol-authorization";
import { BoundsFields, SourceField } from "./ProtocolFormFields";
import { formatSeconds } from "./protocol-text";
import styles from "./Care.module.css";

export interface ProtocolFormSession {
  /** null: new authorization; otherwise the protocol version being revised. */
  protocol: ReusableProtocol | null;
  /** Distinguishes two openings (resets the form). */
  nonce: number;
}

interface ProtocolFormProps {
  session: ProtocolFormSession | null;
  patientId: string;
  record: PatientRecord;
  /** Current server guard and plan-bound requirement ids (use-current-context). */
  context: CurrentContext;
  fence: AccessFence;
  onClose: () => void;
  onOutcome: (outcome: Outcome) => void;
  /** Ask the shared record to refetch (after a 409 the current guard must be reloaded). */
  onRefresh: () => void;
}

type Prepared = { ok: true; send: () => Promise<{ protocol: ReusableProtocol }> } | { ok: false; errors: ProtocolFormErrors };

const FIELD_ORDER: readonly ProtocolFormField[] = ["source", "template", "predicates", "exclusions", "stopCriteria", "validUntil", "minInterval", "maxApplications", "reason"];
const LISTS: readonly PredicateListKey[] = ["predicates", "exclusions", "stopCriteria"];

function sourceOptions(record: PatientRecord, patientId: string, protocol: ReusableProtocol | null): CareProposal[] {
  const eligible = eligibleSourceProposals(record.proposals, patientId);
  return protocol ? eligible.filter((p) => p.id === protocol.sourceProposalId) : eligible;
}

function predicateOptions(record: PatientRecord, patientId: string, requirementIds: readonly string[] | null): PredicateOptions {
  const bindings = record.plan?.state === "active" ? record.plan.profileBindings : [];
  return {
    conditions: currentConditions(record.medicalFacts).filter((f) => bindings.some((b) => b.conditionFactId === f.id)),
    facts: record.medicalFacts.filter((f) => f.patientId === patientId && !f.supersededBy),
    // Exact requirement ids bound in the active plan, sent by the server to care managers.
    requirementSuggestions: requirementIds ?? [],
  };
}

function savedMessage(saved: ReusableProtocol, revised: boolean): string {
  return revised
    ? `Nouvelle version ${saved.revision} du protocole enregistrée par le serveur. Les applications passées gardent leur version d’origine.`
    : `Protocole autorisé (version ${saved.revision}) jusqu’au ${fmtDateTime(saved.validUntil)}, ${saved.maxApplications} application(s) au plus.`;
}

/** Explicit bounded reuse of an approved home measurement. Separate from "Valider une fois". */
export function ProtocolForm({ session, patientId, record, context, fence, onClose, onOutcome, onRefresh }: ProtocolFormProps) {
  const prefix = useId();
  const ids = { source: `${prefix}-source`, validUntil: `${prefix}-valid`, minInterval: `${prefix}-interval`, maxApplications: `${prefix}-count`, reason: `${prefix}-reason` };
  const protocol = session?.protocol ?? null;
  const options = sourceOptions(record, patientId, protocol);
  const [sessionKey, setSessionKey] = useState<number | null>(null);
  const [draft, setDraft] = useState<ProtocolFormDraft>(() => emptyProtocolDraft(""));
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<ProtocolFormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const key = session?.nonce ?? null;
  if (key !== sessionKey) {
    setSessionKey(key);
    const only = options.length === 1 ? options[0] : null;
    if (session) setDraft(session.protocol ? draftFromProtocol(session.protocol) : emptyProtocolDraft(only?.id ?? "", only?.action.templateId ?? ""));
    setReason("");
    setErrors({});
    setFailure(null);
    setAttempt(null);
  }

  // List errors render after this commit: focus them once they exist.
  useEffect(() => {
    if (!focusTarget) return;
    document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  const update = (patch: Partial<ProtocolFormDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const setList = (listKey: PredicateListKey, next: PredicateDraft[]) => setDraft((current) => ({ ...current, [listKey]: next }));

  const firstErrorTarget = (found: ProtocolFormErrors): string | null => {
    const first = FIELD_ORDER.find((field) => found[field]);
    if (!first) return null;
    const list = LISTS.find((listKey) => listKey === first);
    return list ? errorId(`${prefix}-${list}`) : first === "template" ? ids.source : ids[first as keyof typeof ids];
  };

  /** Validated request; the key is reused only for an identical payload. */
  const prepare = (): Prepared => {
    const proposal = record.proposals.find((p) => p.id === draft.sourceProposalId);
    const ctx = {
      patientId,
      proposal,
      facts: record.medicalFacts,
      plan: record.plan,
      currentGuard: context.guard,
      requirementIds: context.requirementIds,
      now: new Date(),
      clientId: "",
    };
    const keyed = <T extends { clientId: string }>(input: T) => {
      const next = nextAttempt(attempt, input, () => createClientId("protocol"));
      return { next, input: { ...input, clientId: next.clientId } };
    };
    if (protocol) {
      const built = buildProtocolRevision(protocol, draft, ctx, reason);
      if (!built.ok) return built;
      const { next, input } = keyed(built.input);
      setAttempt(next);
      return { ok: true, send: () => reviseProtocol(protocol.id, input) };
    }
    const built = buildProtocolAuthorization(draft, ctx);
    if (!built.ok) return built;
    const { next, input } = keyed(built.input);
    setAttempt(next);
    return { ok: true, send: () => createProtocol(patientId, input) };
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session || busy) return;
    setFailure(null);
    const prepared = prepare();
    if (!prepared.ok) {
      setErrors(prepared.errors);
      setFocusTarget(firstErrorTarget(prepared.errors));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const result = await runFenced(fence, prepared.send);
      onOutcome(result.status === "current" ? { ok: true, text: savedMessage(result.value.protocol, protocol !== null) } : DISCARDED_OUTCOME);
    } catch (error) {
      const conflict = classifyConflict(error);
      // 409: keep the form, show the server's reason, reload the current guard (a changed payload gets a new key).
      setFailure(conflict.kind === "other" ? errorText(error) : conflict.text);
      if (conflict.kind !== "other") onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const previous = protocol
    ? {
        validUntil: ` Version ${protocol.revision} : ${fmtDateTime(protocol.validUntil)}.`,
        minInterval: ` Version ${protocol.revision} : ${formatSeconds(protocol.minIntervalSeconds)}.`,
        maxApplications: ` Version ${protocol.revision} : ${protocol.maxApplications}.`,
      }
    : { validUntil: "", minInterval: "", maxApplications: "" };
  const hints = {
    validUntil: `Au plus ${PROTOCOL_FORM_LIMITS.validityDaysMax} jours. Heure de cet appareil.${previous.validUntil}`,
    minInterval: `Délai minimal entre deux applications, entre ${PROTOCOL_FORM_LIMITS.minIntervalHoursMin} et ${PROTOCOL_FORM_LIMITS.minIntervalHoursMax} h.${previous.minInterval}`,
    maxApplications: `Entre ${PROTOCOL_FORM_LIMITS.maxApplicationsMin} et ${PROTOCOL_FORM_LIMITS.maxApplicationsMax}.${previous.maxApplications}`,
  };
  const formId = `${prefix}-form`;
  const predicates = predicateOptions(record, patientId, context.requirementIds);

  return (
    <Dialog
      open={session !== null}
      onClose={() => (busy ? undefined : onClose())}
      closeOnBackdrop={false}
      size="lg"
      title={protocol ? `Réviser le protocole (version ${protocol.revision})` : "Autoriser une réutilisation bornée"}
      description="Distinct de « Valider une fois ». Le serveur revérifie toutes les conditions à chaque application ; une donnée inconnue, un changement de contexte, une révocation ou l’expiration bloque la réutilisation."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={busy}>
            {protocol ? "Enregistrer la nouvelle version" : "Autoriser une réutilisation bornée"}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
        <p className={styles.mutedBlock}>
          Aucune valeur n’est préremplie : durée, fréquence et nombre sont vos décisions. Premier usage de démonstration : mesure à domicile
          uniquement, jamais un examen ni un changement de traitement.
        </p>
        <SourceField
          id={ids.source}
          options={options}
          value={draft.sourceProposalId}
          locked={protocol !== null}
          error={errors.source ?? errors.template}
          onPick={(picked) => update({ sourceProposalId: picked?.id ?? "", templateId: picked?.action.templateId ?? "" })}
        />
        {LISTS.map((listKey) => (
          <PredicateEditor
            key={listKey}
            listKey={listKey}
            idPrefix={prefix}
            drafts={draft[listKey]}
            onChange={(next) => setList(listKey, next)}
            error={errors[listKey]}
            options={predicates}
          />
        ))}
        <BoundsFields ids={ids} draft={draft} errors={errors} hints={hints} onChange={update} />
        {protocol ? (
          <Field label="Motif de la révision" htmlFor={ids.reason} error={errors.reason} required>
            <TextArea
              id={ids.reason}
              rows={3}
              maxLength={PROTOCOL_FORM_LIMITS.reasonMax}
              value={reason}
              invalid={Boolean(errors.reason)}
              aria-describedby={describedBy(ids.reason, { error: errors.reason })}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        ) : null}
        {failure ? (
          <Notice tone="neutral" icon="x-circle" role="alert" title="Aucune autorisation enregistrée">
            {failure}
          </Notice>
        ) : null}
      </form>
    </Dialog>
  );
}

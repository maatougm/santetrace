"use client";

import { Field, Select, TextInput, describedBy } from "@/components/ui";
import type { CareProposal } from "@/contracts/monitoring";
import { templateText } from "@/lib/client/copy/care";
import type { ProtocolFormDraft, ProtocolFormErrors } from "./protocol-authorization";
import styles from "./Care.module.css";

interface SourceFieldProps {
  id: string;
  /** Approved home measurements offered (revision: only the protocol's own source). */
  options: readonly CareProposal[];
  value: string;
  locked: boolean;
  error: string | undefined;
  onPick: (proposal: CareProposal | null) => void;
}

/** The approved proposal being reused, and its exact action (never editable here). */
export function SourceField({ id, options, value, locked, error, onPick }: SourceFieldProps) {
  const source = options.find((p) => p.id === value) ?? null;
  const hint = locked ? "Une révision garde la même proposition source et la même action." : "Mesures à domicile déjà validées une fois pour ce patient.";
  return (
    <>
      <Field label="Proposition validée à réutiliser" htmlFor={id} hint={hint} error={error} required>
        <Select
          id={id}
          value={source ? value : ""}
          disabled={locked}
          invalid={Boolean(error)}
          aria-describedby={describedBy(id, { hint, error })}
          onChange={(e) => onPick(options.find((p) => p.id === e.target.value) ?? null)}
        >
          <option value="">{options.length === 0 ? "Aucune mesure à domicile validée" : "Choisir…"}</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {templateText(p.action.templateId, "fr")} — révision {p.revision}
            </option>
          ))}
        </Select>
      </Field>
      {source ? (
        <p className={styles.row}>
          <span className={styles.strongText}>Action autorisée :</span>
          <span>{templateText(source.action.templateId, "fr")}</span>
          <bdi className={styles.mono}>
            {source.action.templateId} · v{source.action.templateVersion}
          </bdi>
          <span className={styles.muted}>(identique à la proposition validée)</span>
        </p>
      ) : null}
    </>
  );
}

export interface BoundsIds {
  validUntil: string;
  minInterval: string;
  maxApplications: string;
}

interface BoundsFieldsProps {
  ids: BoundsIds;
  draft: ProtocolFormDraft;
  errors: ProtocolFormErrors;
  hints: Record<keyof BoundsIds, string>;
  onChange: (patch: Partial<ProtocolFormDraft>) => void;
}

/** Validity, minimum interval and maximum count: typed by the clinician, never pre-filled. */
export function BoundsFields({ ids, draft, errors, hints, onChange }: BoundsFieldsProps) {
  return (
    <div className={styles.formGrid}>
      <Field label="Valable jusqu’au" htmlFor={ids.validUntil} hint={hints.validUntil} error={errors.validUntil} required>
        <TextInput
          id={ids.validUntil}
          type="datetime-local"
          value={draft.validUntil}
          invalid={Boolean(errors.validUntil)}
          aria-describedby={describedBy(ids.validUntil, { hint: hints.validUntil, error: errors.validUntil })}
          onChange={(e) => onChange({ validUntil: e.target.value })}
        />
      </Field>
      <Field label="Intervalle minimal" htmlFor={ids.minInterval} hint={hints.minInterval} error={errors.minInterval} required>
        <TextInput
          id={ids.minInterval}
          inputMode="numeric"
          suffix="h"
          value={draft.minIntervalHours}
          invalid={Boolean(errors.minInterval)}
          aria-describedby={describedBy(ids.minInterval, { hint: hints.minInterval, error: errors.minInterval })}
          onChange={(e) => onChange({ minIntervalHours: e.target.value })}
        />
      </Field>
      <Field label="Nombre maximal d’applications" htmlFor={ids.maxApplications} hint={hints.maxApplications} error={errors.maxApplications} required>
        <TextInput
          id={ids.maxApplications}
          inputMode="numeric"
          value={draft.maxApplications}
          invalid={Boolean(errors.maxApplications)}
          aria-describedby={describedBy(ids.maxApplications, { hint: hints.maxApplications, error: errors.maxApplications })}
          onChange={(e) => onChange({ maxApplications: e.target.value })}
        />
      </Field>
    </div>
  );
}

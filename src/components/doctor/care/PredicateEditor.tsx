"use client";

import { useState, type ReactNode } from "react";
import { Button, Field, Select, TextInput, errorId, hintId } from "@/components/ui";
import type { MedicalFact, Polarity } from "@/contracts/monitoring";
import { CARE_COPY } from "@/lib/client/copy/care";
import {
  CHECKABLE_POLARITIES,
  PREDICATE_KINDS,
  PREDICATE_LIMITS,
  emptyPredicate,
  type PredicateDraft,
  type PredicateKind,
  type PredicateListKey,
} from "./protocol-predicates";
import { factLabel } from "./fact-labels";
import { PREDICATE_KIND_LABEL, PREDICATE_LIST_LABEL } from "./protocol-text";
import styles from "./Care.module.css";

const copy = CARE_COPY.fr;

export interface PredicateOptions {
  /** Current affirmed conditions bound to a profile of the active plan (priority predicates). */
  conditions: readonly MedicalFact[];
  /** Current facts of this patient (fact predicates). */
  facts: readonly MedicalFact[];
  /** Exact requirement ids bound in the active plan (record.requirementIds); empty when not sent. */
  requirementSuggestions: readonly string[];
}

interface PredicateEditorProps {
  listKey: PredicateListKey;
  idPrefix: string;
  drafts: readonly PredicateDraft[];
  onChange: (next: PredicateDraft[]) => void;
  error?: string | null;
  options: PredicateOptions;
}

interface RowProps {
  draft: PredicateDraft;
  id: string;
  datalistId: string;
  options: PredicateOptions;
  onChange: (next: PredicateDraft) => void;
}

function PredicateFields({ draft, id, datalistId, options, onChange }: RowProps): ReactNode {
  switch (draft.kind) {
    case "priority_equals":
      return (
        <>
          <Field label="Maladie" htmlFor={`${id}-fact`} required>
            <Select id={`${id}-fact`} value={draft.conditionFactId} onChange={(e) => onChange({ ...draft, conditionFactId: e.target.value })}>
              <option value="">Choisir…</option>
              {options.conditions.map((f) => (
                <option key={f.id} value={f.id}>
                  {factLabel(f)}
                </option>
              ))}
            </Select>
          </Field>
          <p className={styles.mutedBlock}>Priorité attendue : « Suivi requis » (orange), jamais rouge.</p>
        </>
      );
    case "evidence_fresh":
      return (
        <>
          <Field label="Exigence de suivi" htmlFor={`${id}-req`} required>
            <TextInput id={`${id}-req`} list={datalistId} value={draft.requirementId} onChange={(e) => onChange({ ...draft, requirementId: e.target.value })} />
          </Field>
          <Field label="Âge maximal de la donnée" htmlFor={`${id}-age`} required>
            <TextInput
              id={`${id}-age`}
              inputMode="numeric"
              suffix="h"
              value={draft.maxAgeHours}
              onChange={(e) => onChange({ ...draft, maxAgeHours: e.target.value })}
            />
          </Field>
        </>
      );
    case "fact_equals":
      return (
        <>
          <Field label="Information du dossier" htmlFor={`${id}-fact`} required>
            <Select id={`${id}-fact`} value={draft.factId} onChange={(e) => onChange({ ...draft, factId: e.target.value })}>
              <option value="">Choisir…</option>
              {options.facts.map((f) => (
                <option key={f.id} value={f.id}>
                  {copy.factKind[f.kind]} : {factLabel(f)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Réponse" htmlFor={`${id}-polarity`} required>
            <Select id={`${id}-polarity`} value={draft.polarity} onChange={(e) => onChange({ ...draft, polarity: e.target.value as Polarity | "" })}>
              <option value="">Choisir…</option>
              {CHECKABLE_POLARITIES.map((p) => (
                <option key={p} value={p}>
                  {copy.polarity[p]}
                </option>
              ))}
            </Select>
          </Field>
        </>
      );
    case "requirements_complete":
      return (
        <>
          <Field label="Exigences (séparées par des virgules)" htmlFor={`${id}-reqs`} required>
            <TextInput id={`${id}-reqs`} list={datalistId} value={draft.requirementIds} onChange={(e) => onChange({ ...draft, requirementIds: e.target.value })} />
          </Field>
          <p className={styles.mutedBlock}>Toutes doivent être complètes et à jour.</p>
        </>
      );
  }
}

/** Closed-union predicate list: the clinician adds each condition explicitly; nothing is pre-filled. */
export function PredicateEditor({ listKey, idPrefix, drafts, onChange, error, options }: PredicateEditorProps) {
  const [kind, setKind] = useState<PredicateKind>("evidence_fresh");
  const label = PREDICATE_LIST_LABEL[listKey];
  const groupId = `${idPrefix}-${listKey}`;
  const datalistId = `${groupId}-requirements`;
  const full = drafts.length >= PREDICATE_LIMITS.perListMax;

  return (
    <fieldset className={styles.fieldset} aria-describedby={[hintId(groupId), error ? errorId(groupId) : null].filter(Boolean).join(" ")}>
      <legend className={styles.legend}>{label.title}</legend>
      <p id={hintId(groupId)} className={styles.mutedBlock}>
        {label.hint}
      </p>
      <datalist id={datalistId}>
        {options.requirementSuggestions.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      {drafts.length === 0 ? <p className={styles.mutedBlock}>Aucun élément.</p> : null}
      {drafts.map((draft, index) => (
        <div key={index} className={styles.predicateRow} role="group" aria-label={`${label.title} ${index + 1} : ${PREDICATE_KIND_LABEL[draft.kind]}`}>
          <PredicateFields
            draft={draft}
            id={`${groupId}-${index}`}
            datalistId={datalistId}
            options={options}
            onChange={(next) => onChange(drafts.map((d, i) => (i === index ? next : d)))}
          />
          <Button size="sm" variant="ghost" iconStart="x" onClick={() => onChange(drafts.filter((_, i) => i !== index))}>
            Retirer
          </Button>
        </div>
      ))}
      <div className={styles.row}>
        <Select id={`${groupId}-kind`} aria-label={`Type d’élément à ajouter (${label.title})`} value={kind} onChange={(e) => setKind(e.target.value as PredicateKind)}>
          {PREDICATE_KINDS.map((k) => (
            <option key={k} value={k}>
              {PREDICATE_KIND_LABEL[k]}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="secondary" iconStart="plus" disabled={full} onClick={() => onChange([...drafts, emptyPredicate(kind)])}>
          Ajouter
        </Button>
      </div>
      {error ? (
        <p id={errorId(groupId)} className={styles.fieldError} tabIndex={-1}>
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

"use client";

/**
 * Sections shared with one doctor. A primary referent receives every section
 * (shown ticked and locked). Missing composite dependencies are listed inline
 * as soon as they appear, so the patient sees why saving is blocked.
 */
import { Checkbox, Icon } from "@/components/ui";
import { SHARING_SCOPES, type SharingScope } from "@/contracts/patient-platform";
import { ACCESS_COPY } from "@/lib/client/copy/access";
import type { Language } from "@/lib/client/transport";
import choiceStyles from "../record/choice.module.css";
import styles from "./access.module.css";

export const scopeInputId = (idPrefix: string, scope: SharingScope) => `${idPrefix}-${scope}`;

export function scopeList(scopes: readonly SharingScope[], lang: Language): string {
  return scopes.map((scope) => ACCESS_COPY[lang].scope[scope]).join(lang === "ar" ? "، " : ", ");
}

interface ScopePickerProps {
  idPrefix: string;
  lang: Language;
  selected: readonly SharingScope[];
  /** Primary: every scope, not editable. */
  locked: boolean;
  missing: readonly SharingScope[];
  /** Shown after a submit attempt with nothing ticked. */
  emptyError: boolean;
  onChange: (scopes: SharingScope[]) => void;
}

export function ScopePicker({ idPrefix, lang, selected, locked, missing, emptyError, onChange }: ScopePickerProps) {
  const copy = ACCESS_COPY[lang];
  const noteId = `${idPrefix}-note`;
  const errorId = `${idPrefix}-error`;
  const message = missing.length > 0 ? copy.doctors.scopesMissing(scopeList(missing, lang)) : emptyError ? copy.doctors.scopesEmpty : null;
  const describedBy = [locked ? noteId : null, message ? errorId : null].filter(Boolean).join(" ") || undefined;
  const toggle = (scope: SharingScope) =>
    onChange(SHARING_SCOPES.filter((s) => (s === scope ? !selected.includes(s) : selected.includes(s))));

  return (
    <fieldset className={choiceStyles.fieldset}>
      <legend className={`${choiceStyles.legend} ${choiceStyles.legendSmall}`}>{copy.doctors.scopesLabel}</legend>
      {locked ? (
        <p id={noteId} className={styles.inlineNote}>
          {copy.doctors.scopesPrimaryNote}
        </p>
      ) : null}
      <div className={styles.scopeList}>
        {SHARING_SCOPES.map((scope) => (
          <Checkbox
            key={scope}
            id={scopeInputId(idPrefix, scope)}
            label={copy.scope[scope]}
            description={copy.scopeHint[scope]}
            checked={locked || selected.includes(scope)}
            disabled={locked}
            invalid={Boolean(message) && !locked}
            aria-describedby={describedBy}
            onChange={() => toggle(scope)}
          />
        ))}
      </div>
      {message ? (
        <p id={errorId} className={styles.missing}>
          <Icon name="x-circle" size={16} />
          <span>{message}</span>
        </p>
      ) : null}
    </fieldset>
  );
}

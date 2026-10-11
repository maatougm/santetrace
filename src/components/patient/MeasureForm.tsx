"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Button, Field, Icon, Notice, SegmentedControl, TextInput, describedBy } from "@/components/ui";
import type { GlucoseUnit, Language, MeasurementKind } from "@/lib/client/api";
import { formatNumber, toDateTimeLocalValue } from "@/lib/client/format";
import type { Messages } from "@/lib/client/i18n";
import type { MeasurementDraft } from "@/lib/client/outbox";
import { Ltr } from "./bits";
import { validateMeasure, type MeasureError, type MeasureField, type MeasureFormValues } from "./measure-validation";
import measure from "./measure.module.css";
import styles from "./patient.module.css";

const GLUCOSE_UNITS: readonly GlucoseUnit[] = ["mg/dL", "mmol/L"];

const FIELD_IDS: Record<MeasureField, string> = {
  systolic: "m-systolic",
  diastolic: "m-diastolic",
  glucose: "m-glucose",
  glucoseUnit: "m-unit-mg-dl",
  measuredAt: "m-measured-at",
};
const FIELD_ORDER: readonly MeasureField[] = ["glucoseUnit", "systolic", "diastolic", "glucose", "measuredAt"];

export function measureErrorText(error: MeasureError, t: Messages, lang: Language): string {
  if (error.code === "range") {
    return t.measure.errors.range(formatNumber(error.min, lang), formatNumber(error.max, lang), error.unit);
  }
  return t.measure.errors[error.code];
}

interface MeasureFormProps {
  values: MeasureFormValues;
  timeEdited: boolean;
  onChange: (values: MeasureFormValues, timeEdited: boolean) => void;
  onSubmit: (draft: MeasurementDraft) => void;
  lang: Language;
  t: Messages;
}

export function MeasureForm({ values, timeEdited, onChange, onSubmit, lang, t }: MeasureFormProps) {
  const [submitted, setSubmitted] = useState(false);
  const validation = useMemo(() => validateMeasure(values), [values]);
  const errors = submitted ? validation.errors : {};
  const errorFor = (field: MeasureField): string | null => {
    const error = errors[field];
    return error ? measureErrorText(error, t, lang) : null;
  };
  const set = (patch: Partial<MeasureFormValues>, editedTime = timeEdited) => onChange({ ...values, ...patch }, editedTime);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    // An untouched time means "now": refresh it at the moment of review.
    const current = timeEdited ? values : { ...values, measuredAtLocal: toDateTimeLocalValue() };
    if (!timeEdited) onChange(current, false);
    const result = validateMeasure(current);
    if (result.draft) {
      onSubmit(result.draft);
      return;
    }
    const first = FIELD_ORDER.find((field) => result.errors[field]);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
  };

  const kindOptions = [
    { value: "blood_pressure" as MeasurementKind, label: t.measure.kindBp, icon: "heart-pulse" as const },
    { value: "glucose" as MeasurementKind, label: t.measure.kindGlucose, icon: "droplet" as const },
  ];

  const hasErrors = submitted && Object.keys(validation.errors).length > 0;
  const unitError = errorFor("glucoseUnit");

  return (
    <form className={measure.form} onSubmit={handleSubmit} noValidate>
      {hasErrors ? (
        <Notice tone="neutral" icon="alert-triangle" role="alert">
          {t.measure.errors.summary}
        </Notice>
      ) : null}

      <div className={measure.block}>
        <p className={measure.blockLabel} id="m-kind-label">
          {t.measure.kindLabel}
        </p>
        <SegmentedControl<MeasurementKind>
          options={kindOptions}
          value={values.kind}
          onChange={(kind) => set({ kind })}
          ariaLabel={t.measure.kindLabel}
          size="lg"
          fullWidth
        />
      </div>

      {values.kind === "blood_pressure" ? (
        <div className={measure.pair}>
          <Field label={t.measure.systolic} htmlFor={FIELD_IDS.systolic} hint={t.measure.systolicHint} error={errorFor("systolic")} required requiredLabel={t.common.required}>
            <TextInput
              id={FIELD_IDS.systolic}
              className={measure.bigInput}
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="next"
              dir="ltr"
              value={values.systolic}
              onChange={(event) => set({ systolic: event.target.value })}
              invalid={Boolean(errorFor("systolic"))}
              aria-describedby={describedBy(FIELD_IDS.systolic, { hint: t.measure.systolicHint, error: errorFor("systolic") })}
              suffix={<Ltr>mmHg</Ltr>}
            />
          </Field>
          <Field label={t.measure.diastolic} htmlFor={FIELD_IDS.diastolic} hint={t.measure.diastolicHint} error={errorFor("diastolic")} required requiredLabel={t.common.required}>
            <TextInput
              id={FIELD_IDS.diastolic}
              className={measure.bigInput}
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="next"
              dir="ltr"
              value={values.diastolic}
              onChange={(event) => set({ diastolic: event.target.value })}
              invalid={Boolean(errorFor("diastolic"))}
              aria-describedby={describedBy(FIELD_IDS.diastolic, { hint: t.measure.diastolicHint, error: errorFor("diastolic") })}
              suffix={<Ltr>mmHg</Ltr>}
            />
          </Field>
        </div>
      ) : (
        <>
          <fieldset className={measure.unitFieldset} aria-describedby={unitError ? "m-unit-error" : "m-unit-hint"}>
            <legend className={measure.blockLabel}>
              {t.measure.unitLabel}
              <span className={styles.required} aria-hidden="true">
                {" *"}
              </span>
            </legend>
            <p className={measure.hint} id="m-unit-hint">
              {t.measure.unitHint}
            </p>
            <div className={measure.unitGrid}>
              {GLUCOSE_UNITS.map((unit) => (
                <label key={unit} className={`${measure.unitCard} ${values.glucoseUnit === unit ? measure.unitCardOn : ""}`}>
                  <input
                    type="radio"
                    id={unit === "mg/dL" ? FIELD_IDS.glucoseUnit : "m-unit-mmol-l"}
                    className={measure.unitRadio}
                    name="glucose-unit"
                    value={unit}
                    checked={values.glucoseUnit === unit}
                    onChange={() => set({ glucoseUnit: unit })}
                  />
                  <span className={measure.unitDot} aria-hidden="true" />
                  <bdi dir="ltr" className={measure.unitName}>
                    {unit}
                  </bdi>
                  <span className={measure.unitExample}>{t.measure.unitExample[unit]}</span>
                </label>
              ))}
            </div>
            {unitError ? (
              <p className={measure.fieldError} id="m-unit-error">
                <Icon name="alert-triangle" size={14} />
                {unitError}
              </p>
            ) : null}
          </fieldset>

          <Field label={t.measure.glucoseValue} htmlFor={FIELD_IDS.glucose} error={errorFor("glucose")} required requiredLabel={t.common.required}>
            <TextInput
              id={FIELD_IDS.glucose}
              className={measure.bigInput}
              inputMode="decimal"
              autoComplete="off"
              dir="ltr"
              value={values.glucose}
              onChange={(event) => set({ glucose: event.target.value })}
              invalid={Boolean(errorFor("glucose"))}
              aria-describedby={describedBy(FIELD_IDS.glucose, { error: errorFor("glucose") })}
              suffix={values.glucoseUnit ? <Ltr>{values.glucoseUnit}</Ltr> : undefined}
            />
          </Field>
        </>
      )}

      <Field label={t.measure.timeLabel} htmlFor={FIELD_IDS.measuredAt} hint={t.measure.timeHint} error={errorFor("measuredAt")} required requiredLabel={t.common.required}>
        <div className={measure.timeRow}>
          <TextInput
            id={FIELD_IDS.measuredAt}
            type="datetime-local"
            className={measure.timeInput}
            dir="ltr"
            value={values.measuredAtLocal}
            max={toDateTimeLocalValue()}
            onChange={(event) => set({ measuredAtLocal: event.target.value }, true)}
            invalid={Boolean(errorFor("measuredAt"))}
            aria-describedby={describedBy(FIELD_IDS.measuredAt, { hint: t.measure.timeHint, error: errorFor("measuredAt") })}
          />
          <Button variant="secondary" iconStart="clock" onClick={() => set({ measuredAtLocal: toDateTimeLocalValue() }, false)}>
            {t.measure.timeNow}
          </Button>
        </div>
      </Field>

      {validation.delayed && !errors.measuredAt ? (
        <Notice tone="neutral" icon="clock">
          {t.measure.delayedWarning}
        </Notice>
      ) : null}

      <Button type="submit" variant="primary" size="lg" fullWidth iconEnd="arrow-right">
        {t.measure.continue}
      </Button>
      <p className={styles.metaCenter}>{t.common.demoRules}</p>
    </form>
  );
}

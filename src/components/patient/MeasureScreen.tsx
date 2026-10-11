"use client";

/**
 * Measurement flow: form -> preview (nothing sent) -> confirm -> result.
 * At confirm time a clientId is generated ONCE, the entry is written to the
 * IndexedDB outbox, and only then is the first network attempt made.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { LinkButton, PageHeader } from "@/components/ui";
import { describeApiError, type MeasurementResponse, type PatientRecord } from "@/lib/client/api";
import { SHARE_COPY } from "@/lib/client/copy/share";
import { toDateTimeLocalValue } from "@/lib/client/format";
import { createMeasurementEntry, enqueue, sendEntry, type MeasurementDraft, type MeasurementEntry } from "@/lib/client/outbox";
import type { Messages } from "@/lib/client/i18n";
import { evaluateLocally } from "./local-evaluation";
import { MeasureForm } from "./MeasureForm";
import { MeasurePreview } from "./MeasurePreview";
import { MeasureResult } from "./MeasureResult";
import type { MeasureFormValues } from "./measure-validation";
import { usePatientRuntime } from "./PatientRuntime";
import { LoadingBlock } from "./RecordGate";
import measure from "./measure.module.css";
import styles from "./patient.module.css";

type Step =
  | { name: "form" }
  | { name: "preview"; draft: MeasurementDraft }
  | { name: "result"; entry: MeasurementEntry; persisted: boolean };

const STEP_ORDER: Step["name"][] = ["form", "preview", "result"];

function initialValues(): MeasureFormValues {
  return { kind: "blood_pressure", systolic: "", diastolic: "", glucose: "", glucoseUnit: null, measuredAtLocal: toDateTimeLocalValue() };
}

function mergeResult(record: PatientRecord, result: MeasurementResponse): PatientRecord {
  const hasMeasurement = record.measurements.some((m) => m.id === result.measurement.id);
  const alert = result.alert;
  const hasAlert = alert ? record.alerts.some((a) => a.id === alert.id) : true;
  return {
    ...record,
    measurements: hasMeasurement ? record.measurements : [...record.measurements, result.measurement],
    alerts: hasAlert || !alert ? record.alerts : [...record.alerts, alert],
  };
}

function StepIndicator({ current, t }: { current: Step["name"]; t: Messages }) {
  const index = STEP_ORDER.indexOf(current);
  return (
    <ol className={measure.steps}>
      {STEP_ORDER.map((name, position) => (
        <li
          key={name}
          className={`${measure.step} ${position < index ? measure.stepDone : ""} ${position === index ? measure.stepCurrent : ""}`}
          aria-current={position === index ? "step" : undefined}
        >
          <span className={measure.stepNumber} aria-hidden="true">
            {position + 1}
          </span>
          <span>{t.measure.steps[name]}</span>
        </li>
      ))}
    </ol>
  );
}

export function MeasureScreen() {
  const { t, lang, scope, data, outbox, online, setLastResult } = usePatientRuntime();
  const [values, setValues] = useState<MeasureFormValues>(initialValues);
  const [timeEdited, setTimeEdited] = useState(false);
  const [step, setStep] = useState<Step>({ name: "form" });
  const [sending, setSending] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const { mutate, refresh } = data;

  useEffect(() => {
    if (step.name === "form") return;
    topRef.current?.scrollIntoView({ block: "start" });
    const heading = document.getElementById(step.name === "preview" ? "m-preview-title" : "m-result-title");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
  }, [step.name]);

  const applyOutcome = useCallback(
    (sent: MeasurementEntry) => {
      const result = sent.result;
      if (sent.state !== "server_received" || !result) return;
      mutate((record) => mergeResult(record, result));
      setLastResult(sent);
      void refresh();
    },
    [mutate, refresh, setLastResult],
  );

  const confirm = async (draft: MeasurementDraft) => {
    if (!scope || sending) return;
    setSending(true);
    setConfirmError(null);
    try {
      const rules = data.record?.patient.rules ?? null;
      const evaluation = rules ? evaluateLocally(draft, rules, data.rulesConfirmedAt) : null;
      const entry = createMeasurementEntry(scope, draft, evaluation);
      let persisted = true;
      try {
        await enqueue(entry);
      } catch {
        persisted = false;
      }
      const sent = await sendEntry(entry, { persist: persisted });
      applyOutcome(sent);
      setStep({ name: "result", entry: sent, persisted });
    } catch (error) {
      setConfirmError(describeApiError(error, lang).message);
    } finally {
      setSending(false);
    }
  };

  const retry = async () => {
    if (step.name !== "result") return;
    setRetrying(true);
    try {
      if (step.persisted) {
        // Stored entries replay from IndexedDB (fresh state, oldest first); the
        // result screen follows the stored entry live.
        await outbox.replay();
        return;
      }
      const sent = await sendEntry(step.entry, { persist: false });
      applyOutcome(sent);
      setStep({ ...step, entry: sent });
    } finally {
      setRetrying(false);
    }
  };

  const startNew = () => {
    setValues(initialValues());
    setTimeEdited(false);
    setConfirmError(null);
    setStep({ name: "form" });
  };

  const correct = async () => {
    if (step.name === "result" && step.persisted) {
      try {
        // The refused entry is replaced by the corrected one (new clientId at confirm).
        await outbox.discard(step.entry.clientId);
      } catch {
        // The refused entry stays visible in the history; correcting continues.
      }
    }
    setStep({ name: "form" });
  };

  return (
    <div className={styles.page} ref={topRef}>
      <PageHeader
        title={t.measure.title}
        actions={
          <LinkButton href="/patient/measure/devices" variant="ghost" iconStart="activity">
            {SHARE_COPY[lang].simulator.title}
          </LinkButton>
        }
      />
      <StepIndicator current={step.name} t={t} />
      {!scope ? <LoadingBlock label={t.common.loading} /> : null}
      {scope && step.name === "form" ? (
        <MeasureForm
          values={values}
          timeEdited={timeEdited}
          lang={lang}
          t={t}
          onChange={(next, edited) => {
            setValues(next);
            setTimeEdited(edited);
          }}
          onSubmit={(draft) => setStep({ name: "preview", draft })}
        />
      ) : null}
      {scope && step.name === "preview" ? (
        <MeasurePreview
          draft={step.draft}
          lang={lang}
          t={t}
          online={online}
          sending={sending}
          error={confirmError}
          onEdit={() => setStep({ name: "form" })}
          onConfirm={() => void confirm(step.draft)}
        />
      ) : null}
      {scope && step.name === "result" ? (
        <MeasureResult
          entry={step.entry}
          persisted={step.persisted}
          retrying={retrying}
          onRetry={() => void retry()}
          onCorrect={() => void correct()}
          onNew={startNew}
        />
      ) : null}
    </div>
  );
}

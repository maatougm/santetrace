"use client";

/**
 * Sends one simulated reading through a paired simulator. Each reading gets
 * one externalEventId (reused on retry of the same unconfirmed reading);
 * "Renvoyer la même mesure" retransmits the identical event so the server's
 * deduplication is visible. Only the server receipt is shown as received.
 */
import { useId, useState, type FormEvent } from "react";
import { Badge, Button, Card, Field, Notice, SegmentedControl, Select, TextInput, describedBy, type SegmentedOption } from "@/components/ui";
import type { ConnectorEvent } from "@/contracts/monitoring";
import { runFenced, type AccessFence } from "@/lib/client/access-fence";
import { SHARE_COPY } from "@/lib/client/copy/share";
import { sendSimulatedReading, type ConnectorView, type MeasurementReceipt } from "@/lib/client/devices-api";
import { formatNumber, toDateTimeLocalValue } from "@/lib/client/format";
import { createClientId } from "@/lib/client/ids";
import { toApiError, type ApiError, type Language } from "@/lib/client/transport";
import { Ltr } from "../bits";
import { usePatientRuntime } from "../PatientRuntime";
import { ApiErrorNotice } from "../share/ApiErrorNotice";
import { SimulatedReadingResult } from "./SimulatedReadingResult";
import {
  eventForSend,
  resendEvent,
  selectableSimulators,
  simulatorBounds,
  validateSimulatorDraft,
  type GlucoseUnit,
  type SentReading,
  type SimulatorDraft,
  type SimulatorError,
  type SimulatorField,
  type SimulatorKind,
} from "./simulator-logic";
import dev from "./devices.module.css";
import styles from "../patient.module.css";

const FIELD_ORDER: readonly SimulatorField[] = ["systolic", "diastolic", "value", "measuredAt"];

function initialDraft(): SimulatorDraft {
  return {
    kind: "blood_pressure",
    systolic: "",
    diastolic: "",
    value: "",
    glucoseUnit: "mmol/L",
    measuredAtLocal: toDateTimeLocalValue(),
    quality: "accepted",
  };
}

function BoundsHint({ field, draft, lang }: { field: Exclude<SimulatorField, "measuredAt">; draft: SimulatorDraft; lang: Language }) {
  const bounds = simulatorBounds(field, draft.kind, draft.glucoseUnit);
  return (
    <Ltr>
      {formatNumber(bounds.min, lang)}–{formatNumber(bounds.max, lang)} {bounds.unit}
    </Ltr>
  );
}

interface NumberFieldProps {
  id: string;
  field: Exclude<SimulatorField, "measuredAt">;
  label: string;
  draft: SimulatorDraft;
  error: string | null;
  lang: Language;
  requiredLabel: string;
  onChange: (value: string) => void;
}

function NumberField({ id, field, label, draft, error, lang, requiredLabel, onChange }: NumberFieldProps) {
  const hint = <BoundsHint field={field} draft={draft} lang={lang} />;
  const unit = simulatorBounds(field, draft.kind, draft.glucoseUnit).unit;
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error} required requiredLabel={requiredLabel}>
      <TextInput
        id={id}
        inputMode={draft.kind === "glucose" ? "decimal" : "numeric"}
        autoComplete="off"
        dir="ltr"
        value={draft[field]}
        onChange={(event) => onChange(event.target.value)}
        invalid={Boolean(error)}
        aria-describedby={describedBy(id, { hint: true, error })}
        suffix={<Ltr>{unit}</Ltr>}
      />
    </Field>
  );
}

interface SimulatedReadingCardProps {
  patientId: string;
  fence: AccessFence;
  live: boolean;
  connectors: ConnectorView[];
  onReceived: () => void;
}

export function SimulatedReadingCard({ patientId, fence, live, connectors, onReceived }: SimulatedReadingCardProps) {
  const { lang, t } = usePatientRuntime();
  const copy = SHARE_COPY[lang].simulator;
  const base = useId();
  const fieldId = (field: SimulatorField | "connector") => `${base}-${field}`;

  // Enabled simulators only: a real-device binding never sends simulated readings.
  const enabled = selectableSimulators(connectors);
  const [connectorId, setConnectorId] = useState("");
  const selected = enabled.find((c) => c.id === connectorId) ?? enabled[0] ?? null;
  const [draft, setDraft] = useState<SimulatorDraft>(initialDraft);
  const [errors, setErrors] = useState<Partial<Record<SimulatorField, SimulatorError>>>({});
  const [last, setLast] = useState<{ sent: SentReading; connectorId: string } | null>(null);
  const [receipt, setReceipt] = useState<MeasurementReceipt | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<"send" | "resend" | null>(null);

  const set = (patch: Partial<SimulatorDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const errorText = (field: SimulatorField): string | null => {
    const error = errors[field];
    return error ? copy[error] : null;
  };

  const transmit = async (targetId: string, event: ConnectorEvent, mode: "send" | "resend") => {
    setBusy(mode);
    setFailure(null);
    setReceipt(null);
    try {
      const result = await runFenced(fence, () => sendSimulatedReading(patientId, targetId, event));
      if (result.status === "current") {
        setReceipt(result.value);
        setLast({ sent: { event, received: true }, connectorId: targetId });
        onReceived();
      }
    } catch (caught) {
      setFailure(toApiError(caught));
    } finally {
      setBusy(null);
    }
  };

  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || busy !== null) return;
    const validation = validateSimulatorDraft(draft);
    if (!validation.ok) {
      setErrors(validation.errors);
      const first = FIELD_ORDER.find((field) => validation.errors[field]);
      if (first) document.getElementById(fieldId(first))?.focus();
      return;
    }
    setErrors({});
    if (!live) return;
    const previous = last?.connectorId === selected.id ? last.sent : null;
    const next = eventForSend(validation.body, previous, () => createClientId("sim-event"));
    setLast({ sent: { event: next, received: false }, connectorId: selected.id });
    void transmit(selected.id, next, "send");
  };

  const resend = () => {
    if (last && live && busy === null) void transmit(last.connectorId, resendEvent(last.sent), "resend");
  };

  const kindOptions: SegmentedOption<SimulatorKind>[] = [
    { value: "blood_pressure", label: copy.kind.blood_pressure, icon: "heart-pulse" },
    { value: "glucose", label: copy.kind.glucose, icon: "droplet" },
    { value: "pulse", label: copy.kind.pulse, icon: "activity" },
  ];
  const unitOptions: SegmentedOption<GlucoseUnit>[] = [
    { value: "mg/dL", label: <Ltr>mg/dL</Ltr> },
    { value: "mmol/L", label: <Ltr>mmol/L</Ltr> },
  ];
  const qualityOptions: SegmentedOption<SimulatorDraft["quality"]>[] = [
    { value: "accepted", label: copy.quality.accepted },
    { value: "suspect", label: copy.quality.suspect },
  ];
  const numberProps = { draft, lang, requiredLabel: t.common.required };

  return (
    <div className={styles.stack}>
      <Card
        id="sim-send"
        title={copy.sendTitle}
        actions={
          <Badge tone="outline" icon="activity">
            {copy.badge}
          </Badge>
        }
      >
        {!selected ? (
          <Notice tone="neutral" icon="link">
            {copy.noConnector}
          </Notice>
        ) : (
          <form className={dev.form} onSubmit={send} noValidate>
            {enabled.length > 1 ? (
              <Field label={copy.deviceIdLabel} htmlFor={fieldId("connector")}>
                <Select id={fieldId("connector")} dir="ltr" value={selected.id} onChange={(event) => setConnectorId(event.target.value)}>
                  {enabled.map((connector) => (
                    <option key={connector.id} value={connector.id}>
                      {connector.deviceId}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            <div className={dev.block}>
              <p className={dev.blockLabel}>{copy.kindLabel}</p>
              <SegmentedControl<SimulatorKind> options={kindOptions} value={draft.kind} onChange={(kind) => set({ kind })} ariaLabel={copy.kindLabel} size="lg" fullWidth />
            </div>

            {draft.kind === "blood_pressure" ? (
              <div className={dev.pair}>
                <NumberField {...numberProps} id={fieldId("systolic")} field="systolic" label={copy.systolicLabel} error={errorText("systolic")} onChange={(systolic) => set({ systolic })} />
                <NumberField {...numberProps} id={fieldId("diastolic")} field="diastolic" label={copy.diastolicLabel} error={errorText("diastolic")} onChange={(diastolic) => set({ diastolic })} />
              </div>
            ) : (
              <>
                {draft.kind === "glucose" ? (
                  <div className={dev.block}>
                    <p className={dev.blockLabel}>{copy.unitLabel}</p>
                    <SegmentedControl<GlucoseUnit> options={unitOptions} value={draft.glucoseUnit} onChange={(glucoseUnit) => set({ glucoseUnit })} ariaLabel={copy.unitLabel} size="lg" />
                  </div>
                ) : null}
                <NumberField {...numberProps} id={fieldId("value")} field="value" label={copy.valueLabel} error={errorText("value")} onChange={(value) => set({ value })} />
              </>
            )}

            <Field label={copy.measuredAtLabel} htmlFor={fieldId("measuredAt")} hint={copy.measuredAtHint} error={errorText("measuredAt")} required requiredLabel={t.common.required}>
              <div className={dev.timeRow}>
                <TextInput
                  id={fieldId("measuredAt")}
                  type="datetime-local"
                  dir="ltr"
                  value={draft.measuredAtLocal}
                  onChange={(event) => set({ measuredAtLocal: event.target.value })}
                  invalid={Boolean(errorText("measuredAt"))}
                  aria-describedby={describedBy(fieldId("measuredAt"), { hint: copy.measuredAtHint, error: errorText("measuredAt") })}
                />
                <Button variant="secondary" iconStart="clock" onClick={() => set({ measuredAtLocal: toDateTimeLocalValue() })}>
                  {t.measure.timeNow}
                </Button>
              </div>
            </Field>

            <div className={dev.block}>
              <p className={dev.blockLabel}>{copy.qualityLabel}</p>
              <SegmentedControl<SimulatorDraft["quality"]> options={qualityOptions} value={draft.quality} onChange={(quality) => set({ quality })} ariaLabel={copy.qualityLabel} size="lg" fullWidth />
            </div>

            <Button type="submit" variant="primary" size="lg" fullWidth iconStart="send" loading={busy !== null} disabled={!live}>
              {busy !== null ? copy.sending : copy.send}
            </Button>
          </form>
        )}
      </Card>
      {/* Outside the form: a resend through a since-revoked simulator must still show its refusal. */}
      {failure ? <ApiErrorNotice error={failure} lang={lang} /> : null}
      {receipt ? <SimulatedReadingResult receipt={receipt} lang={lang} t={t} live={live && busy === null} resending={busy === "resend"} onResend={resend} /> : null}
    </div>
  );
}

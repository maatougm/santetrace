"use client";

/**
 * One explicit pairing form per kind (simulator or real device). Nothing is
 * sent until the owner submits; the request runs under the access fence and
 * its fenced result is handed up as is, so the caller decides (purely) whether
 * a credential may be shown.
 */
import { useId, useState, type FormEvent } from "react";
import { Button, Field, TextInput, describedBy } from "@/components/ui";
import { runFenced, type AccessFence, type FencedResult } from "@/lib/client/access-fence";
import { SHARE_COPY } from "@/lib/client/copy/share";
import type { ConnectorKind, PairResult } from "@/lib/client/devices-api";
import { createClientId } from "@/lib/client/ids";
import { toApiError, type ApiError, type Language } from "@/lib/client/transport";
import { usePatientRuntime } from "../PatientRuntime";
import { ApiErrorNotice } from "../share/ApiErrorNotice";
import { invalidatesList } from "../share/use-fenced-resource";
import { CLIENT_ID_PREFIX, PAIR_REQUEST, pairAttempt, type PairAttempt } from "./pairing-logic";
import { isValidDeviceId } from "./simulator-logic";
import dev from "./devices.module.css";

const DEFAULT_NAME: Readonly<Record<ConnectorKind, string>> = { simulator: "sim-demo-1", device: "" };

export interface PairFormProps {
  kind: ConnectorKind;
  patientId: string;
  fence: AccessFence;
  live: boolean;
  onSettled: (result: FencedResult<PairResult>) => void;
  /** 409 or access refused: the list is reloaded (and any shown credential wiped on denial). */
  onRefused: (error: ApiError) => void;
}

function formText(kind: ConnectorKind, lang: Language) {
  const simulator = SHARE_COPY[lang].simulator;
  const devices = SHARE_COPY[lang].devices;
  return kind === "device"
    ? { label: devices.deviceIdLabel, hint: devices.deviceIdHint, submit: devices.pair, icon: "link" as const }
    : { label: simulator.deviceIdLabel, hint: simulator.deviceIdHint, submit: simulator.pair, icon: "activity" as const };
}

export function PairForm({ kind, patientId, fence, live, onSettled, onRefused }: PairFormProps) {
  const { lang, t } = usePatientRuntime();
  const copy = SHARE_COPY[lang].simulator;
  const text = formText(kind, lang);
  const inputId = `${useId()}-${kind}`;
  const [deviceId, setDeviceId] = useState(DEFAULT_NAME[kind]);
  const [invalid, setInvalid] = useState(false);
  const [attempt, setAttempt] = useState<PairAttempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = deviceId.trim();
    if (!isValidDeviceId(trimmed)) {
      setInvalid(true);
      document.getElementById(inputId)?.focus();
      return;
    }
    setInvalid(false);
    if (!live) return;
    const current = pairAttempt(attempt, kind, trimmed, () => createClientId(CLIENT_ID_PREFIX[kind]));
    setAttempt(current);
    setBusy(true);
    setError(null);
    try {
      const pair = PAIR_REQUEST[kind];
      const result = await runFenced(fence, () => pair(patientId, { deviceId: current.deviceId, clientId: current.clientId }));
      if (result.status === "current") setAttempt(null);
      onSettled(result);
    } catch (caught) {
      const failure = toApiError(caught);
      setError(failure);
      if (invalidatesList(failure)) onRefused(failure);
    } finally {
      setBusy(false);
    }
  };

  const errorText = invalid ? copy.deviceIdInvalid : null;
  return (
    <form className={dev.pairForm} onSubmit={submit} noValidate>
      <div className={dev.pairRow}>
        <Field label={text.label} htmlFor={inputId} hint={text.hint} error={errorText} required requiredLabel={t.common.required}>
          <TextInput
            id={inputId}
            dir="ltr"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={40}
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
            invalid={invalid}
            aria-describedby={describedBy(inputId, { hint: text.hint, error: errorText })}
          />
        </Field>
        <Button type="submit" variant="secondary" iconStart={text.icon} loading={busy} disabled={!live}>
          {busy ? copy.pairing : text.submit}
        </Button>
      </div>
      {error ? <ApiErrorNotice error={error} lang={lang} /> : null}
    </form>
  );
}

"use client";

/**
 * Patient assistant (spec 006 story 4, FR-011/FR-025): fixed record queries
 * and a free question / health update. Online only: offline, no request is
 * made and no reply is invented. One clientId per question, reused on retry.
 * Every reply passes the access fence before it is shown.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  ErrorState,
  Field,
  Notice,
  PageHeader,
  SegmentedControl,
  TextArea,
  describedBy,
} from "@/components/ui";
import type { AssistantInput } from "@/contracts/monitoring";
import { runFenced } from "@/lib/client/access-fence";
import { describeApiError, toApiError, type ErrorDescription, type PatientRecord } from "@/lib/client/api";
import { askAssistant } from "@/lib/client/assist-api";
import { ASSIST_COPY } from "@/lib/client/copy/assist";
import { CARE_COPY } from "@/lib/client/copy/care";
import { createClientId } from "@/lib/client/ids";
import { RedEpisode } from "../monitoring/RedEpisodeBanner";
import { needsReferent } from "../monitoring/monitoring-view";
import { usePatientRuntime } from "../PatientRuntime";
import { RecordGate } from "../RecordGate";
import { AssistantReply } from "./AssistantReply";
import { replyView, validateQuestion, type QuestionError, type ReplyView } from "./assistant-view";
import patientStyles from "../patient.module.css";
import styles from "./plan.module.css";

type Topic = Extract<AssistantInput, { kind: "record_query" }>["topic"];
type FreeKind = Extract<AssistantInput, { kind: "question" | "health_update" }>["kind"];

const TOPICS: readonly Topic[] = ["next_action", "last_measurement", "plan_status"];
const QUESTION_ID = "assistant-question";

function useAssistant(patientId: string) {
  const { data, lang, online } = usePatientRuntime();
  const [pending, setPending] = useState<AssistantInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<ReplyView | null>(null);
  const [error, setError] = useState<ErrorDescription | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);
  // A revocation or authority change hides a reply (or error) obtained under the previous access.
  useEffect(
    () =>
      data.fence.subscribe(() => {
        setReply(null);
        setError(null);
      }),
    [data.fence],
  );

  const send = async (input: AssistantInput): Promise<boolean> => {
    if (!online) return false;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPending(input);
    setBusy(true);
    setError(null);
    setReply(null);
    try {
      const result = await runFenced(data.fence, () => askAssistant(patientId, input, { signal: controller.signal }));
      if (result.status === "stale") return false;
      setReply(replyView(result.value, input.kind));
      setPending(null);
      return true;
    } catch (caught) {
      const apiError = toApiError(caught);
      if (!apiError.isAborted) setError(describeApiError(apiError, lang));
      return false;
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setBusy(false);
      }
    }
  };

  return { busy, reply, error, send, retry: () => (pending ? send(pending) : Promise.resolve(false)) };
}

function AssistantBody({ record }: { record: PatientRecord }) {
  const { lang, data, online, t, careTeam } = usePatientRuntime();
  const copy = ASSIST_COPY[lang].assistant;
  const assistant = useAssistant(record.patient.id);
  const [kind, setKind] = useState<FreeKind>("question");
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<QuestionError | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const noReferent = needsReferent(record, data.origin);
  const disabled = !online || assistant.busy;

  const edit = (next: { text?: string; kind?: FreeKind }) => {
    if (next.text !== undefined) setText(next.text);
    if (next.kind !== undefined) setKind(next.kind);
    setDraftId(null); // A changed question is a new attempt.
    setFieldError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const invalid = validateQuestion(text);
    setFieldError(invalid);
    if (invalid) {
      document.getElementById(QUESTION_ID)?.focus();
      return;
    }
    const clientId = draftId ?? createClientId("assist");
    setDraftId(clientId);
    const sent = await assistant.send({ kind, question: text.trim(), clientId });
    if (sent) {
      setText("");
      setDraftId(null);
    }
  };

  const errorText = fieldError ? copy[fieldError] : null;
  return (
    <>
      <RedEpisode alerts={record.alerts} pendingDoctor={careTeam.status === "none"} />
      <Notice tone="neutral" icon="shield">
        {copy.noAdvice}
      </Notice>
      {noReferent ? <Notice tone="neutral" icon="user-plus">{copy.noReferent}</Notice> : null}
      {!online ? <Notice tone="neutral" icon="wifi-off">{copy.offline}</Notice> : null}

      <Card title={copy.topicsTitle}>
        <div className={styles.topics}>
          {TOPICS.map((topic) => (
            <Button
              key={topic}
              variant="secondary"
              size="lg"
              fullWidth
              iconEnd="chevron-right"
              disabled={disabled}
              onClick={() => void assistant.send({ kind: "record_query", topic, clientId: createClientId("assist") })}
            >
              {copy.topic[topic]}
            </Button>
          ))}
        </div>
      </Card>

      <Card title={copy.freeTitle}>
        <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
          <SegmentedControl<FreeKind>
            ariaLabel={copy.freeTitle}
            value={kind}
            onChange={(value) => edit({ kind: value })}
            options={[
              { value: "question", label: copy.kindQuestion },
              { value: "health_update", label: copy.kindUpdate },
            ]}
            fullWidth
          />
          <Field label={copy.freeLabel} htmlFor={QUESTION_ID} hint={copy.freeHint} error={errorText} required requiredLabel={t.common.required}>
            <TextArea
              id={QUESTION_ID}
              value={text}
              rows={4}
              dir="auto"
              readOnly={assistant.busy}
              invalid={Boolean(errorText)}
              aria-describedby={describedBy(QUESTION_ID, { hint: copy.freeHint, error: errorText })}
              onChange={(event) => edit({ text: event.target.value })}
            />
          </Field>
          <div className={styles.submit}>
            <Button type="submit" variant="primary" iconStart="send" loading={assistant.busy} disabled={disabled}>
              {assistant.busy ? copy.asking : copy.ask}
            </Button>
          </div>
        </form>
      </Card>

      <div className={patientStyles.stack} aria-live="polite" aria-busy={assistant.busy}>
        {assistant.error ? (
          <ErrorState
            title={assistant.error.title}
            message={assistant.error.message}
            code={assistant.error.code}
            onRetry={online ? () => void assistant.retry() : undefined}
            retryLabel={t.common.retry}
            retrying={assistant.busy}
          />
        ) : null}
        {assistant.reply ? <AssistantReply view={assistant.reply} lang={lang} /> : null}
      </div>
    </>
  );
}

export function AssistantScreen() {
  const { lang } = usePatientRuntime();
  const copy = ASSIST_COPY[lang].assistant;
  return (
    <div className={patientStyles.page}>
      <PageHeader title={copy.title} description={copy.description} back={{ href: "/patient/plan", label: CARE_COPY[lang].plan.title }} />
      <RecordGate>{(record) => <AssistantBody record={record} />}</RecordGate>
    </div>
  );
}

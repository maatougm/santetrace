"use client";

/**
 * Onboarding (spec 006, FR-004): registry questions chosen by the server,
 * answered Oui / Non / Je ne sais pas or in text, round after round until none
 * remain. "Je ne sais pas" is sent as unknown, never as "non". The AI mode is
 * always shown; a model failure shows the fixed-question fallback. A retry
 * resends the identical submission (same clientId); a 409 asks for a reload.
 */
import { useCallback, useRef, useState, type FormEvent } from "react";
import { Button, Card, EmptyState, ErrorState, Icon, LinkButton, Notice, PageHeader } from "@/components/ui";
import type { AiMeta, MedicalFact, OnboardingInput, OnboardingResponse } from "@/contracts/monitoring";
import { getOnboarding, submitOnboarding } from "@/lib/client/care-api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { createClientId } from "@/lib/client/ids";
import { describeApiError, staleResponseError, type ApiError, type Language } from "@/lib/client/transport";
import { usePatientRuntime } from "../PatientRuntime";
import { LoadingBlock, RecordGate } from "../RecordGate";
import { ApiErrorNotice } from "./ApiErrorNotice";
import { PolarityBadge, VerificationBadge } from "./FactItem";
import { captureAction, fencedCall } from "./fenced-call";
import {
  answeredCount,
  buildOnboardingInput,
  onboardingDoneBody,
  onboardingModeLine,
  questionNeedsEmergencyLine,
  savedFactsSummary,
  type AnswerChoice,
  type AnswerMap,
} from "./onboarding-model";
import { EmergencyLine } from "./EmergencyLine";
import { QuestionField, questionFocusId } from "./QuestionField";
import { useFencedRead } from "./use-fenced-read";
import styles from "../patient.module.css";
import rec from "./record.module.css";

type Outcome = { kind: "idle" } | { kind: "conflict" } | { kind: "error"; error: ApiError } | { kind: "saved"; facts: MedicalFact[] };

const authorityOf = (response: OnboardingResponse) => response.meta.guard.authorityRevision;

/** AI provenance from a closed list; an unrecognised mode shows nothing rather than a false label. */
function ModeNotice({ meta, lang }: { meta: AiMeta; lang: Language }) {
  const line = onboardingModeLine(meta, lang);
  if (!line) return null;
  if (line.style === "meta") {
    return (
      <p className={styles.metaLine}>
        <Icon name="info" size={14} /> {line.text}
      </p>
    );
  }
  return (
    <Notice tone="neutral" icon="info" role="note">
      {line.text}
    </Notice>
  );
}

/** Summary of what the server recorded; labels are computed in the current language, never raw codes. */
function SavedFacts({ facts, lang }: { facts: readonly MedicalFact[]; lang: Language }) {
  const copy = CARE_COPY[lang].record;
  const lines = savedFactsSummary(facts, lang);
  return (
    <Card title={copy.factsTitle}>
      <div className={rec.cardStack}>
        <Notice tone="success" icon="check">
          {copy.saved}
        </Notice>
        {lines.length > 0 ? (
          <ul className={rec.savedList}>
            {lines.map((fact) => (
              <li key={fact.id} className={rec.savedItem}>
                <bdi>{fact.label}</bdi>
                <PolarityBadge polarity={fact.polarity} lang={lang} />
                <VerificationBadge verification={fact.verification} lang={lang} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

function OnboardingFlow({ patientId }: { patientId: string }) {
  // careTeam "unknown" (loading, offline, refused) never claims a doctor review.
  const { lang, t, data, careTeam } = usePatientRuntime();
  const copy = CARE_COPY[lang].onboarding;
  const read = useCallback((signal: AbortSignal) => getOnboarding(patientId, { signal }), [patientId]);
  const onboarding = useFencedRead(data.fence, read, authorityOf);
  const load = onboarding.state;
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const pending = useRef<OnboardingInput | null>(null);
  // Each recorded round starts its questions afresh (no text left over from the previous round).
  const [round, setRound] = useState(0);

  if (load.status === "loading") return <LoadingBlock label={t.common.loading} />;
  if (load.status === "error") {
    const description = describeApiError(load.error, lang);
    return <ErrorState {...description} onRetry={onboarding.retry} retryLabel={t.common.retry} />;
  }

  const response = load.value;
  const questions = response.questions;
  const check = buildOnboardingInput(questions, answers, response.meta.guard.contextRevision, "");
  const flagged = new Set(showErrors ? [...check.missing, ...check.invalid] : []);

  const answer = (questionId: string, choice: AnswerChoice) => {
    pending.current = null;
    setAnswers((current) => ({ ...current, [questionId]: choice }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!check.input) {
      setShowErrors(true);
      const first = questions.find((q) => check.missing.includes(q.id) || check.invalid.includes(q.id));
      if (first) document.getElementById(questionFocusId(first))?.focus();
      return;
    }
    const input = pending.current ?? { ...check.input, clientId: createClientId("onboarding") };
    pending.current = input;
    // Everything after the await uses only this action's captured fence and refresh.
    const action = captureAction(data);
    setBusy(true);
    setOutcome({ kind: "idle" });
    const result = await fencedCall(action.fence, () => submitOnboarding(patientId, input), authorityOf);
    setBusy(false);
    if (result.status === "stale") {
      if (action.fence.denied()) return;
      // Recorded but withheld (authority moved): read the questions again instead of showing it.
      if (result.answered) {
        pending.current = null;
        setAnswers({});
        setRound((value) => value + 1);
        onboarding.retry();
        void action.refresh();
        return;
      }
      // Nothing confirmed: say so; a retry resends the same submission.
      setOutcome({ kind: "error", error: staleResponseError() });
      return;
    }
    if (result.status === "error") {
      if (result.error.isConflict) {
        // The record moved on: re-read the questions now; answers stay for those still asked.
        pending.current = null;
        onboarding.reload();
        setOutcome({ kind: "conflict" });
        return;
      }
      setOutcome({ kind: "error", error: result.error });
      return;
    }
    pending.current = null;
    setAnswers({});
    setShowErrors(false);
    setRound((value) => value + 1);
    onboarding.update(() => result.value);
    setOutcome({ kind: "saved", facts: result.value.facts });
    void action.refresh();
  };

  const conflict = outcome.kind === "conflict" || response.meta.stale;
  // Answers are kept across the reload; only those to questions still asked are sent.
  const reloadQuestions = () => {
    setOutcome({ kind: "idle" });
    onboarding.retry();
  };

  return (
    <>
      <ModeNotice meta={response.meta} lang={lang} />
      {outcome.kind === "saved" ? <SavedFacts facts={outcome.facts} lang={lang} /> : null}
      {questions.length === 0 ? (
        <EmptyState
          icon="check-circle"
          title={copy.done}
          description={onboardingDoneBody(careTeam.status, lang)}
          action={
            <LinkButton href="/patient/record" variant="primary" iconStart="arrow-left">
              {copy.backToRecord}
            </LinkButton>
          }
        />
      ) : (
        <form className={rec.form} onSubmit={(event) => void submit(event)} noValidate>
          <p className={rec.progress} aria-live="polite">
            {copy.progress(answeredCount(questions, answers), questions.length)}
          </p>
          {questions.map((question) => (
            <div key={`${round}:${question.id}`} className={`${rec.question} ${flagged.has(question.id) ? rec.questionInvalid : ""}`}>
              <QuestionField
                question={question}
                lang={lang}
                requiredLabel={t.common.required}
                choice={answers[question.id]}
                error={flagged.has(question.id) ? copy.required : null}
                onChange={(choice) => answer(question.id, choice)}
              />
              {questionNeedsEmergencyLine(question) ? <EmergencyLine lang={lang} /> : null}
            </div>
          ))}
          {conflict ? (
            <Notice
              tone="neutral"
              icon="refresh"
              role="alert"
              action={
                <Button variant="secondary" iconStart="refresh" onClick={reloadQuestions}>
                  {copy.reload}
                </Button>
              }
            >
              {copy.conflict}
            </Notice>
          ) : null}
          {outcome.kind === "error" ? <ApiErrorNotice error={outcome.error} lang={lang} /> : null}
          <Button type="submit" variant="primary" size="lg" fullWidth iconStart="check" loading={busy}>
            {busy ? copy.submitting : copy.submit}
          </Button>
        </form>
      )}
    </>
  );
}

export function OnboardingScreen() {
  const { lang, data } = usePatientRuntime();
  const copy = CARE_COPY[lang].onboarding;
  return (
    <div className={styles.page}>
      <PageHeader title={copy.title} description={copy.description} back={{ href: "/patient/record", label: copy.backToRecord }} />
      {/* Keyed by actor+patient: a switch drops answers, questions and any held submission. */}
      <RecordGate>
        {(record) => <OnboardingFlow key={data.fence.key ?? record.patient.id} patientId={record.patient.id} />}
      </RecordGate>
    </div>
  );
}

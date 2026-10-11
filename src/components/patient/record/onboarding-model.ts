/**
 * Pure onboarding decisions. "Je ne sais pas" is always sent as polarity
 * "unknown" with a null value: it is never turned into "non", and a skipped
 * optional question is simply not sent (no answer is invented).
 */
import type { AiFailure, AiMeta, MedicalFact, OnboardingInput, OnboardingQuestion, Polarity } from "@/contracts/monitoring";
import { CARE_COPY } from "@/lib/client/copy/care";
import type { Language } from "@/lib/client/transport";
import type { CareTeamStatus } from "../useCareTeam";
import { currentFacts, factLines, type FactLine } from "./record-model";

export type AnswerChoice =
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "unknown" }
  | { kind: "skip" }
  /** Free text, number or one of `allowedValues`, as typed. */
  | { kind: "value"; value: string };

export type AnswerMap = Readonly<Record<string, AnswerChoice | undefined>>;

export type OnboardingAnswer = OnboardingInput["answers"][number];

export type BuiltAnswer = { status: "answer"; answer: OnboardingAnswer } | { status: "omitted" } | { status: "invalid" };

/** Arabic-Indic (U+0660) and Eastern Arabic-Indic (U+06F0) digits to Latin; "٫" and "," to ".". */
function toLatinNumber(text: string): string {
  return text
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/, ".");
}

function parseNumber(text: string): number | null {
  const normalised = toLatinNumber(text);
  const value = Number(normalised);
  return normalised !== "" && Number.isFinite(value) ? value : null;
}

function typedValue(question: OnboardingQuestion, text: string): BuiltAnswer {
  const trimmed = text.trim();
  if (!trimmed) return { status: "omitted" };
  const answer = (value: string | number): BuiltAnswer => ({
    status: "answer",
    answer: { questionId: question.id, value, polarity: "affirmed" },
  });
  switch (question.answerKind) {
    case "text":
      return answer(trimmed);
    case "number": {
      const value = parseNumber(trimmed);
      return value === null ? { status: "invalid" } : answer(value);
    }
    case "choice":
      return question.allowedValues.includes(trimmed) ? answer(trimmed) : { status: "invalid" };
    default:
      return { status: "invalid" };
  }
}

export function buildAnswer(question: OnboardingQuestion, choice: AnswerChoice | undefined): BuiltAnswer {
  if (!choice || choice.kind === "skip") return { status: "omitted" };
  const answer = (value: boolean | null, polarity: Polarity): BuiltAnswer => ({
    status: "answer",
    answer: { questionId: question.id, value, polarity },
  });
  switch (choice.kind) {
    case "unknown":
      return answer(null, "unknown");
    case "yes":
      return question.answerKind === "boolean" ? answer(true, "affirmed") : { status: "invalid" };
    case "no":
      return question.answerKind === "boolean" ? answer(false, "negated") : { status: "invalid" };
    case "value":
      return typedValue(question, choice.value);
  }
}

export interface OnboardingBuild {
  /** Null while a required answer is missing or an answer is invalid. */
  input: OnboardingInput | null;
  missing: string[];
  invalid: string[];
}

export function buildOnboardingInput(
  questions: readonly OnboardingQuestion[],
  answers: AnswerMap,
  expectedContextRevision: number,
  clientId: string,
): OnboardingBuild {
  const built = questions.map((question) => ({ question, result: buildAnswer(question, answers[question.id]) }));
  const missing = built.filter(({ question, result }) => question.required && result.status === "omitted").map(({ question }) => question.id);
  const invalid = built.filter(({ result }) => result.status === "invalid").map(({ question }) => question.id);
  const sent = built.flatMap(({ result }) => (result.status === "answer" ? [result.answer] : []));
  const input = missing.length === 0 && invalid.length === 0 ? { answers: sent, expectedContextRevision, clientId } : null;
  return { input, missing, invalid };
}

/** Questions the patient has dealt with (answered, "je ne sais pas" or explicitly skipped). */
export function answeredCount(questions: readonly OnboardingQuestion[], answers: AnswerMap): number {
  return questions.filter((question) => {
    const choice = answers[question.id];
    return choice?.kind === "skip" || buildAnswer(question, choice).status === "answer";
  }).length;
}

type ModelMode = Exclude<AiMeta["mode"], "deterministic">;

/** Closed lists: values from the server are matched exactly, never used as object keys unchecked. */
const MODEL_MODES: readonly ModelMode[] = ["local_model", "cloud_model"];
const isModelMode = (mode: unknown): mode is ModelMode => MODEL_MODES.some((known) => known === mode);
const isKnownFailure = (reason: unknown): reason is AiFailure =>
  typeof reason === "string" && Object.hasOwn(CARE_COPY.fr.aiFailure, reason);

export type ModeNotice =
  /** Which model answered: a remote (cloud) model is never labelled "local". */
  | { kind: "model"; mode: ModelMode }
  | { kind: "deterministic" }
  /** Fixed questions after a model failure; `reason` null when the server's reason is not recognised. */
  | { kind: "fallback"; reason: AiFailure | null }
  /** Unrecognised mode: no provenance (local, cloud or fixed rules) is claimed. */
  | { kind: "unknown" };

export function onboardingModeNotice(meta: AiMeta): ModeNotice {
  if (meta.failureReason) return { kind: "fallback", reason: isKnownFailure(meta.failureReason) ? meta.failureReason : null };
  if (meta.mode === "deterministic") return { kind: "deterministic" };
  return isModelMode(meta.mode) ? { kind: "model", mode: meta.mode } : { kind: "unknown" };
}

export type ModeLine = { style: "meta" | "note"; text: string } | null;

/** The text the onboarding screen shows for the AI mode: always a plain string, or nothing. */
export function onboardingModeLine(meta: AiMeta, lang: Language): ModeLine {
  const copy = CARE_COPY[lang];
  const notice = onboardingModeNotice(meta);
  switch (notice.kind) {
    case "model":
      return { style: "meta", text: copy.aiMode[notice.mode] };
    case "deterministic":
      return { style: "note", text: copy.onboarding.deterministic };
    case "fallback":
      return {
        style: "note",
        text: notice.reason ? copy.onboarding.modelFallback(copy.aiFailure[notice.reason]) : copy.onboarding.deterministic,
      };
    case "unknown":
      return null;
  }
}

export function polarityLabel(polarity: Polarity, lang: Language): string {
  return CARE_COPY[lang].polarity[polarity];
}

/** Claims a doctor review only when an accepted doctor is present; "unknown" never claims it. */
export function onboardingDoneBody(careTeam: CareTeamStatus, lang: Language): string {
  const copy = CARE_COPY[lang].onboarding;
  return careTeam === "present" ? copy.doneBody : copy.doneBodyNoDoctor;
}

const SYMPTOM_QUESTION = "onboarding.symptom";

/** The fixed 190 line accompanies the symptom question (registry key, not the wording). */
export function questionNeedsEmergencyLine(question: Pick<OnboardingQuestion, "labelKey">): boolean {
  return question.labelKey === SYMPTOM_QUESTION;
}

/** …and any symptom the patient declares or corrects. */
export function factNeedsEmergencyLine(kind: MedicalFact["kind"]): boolean {
  return kind === "symptom";
}

/** "Saved" summary after a round: current facts only, newest first, display labels (no raw codes). */
export function savedFactsSummary(facts: readonly MedicalFact[], lang: Language): FactLine[] {
  return factLines(currentFacts(facts), lang);
}

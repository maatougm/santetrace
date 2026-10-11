"use client";

/**
 * One onboarding registry question. Boolean: Oui / Non / Je ne sais pas.
 * Text or number: a field plus a "Je ne sais pas" toggle. Choice: the allowed
 * values plus "Je ne sais pas". Optional questions can be explicitly skipped.
 * Nothing is pre-selected: no answer is assumed for the patient.
 */
import { useState } from "react";
import { Button, Icon, TextArea, TextInput, VisuallyHidden } from "@/components/ui";
import type { OnboardingQuestion } from "@/contracts/monitoring";
import { CARE_COPY, questionLabel } from "@/lib/client/copy/care";
import type { Language } from "@/lib/client/transport";
import { ChoiceGroup, choiceId, type ChoiceOption } from "./ChoiceGroup";
import type { AnswerChoice } from "./onboarding-model";
import choiceStyles from "./choice.module.css";

/** Free-text answers share the fact value bound (contracts/api.md). */
const TEXT_MAX = 2000;
const VALUE_PREFIX = "v:";

const prefixFor = (question: OnboardingQuestion) => `q-${question.id}`;
const inputIdFor = (question: OnboardingQuestion) => `${prefixFor(question)}-input`;

/** Id of the first control of a question, for focusing it on a submit error. */
export function questionFocusId(question: OnboardingQuestion): string {
  if (question.answerKind === "boolean") return choiceId(prefixFor(question), "yes");
  if (question.answerKind === "choice") {
    const first = question.allowedValues[0];
    return choiceId(prefixFor(question), first === undefined ? "unknown" : `${VALUE_PREFIX}${first}`);
  }
  return inputIdFor(question);
}

interface QuestionFieldProps {
  question: OnboardingQuestion;
  lang: Language;
  requiredLabel: string;
  choice: AnswerChoice | undefined;
  error: string | null;
  onChange: (choice: AnswerChoice) => void;
}

function Legend({ question, lang, requiredLabel }: Pick<QuestionFieldProps, "question" | "lang" | "requiredLabel">) {
  return (
    <>
      {questionLabel(question.labelKey, lang)}
      {question.required ? (
        <>
          <span aria-hidden="true"> *</span>
          <VisuallyHidden> ({requiredLabel})</VisuallyHidden>
        </>
      ) : null}
    </>
  );
}

function selectedValue(choice: AnswerChoice | undefined): string | null {
  if (!choice) return null;
  return choice.kind === "value" ? `${VALUE_PREFIX}${choice.value}` : choice.kind;
}

function toChoice(value: string): AnswerChoice {
  if (value.startsWith(VALUE_PREFIX)) return { kind: "value", value: value.slice(VALUE_PREFIX.length) };
  return value === "yes" || value === "no" || value === "unknown" ? { kind: value } : { kind: "skip" };
}

function OptionQuestion(props: QuestionFieldProps) {
  const { question, lang, choice, error, onChange } = props;
  const copy = CARE_COPY[lang].onboarding;
  const answers: ChoiceOption<string>[] =
    question.answerKind === "boolean"
      ? [
          { value: "yes", label: copy.yes },
          { value: "no", label: copy.no },
        ]
      : question.allowedValues.map((value) => ({ value: `${VALUE_PREFIX}${value}`, label: <bdi>{value}</bdi> }));
  const options: ChoiceOption<string>[] = [
    ...answers,
    { value: "unknown", label: copy.dontKnow },
    ...(question.required ? [] : [{ value: "skip", label: copy.skip }]),
  ];
  return (
    <ChoiceGroup
      idPrefix={prefixFor(question)}
      legend={<Legend {...props} />}
      options={options}
      value={selectedValue(choice)}
      onChange={(value) => onChange(toChoice(value))}
      error={error}
      inline={question.answerKind === "boolean"}
    />
  );
}

function TypedQuestion(props: QuestionFieldProps) {
  const { question, lang, choice, error, onChange } = props;
  const copy = CARE_COPY[lang].onboarding;
  const prefix = prefixFor(question);
  const legendId = `${prefix}-legend`;
  const errorId = `${prefix}-error`;
  const inputId = inputIdFor(question);
  // "Je ne sais pas" / "Passer" clear the field (nothing typed is sent); un-pressing brings the text back.
  const [lastText, setLastText] = useState(choice?.kind === "value" ? choice.value : "");
  const text = choice?.kind === "value" ? choice.value : "";
  const type = (value: string) => {
    setLastText(value);
    onChange({ kind: "value", value });
  };
  const toggle = (kind: "unknown" | "skip") => onChange(choice?.kind === kind ? { kind: "value", value: lastText } : { kind });
  const common = {
    id: inputId,
    value: text,
    invalid: Boolean(error),
    "aria-labelledby": legendId,
    "aria-describedby": error ? errorId : undefined,
  };

  return (
    <fieldset className={choiceStyles.fieldset}>
      <legend id={legendId} className={choiceStyles.legend}>
        <Legend {...props} />
      </legend>
      {question.answerKind === "number" ? (
        <TextInput {...common} inputMode="decimal" onChange={(event) => type(event.target.value)} />
      ) : (
        <TextArea {...common} rows={2} maxLength={TEXT_MAX} placeholder={copy.textPlaceholder} onChange={(event) => type(event.target.value)} />
      )}
      <div className={choiceStyles.toggles}>
        <Button variant="secondary" className={choiceStyles.toggle} iconStart="help-circle" aria-pressed={choice?.kind === "unknown"} onClick={() => toggle("unknown")}>
          {copy.dontKnow}
        </Button>
        {question.required ? null : (
          <Button variant="ghost" className={choiceStyles.toggle} aria-pressed={choice?.kind === "skip"} onClick={() => toggle("skip")}>
            {copy.skip}
          </Button>
        )}
      </div>
      {error ? (
        <p id={errorId} className={choiceStyles.error}>
          <Icon name="x-circle" size={16} />
          <span>{error}</span>
        </p>
      ) : null}
    </fieldset>
  );
}

export function QuestionField(props: QuestionFieldProps) {
  return props.question.answerKind === "text" || props.question.answerKind === "number" ? <TypedQuestion {...props} /> : <OptionQuestion {...props} />;
}

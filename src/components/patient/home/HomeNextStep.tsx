"use client";

/**
 * "Prochaine étape": one concise action taken from live server data only
 * (see `nextStep`). Rendered only when there is one; nothing is invented.
 */
import type { ReactNode } from "react";
import { Badge, LinkButton } from "@/components/ui";
import type { Language } from "@/lib/client/api";
import { CARE_COPY, templateText } from "@/lib/client/copy/care";
import { formatDateTime } from "@/lib/client/format";
import type { Messages } from "@/lib/client/i18n";
import { When } from "../bits";
import { HOME_COPY } from "./home-copy";
import type { NextStep } from "./home-view";
import css from "../home.module.css";

interface StepContent {
  text: string;
  meta: ReactNode;
  href: string;
  cta: string;
}

function stepContent(step: NextStep, lang: Language, t: Messages): StepContent {
  const copy = HOME_COPY[lang];
  const care = CARE_COPY[lang];
  if (step.kind === "action") {
    const { action, overdue } = step;
    return {
      text: templateText(action.action.templateId, lang),
      meta: overdue ? (
        <Badge tone="outline" icon="clock">
          {care.plan.overdue}
        </Badge>
      ) : (
        care.plan.due(formatDateTime(action.dueAt, lang))
      ),
      href: "/patient/plan",
      cta: copy.openPlan,
    };
  }
  if (step.kind === "reminder") {
    return {
      text: step.reminder.label,
      meta: <When iso={step.reminder.dueAt} lang={lang} label={t.reminders.due} />,
      href: "/patient/reminders",
      cta: copy.openReminders,
    };
  }
  return { text: care.record.factsEmpty, meta: null, href: "/patient/onboarding", cta: care.record.startOnboarding };
}

export function HomeNextStep({ step, lang, t }: { step: NextStep; lang: Language; t: Messages }) {
  const content = stepContent(step, lang, t);
  return (
    <section className={css.next} aria-labelledby="home-next-title">
      <h2 id="home-next-title" className={css.cardTitle}>
        {HOME_COPY[lang].nextStepTitle}
      </h2>
      <p className={css.nextText} dir="auto">
        {content.text}
      </p>
      {content.meta ? <p className={css.nextMeta}>{content.meta}</p> : null}
      <LinkButton href={content.href} variant="secondary" iconEnd="chevron-right" fullWidth>
        {content.cta}
      </LinkButton>
    </section>
  );
}

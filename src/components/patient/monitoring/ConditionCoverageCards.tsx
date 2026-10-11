"use client";

/**
 * One card per recorded condition (spec 006 FR-008/FR-009/FR-011). Each card
 * says what its priority covers and nothing more ("concerne uniquement…"),
 * carries the demo-profile label, coverage, next due date and sources with
 * their verification level. Conditions without a profile stay visible with
 * unknown coverage; nothing is classified for them.
 */
import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import type { ConditionEvaluation, SourceRef } from "@/contracts/monitoring";
import type { Language, MeasurementKind } from "@/lib/client/api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { formatDate, formatDateTime, measurementKindLabel } from "@/lib/client/format";
import { CareStatusBadge, Ltr } from "../bits";
import { CoverageList } from "./CoverageList";
import { ReasonList } from "./ReasonList";
import { cardTitle, type ConditionCard } from "./monitoring-view";
import styles from "./monitoring.module.css";
import patientStyles from "../patient.module.css";

/** Demo profiles and the single measurement they evaluate. Unknown profiles show their id. */
const PROFILE_SCOPE: Readonly<Record<string, MeasurementKind>> = {
  demo_blood_pressure: "blood_pressure",
  demo_glucose: "glucose",
};

function scopeText(evaluation: ConditionEvaluation, lang: Language): string {
  const profileId = evaluation.profileId ?? "";
  const scope = Object.hasOwn(PROFILE_SCOPE, profileId) ? measurementKindLabel(PROFILE_SCOPE[profileId], lang) : profileId;
  return CARE_COPY[lang].monitoring.scopeOnly(scope);
}

function gapKey(card: Exclude<ConditionCard, { kind: "evaluated" }>): string {
  if (card.kind === "not_evaluated") return card.fact.id;
  return card.fact?.id ?? card.evaluation?.id ?? "unsupported";
}

function SourceLine({ source, lang }: { source: SourceRef; lang: Language }) {
  const copy = CARE_COPY[lang];
  return (
    <li>
      {copy.sourceKind[source.kind]} · {copy.verification[source.verification]} · {formatDate(source.date, lang)}
    </li>
  );
}

function FactHead({ card, lang, children }: { card: ConditionCard; lang: Language; children: ReactNode }) {
  const copy = CARE_COPY[lang];
  const { fact } = card;
  return (
    <div className={styles.cardHead}>
      {/* Never a raw registry code ("hypertension", "declared"): factDisplayLabel via cardTitle. */}
      <h4 className={styles.cardTitle} dir="auto">
        {cardTitle(card, lang)}
      </h4>
      <div className={styles.badges}>
        {fact ? <Badge tone="outline">{copy.verification[fact.verification]}</Badge> : null}
        {children}
      </div>
    </div>
  );
}

function EvaluatedCard({ card, lang }: { card: Extract<ConditionCard, { kind: "evaluated" }>; lang: Language }) {
  const copy = CARE_COPY[lang].monitoring;
  const { evaluation } = card;
  return (
    <li className={`${styles.card} ${card.display === "unknown" ? styles.cardUnknown : ""}`}>
      <FactHead card={card} lang={lang}>
        <CareStatusBadge status={card.display} lang={lang} size="sm" />
      </FactHead>
      <p className={styles.lead}>{scopeText(evaluation, lang)}</p>
      <div className={styles.badges}>
        <Badge tone="muted" icon="info">
          {copy.profileDemo}
        </Badge>
        {evaluation.profileVersion ? (
          <Badge tone="outline">
            <Ltr>v{evaluation.profileVersion}</Ltr>
          </Badge>
        ) : null}
      </div>
      {/* A profiled "unsupported" reads "partial coverage", never "no profile". */}
      <CoverageList coverage={card.coverage} lang={lang} label={CARE_COPY[lang].plan.coverageTitle} />
      {evaluation.reasons.length > 0 ? (
        <div>
          <h5 className={styles.subTitle}>{copy.reasonsTitle}</h5>
          <ReasonList reasons={evaluation.reasons} lang={lang} />
        </div>
      ) : null}
      {evaluation.sources.length > 0 ? (
        <div>
          <h5 className={styles.subTitle}>{copy.sourcesTitle}</h5>
          <ul className={styles.sources}>
            {evaluation.sources.map((source) => (
              <SourceLine key={`${source.kind}-${source.id}-${source.revision}`} source={source} lang={lang} />
            ))}
          </ul>
        </div>
      ) : null}
      <p className={styles.meta}>
        {/* The epoch "never evaluated" sentinel is never shown as a date. */}
        {card.evaluatedAt ? copy.evaluatedAt(formatDateTime(card.evaluatedAt, lang)) : copy.noEvaluation}
        {evaluation.nextDueAt ? ` · ${copy.nextDue(formatDateTime(evaluation.nextDueAt, lang))}` : null}
      </p>
    </li>
  );
}

function GapCard({ card, lang }: { card: Exclude<ConditionCard, { kind: "evaluated" }>; lang: Language }) {
  const copy = CARE_COPY[lang].monitoring;
  const unsupported = card.kind === "unsupported";
  return (
    <li className={`${styles.card} ${styles.cardUnknown}`}>
      <FactHead card={card} lang={lang}>
        <CareStatusBadge status="unknown" lang={lang} size="sm" />
      </FactHead>
      {unsupported ? <CoverageList coverage={["unsupported"]} lang={lang} /> : null}
      <p className={styles.lead}>{unsupported ? copy.unsupportedCondition : copy.noEvaluation}</p>
    </li>
  );
}

export function ConditionCoverageCards({ cards, lang }: { cards: readonly ConditionCard[]; lang: Language }) {
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby="home-conditions-title" className={patientStyles.stack}>
      {/* Rendered inside the home status card (h2 "Votre suivi"), hence h3/h4/h5. */}
      <h3 id="home-conditions-title" className={styles.subTitle}>
        {CARE_COPY[lang].plan.coverageTitle}
      </h3>
      <ul className={styles.cards}>
        {cards.map((card) =>
          card.kind === "evaluated" ? (
            <EvaluatedCard key={card.evaluation.id} card={card} lang={lang} />
          ) : (
            <GapCard key={gapKey(card)} card={card} lang={lang} />
          ),
        )}
      </ul>
    </section>
  );
}

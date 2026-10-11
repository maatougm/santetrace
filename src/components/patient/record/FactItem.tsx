"use client";

/**
 * One current declared fact with its provenance: kind, answer (polarity),
 * verification label, version, date and sources, plus the earlier versions it
 * replaced. Labels go through factDisplayLabel: a registry code stored as label
 * ("hypertension", "declared") is shown by its name, never raw.
 * "Je ne sais pas" is displayed as such, never as "Non".
 */
import { Badge, Button, type BadgeTone, type IconName } from "@/components/ui";
import type { MedicalFact, Polarity, SourceRef, Verification } from "@/contracts/monitoring";
import { CARE_COPY, factDisplayLabel } from "@/lib/client/copy/care";
import { formatDate } from "@/lib/client/format";
import type { Language } from "@/lib/client/transport";
import { colon, Ltr, When } from "../bits";
import { polarityLabel } from "./onboarding-model";
import { factLines } from "./record-model";
import styles from "../patient.module.css";
import rec from "./record.module.css";

const VERIFICATION_BADGE: Record<Verification, { tone: BadgeTone; icon: IconName }> = {
  confirmed: { tone: "accent", icon: "check" },
  patient_reported: { tone: "neutral", icon: "user" },
  simulated: { tone: "outline", icon: "activity" },
  candidate: { tone: "outline", icon: "help-circle" },
  external_unverified: { tone: "outline", icon: "external-link" },
  reference: { tone: "muted", icon: "file-text" },
};

const POLARITY_BADGE: Record<Polarity, { tone: BadgeTone; icon: IconName }> = {
  affirmed: { tone: "neutral", icon: "check" },
  negated: { tone: "neutral", icon: "minus" },
  uncertain: { tone: "outline", icon: "help-circle" },
  unknown: { tone: "outline", icon: "help-circle" },
};

export function VerificationBadge({ verification, lang }: { verification: Verification; lang: Language }) {
  const style = VERIFICATION_BADGE[verification];
  return (
    <Badge tone={style.tone} icon={style.icon}>
      {CARE_COPY[lang].verification[verification]}
    </Badge>
  );
}

export function PolarityBadge({ polarity, lang }: { polarity: Polarity; lang: Language }) {
  const style = POLARITY_BADGE[polarity];
  return (
    <Badge tone={style.tone} icon={style.icon}>
      {polarityLabel(polarity, lang)}
    </Badge>
  );
}

function Sources({ sources, lang }: { sources: readonly SourceRef[]; lang: Language }) {
  const copy = CARE_COPY[lang];
  if (sources.length === 0) return <p className={styles.metaLine}>{copy.sources.none}</p>;
  return (
    <div>
      <p className={rec.sourcesTitle}>{copy.sources.title}</p>
      <ul className={rec.sources}>
        {sources.map((source) => (
          <li key={`${source.kind}:${source.id}:${source.revision}`}>
            {copy.sourceKind[source.kind]} · {copy.verification[source.verification]} · {copy.sources.date(formatDate(source.date, lang))}
          </li>
        ))}
      </ul>
    </div>
  );
}

function History({ versions, lang }: { versions: readonly MedicalFact[]; lang: Language }) {
  const copy = CARE_COPY[lang].record;
  return (
    <details className={rec.history}>
      <summary>
        {copy.supersededNote} <Ltr>({versions.length})</Ltr>
      </summary>
      <ol className={rec.historyList}>
        {factLines(versions, lang).map((version) => (
          <li key={version.id} className={rec.historyItem}>
            <span className={rec.historyLabel}>
              <bdi>{version.label}</bdi>
            </span>
            <span>
              {polarityLabel(version.polarity, lang)} · {copy.version(version.revision)} ·{" "}
              <When iso={version.createdAt} lang={lang} format="date" />
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

interface FactItemProps {
  fact: MedicalFact;
  history: readonly MedicalFact[];
  lang: Language;
  onCorrect: (fact: MedicalFact) => void;
}

export function FactItem({ fact, history, lang, onCorrect }: FactItemProps) {
  const copy = CARE_COPY[lang];
  const titleId = `fact-${fact.id}`;
  return (
    <li className={rec.fact}>
      <div className={rec.factHead}>
        <span className={styles.kindLabel}>{copy.factKind[fact.kind]}</span>
        <VerificationBadge verification={fact.verification} lang={lang} />
      </div>
      <h3 id={titleId} className={rec.factLabel}>
        <bdi>{factDisplayLabel(fact, lang)}</bdi>
      </h3>
      <p className={rec.answerLine}>
        <span>
          {copy.record.polarityLabel}
          {colon(lang)}
        </span>
        <PolarityBadge polarity={fact.polarity} lang={lang} />
      </p>
      {fact.value ? (
        <p className={rec.factValue}>
          <bdi>{fact.value}</bdi>
        </p>
      ) : null}
      {fact.correction ? (
        <p className={styles.metaLine}>
          {copy.record.reasonLabel}
          {colon(lang)}
          <bdi>{fact.correction.reason}</bdi>
        </p>
      ) : null}
      <p className={styles.metaLine}>
        {copy.record.version(fact.revision)} · <When iso={fact.createdAt} lang={lang} format="date" />
      </p>
      <Sources sources={fact.sources} lang={lang} />
      {history.length > 0 ? <History versions={history} lang={lang} /> : null}
      <div className={rec.factActions}>
        <Button variant="secondary" iconStart="edit" aria-describedby={titleId} onClick={() => onCorrect(fact)}>
          {copy.record.correctFact}
        </Button>
      </div>
    </li>
  );
}

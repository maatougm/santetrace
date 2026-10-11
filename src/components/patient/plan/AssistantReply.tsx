"use client";

/**
 * Renders one assistant reply exactly as `replyView` decided: the server text
 * as plain text (never HTML), approved actions only for an approved_action
 * reply, sources with their verification level, the fixed honesty note, and
 * the AI mode / failure reason. Nothing here writes medical advice.
 */
import { Badge, Card, Notice, type IconName } from "@/components/ui";
import type { AssistantResponse, SourceRef } from "@/contracts/monitoring";
import type { Language } from "@/lib/client/api";
import { ASSIST_COPY } from "@/lib/client/copy/assist";
import { CARE_COPY } from "@/lib/client/copy/care";
import { formatDate } from "@/lib/client/format";
import { ApprovedAdviceCard } from "./ApprovedAdviceCard";
import { replyProvenance, replyTitle, type ReplyView } from "./assistant-view";
import { adviceFromAction } from "./plan-view";
import patientStyles from "../patient.module.css";
import styles from "./plan.module.css";

const KIND_ICON: Record<AssistantResponse["replyKind"], IconName> = {
  record_answer: "file-text",
  approved_action: "check",
  needs_clinician: "stethoscope",
  unavailable: "cloud-off",
};

function Sources({ sources, lang }: { sources: readonly SourceRef[]; lang: Language }) {
  const care = CARE_COPY[lang];
  if (sources.length === 0) return null;
  return (
    <div className={patientStyles.stackSm}>
      <h3 className={styles.subTitle}>{ASSIST_COPY[lang].assistant.sourcesTitle}</h3>
      <ul className={styles.sources}>
        {sources.map((source) => (
          <li key={`${source.kind}-${source.id}-${source.revision}`}>
            {care.sourceKind[source.kind]} · {care.verification[source.verification]} · {formatDate(source.date, lang)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AssistantReply({ view, lang }: { view: ReplyView; lang: Language }) {
  const copy = ASSIST_COPY[lang].assistant;
  // Truthful provenance: local, remote (cloud) or fixed rules, as the server reported it.
  const provenance = replyProvenance(view, lang);
  return (
    <Card
      title={replyTitle(view, lang)}
      actions={
        provenance.modeLabel ? (
          <Badge tone="outline" icon={KIND_ICON[view.kind]}>
            {provenance.modeLabel}
          </Badge>
        ) : undefined
      }
    >
      <div className={patientStyles.stack}>
        {view.answer ? (
          <p className={styles.answer} dir="auto">
            {view.answer}
          </p>
        ) : null}
        {view.actions.map((action) => (
          <ApprovedAdviceCard key={action.id} advice={adviceFromAction(action)} lang={lang} />
        ))}
        <Sources sources={view.sources} lang={lang} />
        {view.note ? (
          <Notice tone="neutral" icon={view.note === "messageRecorded" ? "send" : "info"}>
            {copy[view.note]}
          </Notice>
        ) : null}
        {provenance.fallbackLine ? <p className={patientStyles.metaLine}>{provenance.fallbackLine}</p> : null}
        <p className={patientStyles.metaLine}>{copy.noAdvice}</p>
      </div>
    </Card>
  );
}

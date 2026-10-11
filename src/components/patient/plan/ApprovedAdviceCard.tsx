"use client";

/**
 * One piece of approved advice as the patient sees it (spec 006 story 4):
 * the exact approved template text, whether it was approved once or applied
 * under a clinician-authorised protocol (with its version), that its approval
 * lapsed on the server's live check, or that a protocol reuse was blocked and
 * needs a review. Reading it is not doing it.
 */
import { Badge, Card } from "@/components/ui";
import type { Language } from "@/lib/client/api";
import { ASSIST_COPY } from "@/lib/client/copy/assist";
import { CARE_COPY, templateText } from "@/lib/client/copy/care";
import { formatDateTime } from "@/lib/client/format";
import { Ltr } from "../bits";
import { ApprovalLapsed } from "./ApprovalLapsed";
import type { AdviceView } from "./plan-view";
import patientStyles from "../patient.module.css";
import styles from "./plan.module.css";

interface ApprovedAdviceCardProps {
  advice: AdviceView;
  lang: Language;
  /** 2 when the card sits directly on a page, 3 inside another card (default). */
  headingLevel?: 2 | 3;
}

function BlockedAdvice({ advice, lang, headingLevel }: { advice: Extract<AdviceView, { kind: "blocked" }>; lang: Language; headingLevel: 2 | 3 }) {
  const assist = ASSIST_COPY[lang];
  return (
    <Card title={assist.advice.blockedTitle} headingLevel={headingLevel} tone="muted">
      <div className={patientStyles.stackSm}>
        <p className={patientStyles.metaLine}>{assist.advice.blockedBody}</p>
        <div className={styles.badges}>
          <Badge tone="outline" icon="clock">
            {assist.applicationState.blocked}
          </Badge>
          <Badge tone="outline">
            <Ltr>v{advice.protocolVersion}</Ltr>
          </Badge>
        </div>
        <p className={patientStyles.metaLine}>{formatDateTime(advice.at, lang)}</p>
      </div>
    </Card>
  );
}

/** Live check says the approval lapsed: titled by the action itself, never "Consigne validée". */
function LapsedAdvice({ advice, lang, headingLevel }: { advice: Extract<AdviceView, { kind: "lapsed" }>; lang: Language; headingLevel: 2 | 3 }) {
  const care = CARE_COPY[lang];
  return (
    <Card title={templateText(advice.templateId, lang)} headingLevel={headingLevel} tone="muted">
      <div className={patientStyles.stackSm}>
        <ApprovalLapsed action={advice.action} lang={lang} />
        <p className={patientStyles.metaLine}>{care.plan.due(formatDateTime(advice.action.dueAt, lang))}</p>
      </div>
    </Card>
  );
}

export function ApprovedAdviceCard({ advice, lang, headingLevel = 3 }: ApprovedAdviceCardProps) {
  if (advice.kind === "blocked") return <BlockedAdvice advice={advice} lang={lang} headingLevel={headingLevel} />;
  if (advice.kind === "lapsed") return <LapsedAdvice advice={advice} lang={lang} headingLevel={headingLevel} />;
  const assist = ASSIST_COPY[lang].advice;
  const care = CARE_COPY[lang];
  const { action } = advice;
  return (
    <Card title={assist.title} headingLevel={headingLevel}>
      <div className={patientStyles.stackSm}>
        <p className={styles.itemTitle}>{templateText(advice.templateId, lang)}</p>
        <div className={styles.badges}>
          <Badge tone="neutral" icon="check">
            {advice.kind === "protocol_applied" ? assist.protocolApplied(advice.version) : assist.approvedOnce}
          </Badge>
          <Badge tone="outline">{care.actionState[action.state]}</Badge>
        </div>
        <p className={patientStyles.metaLine}>{care.plan.due(formatDateTime(action.dueAt, lang))}</p>
        <p className={patientStyles.metaLine}>{assist.readNotDone}</p>
      </div>
    </Card>
  );
}

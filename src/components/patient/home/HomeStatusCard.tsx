"use client";

/**
 * The one home status card: server priority (colour + text), the honest
 * explanation, the real evaluation time, and the compact attention rows that
 * must never hide behind a disclosure (suspect reading, answers the patient
 * still owes, approvals pending at the doctor, consent not recorded).
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui";
import type { Language } from "@/lib/client/api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { formatDateTime, formatRelative, measurementKindLabel } from "@/lib/client/format";
import type { Messages } from "@/lib/client/i18n";
import { CareStatusBadge } from "../bits";
import { HOME_COPY } from "./home-copy";
import type { HomeStatusView } from "./home-status";
import { hasAttention, type HomeAttention } from "./home-view";
import css from "../home.module.css";

interface HomeStatusCardProps {
  view: HomeStatusView;
  attention: HomeAttention;
  lang: Language;
  t: Messages;
  /** "Détails du suivi" disclosure, closing the card. */
  children?: ReactNode;
}

interface AttentionLinkProps {
  href: string;
  icon: IconName;
  text: string;
  /** What the link does, when the text alone does not say it. */
  action?: string;
}

function AttentionLink({ href, icon, text, action }: AttentionLinkProps) {
  return (
    <li>
      <Link href={href} className={css.attentionRow}>
        <Icon name={icon} size={20} className={css.attentionIcon} />
        <span>
          {text}
          {action ? <span className={css.attentionAction}>{action}</span> : null}
        </span>
        <Icon name="chevron-right" size={18} />
      </Link>
    </li>
  );
}

function AttentionRows({ attention, lang }: { attention: HomeAttention; lang: Language }) {
  const copy = HOME_COPY[lang];
  if (!hasAttention(attention)) return null;
  return (
    <ul className={css.attention} aria-label={copy.attentionTitle}>
      {attention.consentMissing ? (
        <li className={css.attentionRow}>
          <Icon name="shield" size={20} className={css.attentionIcon} />
          <span>{copy.consentMissing}</span>
        </li>
      ) : null}
      {attention.suspect.map((measurement) => (
        <AttentionLink
          key={measurement.id}
          href="/patient/history"
          icon="help-circle"
          text={copy.suspect(measurementKindLabel(measurement.kind, lang))}
        />
      ))}
      {attention.needsInputs > 0 ? (
        // The server asks for the required welcome questions: they are answered on /patient/onboarding.
        <AttentionLink
          href="/patient/onboarding"
          icon="edit"
          text={copy.needsInputs(attention.needsInputs)}
          action={CARE_COPY[lang].record.startOnboarding}
        />
      ) : null}
      {attention.awaitingDoctor > 0 ? (
        <AttentionLink href="/patient/plan" icon="clock" text={copy.awaitingDoctor(attention.awaitingDoctor)} />
      ) : null}
      {attention.toReconfirm > 0 ? (
        <AttentionLink href="/patient/plan" icon="alert-triangle" text={copy.toReconfirm(attention.toReconfirm)} />
      ) : null}
    </ul>
  );
}

export function HomeStatusCard({ view, attention, lang, t, children }: HomeStatusCardProps) {
  const copy = CARE_COPY[lang].monitoring;
  return (
    <section className={`${css.status} ${css[`status-${view.status}`]}`} aria-labelledby="home-status-title">
      <div className={css.statusTop}>
        <h2 id="home-status-title" className={css.cardTitle}>
          {t.status.title}
        </h2>
        <CareStatusBadge status={view.status} lang={lang} size="lg" />
      </div>
      {view.lines.map((line) => (
        <p key={line} className={css.statusText}>
          {line}
        </p>
      ))}
      <p className={css.statusMeta}>
        {view.evaluatedAt ? (
          <>
            <time dateTime={view.evaluatedAt} title={formatDateTime(view.evaluatedAt, lang)}>
              {copy.evaluatedAt(formatRelative(view.evaluatedAt, lang))}
            </time>
            {" · "}
          </>
        ) : null}
        {view.serverOnly ? `${t.status.serverOnly} ` : null}
        {t.common.demoRules}
      </p>
      <AttentionRows attention={attention} lang={lang} />
      {children}
    </section>
  );
}

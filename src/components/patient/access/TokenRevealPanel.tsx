"use client";

/**
 * The one-time invitation code and doctor link, shown once from component
 * memory: never written to storage, the URL or logs, and gone when the patient
 * confirms the hand-over or leaves the page. A replayed issuance has no code
 * (the server returns null): the patient is told to revoke and re-invite.
 */
import { useEffect, useRef, useState } from "react";
import { Button, Notice } from "@/components/ui";
import { ACCESS_COPY } from "@/lib/client/copy/access";
import { invitationLink } from "@/lib/client/grants-api";
import type { Language } from "@/lib/client/transport";
import type { TokenReveal } from "./access-model";
import styles from "./access.module.css";

type CopyState = "idle" | "copied" | "failed";

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Permission denied or insecure context: the patient selects the text instead.
    return false;
  }
}

function SecretField({ id, label, value, lang }: { id: string; label: string; value: string; lang: Language }) {
  const copy = ACCESS_COPY[lang].doctors;
  const [state, setState] = useState<CopyState>("idle");
  const statusId = `${id}-status`;

  const copyValue = async () => {
    setState((await writeClipboard(value)) ? "copied" : "failed");
  };

  return (
    <div className={styles.secret}>
      <p id={`${id}-label`} className={styles.secretLabel}>
        {label}
      </p>
      <code id={id} dir="ltr" className={styles.secretValue}>
        {value}
      </code>
      <div className={styles.copyRow}>
        <Button variant="secondary" iconStart="copy" aria-describedby={`${id}-label`} onClick={() => void copyValue()}>
          {copy.copy}
        </Button>
        <span id={statusId} role="status" className={`${styles.copyStatus} ${state === "failed" ? styles.copyFailed : ""}`}>
          {state === "copied" ? copy.copied : state === "failed" ? copy.copyFailed : ""}
        </span>
      </div>
    </div>
  );
}

interface TokenRevealPanelProps {
  reveal: Exclude<TokenReveal, { kind: "hidden" }>;
  doctorName: string | null;
  lang: Language;
  /** Label of the button closing the replay notice. */
  dismissLabel: string;
  onHide: () => void;
}

export function TokenRevealPanel({ reveal, doctorName, lang, dismissLabel, onHide }: TokenRevealPanelProps) {
  const copy = ACCESS_COPY[lang].doctors;
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Only ever rendered after a client-side invitation, never during SSR.
  const origin = typeof window === "undefined" ? null : window.location.origin;

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  if (reveal.kind === "replay") {
    return (
      <Notice
        tone="neutral"
        icon="info"
        role="alert"
        action={
          <Button variant="ghost" onClick={onHide}>
            {dismissLabel}
          </Button>
        }
      >
        {copy.tokenReplay}
      </Notice>
    );
  }

  return (
    <section className={styles.reveal} aria-labelledby="invite-token-title">
      <h2 id="invite-token-title" ref={titleRef} tabIndex={-1} className={styles.revealTitle}>
        {copy.tokenTitle}
      </h2>
      {doctorName ? (
        <p className={styles.inlineNote}>
          <bdi>{doctorName}</bdi>
        </p>
      ) : null}
      <p className={styles.inlineNote}>{copy.tokenBody}</p>
      <SecretField id="invite-token" label={copy.tokenLabel} value={reveal.token} lang={lang} />
      {origin ? <SecretField id="invite-link" label={copy.linkLabel} value={invitationLink(origin, reveal.token)} lang={lang} /> : null}
      <div>
        <Button variant="secondary" iconStart="check" onClick={onHide}>
          {copy.tokenHide}
        </Button>
      </div>
    </section>
  );
}

"use client";

/**
 * The one-time credential, from component memory only. Masked by default: the
 * secret is not in the DOM until the owner explicitly reveals it, and it is
 * marked translate="no" so no page-translation service receives it. The
 * acknowledgement wipes it. No copy-to-clipboard, link or href carries it.
 */
import { useCallback } from "react";
import { Button, Notice } from "@/components/ui";
import { SHARE_COPY } from "@/lib/client/copy/share";
import type { Language } from "@/lib/client/transport";
import type { ShownCredential } from "./credential-state";
import dev from "./devices.module.css";
import styles from "../patient.module.css";

const MASK = "•".repeat(12);

interface CredentialNoticeProps {
  shown: ShownCredential;
  lang: Language;
  closeLabel: string;
  onToggle: () => void;
  onAcknowledge: () => void;
}

function noticeText(shown: ShownCredential, lang: Language): { title: string; body: string; replay: string } {
  const simulator = SHARE_COPY[lang].simulator;
  const devices = SHARE_COPY[lang].devices;
  return shown.kind === "device"
    ? { title: devices.credentialTitle, body: devices.credentialBody, replay: devices.credentialReplay }
    : { title: simulator.credentialTitle, body: simulator.credentialBody, replay: simulator.credentialReplay };
}

export function CredentialNotice({ shown, lang, closeLabel, onToggle, onAcknowledge }: CredentialNoticeProps) {
  const devices = SHARE_COPY[lang].devices;
  const text = noticeText(shown, lang);
  // Shown once: move focus here so keyboard and screen-reader users notice it.
  const focusOnMount = useCallback((node: HTMLDivElement | null) => node?.focus(), []);

  if (shown.credential === null) {
    return (
      <div ref={focusOnMount} tabIndex={-1}>
        <Notice
          tone="neutral"
          icon="lock"
          action={
            <Button variant="ghost" iconStart="x" onClick={onAcknowledge}>
              {closeLabel}
            </Button>
          }
        >
          <p className={styles.noticeLine}>{text.replay}</p>
        </Notice>
      </div>
    );
  }

  return (
    <div ref={focusOnMount} tabIndex={-1}>
      <Notice tone="info" icon="lock" title={text.title}>
        <div className={dev.credentialBox}>
          <p className={styles.noticeLine}>{text.body}</p>
          <p className={styles.noticeLine}>
            <span className={dev.deviceName} dir="ltr">
              {shown.deviceId}
            </span>
          </p>
          {shown.revealed ? (
            <code className={dev.secret} dir="ltr" translate="no">
              {shown.credential}
            </code>
          ) : (
            <p className={dev.secretMasked}>
              <span aria-hidden="true" dir="ltr">
                {MASK}
              </span>
              <span>{devices.secretMasked}</span>
            </p>
          )}
          <div className={styles.inlineActions}>
            <Button variant="secondary" iconStart={shown.revealed ? "lock" : "eye"} onClick={onToggle}>
              {shown.revealed ? devices.conceal : devices.reveal}
            </Button>
            <Button variant="primary" iconStart="check" onClick={onAcknowledge}>
              {devices.acknowledge}
            </Button>
          </div>
        </div>
      </Notice>
    </div>
  );
}

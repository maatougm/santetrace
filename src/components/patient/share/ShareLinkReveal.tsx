"use client";

/**
 * The one-time link, shown once from component memory. It is never written
 * to storage, the URL bar or logs; hiding it discards it. A replayed issuance
 * returns url = null: the link cannot be shown again.
 */
import { useCallback, useId, useState } from "react";
import { Badge, Button, Card, Notice, TextInput } from "@/components/ui";
import { SHARE_COPY } from "@/lib/client/copy/share";
import { absoluteShareUrl } from "@/lib/client/share-api";
import type { Language } from "@/lib/client/transport";
import styles from "../patient.module.css";
import share from "./share.module.css";

type CopyState = "idle" | "copied" | "failed";

export function ShareLinkReveal({ url: issued, lang, onHide }: { url: string | null; lang: Language; onHide: () => void }) {
  const copy = SHARE_COPY[lang].share;
  // The server issues a relative "/share#<token>"; the recipient needs the full link (rendered client-side only).
  const url = issued ? absoluteShareUrl(window.location.origin, issued) : null;
  const inputId = `${useId()}-link`;
  const [copyState, setCopyState] = useState<CopyState>("idle");
  // Shown once: move focus here so keyboard and screen-reader users notice it.
  const focusOnMount = useCallback((node: HTMLDivElement | null) => node?.focus(), []);

  const copyLink = async () => {
    if (!url) return;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      // Insecure context or denied permission: the field stays selectable by hand.
      setCopyState("failed");
      document.getElementById(inputId)?.focus();
    }
  };

  return (
    <div ref={focusOnMount} tabIndex={-1}>
      <Card id="share-link" title={copy.linkTitle} headingLevel={3}>
        {url ? (
          <div className={share.linkBox}>
            <p className={styles.metaLine}>{copy.linkBody}</p>
            <TextInput
              id={inputId}
              className={share.linkInput}
              readOnly
              dir="ltr"
              value={url}
              aria-label={copy.linkTitle}
              onFocus={(event) => event.currentTarget.select()}
            />
            <div className={styles.inlineActions}>
              <Button variant="secondary" iconStart="copy" onClick={() => void copyLink()}>
                {copy.copy}
              </Button>
              <Button variant="ghost" iconStart="check" onClick={onHide}>
                {copy.hideLink}
              </Button>
              <span role="status">
                {copyState === "copied" ? (
                  <Badge tone="neutral" icon="check">
                    {copy.copied}
                  </Badge>
                ) : null}
              </span>
            </div>
            {copyState === "failed" ? <p className={styles.slipError}>{copy.copyFailed}</p> : null}
          </div>
        ) : (
          <Notice tone="neutral" icon="lock">
            {copy.linkReplay}
          </Notice>
        )}
      </Card>
    </div>
  );
}

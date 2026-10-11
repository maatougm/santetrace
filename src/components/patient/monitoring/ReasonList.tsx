"use client";

/**
 * Server monitoring reasons in the patient's language. A sentence the client
 * cannot translate is shown as the server's original (lang="en", LTR) with a
 * small "untranslated" label, never passed off as French or Arabic.
 */
import type { Language } from "@/lib/client/api";
import { UNTRANSLATED_REASON } from "@/lib/client/copy/reasons";
import { reasonItems } from "./monitoring-view";
import styles from "./monitoring.module.css";

export function ReasonList({ reasons, lang }: { reasons: readonly string[]; lang: Language }) {
  if (reasons.length === 0) return null;
  return (
    <ul className={styles.reasons}>
      {reasonItems(reasons, lang).map((item) =>
        item.translated ? (
          <li key={item.key}>{item.text}</li>
        ) : (
          <li key={item.key}>
            <span lang="en" dir="ltr">
              {item.text}
            </span>{" "}
            <span className={styles.untranslated}>({UNTRANSLATED_REASON[lang]})</span>
          </li>
        ),
      )}
    </ul>
  );
}

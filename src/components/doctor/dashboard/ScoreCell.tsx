import { VisuallyHidden } from "@/components/ui";
import type { Language } from "@/lib/client/api";
import { directionFor } from "@/lib/client/document-language";
import type { QueueScoreView } from "../record/ai-case-score-view";
import { DASHBOARD_COPY, scoreUnavailableText } from "./dashboard-copy";
import styles from "./Dashboard.module.css";

interface ScoreCellProps {
  view: QueueScoreView;
  lang?: Language;
}

/**
 * Queue cell for the experimental AI case attention estimate. Shows only a
 * genuine current server value (`/100`, labelled "IA · à revoir"); otherwise
 * a dash with its reason written out, so touch users see why. Display only:
 * the queue order never depends on it.
 */
export function ScoreCell({ view, lang = "fr" }: ScoreCellProps) {
  const copy = DASHBOARD_COPY[lang];
  if (view.kind === "none") {
    // The reason is visible and read once; the dash is decoration. An
    // untranslated French reason keeps lang="fr" dir="ltr" under Arabic.
    const reason = scoreUnavailableText(view.text, lang);
    return (
      <span className={styles.scoreNone}>
        <span className={styles.scoreDash} aria-hidden="true">
          —
        </span>
        <span className={styles.scoreReason} lang={reason.lang} dir={directionFor(reason.lang)}>
          {reason.text}
        </span>
      </span>
    );
  }
  return (
    <span className={styles.scoreValue} title={copy.scoreLabel}>
      {/* Value and unit stay one LTR island under an Arabic shell. */}
      <span className={styles.score} dir="ltr">
        <data value={view.value}>{view.value}</data>
        <span className={styles.scoreMax}>/100</span>
      </span>
      <span className={styles.scoreNote} aria-hidden="true">
        {copy.scoreNote}
      </span>
      <VisuallyHidden>{copy.scoreLabel}</VisuallyHidden>
    </span>
  );
}

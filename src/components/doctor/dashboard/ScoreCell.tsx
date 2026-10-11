import { VisuallyHidden } from "@/components/ui";
import { AI_SCORE_LABEL, type QueueScoreView } from "../record/ai-case-score-view";
import styles from "./Dashboard.module.css";

/**
 * Queue cell for the experimental AI case attention estimate. Shows only a
 * genuine current server value (`/100`, labelled "à revoir"); otherwise an
 * honest dash. Display only: the queue order never depends on it.
 */
export function ScoreCell({ view }: { view: QueueScoreView }) {
  if (view.kind === "none") {
    return (
      <span className={styles.score} title={view.text}>
        <span aria-hidden="true">—</span>
        <VisuallyHidden>{view.text}</VisuallyHidden>
      </span>
    );
  }
  return (
    <span className={styles.scoreValue} title={AI_SCORE_LABEL}>
      <span className={styles.score}>
        <data value={view.value}>{view.value}</data>/100
      </span>
      <span className={styles.scoreNote} aria-hidden="true">
        IA · à revoir
      </span>
      <VisuallyHidden>{AI_SCORE_LABEL}</VisuallyHidden>
    </span>
  );
}

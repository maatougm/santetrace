import type { SpinnerProps } from "./contract";
import { VisuallyHidden } from "./VisuallyHidden";
import styles from "./Spinner.module.css";

interface SpinnerGlyphProps {
  size: number;
}

/** Decorative spinner glyph (no live region). Used inside busy buttons. */
export function SpinnerGlyph({ size }: SpinnerGlyphProps) {
  return (
    <svg
      className={styles.svg}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle className={styles.track} cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.25" />
      <circle
        className={styles.arc}
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Loading indicator with a screen-reader label (role="status"). */
export function Spinner({ label = "Chargement", size = 20 }: SpinnerProps) {
  return (
    <span className={styles.spinner} role="status">
      <SpinnerGlyph size={size} />
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  );
}

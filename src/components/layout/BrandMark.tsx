import styles from "./BrandMark.module.css";

interface BrandMarkProps {
  /** "dark" for the blue header band, "light" for white surfaces. */
  tone?: "light" | "dark";
  /** Hide the wordmark and keep only the glyph. */
  compact?: boolean;
  subtitle?: string;
  /** Hide the subtitle on narrow screens (top-bar layouts). */
  collapseSubtitle?: boolean;
}

/** Santetrace mark: a record tile crossed by a single trace line. */
export function BrandMark({ tone = "light", compact = false, subtitle, collapseSubtitle = false }: BrandMarkProps) {
  return (
    <span className={`${styles.brand} ${tone === "dark" ? styles.dark : styles.light}`}>
      <svg className={styles.glyph} viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">
        <rect x="1.5" y="1.5" width="29" height="29" rx="8" className={styles.tile} />
        <path
          d="M6 17.5h5.2l2.3-6.5 3.6 11 2.6-7.2 1.6 2.7H26"
          fill="none"
          className={styles.trace}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {!compact && (
        <span className={styles.words}>
          <span className={styles.name}>Santetrace</span>
          {subtitle && (
            <span className={`${styles.subtitle} ${collapseSubtitle ? styles.collapsible : ""}`}>{subtitle}</span>
          )}
        </span>
      )}
    </span>
  );
}

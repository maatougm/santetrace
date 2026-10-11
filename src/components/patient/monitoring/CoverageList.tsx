"use client";

/**
 * Coverage chips. "complete" is a plain neutral badge; every gap (missing,
 * stale, contradictory, awaiting verification, partial, unsupported) is
 * dashed with a question icon, so a gap never looks like a reassurance.
 */
import { Badge, Icon } from "@/components/ui";
import { CARE_COPY } from "@/lib/client/copy/care";
import type { Language } from "@/lib/client/api";
import { orderedCoverage, type CoverageDisplay } from "./monitoring-view";
import styles from "./monitoring.module.css";

/** "partial" (profiled, some limits unassessed) is not "no profile" ("unsupported"). */
function gapLabel(entry: Exclude<CoverageDisplay, "complete">, lang: Language): string {
  return entry === "partial" ? CARE_COPY[lang].monitoring.partialCoverage : CARE_COPY[lang].coverage[entry];
}

export function CoverageList({ coverage, lang, label }: { coverage: readonly CoverageDisplay[]; lang: Language; label?: string }) {
  const entries = orderedCoverage(coverage);
  if (entries.length === 0) return null;
  const copy = CARE_COPY[lang].coverage;
  return (
    <ul className={styles.coverage} aria-label={label}>
      {entries.map((entry) => (
        <li key={entry}>
          {entry === "complete" ? (
            <Badge tone="neutral" icon="check">
              {copy.complete}
            </Badge>
          ) : (
            <span className={styles.gap}>
              <Icon name="help-circle" size={14} />
              {gapLabel(entry, lang)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

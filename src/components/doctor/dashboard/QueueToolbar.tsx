"use client";

import { useId } from "react";
import { Field, Icon, TextInput } from "@/components/ui";
import type { Language } from "@/lib/client/api";
import { useMediaQuery } from "../shared/hooks";
import { DASHBOARD_COPY, filterButtonLabel, filterSummaryLabel } from "./dashboard-copy";
import { QUEUE_FILTERS, type QueueFilter, type QueueFilterCounts } from "./queue-filter";
import styles from "./Dashboard.module.css";

/** Edge colour echoing the displayed priority; the label always carries the meaning. */
const FILTER_TONE: Readonly<Record<QueueFilter, "red" | "orange" | "unknown" | undefined>> = {
  all: undefined,
  red: "red",
  orange: "orange",
  pending: undefined,
  review: "unknown",
};

interface QueueToolbarProps {
  search: string;
  onSearchChange: (search: string) => void;
  filter: QueueFilter;
  onFilterChange: (filter: QueueFilter) => void;
  counts: QueueFilterCounts;
  lang?: Language;
}

/**
 * Patient search (name, accent-insensitive) and the five quick filters with
 * true counts. One set of buttons: on phones they sit in a native disclosure
 * (collapsed by default) whose summary names the active filter; from 768px the
 * disclosure is held open and its summary hidden, so the same buttons are
 * visible, focusable and exposed to assistive tech in every browser.
 */
export function QueueToolbar({ search, onSearchChange, filter, onFilterChange, counts, lang = "fr" }: QueueToolbarProps) {
  const searchId = useId();
  const copy = DASHBOARD_COPY[lang];
  // Server render and phones: undefined → native, user-controlled disclosure.
  const wide = useMediaQuery("(min-width: 768px)");
  return (
    <div className={styles.toolbar}>
      <Field label={copy.searchLabel} htmlFor={searchId} className={styles.search}>
        <TextInput
          id={searchId}
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
        />
      </Field>
      <details className={styles.filterDisclosure} open={wide || undefined}>
        <summary className={styles.filterSummary}>
          <span className={styles.filterSummaryText}>{filterSummaryLabel(filter, counts, lang)}</span>
          <Icon name="chevron-down" size={20} className={styles.filterChevron} />
        </summary>
        <div role="group" aria-label={copy.filtersGroup} className={styles.filters}>
          {QUEUE_FILTERS.map((id) => {
            const pressed = filter === id;
            const tone = FILTER_TONE[id];
            return (
              <button
                key={id}
                type="button"
                aria-pressed={pressed}
                data-tone={tone}
                className={styles.filter}
                onClick={() => onFilterChange(pressed && id !== "all" ? "all" : id)}
              >
                {tone ? <span className={styles.filterMark} aria-hidden="true" /> : null}
                <span>{filterButtonLabel(id, counts, lang)}</span>
              </button>
            );
          })}
        </div>
      </details>
    </div>
  );
}

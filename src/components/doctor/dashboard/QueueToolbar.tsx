"use client";

import { useId } from "react";
import { Field, TextInput } from "@/components/ui";
import type { QueueFilter, QueueFilterCounts } from "./queue-filter";
import styles from "./Dashboard.module.css";

interface FilterOption {
  id: QueueFilter;
  label: string;
  /** Edge colour echoing the displayed priority; the label always carries the meaning. */
  tone?: "red" | "orange" | "unknown";
}

const FILTER_OPTIONS: readonly FilterOption[] = [
  { id: "all", label: "Tous" },
  { id: "red", label: "Priorité haute", tone: "red" },
  { id: "orange", label: "Suivi requis", tone: "orange" },
  { id: "pending", label: "En attente pour vous" },
  { id: "review", label: "À vérifier", tone: "unknown" },
];

interface QueueToolbarProps {
  search: string;
  onSearchChange: (search: string) => void;
  filter: QueueFilter;
  onFilterChange: (filter: QueueFilter) => void;
  counts: QueueFilterCounts;
}

/** Patient search (name, accent-insensitive) and quick priority filters with true counts. */
export function QueueToolbar({ search, onSearchChange, filter, onFilterChange, counts }: QueueToolbarProps) {
  const searchId = useId();
  return (
    <div className={styles.toolbar}>
      <Field label="Rechercher un patient" htmlFor={searchId} className={styles.search}>
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
      <div role="group" aria-label="Filtrer la file de patients" className={styles.filters}>
        {FILTER_OPTIONS.map((option) => {
          const pressed = filter === option.id;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={pressed}
              data-tone={option.tone}
              className={styles.filter}
              onClick={() => onFilterChange(pressed && option.id !== "all" ? "all" : option.id)}
            >
              {option.tone ? <span className={styles.filterMark} aria-hidden="true" /> : null}
              <span>
                {option.label} ({counts[option.id]})
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import type { TabsProps } from "./contract";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { tabId, tabPanelId } from "./tabs-ids";
import styles from "./Tabs.module.css";

export interface TabsExtraProps<T extends string> extends TabsProps<T> {
  /**
   * Stable prefix for tab ids. When set, tabs get aria-controls pointing at
   * `${idPrefix}-panel-${id}`; render the panel with tabPanelProps(idPrefix, active).
   */
  idPrefix?: string;
  className?: string;
}

type Direction = "next" | "previous";

function arrowDirection(key: string, isRtl: boolean): Direction | null {
  if (key === "ArrowRight") return isRtl ? "previous" : "next";
  if (key === "ArrowLeft") return isRtl ? "next" : "previous";
  return null;
}

/**
 * Controlled tablist (automatic activation). Arrow keys follow reading
 * direction (mirrored in RTL), Home/End jump to the ends.
 */
export function Tabs<T extends string>({ tabs, active, onChange, ariaLabel, idPrefix, className }: TabsExtraProps<T>) {
  const generatedId = useId();
  const prefix = idPrefix ?? `tabs-${generatedId}`;
  const listRef = useRef<HTMLDivElement>(null);
  const activeIndex = tabs.findIndex((tab) => tab.id === active);
  const focusableIndex = activeIndex >= 0 ? activeIndex : 0;

  function activate(index: number) {
    const target = tabs[index];
    if (!target) return;
    onChange(target.id);
    const button = listRef.current?.querySelector<HTMLButtonElement>(`[data-tab-index="${index}"]`);
    button?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    // Leave browser shortcuts (Alt/Cmd+Arrow history navigation, selection) alone.
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const last = tabs.length - 1;
    if (event.key === "Home") {
      event.preventDefault();
      activate(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      activate(last);
      return;
    }
    const isRtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const direction = arrowDirection(event.key, isRtl);
    if (!direction) return;
    event.preventDefault();
    const nextIndex = direction === "next" ? (index >= last ? 0 : index + 1) : index <= 0 ? last : index - 1;
    activate(nextIndex);
  }

  return (
    <div ref={listRef} role="tablist" aria-label={ariaLabel} className={cx(styles.list, className)}>
      {tabs.map((tab, index) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tabId(prefix, tab.id)}
            data-tab-index={index}
            aria-selected={selected}
            aria-controls={idPrefix ? tabPanelId(idPrefix, tab.id) : undefined}
            tabIndex={index === focusableIndex ? 0 : -1}
            className={styles.tab}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {tab.icon ? <Icon name={tab.icon} size={16} className={styles.icon} /> : null}
            <span>{tab.label}</span>
            {typeof tab.count === "number" ? <span className={styles.count}>{tab.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

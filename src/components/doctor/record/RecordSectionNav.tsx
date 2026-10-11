"use client";

import { useId, type ChangeEvent } from "react";
import { Icon, Select, type IconName } from "@/components/ui";
import type { RecordNavCopy } from "./record-nav-copy";
import { parseTabId, type FrequentTabId, type NavGroup, type RecordNavView, type TabId } from "./record-tabs";
import styles from "./RecordSectionNav.module.css";

const FREQUENT_ICON: Record<FrequentTabId, IconName> = {
  care: "clipboard",
  measurements: "heart-pulse",
  documents: "file-text",
  messages: "message",
};

type NavCopy = Pick<
  RecordNavCopy,
  "navLabel" | "sectionSelectLabel" | "jumpToSection" | "frequentLabel" | "moreSelectLabel" | "morePlaceholder"
>;

interface RecordSectionNavProps {
  view: RecordNavView;
  copy: NavCopy;
  /** Id of the record panel these controls switch. */
  panelId: string;
  onSelect: (tab: TabId) => void;
  /** Reveal and focus the section already shown, without changing it. */
  onJump: () => void;
}

function GroupOptions({ groups }: { groups: NavGroup[] }) {
  return (
    <>
      {groups.map((group) => (
        <optgroup key={group.id} label={group.label}>
          {group.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.text}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

/**
 * Record section navigation. Two presentations of the same controlled state,
 * switched by CSS only (the hidden one is display:none): phone = one labelled
 * native select with all 13 destinations, then an "Aller à …" button for the
 * section already chosen (re-picking the same option fires no change);
 * desktop = four frequent buttons plus a labelled "Autres sections" select.
 * Stateless and effect-free: it never mounts a section, it only reports the
 * chosen id or a request to reveal the current one.
 */
export function RecordSectionNav({ view, copy, panelId, onSelect, onJump }: RecordSectionNavProps) {
  const phoneId = useId();
  const moreId = useId();
  const secondaryActive = view.secondaryValue !== "";

  const choose = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = parseTabId(event.target.value);
    if (next) onSelect(next);
  };

  return (
    <nav aria-label={copy.navLabel} className={styles.nav}>
      <div className={styles.phone}>
        <label htmlFor={phoneId} className={styles.label}>
          {copy.sectionSelectLabel}
        </label>
        <Select id={phoneId} value={view.active} onChange={choose} aria-controls={panelId}>
          <GroupOptions groups={view.groups} />
        </Select>
        <button type="button" className={styles.jump} aria-controls={panelId} onClick={onJump}>
          {copy.jumpToSection(view.activeLabel)}
        </button>
      </div>

      <div className={styles.desktop}>
        <ul className={styles.frequent} aria-label={copy.frequentLabel}>
          {view.frequent.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                className={styles.link}
                aria-current={option.current ? "true" : undefined}
                aria-controls={panelId}
                onClick={() => onSelect(option.id)}
              >
                <Icon name={FREQUENT_ICON[option.id]} size={18} />
                <span>{option.label}</span>
                {option.count !== undefined ? <span className={styles.count}>{option.count}</span> : null}
              </button>
            </li>
          ))}
        </ul>
        <div className={styles.more} data-current={secondaryActive ? "true" : undefined}>
          <label htmlFor={moreId} className={styles.moreLabel}>
            {copy.moreSelectLabel}
          </label>
          <Select id={moreId} className={styles.moreControl} value={view.secondaryValue} onChange={choose} aria-controls={panelId}>
            <option value="" disabled>
              {copy.morePlaceholder}
            </option>
            <GroupOptions groups={view.secondaryGroups} />
          </Select>
        </div>
      </div>
    </nav>
  );
}

"use client";

/** Native <details>/<summary> disclosure: keyboard, screen-reader and no-JS friendly. */
import type { ReactNode } from "react";
import { Icon } from "@/components/ui";
import css from "../home.module.css";

interface DisclosureProps {
  title: ReactNode;
  /** Short value shown next to the title while closed (e.g. the latest reading). */
  value?: ReactNode;
  children: ReactNode;
  /** "inline": sits inside another card, separated by a hairline instead of its own border. */
  variant?: "card" | "inline";
}

export function Disclosure({ title, value, children, variant = "card" }: DisclosureProps) {
  return (
    <details className={variant === "inline" ? `${css.details} ${css.detailsInline}` : css.details}>
      <summary className={css.summary}>
        <span className={css.summaryText}>
          {title}
          {value ? <span className={css.summaryValue}> · {value}</span> : null}
        </span>
        <Icon name="chevron-down" size={20} className={css.chevron} />
      </summary>
      <div className={css.detailsBody}>{children}</div>
    </details>
  );
}

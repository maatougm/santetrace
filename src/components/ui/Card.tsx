import type { CardProps } from "./contract";
import { cx } from "./cx";
import styles from "./Card.module.css";

const PADDING_CLASS = {
  none: styles.padNone,
  sm: styles.padSm,
  md: styles.padMd,
  lg: styles.padLg,
} as const;

const TONE_CLASS = {
  default: undefined,
  muted: styles.muted,
  "priority-orange": styles.priorityOrange,
  "priority-red": styles.priorityRed,
} as const;

export interface CardExtraProps extends CardProps {
  /** Heading level for the title. Default 2 (pages own the single h1). */
  headingLevel?: 2 | 3 | 4;
}

/**
 * Bordered surface. With `id` and `title`, a <section>/<article> is labelled by
 * its heading (`${id}-title`). `padding="none"` suits flush tables and lists.
 */
export function Card({
  title,
  eyebrow,
  description,
  actions,
  children,
  as: Tag = "section",
  padding = "md",
  tone = "default",
  className,
  id,
  headingLevel = 2,
}: CardExtraProps) {
  const Heading = `h${headingLevel}` as const;
  const titleId = id && title ? `${id}-title` : undefined;
  const hasHeader = Boolean(title || eyebrow || description || actions);

  return (
    <Tag
      id={id}
      className={cx(styles.card, PADDING_CLASS[padding], TONE_CLASS[tone], className)}
      aria-labelledby={Tag === "div" ? undefined : titleId}
    >
      {hasHeader ? (
        <header className={styles.header}>
          {title || eyebrow || description ? (
            <div className={styles.heading}>
              {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
              {title ? (
                <Heading id={titleId} className={styles.title}>
                  {title}
                </Heading>
              ) : null}
              {description ? <p className={styles.description}>{description}</p> : null}
            </div>
          ) : null}
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </header>
      ) : null}
      {children !== undefined && children !== null ? <div className={styles.body}>{children}</div> : null}
    </Tag>
  );
}

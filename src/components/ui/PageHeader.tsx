import Link from "next/link";
import type { PageHeaderProps } from "./contract";
import { Icon } from "./Icon";
import styles from "./PageHeader.module.css";

export interface PageHeaderExtraProps extends PageHeaderProps {
  /** Id placed on the h1 (useful for aria-labelledby on <main>). */
  titleId?: string;
}

/** Page title block: optional back link, eyebrow, h1 (display serif), description and actions. */
export function PageHeader({ title, eyebrow, description, actions, back, titleId }: PageHeaderExtraProps) {
  return (
    <header className={styles.header}>
      {back ? (
        <Link href={back.href} className={styles.back}>
          <Icon name="arrow-left" size={16} />
          <span>{back.label}</span>
        </Link>
      ) : null}
      <div className={styles.row}>
        <div className={styles.heading}>
          {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
          <h1 id={titleId} className={styles.title}>
            {title}
          </h1>
          {description ? <p className={styles.description}>{description}</p> : null}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
    </header>
  );
}

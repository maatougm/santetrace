import type { KeyValueListProps } from "./contract";
import { cx } from "./cx";
import styles from "./KeyValueList.module.css";

const COLUMN_CLASS = { 1: styles.cols1, 2: styles.cols2, 3: styles.cols3 } as const;

export interface KeyValueListExtraProps extends KeyValueListProps {
  className?: string;
}

/**
 * Semantic <dl> of label/value pairs. Columns respond to the container width,
 * not the viewport, so it works in narrow side panels. `mono` values are
 * bidi-isolated (codes, identifiers) so they never reorder in Arabic.
 */
export function KeyValueList({ items, columns = 1, dense = false, className }: KeyValueListExtraProps) {
  return (
    <div className={cx(styles.wrap, className)}>
      <dl className={cx(styles.list, COLUMN_CLASS[columns], dense && styles.dense)}>
        {items.map((item, index) => (
          <div key={index} className={styles.item}>
            <dt className={styles.term}>{item.label}</dt>
            <dd className={cx(styles.value, item.mono && styles.mono)}>
              {item.mono ? <bdi>{item.value}</bdi> : item.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

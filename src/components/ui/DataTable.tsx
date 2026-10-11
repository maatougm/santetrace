import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import type { DataTableProps, TableColumn } from "./contract";
import { cx } from "./cx";
import { VisuallyHidden } from "./VisuallyHidden";
import styles from "./DataTable.module.css";

export type DataTableRowTone = "default" | "priority-orange" | "priority-red";

export interface DataTableExtraProps<Row> extends DataTableProps<Row> {
  /** Keeps the caption for screen readers but hides it visually. */
  captionHidden?: boolean;
  /** Priority edge mark on a row (alert lists only). */
  rowTone?: (row: Row) => DataTableRowTone | undefined;
  /**
   * Makes the scroll wrapper a focusable, labelled region so keyboard users
   * can scroll wide tables. Recommended when rows are not clickable.
   */
  scrollLabel?: string;
  className?: string;
}

const INTERACTIVE_SELECTOR = "a, button, input, select, textarea, label, summary, [role='button'], [role='link']";
const DEFAULT_EMPTY = "Aucune donnée";

const ROW_TONE_CLASS: Readonly<Record<DataTableRowTone, string | undefined>> = {
  default: undefined,
  "priority-orange": styles.rowPriorityOrange,
  "priority-red": styles.rowPriorityRed,
};

function alignClass<Row>(column: TableColumn<Row>): string | undefined {
  const align = column.align ?? (column.numeric ? "end" : "start");
  if (align === "end") return styles.alignEnd;
  if (align === "center") return styles.alignCenter;
  return undefined;
}

/** True when the event started on a nested control that handles itself. */
function fromNestedControl(event: { target: EventTarget; currentTarget: HTMLElement }): boolean {
  if (!(event.target instanceof Element)) return false;
  const control = event.target.closest(INTERACTIVE_SELECTOR);
  return control !== null && control !== event.currentTarget && event.currentTarget.contains(control);
}

/**
 * Semantic table. Numeric columns are tabular and end-aligned. With
 * `onRowClick`, rows are focusable and open on click, Enter or Space; nested
 * links/buttons keep their own behaviour. Put a real link in the first cell
 * too when the row navigates, so the destination is announced.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
  onRowClick,
  dense = false,
  captionHidden = false,
  rowTone,
  scrollLabel,
  className,
}: DataTableExtraProps<Row>) {
  const clickable = typeof onRowClick === "function";

  function rowHandlers(row: Row) {
    if (!onRowClick) return {};
    return {
      tabIndex: 0,
      onClick: (event: MouseEvent<HTMLTableRowElement>) => {
        if (fromNestedControl(event)) return;
        onRowClick(row);
      },
      onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onRowClick(row);
        }
      },
    };
  }

  const emptyContent: ReactNode = empty ?? <div className={styles.emptyDefault}>{DEFAULT_EMPTY}</div>;

  return (
    <div
      className={cx(styles.scroller, className)}
      role={scrollLabel ? "region" : undefined}
      aria-label={scrollLabel}
      tabIndex={scrollLabel ? 0 : undefined}
    >
      <table className={cx(styles.table, dense && styles.dense)}>
        {caption ? (
          <caption className={captionHidden ? undefined : styles.caption}>
            {captionHidden ? <VisuallyHidden>{caption}</VisuallyHidden> : caption}
          </caption>
        ) : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cx(styles.th, alignClass(column))}
                style={column.width ? { width: column.width } : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className={styles.row}>
              <td className={cx(styles.td, styles.emptyCell)} colSpan={columns.length}>
                {emptyContent}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={cx(styles.row, clickable && styles.clickable, ROW_TONE_CLASS[rowTone?.(row) ?? "default"])}
                {...rowHandlers(row)}
              >
                {columns.map((column) => (
                  <td key={column.key} className={cx(styles.td, alignClass(column), column.numeric && styles.numeric)}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

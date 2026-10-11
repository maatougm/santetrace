"use client";

import type { ReactNode } from "react";
import styles from "./Charts.module.css";

export type LegendMarker = "circle" | "square" | "diamond";

export interface LegendItem {
  key: string;
  label: string;
  /** CSS colour token, e.g. "var(--chart-systolic)". */
  color: string;
  kind: "series" | "threshold";
  marker?: LegendMarker;
  dash?: "dashed" | "dotted";
}

interface ChartFrameProps {
  id: string;
  title: string;
  /** Unit and scope line under the title. */
  subtitle: ReactNode;
  legend: LegendItem[];
  chart: ReactNode;
  /** Accessible table alternative. */
  table: ReactNode;
  rowCount: number;
  footnote?: ReactNode;
}

function MarkerSwatch({ marker = "circle", color }: { marker?: LegendMarker; color: string }) {
  if (marker === "square") return <rect x={6} y={3} width={8} height={8} rx={1.5} fill={color} />;
  if (marker === "diamond") return <path d="M10 2 L14.5 7 L10 12 L5.5 7 Z" fill={color} />;
  return <circle cx={10} cy={7} r={4} fill={color} />;
}

function LegendKey({ item }: { item: LegendItem }) {
  const dash = item.dash === "dotted" ? "1.5 3" : item.dash === "dashed" ? "5 3" : undefined;
  return (
    <svg width={20} height={14} viewBox="0 0 20 14" aria-hidden="true" focusable="false" className={styles.legendSvg}>
      <line x1={0} y1={7} x2={20} y2={7} stroke={item.color} strokeWidth={2} strokeDasharray={dash} strokeLinecap="round" />
      {item.kind === "series" ? <MarkerSwatch marker={item.marker} color={item.color} /> : null}
    </svg>
  );
}

/** Card frame for one chart: title + unit, legend, plot, data-table twin. */
export function ChartFrame({ id, title, subtitle, legend, chart, table, rowCount, footnote }: ChartFrameProps) {
  const titleId = `${id}-title`;
  return (
    <figure className={styles.frame} aria-labelledby={titleId}>
      <header className={styles.frameHead}>
        <div>
          <h3 id={titleId} className={styles.frameTitle}>
            {title}
          </h3>
          <p className={styles.frameSubtitle}>{subtitle}</p>
        </div>
        {legend.length > 0 ? (
          <ul className={styles.legend} aria-label="Légende">
            {legend.map((item) => (
              <li key={item.key} className={styles.legendItem}>
                <LegendKey item={item} />
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </header>
      <div className={styles.plot}>{chart}</div>
      {footnote ? <figcaption className={styles.footnote}>{footnote}</figcaption> : null}
      <details className={styles.details}>
        <summary>Voir les données en tableau ({rowCount})</summary>
        <div className={styles.tableWrap}>{table}</div>
      </details>
    </figure>
  );
}

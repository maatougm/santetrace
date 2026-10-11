"use client";

import type { ReactNode } from "react";
import type { DotItemDotProps } from "recharts";
import type { LegendMarker } from "./ChartFrame";
import styles from "./Charts.module.css";

export const AXIS_TICK = { fontSize: 12, fill: "var(--chart-axis)" } as const;
export const AXIS_LABEL_STYLE = { fontSize: 12, fill: "var(--color-ink-3)" } as const;
export const GRID_STROKE = "var(--chart-grid)";
export const THRESHOLD_ORANGE = "var(--chart-threshold-orange)";
export const THRESHOLD_RED = "var(--chart-threshold-red)";
export const CURSOR = { stroke: "var(--chart-axis)", strokeWidth: 1 } as const;
export const CHART_HEIGHT = 280;

/** Threshold label: text tokens, never the data colour. */
export function thresholdLabel(text: string) {
  return { value: text, position: "right" as const, fill: "var(--color-ink-3)", fontSize: 11 };
}

/**
 * Marker renderer with a 2px surface ring. Shape differs per series so
 * identity never relies on colour alone.
 */
export function markerDot(marker: LegendMarker, color: string, radius = 4.5) {
  function Dot(props: DotItemDotProps): ReactNode {
    const { cx, cy, index, dataKey } = props;
    if (typeof cx !== "number" || typeof cy !== "number") return null;
    const key = `${String(dataKey)}-${index}`;
    const ring = { stroke: "var(--color-surface)", strokeWidth: 2 };
    if (marker === "square") {
      const size = radius * 2;
      return <rect key={key} x={cx - radius} y={cy - radius} width={size} height={size} rx={1.5} fill={color} {...ring} />;
    }
    if (marker === "diamond") {
      const r = radius + 1;
      return <path key={key} d={`M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z`} fill={color} {...ring} />;
    }
    return <circle key={key} cx={cx} cy={cy} r={radius} fill={color} {...ring} />;
  }
  return Dot;
}

interface TooltipRow {
  key: string;
  color: string;
  label: string;
  value: string;
}

interface TooltipCardProps {
  heading: string;
  rows: TooltipRow[];
  meta?: ReactNode;
}

/** Values lead, labels follow; series keyed by a short line. */
export function TooltipCard({ heading, rows, meta }: TooltipCardProps) {
  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipHeading}>{heading}</p>
      <ul className={styles.tooltipRows}>
        {rows.map((row) => (
          <li key={row.key}>
            <span className={styles.tooltipKey} style={{ background: row.color }} aria-hidden="true" />
            <strong>{row.value}</strong>
            <span>{row.label}</span>
          </li>
        ))}
      </ul>
      {meta ? <div className={styles.tooltipMeta}>{meta}</div> : null}
    </div>
  );
}

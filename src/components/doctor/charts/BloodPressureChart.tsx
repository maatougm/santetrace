"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { Measurement, Rules } from "@/lib/client/api";
import { formatNumber, measurementProvenanceLabel, statusLabel } from "@/lib/client/format";
import { fmtDateTime } from "../shared/time";
import { ChartFrame, type LegendItem } from "./ChartFrame";
import {
  AXIS_LABEL_STYLE,
  AXIS_TICK,
  CHART_HEIGHT,
  CURSOR,
  GRID_STROKE,
  THRESHOLD_ORANGE,
  THRESHOLD_RED,
  TooltipCard,
  markerDot,
  thresholdLabel,
} from "./chart-parts";
import { timeDomain, timeTicks, valueDomain } from "./time-axis";
import styles from "./Charts.module.css";

interface BpPoint {
  t: number;
  systolic: number;
  diastolic: number;
  measurement: Measurement;
}

const SYSTOLIC = "var(--chart-systolic)";
const DIASTOLIC = "var(--chart-diastolic)";

function toPoints(measurements: readonly Measurement[]): BpPoint[] {
  return measurements
    .filter(
      (m): m is Measurement & { systolic: number; diastolic: number } =>
        m.kind === "blood_pressure" && typeof m.systolic === "number" && typeof m.diastolic === "number",
    )
    .map((m) => ({ t: Date.parse(m.measuredAt), systolic: m.systolic, diastolic: m.diastolic, measurement: m }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
}

function BpTooltip({ active, payload }: TooltipContentProps) {
  const point = active ? (payload?.[0]?.payload as BpPoint | undefined) : undefined;
  if (!point) return null;
  const m = point.measurement;
  return (
    <TooltipCard
      heading={fmtDateTime(m.measuredAt)}
      rows={[
        { key: "s", color: SYSTOLIC, label: "Systolique", value: `${formatNumber(point.systolic, "fr", 0)} mmHg` },
        { key: "d", color: DIASTOLIC, label: "Diastolique", value: `${formatNumber(point.diastolic, "fr", 0)} mmHg` },
      ]}
      meta={
        <>
          <span>{statusLabel(m.status)}</span>
          <span>Source : {measurementProvenanceLabel(m)}</span>
          <span>Règle {m.ruleVersion}</span>
        </>
      }
    />
  );
}

interface BloodPressureChartProps {
  measurements: readonly Measurement[];
  /** Null when the patient did not share the rules with this clinician: no threshold drawn. */
  rules: Rules | null;
}

/** Systolic and diastolic on one mmHg axis, with current demo thresholds when shared. */
export function BloodPressureChart({ measurements, rules }: BloodPressureChartProps) {
  const points = toPoints(measurements);
  if (points.length === 0) return null;

  const domain = timeDomain(
    points.map((p) => p.t),
    30 * 60_000,
  );
  const { ticks, format } = timeTicks(domain);
  const thresholds = rules ? [rules.systolicWarn, rules.systolicHigh, rules.diastolicWarn, rules.diastolicHigh] : [];
  const yDomain = valueDomain(
    points.flatMap((p) => [p.systolic, p.diastolic]),
    thresholds,
    10,
  );

  const legend: LegendItem[] = [
    { key: "s", label: "Systolique", color: SYSTOLIC, kind: "series", marker: "circle" },
    { key: "d", label: "Diastolique", color: DIASTOLIC, kind: "series", marker: "square" },
    ...(rules
      ? ([
          { key: "warn", label: "Seuil de suivi (démo)", color: THRESHOLD_ORANGE, kind: "threshold", dash: "dashed" },
          { key: "high", label: "Seuil priorité haute (démo)", color: THRESHOLD_RED, kind: "threshold", dash: "dashed" },
        ] satisfies LegendItem[])
      : []),
  ];

  const table = (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Mesurée le</th>
          <th scope="col" className={styles.num}>
            Systolique (mmHg)
          </th>
          <th scope="col" className={styles.num}>
            Diastolique (mmHg)
          </th>
          <th scope="col">Statut</th>
          <th scope="col">Source</th>
        </tr>
      </thead>
      <tbody>
        {[...points].reverse().map((p) => (
          <tr key={p.measurement.id}>
            <td>{fmtDateTime(p.measurement.measuredAt)}</td>
            <td className={styles.num}>{formatNumber(p.systolic, "fr", 0)}</td>
            <td className={styles.num}>{formatNumber(p.diastolic, "fr", 0)}</td>
            <td>{statusLabel(p.measurement.status)}</td>
            <td>{measurementProvenanceLabel(p.measurement)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartFrame
      id="chart-bp"
      title="Tension artérielle"
      subtitle={`mmHg · ${points.length} mesure${points.length > 1 ? "s" : ""} · heure de Tunis`}
      legend={legend}
      rowCount={points.length}
      table={table}
      footnote={
        rules
          ? `Seuils tracés : version actuelle ${rules.version} (démonstration, non validée). Chaque mesure a été évaluée avec la version en vigueur à sa réception (voir Mesures). S = systolique (tirets longs), D = diastolique (tirets courts).`
          : "Seuils non partagés avec vous : aucune ligne de seuil tracée."
      }
      chart={
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart data={points} margin={{ top: 12, right: 96, bottom: 24, left: 4 }}>
            <CartesianGrid stroke={GRID_STROKE} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={domain}
              ticks={ticks}
              tickFormatter={format}
              tick={AXIS_TICK}
              stroke={GRID_STROKE}
              label={{ value: "Date de mesure", position: "insideBottom", offset: -16, ...AXIS_LABEL_STYLE }}
            />
            <YAxis
              domain={yDomain}
              tick={AXIS_TICK}
              stroke={GRID_STROKE}
              width={56}
              label={{ value: "mmHg", angle: -90, position: "insideLeft", offset: 12, ...AXIS_LABEL_STYLE }}
            />
            {rules ? <ReferenceLine y={rules.systolicHigh} stroke={THRESHOLD_RED} strokeDasharray="6 4" label={thresholdLabel(`S priorité ≥ ${rules.systolicHigh}`)} ifOverflow="extendDomain" /> : null}
            {rules ? <ReferenceLine y={rules.systolicWarn} stroke={THRESHOLD_ORANGE} strokeDasharray="6 4" label={thresholdLabel(`S suivi ≥ ${rules.systolicWarn}`)} ifOverflow="extendDomain" /> : null}
            {rules ? <ReferenceLine y={rules.diastolicHigh} stroke={THRESHOLD_RED} strokeDasharray="2 4" label={thresholdLabel(`D priorité ≥ ${rules.diastolicHigh}`)} ifOverflow="extendDomain" /> : null}
            {rules ? <ReferenceLine y={rules.diastolicWarn} stroke={THRESHOLD_ORANGE} strokeDasharray="2 4" label={thresholdLabel(`D suivi ≥ ${rules.diastolicWarn}`)} ifOverflow="extendDomain" /> : null}
            <Tooltip content={BpTooltip} cursor={CURSOR} isAnimationActive={false} />
            <Line
              type="linear"
              dataKey="systolic"
              name="Systolique"
              stroke={SYSTOLIC}
              strokeWidth={2}
              dot={markerDot("circle", SYSTOLIC)}
              activeDot={{ r: 6, stroke: "var(--color-surface)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="diastolic"
              name="Diastolique"
              stroke={DIASTOLIC}
              strokeWidth={2}
              dot={markerDot("square", DIASTOLIC)}
              activeDot={{ r: 6, stroke: "var(--color-surface)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      }
    />
  );
}

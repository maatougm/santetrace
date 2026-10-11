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
import type { GlucoseUnit, Measurement, Rules } from "@/lib/client/api";
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

interface GlucosePoint {
  t: number;
  value: number;
  measurement: Measurement;
}

const GLUCOSE = "var(--chart-glucose)";
const UNITS: readonly GlucoseUnit[] = ["mg/dL", "mmol/L"];

function digits(unit: GlucoseUnit): number {
  return unit === "mmol/L" ? 1 : 0;
}

function pointsFor(measurements: readonly Measurement[], unit: GlucoseUnit): GlucosePoint[] {
  return measurements
    .filter((m): m is Measurement & { value: number } => m.kind === "glucose" && m.unit === unit && typeof m.value === "number")
    .map((m) => ({ t: Date.parse(m.measuredAt), value: m.value, measurement: m }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
}

function GlucoseTooltip({ active, payload }: TooltipContentProps) {
  const point = active ? (payload?.[0]?.payload as GlucosePoint | undefined) : undefined;
  if (!point) return null;
  const m = point.measurement;
  const unit = m.unit as GlucoseUnit;
  return (
    <TooltipCard
      heading={fmtDateTime(m.measuredAt)}
      rows={[{ key: "g", color: GLUCOSE, label: "Glycémie", value: `${formatNumber(point.value, "fr", digits(unit))} ${unit}` }]}
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

function GlucoseChart({ unit, points, rules }: { unit: GlucoseUnit; points: GlucosePoint[]; rules: Rules | null }) {
  const sameUnit = rules !== null && rules.glucoseUnit === unit;
  const domain = timeDomain(
    points.map((p) => p.t),
    30 * 60_000,
  );
  const { ticks, format } = timeTicks(domain);
  const step = unit === "mmol/L" ? 1 : 10;
  const yDomain = valueDomain(
    points.map((p) => p.value),
    rules && sameUnit ? [rules.glucoseWarn, rules.glucoseHigh] : [],
    step,
  );

  const legend: LegendItem[] = sameUnit
    ? [
        { key: "warn", label: "Seuil de suivi (démo)", color: THRESHOLD_ORANGE, kind: "threshold", dash: "dashed" },
        { key: "high", label: "Seuil priorité haute (démo)", color: THRESHOLD_RED, kind: "threshold", dash: "dashed" },
      ]
    : [];

  const table = (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Mesurée le</th>
          <th scope="col" className={styles.num}>
            Glycémie ({unit})
          </th>
          <th scope="col">Statut</th>
          <th scope="col">Source</th>
        </tr>
      </thead>
      <tbody>
        {[...points].reverse().map((p) => (
          <tr key={p.measurement.id}>
            <td>{fmtDateTime(p.measurement.measuredAt)}</td>
            <td className={styles.num}>{formatNumber(p.value, "fr", digits(unit))}</td>
            <td>{statusLabel(p.measurement.status)}</td>
            <td>{measurementProvenanceLabel(p.measurement)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const footnote = !rules
    ? "Seuils non partagés avec vous : aucune ligne de seuil tracée."
    : sameUnit
      ? `Seuils tracés : version actuelle ${rules.version} (démonstration, non validée).`
      : `Seuils de démonstration définis en ${rules.glucoseUnit} : non tracés sur cette échelle en ${unit} (aucune conversion affichée).`;

  return (
    <ChartFrame
      id={`chart-glucose-${unit === "mg/dL" ? "mgdl" : "mmoll"}`}
      title={`Glycémie (${unit})`}
      subtitle={`${unit} · ${points.length} mesure${points.length > 1 ? "s" : ""} · heure de Tunis`}
      legend={legend}
      rowCount={points.length}
      table={table}
      footnote={footnote}
      chart={
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart data={points} margin={{ top: 12, right: sameUnit ? 96 : 24, bottom: 24, left: 4 }}>
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
              tickFormatter={(value: number) => formatNumber(value, "fr", digits(unit))}
              label={{ value: unit, angle: -90, position: "insideLeft", offset: 12, ...AXIS_LABEL_STYLE }}
            />
            {rules && sameUnit ? (
              <ReferenceLine y={rules.glucoseHigh} stroke={THRESHOLD_RED} strokeDasharray="6 4" label={thresholdLabel(`Priorité ≥ ${formatNumber(rules.glucoseHigh, "fr", 1)}`)} />
            ) : null}
            {rules && sameUnit ? (
              <ReferenceLine y={rules.glucoseWarn} stroke={THRESHOLD_ORANGE} strokeDasharray="6 4" label={thresholdLabel(`Suivi ≥ ${formatNumber(rules.glucoseWarn, "fr", 1)}`)} />
            ) : null}
            <Tooltip content={GlucoseTooltip} cursor={CURSOR} isAnimationActive={false} />
            <Line
              type="linear"
              dataKey="value"
              name={`Glycémie (${unit})`}
              stroke={GLUCOSE}
              strokeWidth={2}
              dot={markerDot("diamond", GLUCOSE)}
              activeDot={{ r: 6, stroke: "var(--color-surface)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      }
    />
  );
}

/** One chart per glucose unit: mg/dL and mmol/L are never mixed on one axis. */
export function GlucoseCharts({ measurements, rules }: { measurements: readonly Measurement[]; rules: Rules | null }) {
  const series = UNITS.map((unit) => ({ unit, points: pointsFor(measurements, unit) })).filter((s) => s.points.length > 0);
  if (series.length === 0) return null;
  return (
    <>
      {series.map((s) => (
        <GlucoseChart key={s.unit} unit={s.unit} points={s.points} rules={rules} />
      ))}
    </>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { KeyboardEvent, ReactNode } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type DotItemDotProps,
  type TooltipContentProps,
} from "recharts";
import type { Candidate, CareDocument, Observation } from "@/lib/client/api";
import { formatNumber } from "@/lib/client/format";
import { CALENDAR_TIME_ZONE, calendarDateToMs, formatCalendarDate } from "../shared/dates";
import { reviewHref } from "../shared/routes";
import { fmtDateTime } from "../shared/time";
import { ChartFrame } from "./ChartFrame";
import { AXIS_LABEL_STYLE, AXIS_TICK, CHART_HEIGHT, CURSOR, GRID_STROKE, TooltipCard } from "./chart-parts";
import { DAY, timeDomain, timeTicks, valueDomain } from "./time-axis";
import styles from "./Charts.module.css";

const LAB = "var(--chart-lab)";

interface LabPoint {
  t: number;
  value: number;
  observation: Observation;
  page: number | null;
  filename: string | null;
  href: string;
}

interface LabSeries {
  key: string;
  exam: string;
  unit: string;
  points: LabPoint[];
}

/** Groups confirmed observations by exam + unit; units are never merged. */
export function labSeries(
  patientId: string,
  observations: readonly Observation[],
  candidates: readonly Candidate[],
  documents: readonly CareDocument[],
): LabSeries[] {
  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  const documentById = new Map(documents.map((d) => [d.id, d]));
  const groups = new Map<string, LabSeries>();
  for (const observation of observations) {
    const t = calendarDateToMs(observation.examDate);
    if (t === null || !Number.isFinite(observation.value)) continue;
    const key = `${observation.exam}\u0000${observation.unit}`;
    const point: LabPoint = {
      t,
      value: observation.value,
      observation,
      page: candidateById.get(observation.candidateId)?.page ?? null,
      filename: documentById.get(observation.documentId)?.filename ?? null,
      href: reviewHref(patientId, observation.documentId, observation.candidateId),
    };
    const existing = groups.get(key);
    groups.set(key, {
      key,
      exam: observation.exam,
      unit: observation.unit,
      points: [...(existing?.points ?? []), point],
    });
  }
  return [...groups.values()]
    .map((series) => ({ ...series, points: [...series.points].sort((a, b) => a.t - b.t) }))
    .sort((a, b) => a.exam.localeCompare(b.exam, "fr") || a.unit.localeCompare(b.unit, "fr"));
}

function sourceLabel(point: LabPoint): string {
  const page = point.page ? `, page ${point.page}` : "";
  return `${point.filename ?? "document source"}${page}`;
}

function LabTooltip({ active, payload }: TooltipContentProps) {
  const point = active ? (payload?.[0]?.payload as LabPoint | undefined) : undefined;
  if (!point) return null;
  const o = point.observation;
  return (
    <TooltipCard
      heading={`Examen du ${formatCalendarDate(o.examDate)}`}
      rows={[{ key: "v", color: LAB, label: o.exam, value: `${formatNumber(o.value, "fr", 2)} ${o.unit}` }]}
      meta={
        <>
          <span>Source : {sourceLabel(point)}</span>
          <span>
            Confirmé par {o.confirmedBy} le {fmtDateTime(o.confirmedAt)}
          </span>
          {o.revisions.length > 0 ? <span>Corrigé {o.revisions.length} fois (historique conservé)</span> : null}
          <span>Cliquer pour ouvrir la source</span>
        </>
      }
    />
  );
}

function sourceDot(onOpen: (href: string) => void) {
  function Dot(props: DotItemDotProps): ReactNode {
    const { cx, cy, index, payload } = props;
    const point = payload as LabPoint | undefined;
    if (typeof cx !== "number" || typeof cy !== "number" || !point) return null;
    const label = `${point.observation.exam} ${formatNumber(point.value, "fr", 2)} ${point.observation.unit} du ${formatCalendarDate(point.observation.examDate)} : ouvrir la source (${sourceLabel(point)})`;
    const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpen(point.href);
      }
    };
    return (
      <g
        key={`lab-${index}`}
        role="link"
        tabIndex={0}
        aria-label={label}
        className={styles.sourceDot}
        onClick={() => onOpen(point.href)}
        onKeyDown={onKeyDown}
      >
        <circle cx={cx} cy={cy} r={12} fill="transparent" />
        <circle cx={cx} cy={cy} r={5} fill={LAB} stroke="var(--color-surface)" strokeWidth={2} />
      </g>
    );
  }
  return Dot;
}

function LabChart({ series }: { series: LabSeries }) {
  const router = useRouter();
  const domain = timeDomain(
    series.points.map((p) => p.t),
    15 * DAY,
  );
  const { ticks, format } = timeTicks(domain, CALENDAR_TIME_ZONE);
  const values = series.points.map((p) => p.value);
  const spread = Math.max(...values) - Math.min(...values);
  const step = spread > 50 ? 10 : spread > 5 ? 1 : 0.5;
  const yDomain = valueDomain(values, [], step);
  const slug = series.key.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  const table = (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Date d’examen</th>
          <th scope="col" className={styles.num}>
            {series.exam} ({series.unit})
          </th>
          <th scope="col">Source</th>
          <th scope="col">Confirmé</th>
          <th scope="col">Corrections</th>
        </tr>
      </thead>
      <tbody>
        {[...series.points].reverse().map((p) => (
          <tr key={p.observation.id}>
            <td>{formatCalendarDate(p.observation.examDate)}</td>
            <td className={styles.num}>{formatNumber(p.value, "fr", 2)}</td>
            <td>
              <Link href={p.href}>{sourceLabel(p)}</Link>
            </td>
            <td>
              {p.observation.confirmedBy}, {fmtDateTime(p.observation.confirmedAt)}
            </td>
            <td>{p.observation.revisions.length}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartFrame
      id={`chart-lab-${slug}`}
      title={`${series.exam} (${series.unit})`}
      subtitle={`${series.unit} · ${series.points.length} résultat${series.points.length > 1 ? "s" : ""} confirmé${series.points.length > 1 ? "s" : ""} · date d’examen`}
      legend={[]}
      rowCount={series.points.length}
      table={table}
      footnote="Résultats confirmés par un clinicien uniquement. Chaque point ouvre sa page source dans la revue du document. Aucun seuil n’est tracé pour les examens biologiques."
      chart={
        <ResponsiveContainer width="100%" height={CHART_HEIGHT - 40}>
          <LineChart data={series.points} margin={{ top: 12, right: 24, bottom: 24, left: 4 }}>
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
              label={{ value: "Date d’examen", position: "insideBottom", offset: -16, ...AXIS_LABEL_STYLE }}
            />
            <YAxis
              domain={yDomain}
              tick={AXIS_TICK}
              stroke={GRID_STROKE}
              width={56}
              tickFormatter={(value: number) => formatNumber(value, "fr", 1)}
              label={{ value: series.unit, angle: -90, position: "insideLeft", offset: 12, ...AXIS_LABEL_STYLE }}
            />
            <Tooltip content={LabTooltip} cursor={CURSOR} isAnimationActive={false} />
            <Line
              type="linear"
              dataKey="value"
              name={series.exam}
              stroke={LAB}
              strokeWidth={2}
              dot={sourceDot((href) => router.push(href))}
              activeDot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      }
    />
  );
}

export function LabCharts({ series }: { series: LabSeries[] }) {
  if (series.length === 0) return null;
  return (
    <>
      {series.map((s) => (
        <LabChart key={s.key} series={s} />
      ))}
    </>
  );
}

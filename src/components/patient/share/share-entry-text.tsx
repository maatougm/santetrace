"use client";

/**
 * Label + description of one shareable element, for its checkbox row. Values
 * and units are LTR islands; provenance (simulated, verification) is always
 * visible next to the value.
 */
import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import { CARE_COPY, templateText } from "@/lib/client/copy/care";
import { SHARE_COPY } from "@/lib/client/copy/share";
import { formatDate, formatDateTime, formatNumber, isSimulatedMeasurement, measurementKindLabel, measurementSourceLabel } from "@/lib/client/format";
import type { Language } from "@/lib/client/transport";
import { Ltr, Reading } from "../bits";
import { factTitle, type ShareEntry } from "./share-selection";

export interface EntryText {
  label: ReactNode;
  description: ReactNode;
}

export function shareEntryText(entry: ShareEntry, lang: Language): EntryText {
  const care = CARE_COPY[lang];
  switch (entry.kind) {
    case "measurement": {
      const m = entry.item;
      return {
        label: (
          <>
            {measurementKindLabel(m.kind, lang)} <Reading value={m} lang={lang} size="sm" />
          </>
        ),
        description: (
          <>
            {formatDateTime(m.measuredAt, lang)} · {measurementSourceLabel(m.source, lang)}
            {isSimulatedMeasurement(m) ? (
              <>
                {" "}
                <Badge tone="outline" icon="activity">
                  {SHARE_COPY[lang].guest.simulatedBadge}
                </Badge>
              </>
            ) : null}
          </>
        ),
      };
    }
    case "observation": {
      const o = entry.item;
      return {
        label: (
          <>
            <bdi>{o.exam}</bdi>{" "}
            <Ltr>
              {formatNumber(o.value, lang, 2)} {o.unit}
            </Ltr>
          </>
        ),
        description: `${formatDate(o.examDate, lang)} · ${care.verification.confirmed} · ${care.record.version(1 + o.revisions.length)}`,
      };
    }
    case "patient_fact": {
      const f = entry.item;
      const title = factTitle(f, lang);
      return {
        label: (
          <>
            {title.kind}
            {title.label ? (
              <>
                {" · "}
                <bdi>{title.label}</bdi>
              </>
            ) : null}
            {f.value ? (
              <>
                {" · "}
                <bdi>{f.value}</bdi>
              </>
            ) : null}
          </>
        ),
        description: `${care.polarity[f.polarity]} · ${care.verification[f.verification]} · ${care.record.version(f.revision)}`,
      };
    }
    case "document": {
      const d = entry.item;
      return {
        label: <bdi>{d.filename}</bdi>,
        description: formatDate(d.uploadedAt, lang),
      };
    }
    case "approved_action": {
      const a = entry.item;
      return {
        label: templateText(a.action.templateId, lang),
        description: `${care.plan.due(formatDateTime(a.dueAt, lang))} · ${care.actionState[a.state]}`,
      };
    }
  }
}

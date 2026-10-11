"use client";

/**
 * Open red episode (spec 006 FR-010/FR-019). The fixed scenario message is
 * shown at once, without any model. It is read from open red alerts only, so
 * a later green measurement never hides it; only a clinician's resolution
 * (or rejection) closes it.
 *
 * Announcement: the visible banner is a plain note. A separate, always-mounted
 * alert region receives text only when the open red episode id changes, so the
 * 2 s record poll never re-announces the same episode.
 */
import { useEffect, useRef, useState } from "react";
import { Badge, Notice, VisuallyHidden } from "@/components/ui";
import type { Alert } from "@/lib/client/api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { formatDateTime } from "@/lib/client/format";
import { When } from "../bits";
import { usePatientRuntime } from "../PatientRuntime";
import { nextAnnouncement, openRedAlert } from "./monitoring-view";
import styles from "./monitoring.module.css";

interface RedEpisodeProps {
  alerts: readonly Alert[] | null;
  /** No accepted referent: say plainly that nobody receives this alert. */
  pendingDoctor: boolean;
}

function useRedAnnouncement(alert: Alert | null, text: (alert: Alert) => string): string {
  const announcedRef = useRef<string | null>(null);
  const [live, setLive] = useState("");
  const id = alert?.id ?? null;
  const textRef = useRef(text);
  textRef.current = text;

  // Keyed on the episode id only: poll re-renders keep the same id and never re-announce.
  const alertRef = useRef(alert);
  alertRef.current = alert;
  useEffect(() => {
    const decision = nextAnnouncement(announcedRef.current, id);
    announcedRef.current = decision.announcedId;
    const current = alertRef.current;
    if (decision.announce && current) setLive(textRef.current(current));
    else if (id === null) setLive("");
  }, [id]);

  return live;
}

export function RedEpisode({ alerts, pendingDoctor }: RedEpisodeProps) {
  const { lang } = usePatientRuntime();
  const copy = CARE_COPY[lang];
  const alert = alerts ? openRedAlert(alerts) : null;
  // The date makes two episodes' texts differ, so the second one is announced too.
  const live = useRedAnnouncement(alert, (open) => `${copy.red.fixedTitle}. ${copy.red.fixedBody} (${formatDateTime(open.createdAt, lang)})`);

  return (
    <>
      <VisuallyHidden>
        <span role="alert">{live}</span>
      </VisuallyHidden>
      {alert ? (
        <Notice key={alert.id} tone="red" role="note" title={copy.red.fixedTitle}>
          <div className={styles.redBody}>
            <p className={styles.redStrong}>{copy.red.fixedBody}</p>
            <p>
              <Badge tone="red">
                {copy.monitoring.redOpenTitle}
              </Badge>
            </p>
            <p>{copy.monitoring.redOpenBody}</p>
            {pendingDoctor ? <p className={styles.redStrong}>{copy.red.pendingDoctor}</p> : null}
            <p className={styles.redMeta}>
              <When iso={alert.createdAt} lang={lang} /> · {copy.red.fixedNote}
            </p>
          </div>
        </Notice>
      ) : null}
    </>
  );
}

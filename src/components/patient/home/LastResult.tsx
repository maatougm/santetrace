"use client";

/** Fixed server message after the patient's last send in this visit (memory only). */
import { Badge, Button, Card } from "@/components/ui";
import type { Language } from "@/lib/client/api";
import type { Messages } from "@/lib/client/i18n";
import type { MeasurementEntry } from "@/lib/client/outbox";
import { CareStatusBadge, Reading, When } from "../bits";
import css from "../home.module.css";
import styles from "../patient.module.css";

interface LastResultProps {
  entry: MeasurementEntry;
  lang: Language;
  t: Messages;
  onDismiss: () => void;
}

export function LastResult({ entry, lang, t, onDismiss }: LastResultProps) {
  const message = entry.result?.patientMessage;
  if (!message || !entry.result) return null;
  const tone = message.status === "red" ? "priority-red" : message.status === "orange" ? "priority-orange" : "default";
  return (
    <Card
      title={t.home.lastMessageTitle}
      tone={tone}
      actions={
        <Button variant="ghost" iconStart="x" onClick={onDismiss}>
          {t.common.dismiss}
        </Button>
      }
    >
      <div className={styles.stackSm}>
        <div className={css.latestTop}>
          <Reading value={entry.result.measurement} lang={lang} size="sm" />
          <CareStatusBadge status={message.status} lang={lang} size="sm" />
        </div>
        <p className={styles.serverMessage} dir="auto">
          {message.text}
        </p>
        <p className={styles.metaLine}>
          <Badge tone="muted" icon="lock">
            {t.common.fixedMessage}
          </Badge>{" "}
          <When iso={entry.result.measurement.receivedAt} lang={lang} label={t.common.receivedAt} />
        </p>
      </div>
    </Card>
  );
}

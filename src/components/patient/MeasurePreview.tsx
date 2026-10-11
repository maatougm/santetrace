"use client";

/** Confirmation step: shows exactly what will be sent; nothing has left the device yet. */
import { Badge, Button, Notice } from "@/components/ui";
import type { Language } from "@/lib/client/api";
import { measurementKindLabel } from "@/lib/client/format";
import type { Messages } from "@/lib/client/i18n";
import type { MeasurementDraft } from "@/lib/client/outbox";
import { Ltr, Reading, When } from "./bits";
import measure from "./measure.module.css";
import styles from "./patient.module.css";

interface MeasurePreviewProps {
  draft: MeasurementDraft;
  lang: Language;
  t: Messages;
  online: boolean;
  sending: boolean;
  error: string | null;
  onEdit: () => void;
  onConfirm: () => void;
}

export function MeasurePreview({ draft, lang, t, online, sending, error, onEdit, onConfirm }: MeasurePreviewProps) {
  const copy = t.measure.preview;
  return (
    <div className={measure.form}>
      <section className={`${styles.slip} ${measure.previewSlip}`} aria-labelledby="m-preview-title">
        <header className={styles.slipHead}>
          <span className={styles.slipStub}>{t.measure.steps.preview}</span>
          <Badge tone="outline" icon="clock">
            {copy.notSent}
          </Badge>
        </header>
        <h2 id="m-preview-title" className={measure.previewTitle}>
          {copy.title}
        </h2>
        <p className={styles.metaLine}>{copy.intro}</p>
        <dl className={measure.previewList}>
          <div className={measure.previewRow}>
            <dt>{copy.type}</dt>
            <dd>{measurementKindLabel(draft.kind, lang)}</dd>
          </div>
          <div className={`${measure.previewRow} ${measure.previewValue}`}>
            <dt>{copy.value}</dt>
            <dd>
              <Reading value={draft} lang={lang} size="lg" />
            </dd>
          </div>
          <div className={measure.previewRow}>
            <dt>{copy.unit}</dt>
            <dd>
              <Ltr>{draft.unit}</Ltr>
            </dd>
          </div>
          <div className={measure.previewRow}>
            <dt>{copy.time}</dt>
            <dd>
              <When iso={draft.measuredAt} lang={lang} />
            </dd>
          </div>
        </dl>
        <p className={styles.metaLine}>{t.common.demoRules}</p>
      </section>

      {!online ? (
        <Notice tone="neutral" icon="wifi-off">
          {copy.offlineNote}
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="neutral" icon="alert-triangle" role="alert">
          {error}
        </Notice>
      ) : null}

      <div className={measure.previewActions}>
        <Button variant="secondary" size="lg" iconStart="edit" onClick={onEdit} disabled={sending}>
          {copy.edit}
        </Button>
        <Button variant="primary" size="lg" iconStart="send" loading={sending} onClick={onConfirm}>
          {sending ? copy.sending : copy.confirm}
        </Button>
      </div>
    </div>
  );
}

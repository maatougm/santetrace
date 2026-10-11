"use client";

import { useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Notice,
  TextInput,
  Timestamp,
  describedBy,
  type TableColumn,
} from "@/components/ui";
import { UNGUARDED_MUTATIONS, type MutationGuard } from "@/lib/client/access-fence";
import { createReminder, type Reminder } from "@/lib/client/api";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "@/lib/client/format";
import { errorText } from "../shared/ApiErrorState";
import { DELIVERY_LABEL, selfReportLabel } from "../shared/labels";
import styles from "./Record.module.css";

interface RemindersSectionProps {
  patientId: string;
  reminders: readonly Reminder[];
  onCreated: (reminder: Reminder) => void;
  /** Record mutation guard: a result held across an authority change is discarded. */
  guard?: MutationGuard;
}

const DISCARDED = "Résultat écarté : l’accès au dossier a changé pendant l’opération. Vérifiez l’état actuel avant de recommencer.";
const LABEL_MAX = 200;
const LABEL_ID = "reminder-label";
const DUE_ID = "reminder-due";

function defaultDue(): string {
  return toDateTimeLocalValue(new Date(Date.now() + 60 * 60_000));
}

const COLUMNS: TableColumn<Reminder>[] = [
  { key: "label", header: "Rappel", render: (r) => <span className={styles.strongText}>{r.label}</span> },
  { key: "due", header: "Échéance", render: (r) => <Timestamp iso={r.dueAt} /> },
  {
    key: "delivery",
    header: "Transmission",
    render: (r) => (
      <Badge tone={r.delivery === "failed" ? "outline" : "muted"} icon={r.delivery === "failed" ? "x-circle" : "send"}>
        {DELIVERY_LABEL[r.delivery]}
      </Badge>
    ),
  },
  {
    key: "report",
    header: "Auto-déclaration du patient",
    render: (r) => (
      <span className={styles.cellStack}>
        <span className={r.taken === null ? styles.muted : styles.strongText}>{selfReportLabel(r)}</span>
        {r.acknowledgedAt ? <Timestamp iso={r.acknowledgedAt} label="Déclaré le" /> : null}
      </span>
    ),
  },
];

/** Reminder creation and list: transmission state kept separate from the patient's self-report. */
export function RemindersSection({ patientId, reminders, onCreated, guard = UNGUARDED_MUTATIONS }: RemindersSectionProps) {
  const [label, setLabel] = useState("");
  const [due, setDue] = useState(defaultDue);
  const [errors, setErrors] = useState<{ label?: string; due?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = label.trim();
    const dueIso = fromDateTimeLocalValue(due);
    const nextErrors = {
      label: !trimmed ? "Indiquez le rappel (ex. « Traitement du soir »)." : trimmed.length > LABEL_MAX ? `${LABEL_MAX} caractères au maximum.` : undefined,
      due: dueIso ? undefined : "Indiquez une date et une heure valides.",
    };
    setErrors(nextErrors);
    if (nextErrors.label || nextErrors.due) {
      document.getElementById(nextErrors.label ? LABEL_ID : DUE_ID)?.focus();
      return;
    }
    setSubmitting(true);
    setFailure(null);
    setSuccess(null);
    // Ticket taken before the request: success AND failure are both gated by it.
    const commit = guard.begin();
    try {
      const result = await createReminder(patientId, { label: trimmed, dueAt: dueIso as string });
      if (!commit(() => onCreated(result.reminder))) {
        setFailure(DISCARDED);
        return;
      }
      setLabel("");
      setDue(defaultDue());
      setSuccess(`Rappel « ${result.reminder.label} » créé. Il apparaît dans l’application du patient ; aucun envoi externe n’est garanti.`);
    } catch (error) {
      if (!commit(() => setFailure(errorText(error)))) setFailure(DISCARDED);
    } finally {
      setSubmitting(false);
    }
  };

  const rows = [...reminders].sort((a, b) => Date.parse(b.dueAt) - Date.parse(a.dueAt));
  const dueHint = "Heure de cet appareil.";

  return (
    <div className={styles.sectionStack}>
      <Card title="Nouveau rappel de traitement" headingLevel={2}>
        <form className={styles.inlineForm} onSubmit={(event) => void submit(event)} noValidate>
          <Field label="Libellé" htmlFor={LABEL_ID} error={errors.label} required>
            <TextInput
              id={LABEL_ID}
              value={label}
              maxLength={LABEL_MAX}
              invalid={Boolean(errors.label)}
              aria-describedby={describedBy(LABEL_ID, { error: errors.label })}
              onChange={(event) => {
                setLabel(event.target.value);
                if (errors.label) setErrors((current) => ({ ...current, label: undefined }));
              }}
            />
          </Field>
          <Field label="Échéance" htmlFor={DUE_ID} hint={dueHint} error={errors.due} required>
            <TextInput
              id={DUE_ID}
              type="datetime-local"
              value={due}
              invalid={Boolean(errors.due)}
              aria-describedby={describedBy(DUE_ID, { hint: dueHint, error: errors.due })}
              onChange={(event) => {
                setDue(event.target.value);
                if (errors.due) setErrors((current) => ({ ...current, due: undefined }));
              }}
            />
          </Field>
          <div className={styles.formSubmit}>
            <Button type="submit" variant="primary" iconStart="plus" loading={submitting}>
              Créer le rappel
            </Button>
          </div>
        </form>
        {failure ? (
          <Notice tone="neutral" icon="x-circle" role="alert" title="Rappel non créé">
            {failure}
          </Notice>
        ) : null}
        {success ? <Notice tone="success">{success}</Notice> : null}
      </Card>

      {rows.length === 0 ? (
        <EmptyState compact icon="pill" title="Aucun rappel" description="Aucun rappel de traitement n’a été programmé pour ce patient." />
      ) : (
        <div className={styles.flushCard}>
          <DataTable
            columns={COLUMNS}
            rows={rows}
            rowKey={(r) => r.id}
            caption="« Non déclaré » signifie que le patient n’a rien indiqué : ce n’est ni « pris » ni « non pris ». La transmission ne vaut pas lecture par le patient."
            scrollLabel="Tableau des rappels"
          />
        </div>
      )}
    </div>
  );
}

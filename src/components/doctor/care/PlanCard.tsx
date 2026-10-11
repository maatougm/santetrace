"use client";

import { useId, useState } from "react";
import { Badge, Button, Card, Dialog, KeyValueList, Notice, Timestamp } from "@/components/ui";
import type { ProfileBinding } from "@/contracts/monitoring";
import { runFenced } from "@/lib/client/access-fence";
import type { PatientRecord } from "@/lib/client/api";
import { suggestProfileBindings, updateCarePlan, type PlanUpdate } from "@/lib/client/care-api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { createClientId } from "@/lib/client/ids";
import { hasScope, type DoctorSectionProps } from "../PatientAccessScope";
import { errorText } from "../shared/ApiErrorState";
import { useNow } from "../shared/hooks";
import { uncoveredConditions } from "./coverage";
import { factLabel, factLabelById } from "./fact-labels";
import { nextAttempt, type Attempt } from "./idempotency";
import { DISCARDED_OUTCOME, classifyConflict, type Outcome } from "./outcome";
import { PlanActions } from "./PlanActions";
import { buildPlanUpdate, type DeadlineChoice } from "./plan-update";
import { DeadlineEditDialog } from "./DeadlineEditDialog";
import { DEADLINE_PASSED, ReviewDeadlineField } from "./ReviewDeadlineField";
import { useEpochScoped } from "./use-fenced";
import styles from "./Care.module.css";

const copy = CARE_COPY.fr;

type PlanAction = PlanUpdate["action"];

function BindingList({ bindings, record }: { bindings: readonly ProfileBinding[]; record: PatientRecord }) {
  if (bindings.length === 0) return <p className={styles.mutedBlock}>Aucun profil lié : la couverture reste inconnue.</p>;
  return (
    <ul className={styles.list}>
      {bindings.map((binding) => (
        <li key={`${binding.conditionFactId}:${binding.profileId}`} className={styles.row}>
          <span className={styles.strongText}>
            {factLabelById(record.medicalFacts, binding.conditionFactId) ?? `Condition ${binding.conditionFactId}`}
          </span>
          <bdi className={styles.mono}>
            {binding.profileId} · {binding.profileVersion}
          </bdi>
          <Badge tone="outline">{copy.monitoring.profileDemo}</Badge>
        </li>
      ))}
    </ul>
  );
}

/** Plan state, bindings and review deadline; activation/suspension by the primary clinician only. */
export function PlanCard({ patientId, record, fence, refresh }: DoctorSectionProps) {
  const plan = record.plan;
  const canManage = record.access.canManageCare;
  const now = useNow(60_000);
  const [pending, setPending] = useState<PlanAction | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [outcome, setOutcome] = useEpochScoped<Outcome>(fence);
  const [deadlineChoice, setDeadlineChoice] = useState<DeadlineChoice["kind"]>("keep");
  const [deadlineLocal, setDeadlineLocal] = useState("");
  const [deadlineError, setDeadlineError] = useState<string | null>(null);
  const [editingDeadline, setEditingDeadline] = useState(false);
  const deadlineId = `${useId()}-deadline`;

  const suggested = suggestProfileBindings(record.medicalFacts, record.patient.rules?.version ?? null);
  const bindings = pending === "suspend" ? (plan?.profileBindings ?? []) : suggested;
  // The server refuses an activation without any profile binding.
  const cannotActivate = pending === "activate" && bindings.length === 0;
  const uncovered = uncoveredConditions(record.medicalFacts, []).filter((f) => !suggested.some((b) => b.conditionFactId === f.id));

  const open = (action: PlanAction) => {
    setFailure(null);
    setAttempt(null);
    setDeadlineChoice("keep");
    setDeadlineLocal("");
    setDeadlineError(null);
    setPending(action);
  };

  const finish = (next: Outcome) => {
    setPending(null);
    setOutcome(next);
    refresh();
  };

  const submit = async () => {
    if (!pending || cannotActivate) return;
    const deadline: DeadlineChoice = deadlineChoice === "set" ? { kind: "set", local: deadlineLocal } : { kind: deadlineChoice };
    const built = buildPlanUpdate({ action: pending, profileBindings: bindings, expectedRevision: plan?.revision ?? 0, clientId: "" }, deadline, new Date());
    if (!built.ok) {
      setDeadlineError(built.error);
      document.getElementById(deadlineId)?.focus();
      return;
    }
    setDeadlineError(null);
    const draft = built.input;
    // Same payload: same key (safe retry). Bindings, deadline or revision changed: new key.
    const next = nextAttempt(attempt, draft, () => createClientId("plan"));
    setAttempt(next);
    setBusy(true);
    setFailure(null);
    try {
      const result = await runFenced(fence, () => updateCarePlan(patientId, { ...draft, clientId: next.clientId }));
      if (result.status === "stale") return finish(DISCARDED_OUTCOME);
      const saved = result.value.plan;
      finish(
        saved
          ? { ok: true, text: `${copy.planState[saved.state]} — version ${saved.revision} enregistrée par le serveur.` }
          : { ok: false, text: "Le serveur n’a renvoyé aucun plan : rien n’est considéré comme activé." },
      );
    } catch (error) {
      const conflict = classifyConflict(error);
      if (conflict.kind === "other") setFailure(errorText(error));
      else finish({ ok: false, text: `Le plan a changé entre-temps : ${conflict.text}` });
    } finally {
      setBusy(false);
    }
  };

  const deadlinePassed = plan?.reviewDeadline ? Date.parse(plan.reviewDeadline) < now : false;

  return (
    <Card
      title="Plan de suivi"
      description="Versionné ; seules les actions validées par le médecin référent deviennent des consignes patient."
      actions={
        canManage ? (
          plan?.state === "active" ? (
            <>
              <Button
                variant="secondary"
                iconStart="calendar"
                onClick={() => {
                  setOutcome(null);
                  setEditingDeadline(true);
                }}
              >
                Modifier la date limite de revue…
              </Button>
              <Button variant="ghost" iconStart="minus" onClick={() => open("suspend")}>
                Suspendre le plan…
              </Button>
            </>
          ) : (
            <Button variant="secondary" iconStart="check" onClick={() => open("activate")}>
              Activer le plan…
            </Button>
          )
        ) : null
      }
    >
      <div className={styles.stack}>
        {!canManage ? (
          <Notice tone="neutral" icon="lock">
            Gestion du plan réservée au médecin référent : lecture seule pour ce compte.
          </Notice>
        ) : null}
        {plan ? (
          <KeyValueList
            columns={2}
            items={[
              { label: "État", value: <Badge tone={plan.state === "active" ? "accent" : "outline"}>{copy.planState[plan.state]}</Badge> },
              { label: "Version", value: plan.revision, mono: true },
              { label: "Médecin référent", value: plan.clinicianId ?? "—", mono: Boolean(plan.clinicianId) },
              {
                label: "Revue attendue avant",
                value: (
                  <span className={styles.tightStack}>
                    <span className={styles.row}>
                      <Timestamp iso={plan.reviewDeadline} />
                      {deadlinePassed ? (
                        <Badge tone="outline" icon="clock">
                          {DEADLINE_PASSED}
                        </Badge>
                      ) : null}
                    </span>
                    {deadlinePassed ? <span className={styles.muted}>{copy.plan.reviewOverdue}</span> : null}
                  </span>
                ),
              },
              { label: "Actions approuvées", value: plan.actionIds.length },
            ]}
          />
        ) : hasScope(record, "status") ? (
          <p className={styles.row}>
            <Badge tone="outline">Aucun plan</Badge>
            <span className={styles.muted}>Le suivi démarre après activation par le médecin référent.</span>
          </p>
        ) : (
          <p className={styles.mutedBlock}>Plan non visible avec les accès de ce compte.</p>
        )}
        {plan ? (
          <div className={styles.tightStack}>
            <h3 className={styles.subTitle}>Profils liés</h3>
            <BindingList bindings={plan.profileBindings} record={record} />
          </div>
        ) : null}
        {plan ? (
          <div className={styles.tightStack}>
            <h3 className={styles.subTitle}>Actions du plan</h3>
            <PlanActions actions={record.actions} canManage={canManage} />
          </div>
        ) : null}
        {outcome ? <Notice tone={outcome.ok ? "success" : "neutral"}>{outcome.text}</Notice> : null}
      </div>

      <Dialog
        open={pending !== null}
        onClose={() => (busy ? undefined : setPending(null))}
        title={pending === "suspend" ? "Suspendre le plan de suivi" : "Activer le plan de suivi"}
        description={
          pending === "suspend"
            ? "Le plan passera à l’état suspendu. Les protocoles liés devront être réexaminés explicitement."
            : "Profils de démonstration proposés pour les conditions déclarées. Le serveur vérifie chaque liaison."
        }
        closeOnBackdrop={!busy}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
              Annuler
            </Button>
            <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={cannotActivate}>
              {pending === "suspend" ? "Confirmer la suspension" : "Confirmer l’activation"}
            </Button>
          </>
        }
      >
        <div className={styles.tightStack}>
          {pending === "activate" && record.patient.rules === null ? (
            <Notice tone="neutral" icon="lock">
              Règles non visibles pour ce compte : aucune liaison ne peut être proposée.
            </Notice>
          ) : null}
          <BindingList bindings={bindings} record={record} />
          {cannotActivate ? (
            <p className={styles.mutedBlock}>
              Activation impossible sans profil : aucune condition déclarée (hypertension, diabète) ne correspond à un profil de démonstration.
            </p>
          ) : null}
          {pending === "activate" && uncovered.length > 0 ? (
            <p className={styles.mutedBlock}>
              Sans profil (couverture inconnue) : {uncovered.map(factLabel).join(", ")}.
            </p>
          ) : null}
          <ReviewDeadlineField
            id={deadlineId}
            current={plan?.reviewDeadline ?? null}
            overdue={deadlinePassed}
            choice={deadlineChoice}
            local={deadlineLocal}
            error={deadlineError}
            onChoice={(choice) => {
              setDeadlineChoice(choice);
              setDeadlineError(null);
            }}
            onLocal={(value) => {
              setDeadlineLocal(value);
              setDeadlineError(null);
            }}
          />
          {failure ? (
            <Notice tone="neutral" icon="x-circle" role="alert" title="Plan non modifié">
              {failure}
            </Notice>
          ) : null}
        </div>
      </Dialog>

      <DeadlineEditDialog
        plan={canManage && editingDeadline && plan?.state === "active" ? plan : null}
        patientId={patientId}
        overdue={deadlinePassed}
        fence={fence}
        onClose={() => setEditingDeadline(false)}
        onOutcome={(next) => {
          setEditingDeadline(false);
          setOutcome(next);
          refresh();
        }}
      />
    </Card>
  );
}

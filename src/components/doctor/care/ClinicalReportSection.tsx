"use client";

import { useState } from "react";
import { Badge, Button, Card, Notice, Timestamp } from "@/components/ui";
import type { ReportResponse } from "@/contracts/monitoring";
import { runFenced } from "@/lib/client/access-fence";
import { generateReport } from "@/lib/client/care-api";
import { createClientId } from "@/lib/client/ids";
import { toApiError } from "@/lib/client/transport";
import { hasScope, type DoctorSectionProps } from "../PatientAccessScope";
import { errorText } from "../shared/ApiErrorState";
import { AiMetaLine } from "./AiMetaLine";
import { ReportClaims } from "./ReportClaims";
import { isReportStale } from "./report-claims";
import { useEpochScoped } from "./use-fenced";
import styles from "./Care.module.css";

function NotAvailable() {
  return (
    <Notice tone="neutral" icon="lock" title="Rapport sourcé non disponible">
      Le rapport demande l’accès « Synthèse » (statut, mesures, clinique et documents). Rien n’est affiché pour ce compte.
    </Notice>
  );
}

/** Sourced clinician report (spec 006 story 5): grouped claims, sources by id, hypotheses apart. */
export function ClinicalReportSection(props: DoctorSectionProps) {
  if (!hasScope(props.record, "summary")) return <NotAvailable />;
  return <ReportPanel {...props} />;
}

function ReportPanel({ patientId, fence }: DoctorSectionProps) {
  const [response, setResponse] = useEpochScoped<ReportResponse>(fence);
  const [denied, setDenied] = useEpochScoped<true>(fence);
  const [run, setRun] = useState<{ clientId: string; busy: boolean; failure: string | null; discarded?: boolean } | null>(null);

  const generate = async (clientId: string) => {
    setRun({ clientId, busy: true, failure: null });
    try {
      // The report carries the authority revision it was built under: an older one is dropped.
      const result = await runFenced(
        fence,
        () => generateReport(patientId, { clientId }),
        (value) => value.report.guard.authorityRevision,
      );
      if (result.status === "stale") {
        setRun({ clientId, busy: false, failure: null, discarded: true });
        return;
      }
      setRun(null);
      setDenied(null);
      setResponse(result.value);
    } catch (error) {
      if (toApiError(error).isAccessDenied) {
        setResponse(null);
        setDenied(true);
        setRun(null);
        return;
      }
      setRun({ clientId, busy: false, failure: errorText(error) });
    }
  };

  if (denied) return <NotAvailable />;

  const busy = run?.busy ?? false;
  const stale = response ? isReportStale(response.report, response.meta) : false;

  return (
    <Card
      title="Rapport sourcé"
      description="Affirmations validées par le serveur, chacune avec ses sources. Aide à la revue : à vérifier, rien n’est transmis au patient."
      actions={
        <Button variant="primary" iconStart="refresh" loading={busy} onClick={() => void generate(createClientId("report"))}>
          {response ? "Régénérer le rapport" : "Générer le rapport"}
        </Button>
      }
    >
      <div className={styles.stack}>
        {busy ? <p className={styles.mutedBlock}>Génération en cours (jusqu’à 45 s). Rien n’est affiché avant la réponse du serveur.</p> : null}
        {run?.failure ? (
          <Notice
            tone="neutral"
            icon="x-circle"
            role="alert"
            title="Rapport non généré"
            action={
              <Button size="sm" variant="secondary" iconStart="refresh" onClick={() => void generate(run.clientId)}>
                Réessayer
              </Button>
            }
          >
            {run.failure}
          </Notice>
        ) : null}
        {run?.discarded ? (
          <Notice tone="neutral" icon="lock">
            Résultat écarté : l’accès au dossier a changé pendant la génération. Relancez si besoin.
          </Notice>
        ) : null}
        {!response && !busy && !run?.failure && !run?.discarded ? (
          <p className={styles.mutedBlock}>Aucun rapport affiché. Il est généré à la demande et effacé de l’écran si l’accès change.</p>
        ) : null}
        {response ? (
          <>
            {stale ? (
              <Notice tone="neutral" icon="refresh" title="Rapport périmé : le dossier a changé, régénérez.">
                Les affirmations ci-dessous reflètent un état antérieur du dossier.
              </Notice>
            ) : null}
            <AiMetaLine
              meta={response.meta}
              fallbackLabel="Faits du dossier uniquement (règles fixes) : aucune synthèse ni hypothèse produite par un modèle."
            />
            <p className={styles.metaLine}>
              <Badge tone="muted">Rapport révision {response.report.revision}</Badge>
              <Timestamp iso={response.report.createdAt} label="Créé le" />
              <span>{response.report.sources.length} source(s)</span>
            </p>
            <ReportClaims report={response.report} />
          </>
        ) : null}
      </div>
    </Card>
  );
}

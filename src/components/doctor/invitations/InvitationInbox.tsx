"use client";

import { useCallback } from "react";
import { Card, PageHeader, Skeleton } from "@/components/ui";
import { useActorSession } from "@/components/layout";
import { listDoctorInvitations } from "@/lib/client/grants-api";
import { usePolling } from "@/lib/client/use-polling";
import { ApiErrorState } from "../shared/ApiErrorState";
import { SyncStatus } from "../shared/SyncStatus";
import { AcceptInvitationForm } from "./AcceptInvitationForm";
import { InvitationList } from "./InvitationList";
import styles from "./Invitations.module.css";

const LIST_POLL_MS = 30_000;

/** Doctor invitations: accept with the patient's one-time code, and list received invitation metadata. */
export function InvitationInbox() {
  const { actor } = useActorSession();
  const fetcher = useCallback((signal: AbortSignal) => listDoctorInvitations({ signal }), []);
  const list = usePolling(`doctor-invitations:${actor.id}`, fetcher, { intervalMs: LIST_POLL_MS });

  let body;
  if (list.status === "loading") body = <Skeleton height={160} radius={12} />;
  else if (!list.data) body = <ApiErrorState error={list.error} onRetry={() => void list.refresh()} />;
  else body = <InvitationList invitations={list.data.invitations} />;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Démonstration · médecins fictifs"
        title="Invitations de patients"
        description="Chaque patient possède son dossier et choisit les médecins qui y accèdent, avec quelles sections. Aucun médecin ne crée de dossier patient."
        back={{ href: "/doctor", label: "Patients" }}
      />
      <AcceptInvitationForm onAccepted={() => void list.refresh()} />
      <Card
        title="Invitations reçues"
        description="Informations transmises par le serveur : patient, rôle, sections, échéance et état."
        actions={<SyncStatus lastSuccessAt={list.lastSuccessAt} error={list.error} isRefreshing={list.isRefreshing} />}
        padding="none"
      >
        <div aria-busy={list.status === "loading" || undefined}>{body}</div>
      </Card>
    </div>
  );
}

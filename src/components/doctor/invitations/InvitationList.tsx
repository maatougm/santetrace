"use client";

import { Badge, DataTable, EmptyState, Timestamp, type BadgeTone, type IconName, type TableColumn } from "@/components/ui";
import { ACCESS_COPY } from "@/lib/client/copy/access";
import type { DoctorInvitationSummary } from "@/lib/client/grants-api";
import { useNow } from "../shared/hooks";
import { invitationDisplayState, type InvitationDisplayState } from "./invitation-fragment";
import styles from "./Invitations.module.css";

const access = ACCESS_COPY.fr;

const STATE_BADGE: Record<InvitationDisplayState, { tone: BadgeTone; icon: IconName; label: string }> = {
  pending: { tone: "outline", icon: "clock", label: access.grantState.pending },
  expired: { tone: "muted", icon: "x-circle", label: "Expirée — demandez une nouvelle invitation" },
  active: { tone: "accent", icon: "check", label: access.grantState.active },
  revoked: { tone: "muted", icon: "x", label: access.grantState.revoked },
};

interface Row {
  invitation: DoctorInvitationSummary;
  state: InvitationDisplayState;
}

const COLUMNS: TableColumn<Row>[] = [
  {
    key: "patient",
    header: "Patient (fictif)",
    render: ({ invitation }) => <span className={styles.strongText}>{invitation.patientDisplayName}</span>,
  },
  { key: "role", header: "Rôle proposé", render: ({ invitation }) => access.relationship[invitation.relationship] },
  {
    key: "scopes",
    header: "Sections choisies par le patient",
    render: ({ invitation }) => (
      <span className={styles.muted}>{invitation.scopes.map((scope) => access.scope[scope]).join(", ") || "Aucune"}</span>
    ),
  },
  { key: "expires", header: "Expire", render: ({ invitation }) => <Timestamp iso={invitation.expiresAt} /> },
  {
    key: "state",
    header: "État",
    render: ({ state }) => (
      <Badge tone={STATE_BADGE[state].tone} icon={STATE_BADGE[state].icon}>
        {STATE_BADGE[state].label}
      </Badge>
    ),
  },
];

/** Invitation metadata addressed to this doctor. Codes are never listed: the patient sends them directly. */
export function InvitationList({ invitations }: { invitations: readonly DoctorInvitationSummary[] }) {
  const now = useNow(30_000);
  if (invitations.length === 0) {
    return (
      <EmptyState
        icon="inbox"
        title="Aucune invitation reçue"
        description="Un patient peut vous inviter depuis son espace « Médecins et accès ». Il vous transmet alors un lien ou un code à usage unique, valable 24 heures."
      />
    );
  }
  const rows = [...invitations]
    .sort((a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt))
    .map((invitation) => ({ invitation, state: invitationDisplayState(invitation, now) }));
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      rowKey={(row) => row.invitation.id}
      caption="Métadonnées uniquement. Le code d’invitation n’est jamais affiché ici : saisissez celui que le patient vous a transmis."
      scrollLabel="Tableau des invitations"
    />
  );
}

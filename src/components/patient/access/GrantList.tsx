"use client";

/**
 * Doctors with access to the record: role, sections, state and dates exactly
 * as the server reports them. "Invitation en attente" is never shown as
 * active: access starts only once the doctor accepts. Revoked grants stay
 * listed as history. Changes go through confirmation dialogs.
 */
import { useState } from "react";
import { Badge, Button, EmptyState, type BadgeTone, type IconName } from "@/components/ui";
import type { CareGrant, DoctorProfile } from "@/contracts/patient-platform";
import { ACCESS_COPY } from "@/lib/client/copy/access";
import { formatDateTime } from "@/lib/client/format";
import type { Language } from "@/lib/client/transport";
import { usePatientRuntime } from "../PatientRuntime";
import { canEditScopes, isOpenGrant, sortGrants } from "./access-model";
import { RevokeDialog, ScopeDialog } from "./GrantDialogs";
import patient from "../patient.module.css";
import styles from "./access.module.css";

const STATE_BADGE: Record<CareGrant["state"], { tone: BadgeTone; icon: IconName }> = {
  pending: { tone: "outline", icon: "clock" },
  active: { tone: "accent", icon: "check" },
  revoked: { tone: "muted", icon: "x" },
};

interface GrantItemProps {
  grant: CareGrant;
  doctor: DoctorProfile | null;
  lang: Language;
  onRevoke: () => void;
  onEditScopes: () => void;
}

function GrantItem({ grant, doctor, lang, onRevoke, onEditScopes }: GrantItemProps) {
  const copy = ACCESS_COPY[lang];
  const badge = STATE_BADGE[grant.state];
  const nameId = `grant-${grant.id}`;
  return (
    <li className={`${styles.grant} ${grant.state === "revoked" ? styles.grantRevoked : ""}`}>
      <div className={styles.grantHead}>
        <div>
          <h3 id={nameId} className={styles.doctorName}>
            <bdi>{doctor?.displayName ?? grant.clinicianId}</bdi>
          </h3>
          {doctor ? <p className={patient.metaLine}>{doctor.specialty}</p> : null}
        </div>
        <Badge tone={badge.tone} icon={badge.icon}>
          {copy.grantState[grant.state]}
        </Badge>
      </div>
      <p className={patient.kindLabel}>{copy.relationship[grant.relationship]}</p>
      <ul className={styles.chips} aria-label={copy.doctors.scopesLabel}>
        {grant.scopes.map((scope) => (
          <li key={scope}>
            <Badge tone="muted">{copy.scope[scope]}</Badge>
          </li>
        ))}
      </ul>
      <p className={styles.times}>
        <span>{copy.doctors.issuedAt(formatDateTime(grant.issuedAt, lang))}</span>
        {grant.acceptedAt ? <span>{copy.doctors.acceptedAt(formatDateTime(grant.acceptedAt, lang))}</span> : null}
        {grant.revokedAt ? <span>{copy.doctors.revokedAt(formatDateTime(grant.revokedAt, lang))}</span> : null}
      </p>
      {isOpenGrant(grant) ? (
        <div className={styles.actions}>
          {canEditScopes(grant) ? (
            <Button variant="secondary" iconStart="sliders" aria-describedby={nameId} onClick={onEditScopes}>
              {copy.doctors.editScopes}
            </Button>
          ) : null}
          <Button variant="secondary" iconStart="x-circle" aria-describedby={nameId} onClick={onRevoke}>
            {copy.doctors.revoke}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

type Target = { kind: "revoke" | "scopes"; grantId: string } | null;

interface GrantListProps {
  grants: readonly CareGrant[];
  doctorsById: ReadonlyMap<string, DoctorProfile>;
  onUpdated: (grant: CareGrant) => void;
  onConflict: () => void;
  onDiscarded: () => void;
}

export function GrantList({ grants, doctorsById, onUpdated, onConflict, onDiscarded }: GrantListProps) {
  const { lang } = usePatientRuntime();
  const copy = ACCESS_COPY[lang].doctors;
  const [target, setTarget] = useState<Target>(null);
  const selected = target ? (grants.find((grant) => grant.id === target.grantId) ?? null) : null;

  if (grants.length === 0) return <EmptyState compact icon="users" title={copy.grantsEmpty} />;

  const close = () => setTarget(null);
  const dialogProps = selected
    ? {
        grant: selected,
        doctorName: doctorsById.get(selected.clinicianId)?.displayName ?? selected.clinicianId,
        onClose: close,
        onUpdated: (grant: CareGrant) => {
          close();
          onUpdated(grant);
        },
        onConflict: () => {
          close();
          onConflict();
        },
        onDiscarded: () => {
          close();
          onDiscarded();
        },
      }
    : null;

  return (
    <>
      <ul className={styles.grantList}>
        {sortGrants(grants).map((grant) => (
          <GrantItem
            key={grant.id}
            grant={grant}
            doctor={doctorsById.get(grant.clinicianId) ?? null}
            lang={lang}
            onRevoke={() => setTarget({ kind: "revoke", grantId: grant.id })}
            onEditScopes={() => setTarget({ kind: "scopes", grantId: grant.id })}
          />
        ))}
      </ul>
      {target && dialogProps ? (
        target.kind === "revoke" ? (
          <RevokeDialog key={`revoke-${target.grantId}`} {...dialogProps} />
        ) : (
          <ScopeDialog key={`scopes-${target.grantId}`} {...dialogProps} />
        )
      ) : null}
    </>
  );
}

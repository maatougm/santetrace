"use client";

import type { ReactNode } from "react";
import { Badge, EmptyState } from "@/components/ui";
import type { AccessEnvelope } from "@/contracts/patient-platform";
import { SHARING_SCOPES } from "@/contracts/patient-platform";
import { ACCESS_COPY } from "@/lib/client/copy/access";
import styles from "./Record.module.css";

const copy = ACCESS_COPY.fr;

/**
 * What this clinician may see and do, from the current grant (server
 * projection). Rendered inside the record's Situation card, under its
 * "Votre accès" heading.
 */
export function AccessScopeNotice({ access }: { access: AccessEnvelope }) {
  if (access.owner) return null;
  const granted = new Set(access.scopes);
  const missing = SHARING_SCOPES.filter((scope) => !granted.has(scope));
  return (
    <div className={styles.accessStrip}>
      <span className={styles.accessRole}>
        {access.relationship ? copy.relationship[access.relationship] : "Accès"}
        {access.grantRevision !== null && <span className={styles.accessRevision}> · révision {access.grantRevision}</span>}
      </span>
      <span className={styles.accessScopes}>
        {SHARING_SCOPES.filter((scope) => granted.has(scope)).map((scope) => (
          <Badge key={scope} tone="neutral" icon="check">
            {copy.scope[scope]}
          </Badge>
        ))}
        {missing.map((scope) => (
          <Badge key={scope} tone="muted" icon="lock">
            {copy.scope[scope]} : non partagé
          </Badge>
        ))}
      </span>
      {!access.canManageCare && (
        <span className={styles.accessNote}>Lecture seule : la gestion du plan revient au médecin référent.</span>
      )}
    </div>
  );
}

/** A section the patient did not share: explicit, never shown as "empty". */
export function NotShared({ what }: { what: ReactNode }) {
  return (
    <EmptyState
      icon="lock"
      title={<>{what} : non partagé</>}
      description="Le patient n’a pas partagé cette section avec vous, ou elle est réservée au médecin référent. Aucune donnée n’est transmise à cet écran."
    />
  );
}

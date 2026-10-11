"use client";

import { Card, LinkButton, Notice, PageHeader } from "@/components/ui";
import styles from "./NewPatient.module.css";

/**
 * Clinician-created enrollment is retired (feature 006): patients create and
 * own their record, then invite a doctor. This page explains it at the old
 * URL instead of offering a form that the server now refuses (410).
 */
export function NewPatientView() {
  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Démonstration fictive"
        title="Nouveau patient"
        back={{ href: "/doctor", label: "Patients" }}
      />
      <Card padding="lg" title="Le patient crée son propre dossier">
        <Notice tone="info" icon="info" title="Inscription par le patient">
          Un médecin ne crée plus de dossier patient. Le patient ouvre son compte depuis la page de connexion, puis
          vous invite depuis « Médecins et accès » en choisissant les sections partagées. Vous acceptez ensuite
          l’invitation qui vous est adressée.
        </Notice>
        <p>
          Pour reprendre un ancien dossier de démonstration, l’opérateur local génère un code de rattachement à usage
          unique ; le patient le saisit en créant son compte. Aucun accès médecin n’est rétabli automatiquement.
        </p>
        <LinkButton href="/doctor/invitations" variant="primary" iconEnd="arrow-right">
          Voir mes invitations
        </LinkButton>
      </Card>
    </div>
  );
}

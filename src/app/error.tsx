"use client";

import { Button, LinkButton } from "@/components/ui";
import { BrandMark } from "@/components/layout";
import styles from "./status-page.module.css";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Route-level crash boundary: says what happened, never hides it. */
export default function ErrorPage({ error, reset }: ErrorPageProps) {
  return (
    <main className={styles.page}>
      <div className={styles.panel} role="alert">
        <BrandMark />
        <h1 className={styles.title}>Cet écran a rencontré une erreur</h1>
        <p className={styles.body}>
          L’affichage s’est interrompu. Aucune donnée n’a été modifiée par cet incident d’affichage ; les actions déjà
          confirmées par le serveur restent enregistrées.
        </p>
        {error.digest && (
          <p className={styles.digest}>
            Référence technique : <code>{error.digest}</code>
          </p>
        )}
        <div className={styles.actions}>
          <Button variant="primary" iconStart="refresh" onClick={reset}>
            Réessayer
          </Button>
          <LinkButton href="/" variant="secondary" iconStart="home">
            Accueil
          </LinkButton>
        </div>
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import { LinkButton } from "@/components/ui";
import { BrandMark } from "@/components/layout";
import styles from "./status-page.module.css";

export const metadata: Metadata = { title: "Page introuvable" };

export default function NotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <BrandMark />
        <p className={styles.code}>404</p>
        <h1 className={styles.title}>Page introuvable</h1>
        <p className={styles.body}>
          Cette adresse ne correspond à aucun écran. Si vous suiviez un lien de dossier, il est possible qu’il ne soit pas
          accessible avec votre session.
        </p>
        <LinkButton href="/" variant="primary" iconStart="home">
          Retour à l’accueil
        </LinkButton>
      </div>
    </main>
  );
}

import { DemoLabel, Icon } from "@/components/ui";
import type { Language } from "@/lib/client/api";
import { BrandMark } from "@/components/layout";
import { SIGN_IN_COPY } from "./sign-in-copy";
import styles from "./SignIn.module.css";

/**
 * Product identity on the Santetrace blue panel. Purely descriptive: no
 * values, no charts, nothing that could be mistaken for patient data.
 */
export function IdentityPanel({ lang }: { lang: Language }) {
  const copy = SIGN_IN_COPY[lang];
  return (
    <section className={styles.identity} aria-labelledby="identity-headline">
      <div className={styles.identityTop}>
        <BrandMark tone="dark" subtitle="Suivi chronique · EndoRecord" />
      </div>

      <div className={styles.identityBody}>
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <h1 id="identity-headline" className={styles.headline}>
          {copy.headline}
        </h1>
        <p className={styles.lede}>{copy.lede}</p>
      </div>

      <svg className={styles.trace} viewBox="0 0 600 80" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path
          pathLength={1}
          d="M0 52 H150 l10 -6 l8 6 H214 l9 -36 l10 58 l8 -30 l6 8 H330 l12 -8 l12 8 H600"
        />
      </svg>

      <ul className={styles.guarantees}>
        {copy.guarantees.map((item) => (
          <li key={item.title} className={styles.guarantee}>
            <span className={styles.guaranteeIcon}>
              <Icon name={item.icon} size={18} />
            </span>
            <span>
              <strong className={styles.guaranteeTitle}>{item.title}</strong>
              <span className={styles.guaranteeBody}>{item.body}</span>
            </span>
          </li>
        ))}
      </ul>

      <footer className={styles.identityFoot}>
        <DemoLabel tone="dark" />
        <p>{copy.demoFooter}</p>
      </footer>
    </section>
  );
}

"use client";

/**
 * Home quick links: a compact, labelled secondary list (row dividers, no
 * tiles) placed after the latest reading so it never competes with "Ajouter
 * une mesure". Messages and plan are also in the persistent navigation. The
 * devices/simulator page follows as a quiet link: a demonstration tool, not a
 * clinical feature. No unread count: the home only loads the patient record,
 * which carries no message count, and none is guessed.
 */
import Link from "next/link";
import { Icon } from "@/components/ui";
import type { Language } from "@/lib/client/api";
import { SHARE_COPY } from "@/lib/client/copy/share";
import { DEVICES_HREF, HOME_QUICK_LINKS } from "../patient-nav";
import { HOME_COPY } from "./home-copy";
import css from "../home.module.css";

export function HomeQuickLinks({ lang }: { lang: Language }) {
  const copy = HOME_COPY[lang];
  return (
    <nav className={css.links} aria-labelledby="home-links-title">
      <h2 id="home-links-title" className={css.linksTitle}>
        {copy.quickLinksTitle}
      </h2>
      <ul className={css.linkList}>
        {HOME_QUICK_LINKS.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className={css.linkRow}>
              <Icon name={link.icon} size={20} className={css.linkIcon} />
              <span>{copy.links[link.key]}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href={DEVICES_HREF} className={css.quietLink}>
        {SHARE_COPY[lang].simulator.title}
        <Icon name="chevron-right" size={16} />
      </Link>
    </nav>
  );
}

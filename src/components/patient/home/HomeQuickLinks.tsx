"use client";

/**
 * Home quick links (2 × 2 on a phone). No unread count: the home only loads
 * the patient record, which carries no message count, and none is guessed.
 */
import Link from "next/link";
import { Icon } from "@/components/ui";
import type { Language } from "@/lib/client/api";
import { HOME_QUICK_LINKS } from "../patient-nav";
import { HOME_COPY } from "./home-copy";
import css from "../home.module.css";

export function HomeQuickLinks({ lang }: { lang: Language }) {
  const copy = HOME_COPY[lang];
  return (
    <nav aria-labelledby="home-links-title">
      <h2 id="home-links-title" className={`${css.cardTitle} ${css.sectionGap}`}>
        {copy.quickLinksTitle}
      </h2>
      <ul className={css.tiles}>
        {HOME_QUICK_LINKS.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className={css.tile}>
              <Icon name={link.icon} size={24} className={css.tileIcon} />
              <span>{copy.links[link.key]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

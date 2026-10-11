import type { ReactElement } from "react";
import type { IconName } from "./contract";

/** Extra glyphs used inside the kit (e.g. red priority). Accepted by <Icon>. */
export type ExtraIconName = "alert-octagon" | "circle-dashed";
export type AnyIconName = IconName | ExtraIconName;

/*
 * Hand-drawn 24x24 outline set. Every glyph is stroke-only and inherits
 * currentColor; stroke width, caps and joins are set once on the <svg>.
 */
export const ICON_GLYPHS: Readonly<Record<AnyIconName, ReactElement>> = {
  activity: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  "alert-octagon": (
    <>
      <path d="M8.2 2.5h7.6l5.7 5.7v7.6l-5.7 5.7H8.2l-5.7-5.7V8.2Z" />
      <path d="M12 7.5v5" />
      <path d="M12 16.25h.01" />
    </>
  ),
  "alert-triangle": (
    <>
      <path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4.25" />
      <path d="M12 17.25h.01" />
    </>
  ),
  "arrow-left": (
    <>
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </>
  ),
  "arrow-right": (
    <>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8.5a6 6 0 0 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15 6 8.5" />
      <path d="M10.2 20.5a2 2 0 0 0 3.6 0" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2" />
      <path d="M8 2.5v4" />
      <path d="M16 2.5v4" />
      <path d="M3.5 10h17" />
    </>
  ),
  check: <path d="M20 6.5 9.5 17 4 11.5" />,
  "check-circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.25 12.25 2.5 2.5 5-5.25" />
    </>
  ),
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "chevron-left": <path d="m15 18-6-6 6-6" />,
  "chevron-right": <path d="m9 18 6-6-6-6" />,
  "circle-dashed": (
    <>
      <path d="M10.1 3.2a9 9 0 0 1 3.8 0" />
      <path d="M17.6 5a9 9 0 0 1 1.9 3.3" />
      <path d="M20.8 13.9a9 9 0 0 1-1.9 3.3" />
      <path d="M13.9 20.8a9 9 0 0 1-3.8 0" />
      <path d="M6.4 19a9 9 0 0 1-1.9-3.3" />
      <path d="M3.2 10.1a9 9 0 0 1 1.9-3.3" />
    </>
  ),
  clipboard: (
    <>
      <rect x="8" y="2.5" width="8" height="4" rx="1" />
      <path d="M16 4.5h2a2 2 0 0 1 2 2V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2" />
      <path d="M8.5 12h7" />
      <path d="M8.5 16h4.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.25 2" />
    </>
  ),
  "cloud-off": (
    <>
      <path d="m3 3 18 18" />
      <path d="M8.7 5.4A6.5 6.5 0 0 1 17.3 10h.2a4 4 0 0 1 3.1 6.5" />
      <path d="M17 19H7.5a5 5 0 0 1-1.6-9.7" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v11.5" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4.5 20.5h15" />
    </>
  ),
  droplet: <path d="M12 3c-3.2 4.1-6.25 7.4-6.25 11.1a6.25 6.25 0 0 0 12.5 0C18.25 10.4 15.2 7.1 12 3Z" />,
  edit: (
    <>
      <path d="M12.5 20.5h8" />
      <path d="M16.6 3.6a2.1 2.1 0 0 1 3 3L8 18.2l-4 1 1-4Z" />
    </>
  ),
  "external-link": (
    <>
      <path d="M14.5 3.5h6v6" />
      <path d="m10 14 10.5-10.5" />
      <path d="M18.5 13.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5h5.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  "file-text": (
    <>
      <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8Z" />
      <path d="M14 3v5h5" />
      <path d="M8.5 13h7" />
      <path d="M8.5 17h5" />
    </>
  ),
  "heart-pulse": (
    <>
      <path d="M19.4 13.5c1.4-1.5 2.1-3 2.1-4.8A5.2 5.2 0 0 0 16.3 3.5c-1.8 0-3 .6-4.3 2-1.3-1.4-2.5-2-4.3-2a5.2 5.2 0 0 0-5.2 5.2c0 1.8.7 3.3 2.1 4.8L12 20.8Z" />
      <path d="M3.5 12h4.25l1.75-2.75 2.5 5 1.75-2.25h6.75" />
    </>
  ),
  "help-circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.4 9.25a2.75 2.75 0 0 1 5.35.9c0 1.85-2.75 2.6-2.75 2.6" />
      <path d="M12 16.75h.01" />
    </>
  ),
  home: (
    <>
      <path d="m3.5 10.5 8.5-7 8.5 7" />
      <path d="M5.5 9v10.5a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9" />
    </>
  ),
  inbox: (
    <>
      <path d="M21.5 12.5h-5.75l-1.75 3h-4l-1.75-3H2.5" />
      <path d="M5.4 5.2 2.5 12.5v6a1.5 1.5 0 0 0 1.5 1.5h16a1.5 1.5 0 0 0 1.5-1.5v-6l-2.9-7.3A1.5 1.5 0 0 0 17.2 4.2H6.8a1.5 1.5 0 0 0-1.4 1Z" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.75h.01" />
    </>
  ),
  languages: (
    <>
      <path d="M2.5 5.5h11" />
      <path d="M8 3v2.5" />
      <path d="M11.5 5.5c-.8 3.6-3.4 6.9-7 8.5" />
      <path d="M5.5 9c1 1.9 2.7 3.5 4.75 4.5" />
      <path d="m12.5 21 4.25-9.5L21 21" />
      <path d="M14 17.75h5.5" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  link: (
    <>
      <path d="M10 13.5a4.5 4.5 0 0 0 6.4.4l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
      <path d="M14 10.5a4.5 4.5 0 0 0-6.4-.4l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
    </>
  ),
  message: <path d="M20 14.5a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.4-4.4" />
    </>
  ),
  "log-out": (
    <>
      <path d="M9.5 20.5H5.5a1.5 1.5 0 0 1-1.5-1.5V5a1.5 1.5 0 0 1 1.5-1.5h4" />
      <path d="m15.5 16.5 4.5-4.5-4.5-4.5" />
      <path d="M20 12H9.5" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  pill: (
    <>
      <path d="m10.6 20.4 9.8-9.8a4.9 4.9 0 0 0-7-7l-9.8 9.8a4.9 4.9 0 0 0 7 7Z" />
      <path d="m8.5 8.5 7 7" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  refresh: (
    <>
      <path d="M20.5 12a8.5 8.5 0 0 1-14.7 5.8L3.5 15.5" />
      <path d="M3.5 20.5v-5h5" />
      <path d="M3.5 12a8.5 8.5 0 0 1 14.7-5.8l2.3 2.3" />
      <path d="M20.5 3.5v5h-5" />
    </>
  ),
  send: (
    <>
      <path d="M21 3 10.5 13.5" />
      <path d="M21 3 14.5 21l-4-7.5L3 9.5Z" />
    </>
  ),
  shield: <path d="M12 21.5s7.5-3.6 7.5-9.5V5.5L12 2.75 4.5 5.5V12c0 5.9 7.5 9.5 7.5 9.5Z" />,
  sliders: (
    <>
      <path d="M4 21v-7" />
      <path d="M4 10V3" />
      <path d="M12 21v-9" />
      <path d="M12 8V3" />
      <path d="M20 21v-5" />
      <path d="M20 12V3" />
      <path d="M1.75 14h4.5" />
      <path d="M9.75 8h4.5" />
      <path d="M17.75 16h4.5" />
    </>
  ),
  stethoscope: (
    <>
      <path d="M6 3H5a1 1 0 0 0-1 1v4.5a4.5 4.5 0 0 0 9 0V4a1 1 0 0 0-1-1h-1" />
      <path d="M8.5 13v1.5a5.5 5.5 0 0 0 11 0V12" />
      <circle cx="19.5" cy="10" r="2" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15.5V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4.5 20.5h15" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  "user-plus": (
    <>
      <circle cx="9.5" cy="8" r="4" />
      <path d="M2.5 20.5a7 7 0 0 1 14 0" />
      <path d="M19 8.5v6" />
      <path d="M16 11.5h6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 20.5a7 7 0 0 1 14 0" />
      <path d="M16 3.6a4 4 0 0 1 0 7.8" />
      <path d="M22 20.5a7 7 0 0 0-4-6.3" />
    </>
  ),
  wifi: (
    <>
      <path d="M2 8.8a15 15 0 0 1 20 0" />
      <path d="M5 12.4a10.5 10.5 0 0 1 14 0" />
      <path d="M8.5 15.9a5.25 5.25 0 0 1 7 0" />
      <path d="M12 19.5h.01" />
    </>
  ),
  "wifi-off": (
    <>
      <path d="m3 3 18 18" />
      <path d="M8.5 15.9a5.25 5.25 0 0 1 7 0" />
      <path d="M5 12.4a10.5 10.5 0 0 1 4.3-2.3" />
      <path d="M2 8.8a15 15 0 0 1 4.2-2.7" />
      <path d="M10.8 5.4A15 15 0 0 1 22 8.8" />
      <path d="M16.6 10.4A10.5 10.5 0 0 1 19 12.4" />
      <path d="M12 19.5h.01" />
    </>
  ),
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  "x-circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </>
  ),
};

/**
 * Icons that carry reading direction. <Icon> mirrors them automatically under
 * [dir="rtl"] so "arrow-left" always means "back" and "chevron-right" "next".
 */
export const DIRECTIONAL_ICONS: ReadonlySet<AnyIconName> = new Set<AnyIconName>([
  "arrow-left",
  "arrow-right",
  "chevron-left",
  "chevron-right",
  "log-out",
  "send",
]);

/**
 * View model for the live-connection badge. Pure and dependency-free so it can
 * be unit-tested; the status union mirrors `LiveConnectionStatus` from
 * `@/lib/client/use-live` (the shells pass the hook state in).
 *
 * Honesty rules: "live" is the only state that claims real-time delivery;
 * every other state says the screen still refreshes on its own (polling
 * fallback) or that the session must be renewed. Never green: green is
 * reserved for the clinical priority colour.
 */
export type LiveStatus = "connecting" | "live" | "reconnecting" | "offline" | "unavailable" | "denied";
export type ConnectionLanguage = "fr" | "ar";
export type ConnectionTone = "live" | "pending" | "fallback" | "offline" | "denied";

export interface ConnectionBadgeView {
  tone: ConnectionTone;
  label: string;
  /** Status explanation, stable while the status is unchanged (screen-reader text). */
  description: string;
  /** Description plus the last event time (tooltip only: it changes on every event). */
  detail: string;
}

const COPY: Record<ConnectionLanguage, Record<LiveStatus, { label: string; detail: string }>> = {
  fr: {
    live: { label: "En direct", detail: "Les nouveautés s’affichent dès leur arrivée." },
    connecting: { label: "Connexion…", detail: "Connexion en direct en cours ; l’écran s’actualise aussi tout seul." },
    reconnecting: { label: "Reconnexion…", detail: "Connexion en direct interrompue ; l’écran continue de s’actualiser régulièrement." },
    unavailable: { label: "Actualisation régulière", detail: "Connexion en direct indisponible ; l’écran s’actualise régulièrement." },
    offline: { label: "Hors ligne", detail: "Pas de réseau : les informations affichées peuvent être anciennes." },
    denied: { label: "Session à renouveler", detail: "Le serveur refuse la connexion : reconnectez-vous." },
  },
  ar: {
    live: { label: "مباشر", detail: "تظهر المستجدات فور وصولها." },
    connecting: { label: "جارٍ الاتصال…", detail: "جارٍ الاتصال المباشر؛ تتحدّث الشاشة تلقائيًا أيضًا." },
    reconnecting: { label: "إعادة الاتصال…", detail: "انقطع الاتصال المباشر؛ تستمر الشاشة في التحديث بانتظام." },
    unavailable: { label: "تحديث منتظم", detail: "الاتصال المباشر غير متاح؛ تتحدّث الشاشة بانتظام." },
    offline: { label: "دون اتصال", detail: "لا توجد شبكة: قد تكون المعلومات المعروضة قديمة." },
    denied: { label: "يجب تجديد الجلسة", detail: "يرفض الخادم الاتصال: يرجى تسجيل الدخول من جديد." },
  },
};

const TONE: Record<LiveStatus, ConnectionTone> = {
  live: "live",
  connecting: "pending",
  reconnecting: "pending",
  unavailable: "fallback",
  offline: "offline",
  denied: "denied",
};

const LAST_EVENT_PREFIX: Record<ConnectionLanguage, string> = {
  fr: "Dernier événement reçu : ",
  ar: "آخر حدث مُستلَم: ",
};

function lastEventText(lastEventAt: number | null, lang: ConnectionLanguage, now: number): string | null {
  if (lastEventAt === null || !Number.isFinite(lastEventAt)) return null;
  const seconds = Math.round((lastEventAt - Math.max(now, lastEventAt)) / 1000);
  const formatter = new Intl.RelativeTimeFormat(lang === "ar" ? "ar" : "fr-FR", { numeric: "auto" });
  const relative = Math.abs(seconds) < 60 ? formatter.format(seconds, "second") : formatter.format(Math.round(seconds / 60), "minute");
  return `${LAST_EVENT_PREFIX[lang]}${relative}`;
}

export function connectionBadgeView(
  status: LiveStatus,
  lastEventAt: number | null,
  lang: ConnectionLanguage = "fr",
  now: number = Date.now(),
): ConnectionBadgeView {
  const copy = COPY[lang][status];
  const last = lastEventText(lastEventAt, lang, now);
  return {
    tone: TONE[status],
    label: copy.label,
    description: copy.detail,
    detail: last ? `${copy.detail} ${last}` : copy.detail,
  };
}

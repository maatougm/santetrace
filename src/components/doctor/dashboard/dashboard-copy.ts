/**
 * Clinician queue and freshness copy in French and Arabic, plus small pure
 * presentation helpers. Nothing here orders, filters or scores rows: the
 * status, its colour and the estimate value always come from queue.ts and
 * ai-case-score-view.ts unchanged; only their labels are localized.
 */
import type { Language } from "@/lib/client/api";
import { statusLabel } from "@/lib/client/format";
import type { DoctorQueueSummary } from "@/contracts/patient-platform";
import { AI_SCORE_LABEL, AI_SCORE_NOT_COMPUTED } from "../record/ai-case-score-view";
import { queueCounters, type PriorityDisplay, type QueueCounter } from "./queue";
import type { QueueFilter, QueueFilterCounts } from "./queue-filter";
import { pendingWorkSummary } from "./row-indicators";

/** French text queueScoreView returns for an ineligible access (kept in sync by tests). */
const SCORE_NOT_ELIGIBLE_FR = "Non disponible pour votre accès";

export interface DashboardCopy {
  title: string;
  invitationsLink: string;
  loadingQueue: string;
  noPatientsTitle: string;
  noPatientsBody: string;
  noPatientsAction: string;
  queueHeading: string;
  noMatchTitle: string;
  noMatchBody: string;
  resetFilters: string;
  searchLabel: string;
  filtersGroup: string;
  filtersSummary: string;
  filters: Readonly<Record<QueueFilter, string>>;
  columnPatient: string;
  columnUrgency: string;
  columnEstimate: string;
  caption: string;
  caveatLead: string;
  caveat: string;
  orderingSummary: string;
  orderingBody: string;
  statusNotShared: string;
  pendingBadge: string;
  scoreNote: string;
  scoreLabel: string;
  scoreNotComputed: string;
  scoreNotEligible: string;
  workerNeverTitle: string;
  workerNeverBody: string;
  workerStaleTitle: string;
  workerLastSignal: string;
}

export const DASHBOARD_COPY: Readonly<Record<Language, DashboardCopy>> = {
  fr: {
    title: "Patients",
    invitationsLink: "Invitations",
    loadingQueue: "Chargement de la file de patients",
    noPatientsTitle: "Aucun patient ne vous a donné accès",
    noPatientsBody:
      "Les patients créent eux-mêmes leur dossier et choisissent leurs médecins. Quand un patient vous invite, acceptez son invitation pour voir son dossier ici.",
    noPatientsAction: "Voir mes invitations",
    queueHeading: "File de priorité",
    noMatchTitle: "Aucun patient ne correspond",
    noMatchBody: "Modifiez la recherche ou le filtre. Les patients restent dans la file : seul l’affichage est filtré.",
    resetFilters: "Réinitialiser la recherche et les filtres",
    searchLabel: "Rechercher un patient",
    filtersGroup: "Filtrer la file de patients",
    filtersSummary: "Filtres",
    filters: {
      all: "Tous",
      red: "Priorité haute",
      orange: "Suivi requis",
      pending: "En attente pour vous",
      review: "À vérifier",
    },
    columnPatient: "Patient",
    columnUrgency: "Urgence",
    columnEstimate: "Estimation IA",
    caption:
      "File priorisée : priorité rouge affichée (alerte rouge ouverte la plus ancienne d’abord), puis priorité orange affichée (de même), puis autre travail en attente pour vous (le plus ancien d’abord), puis les autres patients par priorité (inconnu avant vert). Cet ordre ne change jamais la priorité affichée, et la recherche ou les filtres retirent des lignes sans le modifier. « Inconnu » signale une couverture incomplète ou des données manquantes : ce n’est jamais un vert rassurant ; « non partagé » n’est pas zéro. Ouvrez le dossier pour les raisons, la dernière mesure et votre accès.",
    caveatLead: "Estimation IA :",
    caveat: "signal expérimental à revoir, pas une probabilité clinique ; ne change pas l’ordre.",
    orderingSummary: "Ordre de la file et estimation IA",
    orderingBody:
      "Ordre : priorité haute, suivi requis, travail en attente pour vous, puis les autres (inconnu avant vert). La recherche et les filtres retirent des lignes sans changer l’ordre. L’estimation IA est un signal d’attention calculé seulement à votre demande, dans le dossier ; ce n’est jamais une probabilité clinique et elle ne modifie ni la priorité ni l’ordre.",
    statusNotShared: "Statut non partagé",
    pendingBadge: "En attente",
    scoreNote: "IA · à revoir",
    scoreLabel: AI_SCORE_LABEL,
    scoreNotComputed: AI_SCORE_NOT_COMPUTED,
    scoreNotEligible: SCORE_NOT_ELIGIBLE_FR,
    workerNeverTitle: "Surveillance automatique jamais vue : évaluations potentiellement périmées",
    workerNeverBody:
      "Le serveur n’a reçu aucun signal du service de surveillance. Les échéances de suivi, relances et réévaluations programmées peuvent ne pas avoir été traitées.",
    workerStaleTitle: "Surveillance automatique interrompue : évaluations potentiellement périmées",
    workerLastSignal: "Dernier signal du service :",
  },
  ar: {
    title: "المرضى",
    invitationsLink: "الدعوات",
    loadingQueue: "جارٍ تحميل قائمة المرضى",
    noPatientsTitle: "لم يمنحك أي مريض حق الوصول",
    noPatientsBody: "ينشئ المرضى ملفاتهم بأنفسهم ويختارون أطباءهم. عندما يدعوك مريض، اقبل دعوته لترى ملفه هنا.",
    noPatientsAction: "عرض دعواتي",
    queueHeading: "قائمة الأولوية",
    noMatchTitle: "لا يوجد مريض مطابق",
    noMatchBody: "عدّل البحث أو عامل التصفية. يبقى المرضى في القائمة: العرض فقط هو المُصفّى.",
    resetFilters: "إعادة ضبط البحث وعوامل التصفية",
    searchLabel: "البحث عن مريض",
    filtersGroup: "تصفية قائمة المرضى",
    filtersSummary: "التصفية",
    filters: {
      all: "الكل",
      red: "أولوية عالية",
      orange: "متابعة مطلوبة",
      pending: "في انتظارك",
      review: "للتحقق",
    },
    columnPatient: "المريض",
    columnUrgency: "الاستعجال",
    columnEstimate: "تقدير الذكاء الاصطناعي",
    caption:
      "قائمة مرتّبة حسب الأولوية: الأولوية الحمراء المعروضة (أقدم تنبيه أحمر مفتوح أولًا)، ثم الأولوية البرتقالية المعروضة (بالطريقة نفسها)، ثم الأعمال الأخرى التي تنتظرك (الأقدم أولًا)، ثم بقية المرضى حسب الأولوية (غير المعروف قبل الأخضر). هذا الترتيب لا يغيّر أبدًا الأولوية المعروضة، والبحث أو عوامل التصفية تُخفي صفوفًا دون تغيير الترتيب. «غير معروف» يعني تغطية ناقصة أو بيانات مفقودة: ليس أخضر مطمئنًا أبدًا؛ و«غير مُشارَك» لا يعني صفرًا. افتح الملف لمعرفة الأسباب وآخر قياس وصلاحيات وصولك.",
    caveatLead: "تقدير الذكاء الاصطناعي:",
    caveat: "إشارة تجريبية للمراجعة، وليس احتمالًا سريريًا؛ لا يغيّر الترتيب.",
    orderingSummary: "ترتيب القائمة وتقدير الذكاء الاصطناعي",
    orderingBody:
      "الترتيب: أولوية عالية، ثم متابعة مطلوبة، ثم الأعمال التي تنتظرك، ثم البقية (غير المعروف قبل الأخضر). البحث وعوامل التصفية تُخفي صفوفًا دون تغيير الترتيب. تقدير الذكاء الاصطناعي إشارة انتباه لا تُحسب إلا بطلب منك داخل الملف؛ وهو ليس احتمالًا سريريًا أبدًا ولا يغيّر الأولوية ولا الترتيب.",
    statusNotShared: "الحالة غير مُشارَكة",
    pendingBadge: "قيد الانتظار",
    scoreNote: "ذكاء اصطناعي · للمراجعة",
    scoreLabel: "تقدير الذكاء الاصطناعي · للمراجعة",
    scoreNotComputed: "غير محسوب",
    scoreNotEligible: "غير متاح لمستوى وصولك",
    workerNeverTitle: "لم تُرصد المراقبة التلقائية قط: قد تكون التقييمات قديمة",
    workerNeverBody:
      "لم يتلقَّ الخادم أي إشارة من خدمة المراقبة. قد لا تكون مواعيد المتابعة والتذكيرات وإعادة التقييم المبرمجة قد عولجت.",
    workerStaleTitle: "توقفت المراقبة التلقائية: قد تكون التقييمات قديمة",
    workerLastSignal: "آخر إشارة من الخدمة:",
  },
};

/** "Filtres · Tous (12)": the disclosure summary keeps the active filter and its true count visible. */
export function filterSummaryLabel(filter: QueueFilter, counts: QueueFilterCounts, lang: Language): string {
  const copy = DASHBOARD_COPY[lang];
  return `${copy.filtersSummary} · ${copy.filters[filter]} (${counts[filter]})`;
}

/** Filter button text with its true count. */
export function filterButtonLabel(filter: QueueFilter, counts: QueueFilterCounts, lang: Language): string {
  return `${DASHBOARD_COPY[lang].filters[filter]} (${counts[filter]})`;
}

/** Live result line under the toolbar. */
export function resultText(shown: number, total: number, lang: Language): string {
  if (lang === "ar") return shown === total ? `عدد المرضى: ${total}` : `المعروض: ${shown} من ${total}`;
  const patients = `patient${total > 1 ? "s" : ""}`;
  return shown === total ? `${total} ${patients}` : `${shown} sur ${total} ${patients} affichés`;
}

/** Badge text for the displayed status; the status itself (and its colour) is priorityDisplay's, unchanged. */
export function urgencyLabel(display: PriorityDisplay, lang: Language): string {
  return display.monitoringShared ? statusLabel(display.status, lang) : DASHBOARD_COPY[lang].statusNotShared;
}

export function newAlertsText(count: number, lang: Language): string {
  if (lang === "ar") return `تنبيهات جديدة: ${count}`;
  return `${count} ${count > 1 ? "nouvelles alertes" : "nouvelle alerte"}`;
}

export interface LocalizedText {
  text: string;
  /** Language the text is written in: unknown French source text keeps "fr". */
  lang: Language;
}

/**
 * Honest "no estimate" explanation in the shell language. A French text that
 * is not one of the known queue states is returned unchanged, marked French.
 */
export function scoreUnavailableText(text: string, lang: Language): LocalizedText {
  if (lang === "fr") return { text, lang: "fr" };
  const copy = DASHBOARD_COPY[lang];
  if (text === AI_SCORE_NOT_COMPUTED) return { text: copy.scoreNotComputed, lang };
  if (text === SCORE_NOT_ELIGIBLE_FR) return { text: copy.scoreNotEligible, lang };
  return { text, lang: "fr" };
}

function arabicCounterText(counter: QueueCounter): string | null {
  if (counter.state === "count" && counter.count > 0) {
    if (counter.key === "clinicalMessages") return `رسائل سريرية: ${counter.count}`;
    if (counter.key === "contactRequests") return `طلبات تواصل: ${counter.count}`;
    return `بروتوكولات متوقفة: ${counter.count}`;
  }
  if (counter.state === "proposals" && counter.awaitingReview > 0) return `مقترحات للمراجعة: ${counter.awaitingReview}`;
  if (counter.state === "plan" && counter.overdue) return "مراجعة الخطة متأخرة";
  return null;
}

/** What waits on this clinician; French is pendingWorkSummary verbatim, Arabic mirrors the same counters. */
export function pendingWorkText(queue: DoctorQueueSummary | null | undefined, lang: Language): string | null {
  if (lang === "fr") return pendingWorkSummary(queue);
  const parts = (queueCounters(queue) ?? []).map(arabicCounterText).filter((text): text is string => text !== null);
  return parts.length > 0 ? parts.join("، ") : null;
}

// ---------------------------------------------------------------------------
// Freshness chip and stale banner (shared by the queue and the record header)
// ---------------------------------------------------------------------------

export interface FreshnessCopy {
  syncing: string;
  updated: string;
  lastUpdated: string;
  secondsAgo: (seconds: number) => string;
  minutesAgo: (minutes: number) => string;
  atClock: (clock: string) => string;
  interrupted: string;
  staleTitle: (since: string) => string;
  staleBody: string;
  retry: string;
  errorCode: string;
  /** Between an error title and its message (French spaced colon). */
  labelSeparator: string;
}

export const FRESHNESS_COPY: Readonly<Record<Language, FreshnessCopy>> = {
  fr: {
    syncing: "Synchronisation…",
    updated: "Mis à jour",
    lastUpdated: "Dernière mise à jour",
    secondsAgo: (seconds) => `il y a ${seconds} s`,
    minutesAgo: (minutes) => `il y a ${minutes} min`,
    atClock: (clock) => `à ${clock}`,
    interrupted: "Synchronisation interrompue",
    staleTitle: (since) => `Données affichées du ${since} — possiblement périmées`,
    staleBody: "Les nouvelles mesures et alertes n’apparaissent pas tant que la synchronisation est interrompue.",
    retry: "Réessayer",
    errorCode: "Code",
    labelSeparator: " : ",
  },
  ar: {
    syncing: "جارٍ المزامنة…",
    updated: "تم التحديث",
    lastUpdated: "آخر تحديث",
    secondsAgo: (seconds) => `منذ ${seconds} ث`,
    minutesAgo: (minutes) => `منذ ${minutes} د`,
    atClock: (clock) => `على الساعة ${clock}`,
    interrupted: "المزامنة متوقفة",
    staleTitle: (since) => `البيانات المعروضة من ${since} — قد تكون قديمة`,
    staleBody: "لن تظهر القياسات والتنبيهات الجديدة ما دامت المزامنة متوقفة.",
    retry: "إعادة المحاولة",
    errorCode: "الرمز",
    labelSeparator: ": ",
  },
};

/** Age of the last successful sync; past one hour, the caller's formatted clock time. */
export function freshnessAge(lastSuccessAt: number, now: number, lang: Language, clock: (ms: number) => string): string {
  const copy = FRESHNESS_COPY[lang];
  const seconds = Math.max(0, Math.round((now - lastSuccessAt) / 1000));
  if (seconds < 60) return copy.secondsAgo(seconds);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return copy.minutesAgo(minutes);
  return copy.atClock(clock(lastSuccessAt));
}

/** Running-worker confirmation, with the true heartbeat age. */
export function workerRunningText(ageMs: number, lang: Language): string {
  const seconds = Math.round(ageMs / 1000);
  return lang === "ar"
    ? `المراقبة التلقائية نشطة · آخر إشارة منذ ${seconds} ث`
    : `Surveillance automatique active · signal il y a ${seconds} s`;
}

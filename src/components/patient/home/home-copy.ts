/**
 * New patient copy for the simplified home and the bottom navigation.
 * Everything else reuses the existing i18n / CARE_COPY strings. French and
 * Arabic keep the same keys and function arities (tests/frontend-patient-home).
 * Arabic counts are written "label: n" so no Arabic plural form is guessed.
 */
import type { Language } from "@/lib/client/transport";

const fr = {
  nav: {
    messages: "Messages",
  },
  messagesTitle: "Messages",
  addMeasure: "Ajouter une mesure",
  nextStepTitle: "Prochaine étape",
  openPlan: "Voir mon plan",
  openReminders: "Voir mes rappels",
  quickLinksTitle: "Accès rapide",
  links: {
    messages: "Messages",
    plan: "Mon plan",
    documents: "Documents",
    history: "Historique",
  },
  detailsMonitoring: "Détails du suivi",
  attentionTitle: "À noter",
  awaitingDoctor: (n: number) =>
    n === 1 ? "1 proposition en attente de revue du médecin" : `${n} propositions en attente de revue du médecin`,
  /** needs_inputs: the patient, not the doctor, has something to do. */
  needsInputs: (n: number) =>
    n === 1 ? "À compléter : 1 proposition attend vos réponses" : `À compléter : ${n} propositions attendent vos réponses`,
  toReconfirm: (n: number) =>
    n === 1 ? "1 action à reconfirmer par votre médecin" : `${n} actions à reconfirmer par votre médecin`,
  suspect: (kind: string) => `${kind} : dernière mesure suspecte, exclue des règles`,
  consentMissing: "Consentement non enregistré : accès et envois bloqués.",
  planLinksTitle: "Dans mon plan",
};

type HomeCopy = typeof fr;

const ar: HomeCopy = {
  nav: {
    messages: "الرسائل",
  },
  messagesTitle: "الرسائل",
  addMeasure: "إضافة قياس",
  nextStepTitle: "الخطوة التالية",
  openPlan: "عرض خطتي",
  openReminders: "عرض تذكيراتي",
  quickLinksTitle: "وصول سريع",
  links: {
    messages: "الرسائل",
    plan: "خطتي",
    documents: "المستندات",
    history: "السجل",
  },
  detailsMonitoring: "تفاصيل المتابعة",
  attentionTitle: "للعلم",
  awaitingDoctor: (n: number) => `مقترحات في انتظار مراجعة الطبيب: ${n}`,
  needsInputs: (n: number) => `للاستكمال — مقترحات تنتظر إجاباتك: ${n}`,
  toReconfirm: (n: number) => `إجراءات تحتاج إلى إعادة تأكيد من طبيبك: ${n}`,
  suspect: (kind: string) => `${kind}: آخر قياس مشكوك فيه ومستبعد من القواعد`,
  consentMissing: "الموافقة غير مسجّلة: الوصول والإرسال محظوران.",
  planLinksTitle: "في خطتي",
};

export const HOME_COPY: Readonly<Record<Language, HomeCopy>> = { fr, ar };

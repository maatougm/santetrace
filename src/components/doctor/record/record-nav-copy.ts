/**
 * Clinician record header, shortcuts and section navigation, in the clinician
 * shell's language. Only frontend-authored labels live here: server clinical
 * facts and the untranslated section forms keep their French source (rendered
 * under `FRENCH_SOURCE`), and are never machine-translated.
 */
import type { Language } from "@/lib/client/api";
import type { NavLabels, TabGroupId, TabId } from "./record-tabs";

export interface RecordNavCopy extends NavLabels {
  eyebrow: string;
  back: string;
  loadingTitle: string;
  deniedTitle: string;
  unavailableTitle: string;
  deniedNoticeTitle: string;
  deniedNoticeBody: string;
  backToPatients: string;
  writeToPatient: string;
  messagesNotShared: string;
  alertsShortcut: (count: number) => string;
  /** Accessible name of the <nav>. */
  navLabel: string;
  /** Visible label of the phone select (all 13 destinations). */
  sectionSelectLabel: string;
  /** Phone action under the select: reveals the section already shown, named by its exact visible label. */
  jumpToSection: (section: string) => string;
  /** Accessible name of the desktop row of frequent destinations. */
  frequentLabel: string;
  /** Visible label of the desktop select for the other destinations. */
  moreSelectLabel: string;
  morePlaceholder: string;
  sections: Record<TabId, string>;
  groups: Record<TabGroupId, string>;
}

export const RECORD_NAV_COPY: Readonly<Record<Language, RecordNavCopy>> = {
  fr: {
    eyebrow: "Dossier patient · fictif",
    back: "Patients",
    loadingTitle: "Chargement du dossier…",
    deniedTitle: "Accès retiré ou indisponible",
    unavailableTitle: "Dossier indisponible",
    deniedNoticeTitle: "Affichage effacé",
    deniedNoticeBody:
      "Le serveur refuse désormais cet accès. Les données affichées ont été retirées de cet écran ; une réponse reçue plus tard ne les rétablit pas. Le patient conserve son dossier.",
    backToPatients: "Retour aux patients",
    writeToPatient: "Écrire au patient",
    messagesNotShared: "Messages non partagés",
    alertsShortcut: (count) => `Alertes (${count})`,
    navLabel: "Sections du dossier",
    sectionSelectLabel: "Section du dossier",
    jumpToSection: (section) => `Aller à ${section}`,
    frequentLabel: "Sections fréquentes",
    moreSelectLabel: "Autres sections",
    morePlaceholder: "Choisir une section",
    sections: {
      messages: "Messages",
      alerts: "Alertes",
      care: "Suivi et plan",
      trends: "Tendances",
      measurements: "Mesures",
      documents: "Documents",
      report: "Rapport",
      protocols: "Protocoles",
      search: "Recherche",
      notes: "Notes externes",
      reminders: "Rappels",
      rules: "Règles",
      summary: "Synthèse",
    },
    groups: {
      communication: "Communication",
      followUp: "Suivi",
      evidence: "Sources et comptes rendus",
      tools: "Outils",
    },
  },
  ar: {
    eyebrow: "ملف المريض · وهمي",
    back: "المرضى",
    loadingTitle: "جارٍ تحميل الملف…",
    deniedTitle: "الوصول مسحوب أو غير متاح",
    unavailableTitle: "الملف غير متاح",
    deniedNoticeTitle: "تم مسح العرض",
    deniedNoticeBody:
      "يرفض الخادم هذا الوصول الآن. أُزيلت البيانات المعروضة من هذه الشاشة، ولن يعيدها أي ردّ يصل لاحقًا. يحتفظ المريض بملفه.",
    backToPatients: "العودة إلى المرضى",
    writeToPatient: "مراسلة المريض",
    messagesNotShared: "الرسائل غير مُشارَكة",
    alertsShortcut: (count) => `التنبيهات (${count})`,
    navLabel: "أقسام الملف",
    sectionSelectLabel: "قسم الملف",
    jumpToSection: (section) => `الانتقال إلى ${section}`,
    frequentLabel: "الأقسام الأكثر استخدامًا",
    moreSelectLabel: "أقسام أخرى",
    morePlaceholder: "اختر قسمًا",
    sections: {
      messages: "الرسائل",
      alerts: "التنبيهات",
      care: "المتابعة والخطة",
      trends: "الاتجاهات",
      measurements: "القياسات",
      documents: "المستندات",
      report: "التقرير",
      protocols: "البروتوكولات",
      search: "البحث",
      notes: "ملاحظات خارجية",
      reminders: "التذكيرات",
      rules: "القواعد",
      summary: "الملخّص",
    },
    groups: {
      communication: "التواصل",
      followUp: "المتابعة",
      evidence: "المصادر والتقارير",
      tools: "الأدوات",
    },
  },
};

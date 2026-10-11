import type { Language } from "@/lib/client/api";
import type { ShellNavItem } from "./nav";

export interface ShellCopy {
  skipToContent: string;
  checkingSession: string;
  sessionRequiredTitle: string;
  sessionRequiredBody: string;
  signIn: string;
  wrongRoleTitle: string;
  wrongRoleBody: string;
  goToMySpace: string;
  offlineTitle: string;
  offlineBody: string;
  offlineUnverified: string;
  retry: string;
  logout: string;
  loggingOut: string;
  logoutFailed: string;
  demo: string;
  mainNav: string;
  clinicianRole: string;
  patientRole: string;
  demoRules: string;
}

export const SHELL_COPY: Record<Language, ShellCopy> = {
  fr: {
    skipToContent: "Aller au contenu",
    checkingSession: "Vérification de la session…",
    sessionRequiredTitle: "Session requise",
    sessionRequiredBody: "Votre session est absente ou a expiré. Reconnectez-vous pour accéder à cet espace.",
    signIn: "Se connecter",
    wrongRoleTitle: "Espace réservé",
    wrongRoleBody: "Cette page n’est pas accessible avec le rôle de votre session.",
    goToMySpace: "Aller à mon espace",
    offlineTitle: "Serveur injoignable",
    offlineBody: "Impossible de vérifier votre session. Vérifiez la connexion puis réessayez.",
    offlineUnverified: "Hors ligne — session non vérifiée",
    retry: "Réessayer",
    logout: "Se déconnecter",
    loggingOut: "Déconnexion…",
    logoutFailed: "La déconnexion côté serveur n’a pas pu être confirmée. Les données locales ont été effacées.",
    demo: "Démonstration fictive",
    mainNav: "Navigation principale",
    clinicianRole: "Clinicien · démo",
    patientRole: "Patient · démo",
    demoRules: "Seuils de démonstration, non validés cliniquement.",
  },
  ar: {
    skipToContent: "الانتقال إلى المحتوى",
    checkingSession: "جارٍ التحقق من الجلسة…",
    sessionRequiredTitle: "الجلسة مطلوبة",
    sessionRequiredBody: "جلستك غير موجودة أو انتهت. يرجى تسجيل الدخول من جديد.",
    signIn: "تسجيل الدخول",
    wrongRoleTitle: "مساحة محجوزة",
    wrongRoleBody: "هذه الصفحة غير متاحة لدور جلستك.",
    goToMySpace: "الذهاب إلى مساحتي",
    offlineTitle: "تعذّر الوصول إلى الخادم",
    offlineBody: "لا يمكن التحقق من جلستك. تحقّق من الاتصال ثم أعد المحاولة.",
    offlineUnverified: "دون اتصال — الجلسة غير مؤكَّدة",
    retry: "إعادة المحاولة",
    logout: "تسجيل الخروج",
    loggingOut: "جارٍ تسجيل الخروج…",
    logoutFailed: "تعذّر تأكيد تسجيل الخروج على الخادم. تم مسح البيانات المحلية.",
    demo: "عرض تجريبي وهمي",
    mainNav: "التنقل الرئيسي",
    clinicianRole: "طبيب · تجريبي",
    patientRole: "مريض · تجريبي",
    demoRules: "حدود تجريبية، غير مُعتمدة سريريًا.",
  },
};

/** Clinician-shell-only strings (the shared keys above stay in SHELL_COPY). "Santetrace" is never translated. */
export interface ClinicianShellCopy {
  /** Accessible name of the brand link back to the queue. */
  brandHome: string;
  navPatients: string;
  navInvitations: string;
  /** Name of the other language, written in that language. */
  languageSwitchLabel: string;
  languageSwitchAria: string;
  logoutStoppedTitle: string;
  logoutStoppedPurgeFailed: string;
  logoutStoppedPreparationFailed: string;
  logoutRetry: string;
}

export const CLINICIAN_SHELL_COPY: Readonly<Record<Language, ClinicianShellCopy>> = {
  fr: {
    brandHome: "Santetrace — liste des patients",
    navPatients: "Patients",
    navInvitations: "Invitations",
    languageSwitchLabel: "العربية",
    languageSwitchAria: "Afficher l’espace clinicien en arabe",
    logoutStoppedTitle: "Déconnexion interrompue",
    logoutStoppedPurgeFailed:
      "Des données privées laissées sur cet appareil n’ont pas pu être effacées. Vous restez connecté·e. Fermez les autres onglets Santetrace, puis réessayez.",
    logoutStoppedPreparationFailed: "La déconnexion n’a pas pu être préparée. Vous restez connecté·e et rien n’a été effacé.",
    logoutRetry: "Réessayer la déconnexion",
  },
  ar: {
    brandHome: "Santetrace — قائمة المرضى",
    navPatients: "المرضى",
    navInvitations: "الدعوات",
    languageSwitchLabel: "Français",
    languageSwitchAria: "عرض مساحة الطبيب بالفرنسية",
    logoutStoppedTitle: "توقّف تسجيل الخروج",
    logoutStoppedPurgeFailed:
      "تعذّر حذف بيانات خاصة متبقية على هذا الجهاز. ما زلت متصلًا. أغلق علامات تبويب Santetrace الأخرى ثم أعد المحاولة.",
    logoutStoppedPreparationFailed: "تعذّر تحضير تسجيل الخروج. ما زلت متصلًا ولم يُحذف أي شيء.",
    logoutRetry: "إعادة محاولة تسجيل الخروج",
  },
};

/**
 * Clinician header links in the selected language. Only the labels change:
 * hrefs, icons and active-route matching are identical in every language.
 */
export function clinicianNav(lang: Language): ShellNavItem[] {
  const copy = CLINICIAN_SHELL_COPY[lang];
  return [
    // Exact on the queue, plus every patient record page.
    { href: "/doctor", label: copy.navPatients, icon: "users", exact: true, matches: ["/doctor/patients"] },
    { href: "/doctor/invitations", label: copy.navInvitations, icon: "inbox" },
  ];
}

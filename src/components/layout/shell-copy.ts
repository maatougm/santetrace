import type { Language } from "@/lib/client/api";

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

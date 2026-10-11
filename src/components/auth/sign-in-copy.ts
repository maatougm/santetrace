import type { Language } from "@/lib/client/api";

export interface SignInCopy {
  langToggle: string;
  langToggleLabel: string;
  eyebrow: string;
  headline: string;
  lede: string;
  guarantees: { icon: "users" | "shield" | "file-text"; title: string; body: string }[];
  demoFooter: string;
  clinicianTitle: string;
  clinicianDescription: string;
  passwordLabel: string;
  passwordRequired: string;
  clinicianSubmit: string;
  rejectedTitle: string;
  rejectedFallback: string;
  activeTitle: string;
  activeAs: (name: string, role: string) => string;
  continue: string;
  switchAccount: string;
  clinicianRole: string;
  patientRole: string;
  checking: string;
  offlineTitle: string;
  offlineBody: string;
  offlineContinue: string;
  loggedOut: string;
  logoutUnconfirmed: string;
  demoTitle: string;
  demoDescription: string;
  demoPatient: string;
  demoClinician: string;
}

export const SIGN_IN_COPY: Record<Language, SignInCopy> = {
  fr: {
    langToggle: "العربية",
    langToggleLabel: "Afficher en arabe",
    eyebrow: "Démonstration fictive · Santetrace",
    headline: "Le suivi chronique entre deux consultations.",
    lede:
      "Le patient possède son dossier et choisit ses médecins. Mesures, documents et propositions restent sourcés ; les priorités viennent de règles versionnées et le médecin décide.",
    guarantees: [
      {
        icon: "users",
        title: "Patients et documents fictifs",
        body: "Aucune donnée réelle. Chaque patient crée son propre dossier et choisit qui y accède.",
      },
      {
        icon: "shield",
        title: "Règles et supervision médicale",
        body: "La priorité vient de règles versionnées. L’IA organise et propose ; un médecin valide. Aucun diagnostic automatique.",
      },
      {
        icon: "file-text",
        title: "Résultats liés à la source",
        body: "Une valeur extraite n’entre dans l’historique qu’après confirmation par le clinicien.",
      },
    ],
    demoFooter: "Seuils de démonstration non validés cliniquement. Ne pas utiliser pour de vrais patients.",
    clinicianTitle: "Espace clinicien",
    clinicianDescription: "Patients qui vous ont donné accès, par priorité. Comptes médecins fictifs préconfigurés.",
    passwordLabel: "Mot de passe",
    passwordRequired: "Saisissez le mot de passe.",
    clinicianSubmit: "Se connecter",
    rejectedTitle: "Connexion refusée",
    rejectedFallback: "Identifiants invalides ou expirés.",
    activeTitle: "Session active",
    activeAs: (name, role) => `Connecté·e en tant que ${name} (${role}).`,
    continue: "Continuer",
    switchAccount: "Changer de compte",
    clinicianRole: "clinicien",
    patientRole: "patient",
    checking: "Vérification de la session…",
    offlineTitle: "Serveur injoignable",
    offlineBody: "La connexion nécessite le réseau. Les saisies déjà en file d’attente restent sur cet appareil.",
    offlineContinue: "Ouvrir mon espace hors ligne",
    loggedOut: "Vous êtes déconnecté·e.",
    logoutUnconfirmed:
      "Données locales effacées, mais le serveur n’a pas confirmé la déconnexion. Reconnectez-vous puis déconnectez-vous en ligne.",
    demoTitle: "Accès rapide de démonstration",
    demoDescription: "Comptes fictifs, sans mot de passe, activés uniquement pour cette démonstration.",
    demoPatient: "Patient démo",
    demoClinician: "Médecin démo",
  },
  ar: {
    langToggle: "Français",
    langToggleLabel: "Afficher en français",
    eyebrow: "عرض تجريبي وهمي · Santetrace",
    headline: "متابعة الأمراض المزمنة بين استشارتين.",
    lede: "يملك المريض ملفه ويختار أطباءه. تبقى القياسات والوثائق والمقترحات مرتبطة بمصادرها؛ تأتي الأولويات من قواعد ذات إصدارات محددة والقرار للطبيب.",
    guarantees: [
      {
        icon: "users",
        title: "مرضى ووثائق وهمية",
        body: "لا توجد بيانات حقيقية. كل مريض ينشئ ملفه بنفسه ويختار من يطّلع عليه.",
      },
      {
        icon: "shield",
        title: "قواعد وإشراف طبي",
        body: "تأتي الأولوية من قواعد ذات إصدارات محددة. ينظّم الذكاء الاصطناعي ويقترح؛ ويعتمد الطبيب. لا تشخيص آلي.",
      },
      {
        icon: "file-text",
        title: "نتائج مرتبطة بمصدرها",
        body: "لا تدخل القيمة المستخرجة إلى السجل إلا بعد تأكيد الطبيب.",
      },
    ],
    demoFooter: "حدود تجريبية غير مُعتمدة سريريًا. لا تُستعمل مع مرضى حقيقيين.",
    clinicianTitle: "فضاء الطبيب",
    clinicianDescription: "المرضى الذين منحوك الوصول، حسب الأولوية. حسابات أطباء وهمية معدّة مسبقًا.",
    passwordLabel: "كلمة المرور",
    passwordRequired: "أدخل كلمة المرور.",
    clinicianSubmit: "تسجيل الدخول",
    rejectedTitle: "تم رفض الدخول",
    rejectedFallback: "بيانات الدخول غير صالحة أو منتهية.",
    activeTitle: "جلسة نشطة",
    activeAs: (name, role) => `متصل باسم ${name} (${role}).`,
    continue: "متابعة",
    switchAccount: "تغيير الحساب",
    clinicianRole: "طبيب",
    patientRole: "مريض",
    checking: "جارٍ التحقق من الجلسة…",
    offlineTitle: "تعذّر الوصول إلى الخادم",
    offlineBody: "يتطلب تسجيل الدخول اتصالًا بالشبكة. القياسات المنتظرة تبقى محفوظة على هذا الجهاز.",
    offlineContinue: "فتح مساحتي دون اتصال",
    loggedOut: "تم تسجيل الخروج.",
    logoutUnconfirmed: "تم مسح البيانات المحلية، لكن الخادم لم يؤكد تسجيل الخروج. سجّل الدخول ثم الخروج عند توفر الاتصال.",
    demoTitle: "دخول سريع للعرض التجريبي",
    demoDescription: "حسابات وهمية دون كلمة مرور، مفعَّلة لهذا العرض التجريبي فقط.",
    demoPatient: "مريض تجريبي",
    demoClinician: "طبيب تجريبي",
  },
};

"use client";

/**
 * Patient app strings (French source, Modern Standard Arabic translation).
 * Arabic wording is MSA and still needs review by a fluent Tunisian speaker
 * before any Darija adaptation (constitution: "Darija wording requires review").
 *
 * Latin tokens (units, rule versions) are rendered by components inside
 * <bdi dir="ltr"> rather than baked into Arabic sentences where possible.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CareDocument, EvaluatedStatus, GlucoseUnit, Language, Reminder } from "./api";
import type { OutboxErrorKind, OutboxState } from "./outbox";

type Plural = (count: number) => string;

const fr = {
  common: {
    appName: "Santetrace",
    demo: "Démonstration fictive",
    demoRules: "Seuils de démonstration, non validés cliniquement.",
    loading: "Chargement…",
    retry: "Réessayer",
    back: "Retour",
    cancel: "Annuler",
    close: "Fermer",
    signInAgain: "Se reconnecter",
    fixedMessage: "Message fixe, sans IA",
    measuredAt: "Mesurée le",
    receivedAt: "Reçue par le serveur le",
    seeAll: "Tout voir",
    refresh: "Actualiser",
    dismiss: "Masquer",
    required: "obligatoire",
  },
  nav: {
    home: "Accueil",
    measure: "Mesurer",
    reminders: "Rappels",
    history: "Historique",
    documents: "Analyses",
    follow: "Suivi",
    record: "Dossier",
    plan: "Plan",
    contact: "Contact",
    ariaLabel: "Navigation patient",
  },
  language: {
    switchLabel: "العربية",
    switchAria: "Afficher l’application en arabe",
  },
  connection: {
    online: "En ligne",
    offline: "Hors ligne",
    unreachable: "Serveur injoignable",
    syncedAgo: (when: string) => `Données du serveur : ${when}`,
    staleSince: (when: string) => `Dernière réponse du serveur : ${when}`,
    deviceCopy: (date: string) => `Copie enregistrée sur cet appareil le ${date}. Elle peut être périmée.`,
    noServerData: "Aucune donnée du serveur disponible sur cet appareil.",
    sessionUnverified: "Session non vérifiée (hors ligne)",
    sessionExpired: "Session expirée. Vos envois en attente restent sur cet appareil.",
    consentRevoked: "Consentement retiré : accès et envois bloqués.",
    installed: "Application installée",
    offlineReady: "Utilisable hors ligne",
  },
  outbox: {
    title: "Envois depuis cet appareil",
    waiting: ((n: number) => (n === 1 ? "1 envoi en attente" : `${n} envois en attente`)) as Plural,
    failed: ((n: number) => (n === 1 ? "1 envoi refusé" : `${n} envois refusés`)) as Plural,
    received: ((n: number) => (n === 1 ? "1 reçu par le serveur" : `${n} reçus par le serveur`)) as Plural,
    nothingPending: "Aucun envoi en attente",
    retry: "Réessayer",
    retrying: "Envoi…",
    storageUnavailable: "Stockage local indisponible : impossible de garder des envois hors ligne sur cet appareil.",
    state: {
      queued: "En attente d’envoi",
      sending: "Envoi en cours",
      server_received: "Reçu par le serveur",
      failed: "Refusé — non envoyé",
    } satisfies Record<OutboxState, string>,
    notSent: "Non envoyé",
    savedOnDevice: "Enregistré sur cet appareil",
    careTeamNotInformed: "Rien n’est transmis à un médecin tant que l’envoi n’a pas réussi.",
    discard: "Retirer de cet appareil",
    correct: "Corriger",
    redacted: "Bloqué : consentement retiré. Le contenu a été effacé de cet appareil ; rien n’a été envoyé.",
    attempts: ((n: number) => (n === 1 ? "1 tentative" : `${n} tentatives`)) as Plural,
    errors: {
      network: "Pas de connexion. Nouvel essai automatique au retour du réseau.",
      server: "Le serveur n’a pas confirmé la réception. Nouvel essai automatique.",
      unavailable: "Service pas encore disponible côté serveur. Nouvel essai plus tard.",
      unauthenticated: "Session expirée : reconnectez-vous pour envoyer. Rien n’a été effacé.",
      consent_revoked: "Consentement retiré : cet envoi est bloqué.",
      forbidden: "Accès refusé pour cette session.",
      rejected: "Refusé par le serveur.",
      conflict: "En conflit avec une déclaration déjà reçue.",
    } satisfies Record<OutboxErrorKind, string>,
  },
  noReferent: {
    deliveryStep: "Aucun médecin n’a accès à vos alertes",
    receivedNote: "Enregistrée dans votre dossier. Aucun médecin n’a accès à vos alertes : personne ne la voit pour l’instant.",
    alertCreated: "Une alerte a été enregistrée dans votre dossier. Aucun médecin n’a accès à vos alertes : elle n’est transmise à personne.",
    statusOrange: "Une alerte de suivi est ouverte dans votre dossier. Aucun médecin n’a accès à vos alertes pour l’instant : invitez un médecin pour qu’elle soit examinée.",
    statusRed: "Une alerte de priorité haute est ouverte dans votre dossier. Aucun médecin n’a accès à vos alertes : en cas de symptômes graves, appelez le 190 (SAMU).",
    historyAlertOpen: "Alerte enregistrée dans votre dossier — aucun médecin n’a accès à vos alertes",
    unknownTeam: "L’application ne peut pas confirmer pour l’instant qu’un médecin a accès à vos alertes.",
    invite: "Inviter un médecin",
  },
  delivery: {
    aria: "Étapes de transmission",
    device: "Saisi sur cet appareil",
    server: "Reçu par le serveur",
    careTeam: "Vu par un médecin",
    notYet: "pas encore",
  },
  status: {
    title: "Votre suivi",
    explain: {
      green: "Votre dernière mesure reçue ne dépasse aucun seuil haut de démonstration. Les valeurs basses ne sont pas évaluées : une valeur très basse n’est pas signalée. Cela ne remplace pas un avis médical.",
      orange: "Une alerte de suivi est ouverte dans votre dossier ; votre équipe soignante doit l’examiner.",
      red: "Une alerte de priorité haute est ouverte dans votre dossier. En cas de symptômes graves, contactez les urgences locales.",
    } satisfies Record<EvaluatedStatus, string>,
    unknown: (hours: number) =>
      `Information manquante : aucune mesure reçue dans les ${hours} dernières heures. Cela ne signifie pas que tout va bien.`,
    serverOnly: "Statut calculé par le serveur, pas par cet appareil.",
    staleUnverified: (date: string) =>
      `Statut non vérifié : la dernière réponse du serveur date du ${date}. Il a pu changer depuis ; cela ne signifie pas que tout va bien.`,
    staleAsOf: (date: string) => `Dernier statut connu, reçu du serveur le ${date}. Il a pu changer depuis.`,
  },
  home: {
    greeting: (name: string) => (name ? `Bonjour, ${name}` : "Bonjour"),
    intro: "Suivi de la tension et de la glycémie entre deux consultations.",
    latestTitle: "Dernière mesure reçue",
    latestNone: "Aucune mesure reçue par le serveur pour l’instant.",
    lastMessageTitle: "Après votre dernier envoi",
    nextReminders: "Prochains rappels",
    noReminders: "Aucun rappel à venir.",
    measureCta: "Nouvelle mesure",
    measureCtaHint: "Tension ou glycémie",
    summaryCta: "Ma synthèse",
    documentsCta: "Envoyer une analyse",
    historyCta: "Historique",
    noDataOffline: "Hors ligne, sans copie sur cet appareil : votre statut ne peut pas être affiché.",
  },
  measure: {
    title: "Nouvelle mesure",
    steps: { form: "Saisie", preview: "Vérification", result: "Résultat" },
    kindLabel: "Que mesurez-vous ?",
    kindBp: "Tension",
    kindGlucose: "Glycémie",
    systolic: "Systolique",
    systolicHint: "Le chiffre du haut",
    diastolic: "Diastolique",
    diastolicHint: "Le chiffre du bas",
    glucoseValue: "Glycémie",
    unitLabel: "Unité affichée sur votre lecteur",
    unitHint: "Aucune unité n’est choisie à votre place.",
    unitExample: { "mg/dL": "ex. 126", "mmol/L": "ex. 7,0" } satisfies Record<GlucoseUnit, string>,
    timeLabel: "Heure de la mesure",
    timeHint: "Par défaut : maintenant. Modifiez-la si vous avez mesuré plus tôt.",
    timeNow: "Maintenant",
    continue: "Vérifier avant envoi",
    delayedWarning: "Mesure de plus de 24 h : elle sera marquée comme différée.",
    errors: {
      required: "Valeur requise.",
      notNumber: "Saisissez un nombre.",
      notInteger: "Saisissez un nombre entier.",
      range: (min: string, max: string, unit: string) => `Valeur attendue entre ${min} et ${max} ${unit}.`,
      systolicNotAbove: "La systolique doit être supérieure à la diastolique.",
      unitRequired: "Choisissez l’unité affichée sur votre lecteur.",
      looksLikeMmol: "Cette valeur ressemble à des mmol/L. Vérifiez l’unité choisie.",
      looksLikeMgdl: "Cette valeur ressemble à des mg/dL. Vérifiez l’unité choisie.",
      timeInvalid: "Date et heure invalides.",
      timeFuture: "L’heure de mesure est dans le futur.",
      summary: "Corrigez les champs signalés. Rien n’a été envoyé.",
    },
    preview: {
      title: "Vérifiez avant d’envoyer",
      intro: "Voici exactement ce qui sera envoyé à votre dossier.",
      notSent: "Pas encore envoyé",
      type: "Type",
      value: "Valeur",
      unit: "Unité",
      time: "Mesurée le",
      edit: "Modifier",
      confirm: "Confirmer et envoyer",
      sending: "Envoi…",
      offlineNote: "Hors ligne : la mesure sera gardée sur cet appareil et envoyée au retour de la connexion.",
    },
    result: {
      receivedTitle: "Mesure reçue par le serveur",
      receivedNote: "Reçue ne veut pas dire lue : elle apparaît dans le tableau de bord de votre équipe soignante.",
      alertCreated: "Une alerte a été créée dans votre dossier. Elle n’a pas encore été vue par votre équipe soignante.",
      queuedTitle: "Gardée sur cet appareil",
      queuedBody: "Pas encore envoyée. Elle partira automatiquement dès que la connexion reviendra.",
      localTitle: "Évaluation locale provisoire",
      localBody: "Calculée sur cet appareil avec les règles de démonstration enregistrées. Le serveur fera foi après l’envoi.",
      localRules: "Règles",
      localSavedAt: "enregistrées le",
      localStatus: {
        green: "Aucun seuil haut de démonstration dépassé (provisoire) ; valeurs basses non évaluées.",
        orange: "Au-dessus du seuil de suivi de démonstration (provisoire).",
        red: "Au-dessus du seuil haut de démonstration (provisoire).",
      } satisfies Record<EvaluatedStatus, string>,
      emergency: "En cas de symptômes graves, contactez les urgences locales.",
      conversion: "Conversion locale (facteur 18) :",
      noRules: "En attente : aucune règle enregistrée sur cet appareil, donc pas d’évaluation locale.",
      failedTitle: "Mesure refusée — rien n’a été enregistré",
      failedBody: "Corrigez la mesure puis renvoyez-la.",
      sessionTitle: "Session expirée",
      sessionBody: "La mesure reste sur cet appareil. Reconnectez-vous pour l’envoyer.",
      consentTitle: "Consentement retiré",
      consentBody: "L’envoi est bloqué. Aucune donnée n’est transmise.",
      noStorageTitle: "Rien n’a été envoyé",
      noStorageBody: "La connexion a échoué et cet appareil ne peut pas garder la mesure. Réessayez une fois en ligne.",
      newMeasure: "Nouvelle mesure",
      history: "Voir l’historique",
      home: "Retour à l’accueil",
      storedWarning: "Stockage local indisponible : envoi direct, sans file d’attente.",
    },
  },
  reminders: {
    title: "Rappels de traitement",
    intro: "Indiquez si vous avez pris votre traitement. Une déclaration ne peut plus être modifiée ensuite.",
    upcoming: "À venir",
    past: "Passés",
    empty: "Aucun rappel programmé par votre équipe soignante.",
    due: "Prévu le",
    deliveryLabel: "Notification",
    delivery: {
      pending: "Envoi prévu",
      sent: "Notification envoyée",
      failed: "Échec de la notification",
      local: "Dans l’application seulement",
    } satisfies Record<Reminder["delivery"], string>,
    reportLabel: "Votre déclaration",
    notReported: "Non déclaré",
    taken: "Pris",
    notTaken: "Pas pris",
    confirmTaken: "Confirmer : pris",
    confirmNotTaken: "Confirmer : pas pris",
    confirmQuestion: "Cette déclaration sera définitive.",
    reportedOn: "Déclaré le",
    serverReceived: "Reçu par le serveur",
    localPending: "Déclaré sur cet appareil — pas encore envoyé",
    offlineList: "Liste enregistrée sur cet appareil ; elle a pu changer depuis.",
    unavailable: "Rappels indisponibles : hors ligne et sans copie sur cet appareil.",
  },
  history: {
    title: "Historique",
    unsentTitle: "Pas encore reçus par le serveur",
    unsentHint: "Ces éléments existent seulement sur cet appareil.",
    serverTitle: "Mesures reçues par le serveur",
    empty: "Aucune mesure reçue par le serveur.",
    source: "Source",
    delayed: "Mesure différée : heures de mesure et de réception éloignées.",
    alert: {
      new: "Alerte reçue par le serveur, pas encore vue par un médecin",
      acknowledged: "Alerte vue par un médecin",
      resolved: "Alerte traitée par un médecin",
      rejected: "Alerte écartée par un médecin",
    },
    priority: { orange: "Suivi", red: "Priorité haute" },
    reminderReport: "Déclaration de rappel",
    summaryLink: "Voir ma synthèse",
    ruleVersion: "Règle",
  },
  documents: {
    discarded: "L’accès à ce dossier a changé pendant l’envoi : la réponse n’est pas affichée. Vérifiez la liste des documents.",
    title: "Analyses",
    intro: "Envoyez un compte rendu d’analyse en PDF. Une valeur n’entre dans votre dossier comme résultat confirmé qu’après vérification par un médecin ayant accès.",
    limits: "PDF uniquement · 5 Mio maximum · 20 pages maximum (vérifié par le serveur).",
    fileLabel: "Document PDF",
    choose: "Choisir un PDF",
    send: "Envoyer le document",
    sending: "Envoi en cours… gardez cette page ouverte.",
    needsConnection: "L’envoi de documents nécessite une connexion ; il n’est pas mis en file d’attente.",
    errors: {
      notPdf: "Seuls les fichiers PDF sont acceptés.",
      tooLarge: (size: string) => `Fichier trop volumineux (${size}). Maximum 5 Mio.`,
      empty: "Le fichier est vide.",
      required: "Choisissez un fichier PDF.",
    },
    pendingTitle: "Fonction en cours d’intégration",
    pendingBody: "Le serveur n’accepte pas encore les documents. Rien n’a été envoyé.",
    receivedTitle: "Document reçu par le serveur",
    receivedBody: "Aucune valeur ne devient un résultat confirmé sans validation d’un médecin ayant accès à votre dossier.",
    proposed: ((n: number) =>
      n === 1 ? "1 valeur proposée, en attente de validation" : `${n} valeurs proposées, en attente de validation`) as Plural,
    listTitle: "Mes documents",
    listEmpty: "Aucun document envoyé.",
    uploadedAt: "Envoyé le",
    status: {
      processing: "Traitement en cours",
      review: "En attente de relecture",
      needs_manual_review: "Relecture manuelle nécessaire",
      reviewed: "Relu par un médecin",
      failed: "Échec du traitement",
    } satisfies Record<CareDocument["status"], string>,
    resultsTitle: "Résultats confirmés par un médecin",
    resultsEmpty: "Aucun résultat confirmé pour l’instant.",
    examDate: "Date de l’examen",
  },
  summary: {
    title: "Ma synthèse",
    factual: "Synthèse factuelle, sans IA",
    ai: "Synthèse assistée par IA (faits dé-identifiés)",
    facts: ((n: number) => (n === 1 ? "1 fait inclus" : `${n} faits inclus`)) as Plural,
    serverLanguage: "",
    deferral:
      "Pour toute question sur votre traitement, adressez-vous à votre médecin. Cette application ne modifie jamais votre traitement.",
    readAt: "Lue le",
    consentTitle: "Consentement et données",
    consentBody:
      "Vous pouvez retirer votre consentement. Vos mesures ne seront plus transmises et l’accès à votre dossier sera bloqué.",
    consentAction: "Retirer mon consentement",
    consentConfirmTitle: "Retirer votre consentement ?",
    consentConfirmBody:
      "Cette action est immédiate. Aucun médecin ne recevra plus vos mesures depuis cette application.",
    consentConfirm: "Oui, retirer",
    consentDone: "Consentement retiré. Déconnectez-vous pour effacer les données de cet appareil.",
  },
  logout: {
    unsentTitle: "Envois non transmis",
    unsentBody: (n: number) =>
      `${n} élément(s) enregistré(s) sur cet appareil n’ont pas été reçus par le serveur. En vous déconnectant, ils seront effacés de cet appareil et ne seront jamais envoyés.`,
    stay: "Rester connecté",
    purge: "Effacer et me déconnecter",
    purgeFailed: "Impossible d’effacer les données de cet appareil.",
    purgeFailedBody:
      "Vous restez connecté·e : la déconnexion n’a lieu qu’une fois ces données effacées. Fermez les autres onglets Santetrace, puis réessayez.",
    retryPurge: "Réessayer l’effacement",
    blockedTitle: "Déconnexion interrompue",
    blockedBody:
      "Les données de ce compte n’ont pas pu être effacées de cet appareil. Vous restez connecté·e. Fermez les autres onglets Santetrace, puis réessayez.",
    preparationFailedBody: "La déconnexion n’a pas pu être préparée. Vous restez connecté·e et rien n’a été effacé.",
    retryLogout: "Réessayer la déconnexion",
  },
};

export type Messages = typeof fr;

const ar: Messages = {
  common: {
    appName: "Santetrace",
    demo: "عرض تجريبي بمعطيات وهمية",
    demoRules: "حدود تجريبية غير مُصادَق عليها سريريًا.",
    loading: "جارٍ التحميل…",
    retry: "إعادة المحاولة",
    back: "رجوع",
    cancel: "إلغاء",
    close: "إغلاق",
    signInAgain: "تسجيل الدخول من جديد",
    fixedMessage: "رسالة ثابتة، دون ذكاء اصطناعي",
    measuredAt: "وقت القياس",
    receivedAt: "وقت الاستلام على الخادم",
    seeAll: "عرض الكل",
    refresh: "تحديث",
    dismiss: "إخفاء",
    required: "إلزامي",
  },
  nav: {
    home: "الرئيسية",
    measure: "قياس",
    reminders: "التذكيرات",
    history: "السجل",
    documents: "التحاليل",
    follow: "المتابعة",
    record: "الملف",
    plan: "الخطة",
    contact: "التواصل",
    ariaLabel: "تنقّل المريض",
  },
  language: {
    switchLabel: "Français",
    switchAria: "عرض التطبيق بالفرنسية",
  },
  connection: {
    online: "متصل",
    offline: "غير متصل",
    unreachable: "تعذّر الوصول إلى الخادم",
    syncedAgo: (when: string) => `بيانات الخادم: ${when}`,
    staleSince: (when: string) => `آخر رد من الخادم: ${when}`,
    deviceCopy: (date: string) => `نسخة محفوظة على هذا الجهاز بتاريخ ${date}، وقد لا تكون محدّثة.`,
    noServerData: "لا توجد بيانات من الخادم على هذا الجهاز.",
    sessionUnverified: "جلسة غير مؤكَّدة (دون اتصال)",
    sessionExpired: "انتهت الجلسة. الإرسالات المعلّقة باقية على هذا الجهاز.",
    consentRevoked: "تم سحب الموافقة: الوصول والإرسال موقوفان.",
    installed: "التطبيق مثبَّت",
    offlineReady: "يعمل دون اتصال",
  },
  outbox: {
    title: "الإرسالات من هذا الجهاز",
    waiting: (n: number) => `في انتظار الإرسال: ${n}`,
    failed: (n: number) => `مرفوضة: ${n}`,
    received: (n: number) => `استلمها الخادم: ${n}`,
    nothingPending: "لا توجد إرسالات معلّقة",
    retry: "إعادة الإرسال",
    retrying: "جارٍ الإرسال…",
    storageUnavailable: "التخزين المحلي غير متاح: لا يمكن الاحتفاظ بالإرسالات دون اتصال على هذا الجهاز.",
    state: {
      queued: "في انتظار الإرسال",
      sending: "جارٍ الإرسال",
      server_received: "استلمه الخادم",
      failed: "مرفوض — لم يُرسل",
    },
    notSent: "لم يُرسل",
    savedOnDevice: "محفوظ على هذا الجهاز",
    careTeamNotInformed: "لا يُرسل أي شيء إلى طبيب ما لم ينجح الإرسال.",
    discard: "حذف من هذا الجهاز",
    correct: "تصحيح",
    redacted: "موقوف: تم سحب الموافقة. حُذف المحتوى من هذا الجهاز ولم يُرسل أي شيء.",
    attempts: (n: number) => `عدد المحاولات: ${n}`,
    errors: {
      network: "لا يوجد اتصال. ستُعاد المحاولة تلقائيًا عند عودة الشبكة.",
      server: "لم يؤكد الخادم الاستلام. ستُعاد المحاولة تلقائيًا.",
      unavailable: "الخدمة غير متاحة بعد على الخادم. ستُعاد المحاولة لاحقًا.",
      unauthenticated: "انتهت الجلسة: سجّل الدخول من جديد للإرسال. لم يُحذف أي شيء.",
      consent_revoked: "تم سحب الموافقة: هذا الإرسال موقوف.",
      forbidden: "الوصول مرفوض لهذه الجلسة.",
      rejected: "رفضه الخادم.",
      conflict: "يتعارض مع تصريح سبق استلامه.",
    },
  },
  noReferent: {
    deliveryStep: "لا يوجد طبيب لديه وصول إلى تنبيهاتك",
    receivedNote: "سُجّل في ملفك. لا يوجد طبيب لديه وصول إلى تنبيهاتك: لا أحد يراه حاليًا.",
    alertCreated: "سُجّل تنبيه في ملفك. لا يوجد طبيب لديه وصول إلى تنبيهاتك: لا يُرسل إلى أحد.",
    statusOrange: "يوجد تنبيه متابعة مفتوح في ملفك. لا يوجد طبيب لديه وصول إلى تنبيهاتك حاليًا: ادعُ طبيبًا ليراجعه.",
    statusRed: "يوجد تنبيه ذو أولوية عالية مفتوح في ملفك. لا يوجد طبيب لديه وصول إلى تنبيهاتك: عند وجود أعراض خطيرة اتصل بالرقم 190 (الإسعاف).",
    historyAlertOpen: "تنبيه مسجَّل في ملفك — لا يوجد طبيب لديه وصول إلى تنبيهاتك",
    unknownTeam: "لا يستطيع التطبيق حاليًا تأكيد أن طبيبًا لديه وصول إلى تنبيهاتك.",
    invite: "دعوة طبيب",
  },
  delivery: {
    aria: "مراحل الإرسال",
    device: "أُدخل على هذا الجهاز",
    server: "استلمه الخادم",
    careTeam: "اطّلع عليه طبيب",
    notYet: "ليس بعد",
  },
  status: {
    title: "متابعتك",
    explain: {
      green: "آخر قياس استلمه الخادم لا يتجاوز أي حد أعلى تجريبي. القيم المنخفضة غير مُقيَّمة: لا يُنبَّه إلى قيمة منخفضة جدًا. هذا لا يعوّض الرأي الطبي.",
      orange: "يوجد تنبيه متابعة مفتوح في ملفك، وعلى فريق الرعاية مراجعته.",
      red: "يوجد تنبيه ذو أولوية عالية مفتوح في ملفك. في حال ظهور أعراض خطيرة، اتصل بخدمات الطوارئ المحلية.",
    },
    unknown: (hours: number) =>
      `معلومة ناقصة: لم يُستلم أي قياس خلال آخر ${hours} ساعة. هذا لا يعني أن كل شيء على ما يرام.`,
    serverOnly: "الحالة يحسبها الخادم، لا هذا الجهاز.",
    staleUnverified: (date: string) =>
      `حالة غير مؤكَّدة: آخر رد من الخادم بتاريخ ${date}. ربما تغيّرت منذ ذلك الحين، وهذا لا يعني أن كل شيء على ما يرام.`,
    staleAsOf: (date: string) => `آخر حالة معروفة، استُلمت من الخادم بتاريخ ${date}. ربما تغيّرت منذ ذلك الحين.`,
  },
  home: {
    greeting: (name: string) => (name ? `مرحبًا، ${name}` : "مرحبًا"),
    intro: "متابعة ضغط الدم وسكر الدم بين استشارتين.",
    latestTitle: "آخر قياس مستلَم",
    latestNone: "لم يستلم الخادم أي قياس حتى الآن.",
    lastMessageTitle: "بعد آخر إرسال",
    nextReminders: "التذكيرات القادمة",
    noReminders: "لا توجد تذكيرات قادمة.",
    measureCta: "قياس جديد",
    measureCtaHint: "ضغط الدم أو سكر الدم",
    summaryCta: "ملخّصي",
    documentsCta: "إرسال تحليل",
    historyCta: "السجل",
    noDataOffline: "لا يوجد اتصال ولا نسخة محفوظة على هذا الجهاز: لا يمكن عرض حالتك.",
  },
  measure: {
    title: "قياس جديد",
    steps: { form: "الإدخال", preview: "التحقّق", result: "النتيجة" },
    kindLabel: "ماذا تقيس؟",
    kindBp: "ضغط الدم",
    kindGlucose: "سكر الدم",
    systolic: "الانقباضي",
    systolicHint: "الرقم الأعلى",
    diastolic: "الانبساطي",
    diastolicHint: "الرقم الأدنى",
    glucoseValue: "سكر الدم",
    unitLabel: "الوحدة الظاهرة على جهاز القياس",
    unitHint: "لا نختار الوحدة بدلًا منك.",
    unitExample: { "mg/dL": "مثال: 126", "mmol/L": "مثال: 7.0" },
    timeLabel: "وقت القياس",
    timeHint: "الآن افتراضيًا. عدّله إذا أجريت القياس في وقت سابق.",
    timeNow: "الآن",
    continue: "التحقّق قبل الإرسال",
    delayedWarning: "قياس أقدم من 24 ساعة: سيُعلَّم كقياس متأخر.",
    errors: {
      required: "القيمة مطلوبة.",
      notNumber: "أدخل رقمًا.",
      notInteger: "أدخل عددًا صحيحًا.",
      range: (min: string, max: string, unit: string) => `القيمة المتوقعة بين ${min} و${max} (${unit}).`,
      systolicNotAbove: "يجب أن يكون الضغط الانقباضي أعلى من الانبساطي.",
      unitRequired: "اختر الوحدة الظاهرة على جهاز القياس.",
      looksLikeMmol: "تبدو هذه القيمة بوحدة mmol/L. تحقّق من الوحدة المختارة.",
      looksLikeMgdl: "تبدو هذه القيمة بوحدة mg/dL. تحقّق من الوحدة المختارة.",
      timeInvalid: "تاريخ ووقت غير صالحين.",
      timeFuture: "وقت القياس في المستقبل.",
      summary: "صحّح الحقول المشار إليها. لم يُرسل أي شيء.",
    },
    preview: {
      title: "تحقّق قبل الإرسال",
      intro: "هذا بالضبط ما سيُرسل إلى ملفك.",
      notSent: "لم يُرسل بعد",
      type: "النوع",
      value: "القيمة",
      unit: "الوحدة",
      time: "وقت القياس",
      edit: "تعديل",
      confirm: "تأكيد وإرسال",
      sending: "جارٍ الإرسال…",
      offlineNote: "لا يوجد اتصال: سيُحفظ القياس على هذا الجهاز ويُرسل عند عودة الاتصال.",
    },
    result: {
      receivedTitle: "استلم الخادم القياس",
      receivedNote: "الاستلام لا يعني الاطّلاع: يظهر القياس في لوحة فريق الرعاية.",
      alertCreated: "أُنشئ تنبيه في ملفك، ولم يطّلع عليه فريق الرعاية بعد.",
      queuedTitle: "محفوظ على هذا الجهاز",
      queuedBody: "لم يُرسل بعد. سيُرسل تلقائيًا عند عودة الاتصال.",
      localTitle: "تقييم محلي مؤقت",
      localBody: "حُسب على هذا الجهاز بالقواعد التجريبية المحفوظة. يبقى تقييم الخادم هو المرجع بعد الإرسال.",
      localRules: "القواعد",
      localSavedAt: "محفوظة بتاريخ",
      localStatus: {
        green: "لم يُتجاوز أي حد أعلى تجريبي (مؤقت)؛ القيم المنخفضة غير مُقيَّمة.",
        orange: "أعلى من حد المتابعة التجريبي (مؤقت).",
        red: "أعلى من الحد المرتفع التجريبي (مؤقت).",
      },
      emergency: "في حال ظهور أعراض خطيرة، اتصل بخدمات الطوارئ المحلية.",
      conversion: "تحويل محلي (المعامل 18):",
      noRules: "في الانتظار: لا توجد قواعد محفوظة على هذا الجهاز، لذا لا يوجد تقييم محلي.",
      failedTitle: "رُفض القياس — لم يُسجَّل أي شيء",
      failedBody: "صحّح القياس ثم أعد إرساله.",
      sessionTitle: "انتهت الجلسة",
      sessionBody: "يبقى القياس على هذا الجهاز. سجّل الدخول من جديد لإرساله.",
      consentTitle: "تم سحب الموافقة",
      consentBody: "الإرسال موقوف. لا تُنقل أي بيانات.",
      noStorageTitle: "لم يُرسل أي شيء",
      noStorageBody: "فشل الاتصال ولا يستطيع هذا الجهاز الاحتفاظ بالقياس. أعد المحاولة عند الاتصال.",
      newMeasure: "قياس جديد",
      history: "عرض السجل",
      home: "العودة إلى الرئيسية",
      storedWarning: "التخزين المحلي غير متاح: إرسال مباشر دون قائمة انتظار.",
    },
  },
  reminders: {
    title: "تذكيرات العلاج",
    intro: "صرّح إن كنت قد تناولت علاجك. لا يمكن تعديل التصريح بعد ذلك.",
    upcoming: "القادمة",
    past: "السابقة",
    empty: "لم يبرمج فريق الرعاية أي تذكير.",
    due: "الموعد",
    deliveryLabel: "الإشعار",
    delivery: {
      pending: "الإرسال مبرمج",
      sent: "أُرسل الإشعار",
      failed: "فشل الإشعار",
      local: "داخل التطبيق فقط",
    },
    reportLabel: "تصريحك",
    notReported: "لم يُصرَّح به",
    taken: "تناولته",
    notTaken: "لم أتناوله",
    confirmTaken: "تأكيد: تناولته",
    confirmNotTaken: "تأكيد: لم أتناوله",
    confirmQuestion: "سيكون هذا التصريح نهائيًا.",
    reportedOn: "تاريخ التصريح",
    serverReceived: "استلمه الخادم",
    localPending: "صُرّح به على هذا الجهاز — لم يُرسل بعد",
    offlineList: "قائمة محفوظة على هذا الجهاز، وقد تكون تغيّرت.",
    unavailable: "التذكيرات غير متاحة: لا يوجد اتصال ولا نسخة على هذا الجهاز.",
  },
  history: {
    title: "السجل",
    unsentTitle: "لم يستلمها الخادم بعد",
    unsentHint: "هذه العناصر موجودة على هذا الجهاز فقط.",
    serverTitle: "قياسات استلمها الخادم",
    empty: "لم يستلم الخادم أي قياس.",
    source: "المصدر",
    delayed: "قياس متأخر: فارق كبير بين وقت القياس ووقت الاستلام.",
    alert: {
      new: "تنبيه استلمه الخادم، ولم يطّلع عليه أي طبيب بعد",
      acknowledged: "اطّلع طبيب على التنبيه",
      resolved: "عالج طبيب التنبيه",
      rejected: "استبعد طبيب التنبيه",
    },
    priority: { orange: "متابعة", red: "أولوية عالية" },
    reminderReport: "تصريح تذكير",
    summaryLink: "عرض ملخّصي",
    ruleVersion: "القاعدة",
  },
  documents: {
    discarded: "تغيّر الوصول إلى هذا الملف أثناء الإرسال: لا يُعرض الرد. تحقّق من قائمة المستندات.",
    title: "التحاليل",
    intro: "أرسل تقرير تحليل بصيغة PDF. لا تُضاف أي قيمة إلى ملفك كنتيجة مؤكَّدة إلا بعد تحقّق طبيب لديه وصول.",
    limits: "ملفات PDF فقط · 5 ميغابايت كحد أقصى · 20 صفحة كحد أقصى (يتحقّق منها الخادم).",
    fileLabel: "مستند PDF",
    choose: "اختيار ملف PDF",
    send: "إرسال المستند",
    sending: "جارٍ الإرسال… أبقِ هذه الصفحة مفتوحة.",
    needsConnection: "يتطلب إرسال المستندات اتصالًا، ولا يُحفظ في قائمة الانتظار.",
    errors: {
      notPdf: "تُقبل ملفات PDF فقط.",
      tooLarge: (size: string) => `الملف كبير جدًا (${size}). الحد الأقصى 5 ميغابايت.`,
      empty: "الملف فارغ.",
      required: "اختر ملف PDF.",
    },
    pendingTitle: "الخدمة قيد الإدماج",
    pendingBody: "لا يقبل الخادم المستندات بعد. لم يُرسل أي شيء.",
    receivedTitle: "استلم الخادم المستند",
    receivedBody: "لا تصبح أي قيمة نتيجة مؤكَّدة دون مصادقة طبيب لديه وصول إلى ملفك.",
    proposed: (n: number) => `قيم مقترحة في انتظار المصادقة: ${n}`,
    listTitle: "مستنداتي",
    listEmpty: "لم ترسل أي مستند.",
    uploadedAt: "تاريخ الإرسال",
    status: {
      processing: "قيد المعالجة",
      review: "في انتظار المراجعة",
      needs_manual_review: "تتطلب مراجعة يدوية",
      reviewed: "راجعه طبيب",
      failed: "فشلت المعالجة",
    },
    resultsTitle: "نتائج أكّدها طبيب",
    resultsEmpty: "لا توجد نتائج مؤكَّدة حتى الآن.",
    examDate: "تاريخ الفحص",
  },
  summary: {
    title: "ملخّصي",
    factual: "ملخّص وقائعي، دون ذكاء اصطناعي",
    ai: "ملخّص بمساعدة الذكاء الاصطناعي (وقائع مجهولة الهوية)",
    facts: (n: number) => `عدد الوقائع المدرجة: ${n}`,
    serverLanguage: "النص التالي صادر عن الخادم باللغة الفرنسية.",
    deferral: "لأي سؤال حول علاجك، توجّه إلى طبيبك. هذا التطبيق لا يغيّر علاجك أبدًا.",
    readAt: "وقت القراءة",
    consentTitle: "الموافقة والبيانات",
    consentBody: "يمكنك سحب موافقتك. لن تُرسل قياساتك بعد ذلك وسيُوقف الوصول إلى ملفك.",
    consentAction: "سحب موافقتي",
    consentConfirmTitle: "هل تريد سحب موافقتك؟",
    consentConfirmBody: "هذا الإجراء فوري. لن يستلم أي طبيب قياساتك من هذا التطبيق بعد الآن.",
    consentConfirm: "نعم، اسحب الموافقة",
    consentDone: "تم سحب الموافقة. سجّل الخروج لحذف البيانات من هذا الجهاز.",
  },
  logout: {
    unsentTitle: "إرسالات لم تُنقل",
    unsentBody: (n: number) =>
      `عناصر محفوظة على هذا الجهاز لم يستلمها الخادم: ${n}. عند تسجيل الخروج ستُحذف من هذا الجهاز ولن تُرسل أبدًا.`,
    stay: "البقاء متصلًا",
    purge: "حذف وتسجيل الخروج",
    purgeFailed: "تعذّر حذف بيانات هذا الجهاز.",
    purgeFailedBody: "ما زلت متصلًا: لا يتم تسجيل الخروج إلا بعد حذف هذه البيانات. أغلق علامات تبويب Santetrace الأخرى ثم أعد المحاولة.",
    retryPurge: "إعادة محاولة الحذف",
    blockedTitle: "توقّف تسجيل الخروج",
    blockedBody: "تعذّر حذف بيانات هذا الحساب من هذا الجهاز. ما زلت متصلًا. أغلق علامات تبويب Santetrace الأخرى ثم أعد المحاولة.",
    preparationFailedBody: "تعذّر تحضير تسجيل الخروج. ما زلت متصلًا ولم يُحذف أي شيء.",
    retryLogout: "إعادة محاولة تسجيل الخروج",
  },
};

const MESSAGES: Record<Language, Messages> = { fr, ar };

export function getMessages(lang: Language): Messages {
  return MESSAGES[lang];
}

// ---------------------------------------------------------------------------
// Language preference
// ---------------------------------------------------------------------------

const STORAGE_KEY = "hackcure:patient-language";

function isLanguage(value: unknown): value is Language {
  return value === "fr" || value === "ar";
}

export function readStoredLanguage(): Language | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredLanguage(lang: Language): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
    return true;
  } catch {
    // Private mode: the choice still applies for this visit.
    return false;
  }
}

export interface LanguagePreference {
  lang: Language;
  /** True once the device preference has been read (avoids a hydration mismatch). */
  ready: boolean;
  hasStoredPreference: boolean;
  /** Explicit user choice: applied and persisted on this device. */
  setLanguage: (lang: Language) => void;
  /** Server default (patient.language): applied only when no preference is stored. */
  adoptDefault: (lang: Language) => void;
  t: Messages;
}

export function useLanguagePreference(): LanguagePreference {
  const [lang, setLang] = useState<Language>("fr");
  const [ready, setReady] = useState(false);
  const [hasStoredPreference, setHasStoredPreference] = useState(false);
  const storedRef = useRef(false);

  useEffect(() => {
    const stored = readStoredLanguage();
    if (stored) {
      storedRef.current = true;
      setHasStoredPreference(true);
      setLang(stored);
    }
    setReady(true);
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && isLanguage(event.newValue)) {
        storedRef.current = true;
        setHasStoredPreference(true);
        setLang(event.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setLanguage = useCallback((next: Language) => {
    storedRef.current = true;
    setHasStoredPreference(true);
    setLang(next);
    writeStoredLanguage(next);
  }, []);

  const adoptDefault = useCallback((next: Language) => {
    if (!storedRef.current) setLang(next);
  }, []);

  const t = useMemo(() => getMessages(lang), [lang]);

  return { lang, ready, hasStoredPreference, setLanguage, adoptDefault, t };
}

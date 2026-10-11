/**
 * Feature 006 lot C copy: patient assistant, approved advice and protocol
 * application states as the patient sees them. Clinician protocol screens are
 * French-only (doctor UI convention) and use `ASSIST_COPY.fr.protocol*`.
 * French source, MSA Arabic pending fluent review. `ar` is typed `typeof fr`.
 */
import type { AssistantInput, AssistantResponse, ProtocolApplication, ReusableProtocol } from "@/contracts/monitoring";
import type { Language } from "../transport";

type RecordTopic = Extract<AssistantInput, { kind: "record_query" }>["topic"];

const fr = {
  assistant: {
    title: "Questions sur mon suivi",
    description: "L’assistant explique votre dossier et vos consignes déjà validées. Il ne donne aucune nouvelle consigne médicale.",
    topicsTitle: "Questions rapides",
    topic: {
      next_action: "Quelle est ma prochaine action ?",
      last_measurement: "Quelle est ma dernière mesure ?",
      plan_status: "Où en est mon plan ?",
    } satisfies Record<RecordTopic, string>,
    freeTitle: "Une autre question ou un changement de santé",
    freeLabel: "Votre question",
    freeHint: "Une question médicale ou un changement (nouveau symptôme, nouveau traitement) est transmis à votre médecin pour revue, s’il a accès à vos messages.",
    kindQuestion: "Question",
    kindUpdate: "Changement de santé",
    ask: "Envoyer",
    asking: "Réponse en cours…",
    emptyQuestion: "Écrivez votre question.",
    tooLong: "Question trop longue (2 000 caractères au plus).",
    replyKind: {
      record_answer: "Réponse tirée de votre dossier",
      approved_action: "Consigne déjà validée par votre médecin",
      needs_clinician: "Nécessite votre médecin",
      unavailable: "Assistant indisponible",
    } satisfies Record<AssistantResponse["replyKind"], string>,
    messageRecorded: "Votre question est enregistrée comme message pour votre médecin. Elle n’a pas encore été lue.",
    noRecipientPending: "Aucun médecin ne peut recevoir cette question pour l’instant : rien n’a été transmis.",
    unavailableBody: "L’assistant IA est indisponible. Votre plan, vos rappels et les messages fixes restent utilisables.",
    offline: "Hors ligne : l’assistant nécessite une connexion. Aucune réponse n’est inventée.",
    noAdvice: "L’assistant ne propose ni diagnostic, ni dose, ni nouveau traitement.",
    sourcesTitle: "D’après",
    noReferent: "Sans médecin référent, l’assistant peut seulement lire votre dossier.",
  },
  advice: {
    title: "Consigne validée",
    approvedOnce: "Validée une fois par votre médecin",
    protocolApplied: (version: number) => `Appliquée selon le protocole validé par le médecin (version ${version})`,
    conditionsTitle: "Conditions vérifiées",
    blockedTitle: "Non appliquée — revue demandée",
    blockedBody: "La situation a changé ou une condition n’est plus remplie. Votre médecin doit réexaminer avant toute nouvelle consigne.",
    readNotDone: "Avoir lu une consigne ne signifie pas l’avoir faite.",
  },
  applicationState: {
    authorized: "Autorisée",
    blocked: "Bloquée — revue demandée",
    delivered: "Transmise dans l’application",
    expired: "Expirée",
    not_triggered: "Non déclenchée : conditions non réunies, aucune action créée",
  } satisfies Record<ProtocolApplication["state"], string>,
  protocolState: {
    active: "Protocole actif",
    suspended: "Protocole suspendu",
    revoked: "Protocole retiré",
    expired: "Protocole expiré",
  } satisfies Record<ReusableProtocol["state"], string>,
  reminders: {
    planLink: "Voir mon plan",
    readIsNotDone: "Lire un rappel ne le marque pas comme fait : déclarez-le explicitement.",
  },
};

export type AssistCopy = typeof fr;

const ar: AssistCopy = {
  assistant: {
    title: "أسئلة حول متابعتي",
    description: "يشرح المساعد ملفك وتعليماتك المعتمدة مسبقًا. لا يقدّم أي تعليمة طبية جديدة.",
    topicsTitle: "أسئلة سريعة",
    topic: {
      next_action: "ما هو إجرائي التالي؟",
      last_measurement: "ما هو آخر قياس لي؟",
      plan_status: "أين وصلت خطتي؟",
    },
    freeTitle: "سؤال آخر أو تغيّر في الصحة",
    freeLabel: "سؤالك",
    freeHint: "يُرسل السؤال الطبي أو التغيّر (عَرَض جديد، علاج جديد) إلى طبيبك للمراجعة، إن كانت لديه صلاحية الاطلاع على رسائلك.",
    kindQuestion: "سؤال",
    kindUpdate: "تغيّر في الصحة",
    ask: "إرسال",
    asking: "جارٍ الرد…",
    emptyQuestion: "اكتب سؤالك.",
    tooLong: "السؤال طويل جدًا (2000 حرف كحد أقصى).",
    replyKind: {
      record_answer: "إجابة مأخوذة من ملفك",
      approved_action: "تعليمة اعتمدها طبيبك مسبقًا",
      needs_clinician: "يتطلب طبيبك",
      unavailable: "المساعد غير متاح",
    },
    messageRecorded: "سُجّل سؤالك كرسالة إلى طبيبك. لم يُقرأ بعد.",
    noRecipientPending: "لا يوجد طبيب يمكنه استلام هذا السؤال حاليًا: لم يُرسل أي شيء.",
    unavailableBody: "المساعد الذكي غير متاح. تبقى خطتك وتذكيراتك والرسائل الثابتة قابلة للاستعمال.",
    offline: "دون اتصال: يتطلب المساعد اتصالًا. لا تُختلق أي إجابة.",
    noAdvice: "لا يقترح المساعد تشخيصًا ولا جرعة ولا علاجًا جديدًا.",
    sourcesTitle: "استنادًا إلى",
    noReferent: "دون طبيب مرجعي، يستطيع المساعد فقط قراءة ملفك.",
  },
  advice: {
    title: "تعليمة معتمدة",
    approvedOnce: "اعتمدها طبيبك مرة واحدة",
    protocolApplied: (version: number) => `طُبّقت حسب البروتوكول الذي اعتمده الطبيب (النسخة ${version})`,
    conditionsTitle: "الشروط المتحقَّق منها",
    blockedTitle: "لم تُطبَّق — طُلبت مراجعة",
    blockedBody: "تغيّر الوضع أو لم يعد أحد الشروط متوفرًا. يجب أن يراجع طبيبك قبل أي تعليمة جديدة.",
    readNotDone: "قراءة التعليمة لا تعني إنجازها.",
  },
  applicationState: {
    authorized: "مأذون بها",
    blocked: "محجوبة — طُلبت مراجعة",
    delivered: "أُرسلت داخل التطبيق",
    expired: "منتهية الصلاحية",
    not_triggered: "لم تُفعَّل: الشروط غير مستوفاة، لم يُنشأ أي إجراء",
  },
  protocolState: {
    active: "بروتوكول مفعَّل",
    suspended: "بروتوكول معلَّق",
    revoked: "بروتوكول مسحوب",
    expired: "بروتوكول منتهي الصلاحية",
  },
  reminders: {
    planLink: "عرض خطتي",
    readIsNotDone: "قراءة التذكير لا تعني إنجازه: صرّح بذلك صراحة.",
  },
};

export const ASSIST_COPY: Record<Language, AssistCopy> = { fr, ar };

/**
 * FR/AR display of the server's monitoring reasons. The evaluator emits
 * English sentences (some with values); until a closed reason-code registry
 * exists (claude-questions Q18), known sentences and templates are mapped
 * here. Anything unknown is returned verbatim and flagged `translated: false`
 * so the UI renders it with lang="en" instead of pretending it is French.
 */
import type { Language } from "../transport";

export interface ReasonText {
  text: string;
  translated: boolean;
}

type Table = Record<string, { fr: string; ar: string }>;

const EXACT: Table = {
  "Current complete coverage is required across every recorded condition before global green.": {
    fr: "Pas de vert global sans données à jour pour chaque condition enregistrée.",
    ar: "لا يوجد أخضر عام دون بيانات محدَّثة لكل حالة مسجَّلة.",
  },
  "No current condition evaluations are available.": {
    fr: "Aucune évaluation de suivi n’est encore disponible.",
    ar: "لا يوجد أي تقييم متابعة متاح بعد.",
  },
  "The clinician plan review deadline has passed.": {
    fr: "La date de revue du plan par le médecin est dépassée (le silence ne vaut pas accord).",
    ar: "تجاوز موعد مراجعة الطبيب للخطة (الصمت لا يعني الموافقة).",
  },
  "The plan review deadline is invalid.": { fr: "La date de revue du plan est invalide.", ar: "موعد مراجعة الخطة غير صالح." },
  "The rule pack has no compatible measurement requirement.": {
    fr: "Le profil de démonstration n’a pas de mesure compatible.",
    ar: "لا يحتوي الملف التجريبي على قياس متوافق.",
  },
  "Unresolved alert episodes remain open until an explicit clinician decision.": {
    fr: "Un épisode d’alerte reste ouvert jusqu’à une décision explicite du médecin.",
    ar: "يبقى حدث التنبيه مفتوحًا حتى قرار صريح من الطبيب.",
  },
  "No active clinician-approved monitoring plan is available.": {
    fr: "Aucun plan de suivi validé par un médecin n’est actif.",
    ar: "لا توجد خطة متابعة مفعَّلة يعتمدها طبيب.",
  },
  "No admitted monitoring profile covers the recorded condition code.": {
    fr: "Aucun profil de suivi ne couvre cette condition : couverture inconnue.",
    ar: "لا يغطي أي ملف متابعة هذه الحالة: التغطية غير معروفة.",
  },
  "The condition declaration is not admitted for demonstration monitoring.": {
    fr: "Cette déclaration de condition n’est pas admise pour le suivi de démonstration.",
    ar: "هذا التصريح بالحالة غير مقبول في المتابعة التجريبية.",
  },
  "The condition is absent, uncertain, negated, or superseded; no condition rule is selected.": {
    fr: "Condition absente, incertaine, niée ou remplacée : aucune règle n’est appliquée.",
    ar: "الحالة غائبة أو غير مؤكدة أو منفية أو مستبدلة: لا تُطبَّق أي قاعدة.",
  },
  "The demonstration profile does not cover the whole condition or establish a diagnosis.": {
    fr: "Le profil de démonstration ne couvre pas toute la maladie et n’établit aucun diagnostic.",
    ar: "لا يغطي الملف التجريبي المرض بأكمله ولا يضع أي تشخيص.",
  },
  "The demonstration rule pack or its copied thresholds are invalid.": {
    fr: "Les seuils de démonstration de ce profil sont invalides.",
    ar: "الحدود التجريبية لهذا الملف غير صالحة.",
  },
  "The evidence snapshot belongs to another patient or has a changed revision guard.": {
    fr: "Les données évaluées ne correspondent plus à l’état actuel du dossier.",
    ar: "البيانات المُقيَّمة لم تعد تطابق الحالة الحالية للملف.",
  },
  "The plan revision or approved condition profile binding does not match the snapshot.": {
    fr: "Le plan a changé depuis cette évaluation.",
    ar: "تغيّرت الخطة منذ هذا التقييم.",
  },
  "The profile version differs from the guarded snapshot.": {
    fr: "La version du profil a changé depuis cette évaluation.",
    ar: "تغيّرت نسخة الملف منذ هذا التقييم.",
  },
  "Pulse recorded in bpm; no demonstration scoring profile.": {
    fr: "Pouls enregistré en bpm : aucun profil ne l’évalue.",
    ar: "سُجّل النبض بوحدة bpm: لا يقيّمه أي ملف.",
  },
  "Delayed measurement; measured and received times differ.": {
    fr: "Mesure transmise en différé : heure de mesure et heure de réception diffèrent.",
    ar: "قياس مُرسل متأخرًا: يختلف وقت القياس عن وقت الاستلام.",
  },
  "A valid evaluation timestamp is required.": { fr: "Horodatage d’évaluation invalide.", ar: "وقت التقييم غير صالح." },
};

/** Requirement gap details (after "Requirement <id>: "). */
const GAP: Table = {
  "freshness or admitted verification policy is invalid.": {
    fr: "règle de fraîcheur ou de vérification invalide.",
    ar: "قاعدة الحداثة أو التحقق غير صالحة.",
  },
  "no sourced evidence is available.": { fr: "aucune donnée sourcée disponible.", ar: "لا توجد أي بيانات مرتبطة بمصدر." },
  "conflicting source revisions or metadata refer to the same evidence.": {
    fr: "versions de source contradictoires pour la même donnée.",
    ar: "نسخ مصادر متعارضة للمعطى نفسه.",
  },
  "the evidence polarity is not affirmed.": { fr: "la donnée n’est pas affirmée.", ar: "المعطى غير مؤكَّد." },
  "the latest source has not reached the required verification.": {
    fr: "la dernière donnée n’a pas le niveau de vérification requis.",
    ar: "آخر معطى لم يبلغ مستوى التحقق المطلوب.",
  },
  "the source time is invalid or in the future.": { fr: "date de la source invalide ou future.", ar: "تاريخ المصدر غير صالح أو في المستقبل." },
  "the immutable reading and its source snapshot do not match.": {
    fr: "la mesure et sa source ne concordent pas.",
    ar: "القياس ومصدره غير متطابقين.",
  },
  "the latest reading is suspect or unscored.": {
    fr: "la dernière mesure est suspecte ou non évaluée.",
    ar: "آخر قياس مشكوك فيه أو غير مُقيَّم.",
  },
  "the freshness deadline is invalid.": { fr: "délai de fraîcheur invalide.", ar: "مهلة الحداثة غير صالحة." },
  "the latest admitted evidence has expired.": { fr: "la dernière donnée admise est trop ancienne.", ar: "آخر معطى مقبول قديم جدًا." },
  "the measurement kind, unit, or numeric values are outside the rule pack.": {
    fr: "type, unité ou valeur hors du profil de démonstration.",
    ar: "النوع أو الوحدة أو القيمة خارج الملف التجريبي.",
  },
};

const VALUE_LABEL: Record<string, { fr: string; ar: string }> = {
  Systolic: { fr: "Systolique", ar: "الانقباضي" },
  Diastolic: { fr: "Diastolique", ar: "الانبساطي" },
  Glucose: { fr: "Glycémie", ar: "السكر" },
};

type Pattern = { match: RegExp; render: (m: RegExpMatchArray, lang: Language) => string | null };

const PATTERNS: Pattern[] = [
  {
    // "Systolic 182 mmHg >= 180 mmHg (red; demo rule demo-1)."
    match: /^(Systolic|Diastolic|Glucose) ([\d.]+) (\S+) >= ([\d.]+) (\S+) \((red|orange); demo rule ([^)]+)\)\.$/,
    render: (m, lang) => {
      const label = VALUE_LABEL[m[1]]?.[lang];
      if (!label) return null;
      const level = m[6] === "red" ? (lang === "fr" ? "priorité haute" : "أولوية عالية") : lang === "fr" ? "suivi requis" : "متابعة مطلوبة";
      return lang === "fr"
        ? `${label} ${m[2]} ${m[3]} ≥ seuil ${m[4]} ${m[5]} (${level} ; règle de démonstration ${m[7]}).`
        : `${label} ${m[2]} ${m[3]} ≥ الحد ${m[4]} ${m[5]} (${level}؛ قاعدة تجريبية ${m[7]}).`;
    },
  },
  {
    match: /^No high demonstration threshold crossed \(demo rule ([^)]+)\); lower directions remain unassessed\.$/,
    render: (m, lang) =>
      lang === "fr"
        ? `Aucun seuil haut de démonstration dépassé (règle ${m[1]}) ; les valeurs basses ne sont pas évaluées.`
        : `لم يُتجاوز أي حد أعلى تجريبي (القاعدة ${m[1]})؛ القيم المنخفضة غير مُقيَّمة.`,
  },
  {
    match: /^Low (blood pressure|glucose) direction is not assessed( by this high-only demonstration profile)?\.$/,
    render: (m, lang) => {
      const bp = m[1] === "blood pressure";
      return lang === "fr"
        ? `Les valeurs basses ${bp ? "de tension" : "de glycémie"} ne sont pas évaluées par ce profil de démonstration.`
        : `القيم المنخفضة ${bp ? "لضغط الدم" : "للسكر"} غير مُقيَّمة في هذا الملف التجريبي.`;
    },
  },
  {
    match: /^Conversion: ([\d.]+) (\S+) = ([\d.]+) (\S+) \(factor 18\)\.?$/,
    render: (m, lang) =>
      lang === "fr" ? `Conversion : ${m[1]} ${m[2]} = ${m[3]} ${m[4]} (facteur 18).` : `تحويل: ${m[1]} ${m[2]} = ${m[3]} ${m[4]} (المعامل 18).`,
  },
  {
    match: /^Requirement (\S+): (.+)$/,
    render: (m, lang) => {
      const gap = Object.hasOwn(GAP, m[2]) ? GAP[m[2]][lang] : null;
      if (!gap) return null;
      return lang === "fr" ? `Exigence ${m[1]} : ${gap}` : `المتطلب ${m[1]}: ${gap}`;
    },
  },
];

/** Translated reason, or the original text flagged untranslated. */
export function reasonText(reason: string, lang: Language): ReasonText {
  if (Object.hasOwn(EXACT, reason)) return { text: EXACT[reason][lang], translated: true };
  for (const pattern of PATTERNS) {
    const match = reason.match(pattern.match);
    if (!match) continue;
    const text = pattern.render(match, lang);
    if (text) return { text, translated: true };
  }
  return { text: reason, translated: false };
}

/** Label shown next to an untranslated server reason. */
export const UNTRANSLATED_REASON: Record<Language, string> = {
  fr: "Texte technique du serveur (non traduit)",
  ar: "نص تقني من الخادم (غير مترجم)",
};

/**
 * An evaluation time the UI may display. The server uses the Unix epoch as a
 * "never evaluated" sentinel; that, or an unparsable value, returns null so
 * the screen says "not yet evaluated" instead of showing a 1970 date or a
 * "57 years ago" relative time. Never substitute another time.
 */
export function displayableEvaluationTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time) || time <= 0) return null;
  // Anything before 2000 cannot be a real evaluation in this prototype.
  if (time < Date.UTC(2000, 0, 1)) return null;
  return iso;
}

import type { CareStatus, Priority } from "./contract";
import type { AnyIconName } from "./icons";

interface StatusMeta {
  readonly label: string;
  readonly icon: AnyIconName;
}

/**
 * Default French wording and glyph for each care status. Each status has a
 * distinct icon shape so meaning never depends on colour alone.
 */
export const CARE_STATUS_META: Readonly<Record<CareStatus, StatusMeta>> = {
  green: { label: "Aucun seuil haut dépassé (démo)", icon: "minus" },
  orange: { label: "Suivi requis", icon: "alert-triangle" },
  red: { label: "Priorité haute", icon: "alert-octagon" },
  unknown: { label: "Inconnu — données manquantes", icon: "help-circle" },
};

export const PRIORITY_META: Readonly<Record<Priority, StatusMeta>> = {
  orange: { label: "Priorité orange", icon: "alert-triangle" },
  red: { label: "Priorité rouge", icon: "alert-octagon" },
};

/** Arabic labels, offered for convenience; callers may pass their own `label`. */
export const CARE_STATUS_LABELS_AR: Readonly<Record<CareStatus, string>> = {
  green: "لم يُتجاوز أي حد أعلى (تجريبي)",
  orange: "تتطلب متابعة",
  red: "أولوية عالية",
  unknown: "غير معروف — بيانات ناقصة",
};

export const PRIORITY_LABELS_AR: Readonly<Record<Priority, string>> = {
  orange: "أولوية برتقالية",
  red: "أولوية حمراء",
};

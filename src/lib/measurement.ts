/** Parses submission format only; these bounds are not clinical thresholds. */
export function parseBloodPressure(text: string): { systolic: number; diastolic: number } {
  const normalized = text.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
  const match = /^\s*([0-9]{1,3})\s*\/\s*([0-9]{1,3})\s*(?:mmHg)?\s*$/.exec(normalized);
  const formatError = () => new Error('Format invalide : utilisez deux entiers, par exemple 165/100 mmHg.');
  if (!match) throw formatError();

  const systolic = Number(match[1]);
  const diastolic = Number(match[2]);
  if (systolic < 40 || systolic > 300 || diastolic < 20 || diastolic > 200 || systolic <= diastolic) {
    throw formatError();
  }
  return { systolic, diastolic };
}

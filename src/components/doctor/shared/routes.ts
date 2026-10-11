/** Clinician URLs. Ids are encoded; candidate deep links use the fragment only. */
export function patientHref(patientId: string, section?: string): string {
  const base = `/doctor/patients/${encodeURIComponent(patientId)}`;
  return section ? `${base}#${section}` : base;
}

export function reviewHref(patientId: string, documentId: string, candidateId?: string): string {
  const base = `${patientHref(patientId)}/documents/${encodeURIComponent(documentId)}`;
  return candidateId ? `${base}#candidate-${encodeURIComponent(candidateId)}` : base;
}

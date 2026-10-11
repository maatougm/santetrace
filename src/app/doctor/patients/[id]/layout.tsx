import type { ReactNode } from "react";
import { PatientAccessScope } from "@/components/doctor/PatientAccessScope";

/** Shared fenced record poll for every clinician view of this patient. */
export default async function DoctorPatientLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PatientAccessScope patientId={id}>{children}</PatientAccessScope>;
}

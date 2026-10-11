import { PatientRecordView } from "@/components/doctor/record/PatientRecordView";

export default async function PatientRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PatientRecordView patientId={id} />;
}

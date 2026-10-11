import type { Metadata } from "next";
import { RecordHub } from "@/components/patient/record/RecordHub";

export const metadata: Metadata = { title: "Mon dossier" };

export default function PatientRecordPage() {
  return <RecordHub />;
}

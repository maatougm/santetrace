import type { Metadata } from "next";
import { DocumentsScreen } from "@/components/patient/DocumentsScreen";

export const metadata: Metadata = { title: "Analyses" };

export default function PatientDocumentsPage() {
  return <DocumentsScreen />;
}

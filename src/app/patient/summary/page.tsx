import type { Metadata } from "next";
import { SummaryScreen } from "@/components/patient/SummaryScreen";

export const metadata: Metadata = { title: "Ma synthèse" };

export default function PatientSummaryPage() {
  return <SummaryScreen />;
}

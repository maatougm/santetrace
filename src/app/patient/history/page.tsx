import type { Metadata } from "next";
import { HistoryScreen } from "@/components/patient/HistoryScreen";

export const metadata: Metadata = { title: "Historique" };

export default function PatientHistoryPage() {
  return <HistoryScreen />;
}

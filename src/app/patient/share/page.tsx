import type { Metadata } from "next";
import { ShareScreen } from "@/components/patient/share/ShareScreen";

export const metadata: Metadata = { title: "Partager avec un médecin externe" };

export default function PatientSharePage() {
  return <ShareScreen />;
}

import type { Metadata } from "next";
import { AssistantScreen } from "@/components/patient/plan/AssistantScreen";

export const metadata: Metadata = { title: "Questions sur mon suivi" };

export default function PatientAssistantPage() {
  return <AssistantScreen />;
}

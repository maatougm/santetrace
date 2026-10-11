import type { Metadata } from "next";
import { OnboardingScreen } from "@/components/patient/record/OnboardingScreen";

export const metadata: Metadata = { title: "Questions d’accueil" };

export default function PatientOnboardingPage() {
  return <OnboardingScreen />;
}

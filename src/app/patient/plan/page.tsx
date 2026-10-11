import type { Metadata } from "next";
import { PlanScreen } from "@/components/patient/plan/PlanScreen";

export const metadata: Metadata = { title: "Plan" };

export default function PatientPlanPage() {
  return <PlanScreen />;
}

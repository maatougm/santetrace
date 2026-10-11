import type { Metadata } from "next";
import { RemindersScreen } from "@/components/patient/RemindersScreen";

export const metadata: Metadata = { title: "Rappels" };

export default function PatientRemindersPage() {
  return <RemindersScreen />;
}

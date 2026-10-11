import type { Metadata } from "next";
import { DoctorAccessScreen } from "@/components/patient/access/DoctorAccessScreen";

export const metadata: Metadata = { title: "Médecins et accès" };

export default function PatientDoctorsPage() {
  return <DoctorAccessScreen />;
}

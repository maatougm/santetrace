import type { Metadata } from "next";
import { MeasureScreen } from "@/components/patient/MeasureScreen";

export const metadata: Metadata = { title: "Nouvelle mesure" };

export default function PatientMeasurePage() {
  return <MeasureScreen />;
}

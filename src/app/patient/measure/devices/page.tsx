import type { Metadata } from "next";
import { SimulatorPanel } from "@/components/patient/devices/SimulatorPanel";

export const metadata: Metadata = { title: "Appareils et simulateur" };

export default function PatientDevicesPage() {
  return <SimulatorPanel />;
}

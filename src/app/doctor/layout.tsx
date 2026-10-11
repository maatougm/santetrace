import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ClinicianShell } from "@/components/layout";

export const metadata: Metadata = {
  title: "Espace clinicien — Santetrace (démonstration)",
};

export default function DoctorLayout({ children }: { children: ReactNode }) {
  return <ClinicianShell>{children}</ClinicianShell>;
}

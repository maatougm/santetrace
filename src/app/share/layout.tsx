import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GuestFrame } from "@/components/guest/GuestFrame";

// Generic public page: a link preview sees this title and nothing about the patient.
export const metadata: Metadata = {
  title: { default: "Consultation partagée", template: "%s · Santetrace" },
  description: "Consultation partagée par un patient (démonstration fictive).",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ShareLayout({ children }: { children: ReactNode }) {
  return <GuestFrame>{children}</GuestFrame>;
}

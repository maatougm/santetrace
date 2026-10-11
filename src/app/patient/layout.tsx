import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { PatientFrame } from "@/components/patient/PatientFrame";

export const metadata: Metadata = {
  title: {
    default: "Santetrace — suivi patient (démonstration)",
    template: "%s · Santetrace patient",
  },
  description: "Suivi de la tension et de la glycémie entre deux consultations. Démonstration fictive.",
  manifest: "/manifest.webmanifest",
  applicationName: "Santetrace",
  appleWebApp: {
    capable: true,
    title: "Santetrace",
    statusBarStyle: "default",
  },
  // SVG only for now: iOS home-screen icons need a PNG apple-touch-icon (not yet authored).
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // Mirrors --color-accent / --color-bg in src/components/ui/tokens.css (metadata cannot read CSS variables).
  themeColor: "#005eb8",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function PatientLayout({ children }: { children: ReactNode }) {
  return <PatientFrame>{children}</PatientFrame>;
}

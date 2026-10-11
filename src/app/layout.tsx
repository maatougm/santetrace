import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@/components/ui/tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Santetrace — suivi chronique (démonstration fictive)",
    template: "%s · Santetrace",
  },
  description:
    "Démonstration fictive de suivi de l’hypertension et du diabète entre deux consultations, avec revue d’analyses liée à la source (EndoRecord). Données synthétiques, seuils non validés cliniquement.",
  applicationName: "Santetrace",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Mirrors --color-accent in src/components/ui/tokens.css (metadata cannot read CSS variables).
  themeColor: "#005eb8",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" dir="ltr" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}

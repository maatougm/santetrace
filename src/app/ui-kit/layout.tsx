import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Kit d’interface (interne)" };

/**
 * Internal design preview. Available in development for screenshot review;
 * removed from production builds (the demo) unless explicitly enabled with
 * NEXT_PUBLIC_ENABLE_UI_KIT=1.
 */
export default function UiKitLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ENABLE_UI_KIT !== "1") {
    notFound();
  }
  return children;
}

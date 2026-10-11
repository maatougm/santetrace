import type { Metadata } from "next";
import { SignInScreen } from "@/components/auth/SignInScreen";

export const metadata: Metadata = {
  title: "Connexion",
};

export default function HomePage() {
  return <SignInScreen />;
}

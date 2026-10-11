import type { Metadata } from "next";
import { MessagesScreen } from "@/components/patient/contact/MessagesScreen";

export const metadata: Metadata = { title: "Messages" };

export default function PatientMessagesPage() {
  return <MessagesScreen />;
}

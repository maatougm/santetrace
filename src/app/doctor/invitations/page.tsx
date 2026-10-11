import type { Metadata } from "next";
import { InvitationInbox } from "@/components/doctor/invitations/InvitationInbox";

export const metadata: Metadata = {
  title: "Invitations de patients — Santetrace (démonstration)",
  referrer: "no-referrer",
};

export default function DoctorInvitationsPage() {
  return <InvitationInbox />;
}

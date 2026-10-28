import { redirect } from "next/navigation";

// The Inbound queue and the raw Inbox now live in People & Inbox (People, filtered to "Needs reply").
export default function Page() {
  redirect("/?view=people&type=open");
}

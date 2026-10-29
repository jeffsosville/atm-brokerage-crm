import { redirect } from "next/navigation";

// The Inbound queue and the raw Inbox now live in the CRM's Inbox tab.
export default function Page() {
  redirect("/?view=inbox&type=open");
}

import type { Metadata } from "next";
import { AdminConsole } from "./AdminConsole";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Atlas admin", robots: { index: false, follow: false } };

export default function AdminPage() {
  return <AdminConsole />;
}

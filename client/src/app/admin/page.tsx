import type { Metadata } from "next";
import { headers } from "next/headers";
import { AdminDashboard, AdminLogin } from "@/components/admin/admin-console";
import { PageIntro } from "@/components/page-intro";
import { getAdminOverview, getAdminSession } from "@/lib/engine";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Admin | Faraday", robots: { index: false } };

// Admin access comes from the username and password login (fd_admin cookie) or an admin Google account.
export default async function AdminPage() {
  const cookie = (await headers()).get("cookie");
  if (!(await getAdminSession(cookie))) return <AdminLogin />;
  const overview = await getAdminOverview(cookie);
  if (!overview) return <PageIntro eyebrow="/admin" title="Admin" lede="The engine did not answer. Try again in a moment." />;
  return <AdminDashboard initialSettings={overview.settings} initialTopics={overview.topics} />;
}

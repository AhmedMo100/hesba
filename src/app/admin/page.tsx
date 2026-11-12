"use client";

import dynamic from "next/dynamic";

/** Platform admin (ADR-0030). The page is a shell; every API behind it checks `platform_admins`. */
const AdminAiView = dynamic(
  () => import("@/client/features/admin/AdminAiView"),
  {
    ssr: false,
  },
);

export default function AdminPage() {
  return <AdminAiView />;
}

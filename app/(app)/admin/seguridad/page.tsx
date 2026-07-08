import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { countRateLimitRecords, listRateLimitRecords } from "@/lib/services/rate-limit"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { RateLimitList } from "./rate-limit-list"

export const metadata: Metadata = { title: "Seguridad y bloqueos" }

export default async function SecurityPage() {
  try {
    await requirePermission("admin:security")
  } catch {
    redirect("/forbidden")
  }

  const [rows, total] = await Promise.all([
    listRateLimitRecords(500),
    countRateLimitRecords(),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Seguridad y bloqueos"
        description="Diagnostica bloqueos por intentos fallidos en login y formularios públicos, y libera claves manualmente."
        breadcrumb={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Seguridad y bloqueos" },
        ]}
      />
      <RateLimitList
        rows={rows.map((r) => ({
          key: r.key,
          count: r.count,
          successCount: r.successCount,
          lockUntil: r.lockUntil,
          updatedAt: r.updatedAt,
        }))}
        total={total}
      />
    </PageContainer>
  )
}

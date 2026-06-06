import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { desc } from "drizzle-orm"
import { auditLog } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { AuditLog } from "./audit-log"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Log de auditoría" }

export default async function AuditoriaPage() {
  try { await requirePermission("admin:audit_log") }
  catch { redirect("/dashboard") }

  const entries = await db
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(500)

  return (
    <>
      <PageHeader
        title="Log de auditoría"
        description="Historial de acciones y cambios de estado del sistema."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Administración" },
            { label: "Auditoría" },
          ]} />
        }
      />
      <AuditLog entries={entries.map((e) => ({
        id:         e.id,
        userEmail:  e.userEmail,
        action:     e.action,
        entityType: e.entityType,
        entityId:   e.entityId,
        entityCode: e.entityCode,
        oldState:   e.oldState,
        newState:   e.newState,
        reason:     e.reason,
        createdAt:  e.createdAt,
      }))} />
    </>
  )
}

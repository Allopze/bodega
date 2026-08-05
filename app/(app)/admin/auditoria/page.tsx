import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { desc } from "drizzle-orm"
import { auditLog } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { AuditLog } from "./audit-log"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Log de auditoría" }

export default async function AuditoriaPage() {
  try { await requirePermission("admin:audit_log") }
  catch { redirect("/forbidden") }

  const entries = await db
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(500)

  // Es un log de solo lectura: ninguna cifra es "accionable" en sentido de
  // HeaderSignals. Ponemos el desglose en la descripción del título (patrón
  // aprobaciones), sin chips en el TopBar.
  const actions = new Set(entries.map((e) => e.action)).size
  const users = new Set(entries.flatMap((e) => e.userEmail ? [e.userEmail] : [])).size
  const entities = new Set(entries.map((e) => e.entityType)).size
  const description = entries.length > 0
    ? `${entries.length} eventos · ${actions} acciones · ${users} usuarios · ${entities} entidades`
    : "Historial de acciones y cambios de estado del sistema."

  return (
    <PageContainer>
      <PageHeader
        title="Log de auditoría"
        description={description}
        breadcrumb={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Auditoría" },
        ]}
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
    </PageContainer>
  )
}

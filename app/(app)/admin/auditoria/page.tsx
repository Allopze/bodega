import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { desc, eq } from "drizzle-orm"
import { auditLog } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { AuditLog } from "./audit-log"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Log de auditoría" }

export default async function AuditoriaPage({ searchParams }: { searchParams: Promise<{ entidad?: string | string[] }> }) {
  try { await requirePermission("admin:audit_log") }
  catch { redirect("/forbidden") }

  // M-18 (auditoría 2026-09-28): `?entidad=<id>` trae la historia completa de
  // un registro, no sólo la parte que cae en los últimos 500 eventos.
  const query = await searchParams
  const entityId = (Array.isArray(query.entidad) ? query.entidad[0] : query.entidad)?.trim() || null
  const entries = await db
    .select()
    .from(auditLog)
    .where(entityId ? eq(auditLog.entityId, entityId) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(500)

  // Es un log de solo lectura: ninguna cifra es "accionable" en sentido de
  // HeaderSignals. Ponemos el desglose en la descripción del título (patrón
  // aprobaciones), sin chips en el TopBar.
  const actions = new Set(entries.map((e) => e.action)).size
  const users = new Set(entries.flatMap((e) => e.userEmail ? [e.userEmail] : [])).size
  const entities = new Set(entries.map((e) => e.entityType)).size
  const description = entityId
    ? `${entries.length} eventos del registro ${entityId}`
    : entries.length > 0
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

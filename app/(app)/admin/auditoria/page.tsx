import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { desc } from "drizzle-orm"
import { auditLog } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { ClockCounterClockwise, Lightning, UserCircle, Stack } from "@phosphor-icons/react/dist/ssr"
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

  const summaryStats: SummaryStat[] = [
    { key: "events",   label: "Eventos",   value: entries.length,                                          icon: <ClockCounterClockwise size={13} /> },
    { key: "actions",  label: "Acciones",  value: new Set(entries.map((e) => e.action)).size,              icon: <Lightning size={13} /> },
    { key: "users",    label: "Usuarios",  value: new Set(entries.map((e) => e.userEmail).filter(Boolean)).size, icon: <UserCircle size={13} /> },
    { key: "entities", label: "Entidades", value: new Set(entries.map((e) => e.entityType)).size,           icon: <Stack size={13} /> },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Log de auditoría"
        description="Historial de acciones y cambios de estado del sistema."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Administración", href: "/admin" },
            { label: "Auditoría" },
          ]} />
        }
      />
      {entries.length > 0 && <SummaryBar className="mb-4" stats={summaryStats} />}
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

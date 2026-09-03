import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { db } from "@/db"
import { itAssets } from "@/db/schema"
import { and, isNull } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { ReportCard } from "./report-card"

export const metadata: Metadata = { title: "Reportes TI" }

const REPORTS = [
  { type: "inventario_general", title: "Inventario general", description: "Todos los activos TI con tipo, estado, faena, costo y garantía.", needsAsset: false },
  { type: "inventario_faena", title: "Inventario por faena", description: "Una hoja por faena con sus activos.", needsAsset: false },
  { type: "equipos_trabajador", title: "Equipos asignados por trabajador", description: "Una hoja por trabajador con los equipos en su custodia.", needsAsset: false },
  { type: "disponibles", title: "Equipos disponibles", description: "Activos en estado disponible para entrega.", needsAsset: false },
  { type: "reparacion", title: "Equipos en reparación", description: "Activos actualmente en reparación.", needsAsset: false },
  { type: "historial_activo", title: "Historial de un activo", description: "Línea de tiempo completa de un activo específico.", needsAsset: true },
  { type: "costo_reparacion", title: "Costo de reparación por activo", description: "Ranking de gasto acumulado para identificar reemplazos.", needsAsset: false },
  { type: "antiguedad", title: "Activos por antigüedad", description: "Años de uso desde la fecha de compra.", needsAsset: false },
  { type: "garantias", title: "Garantías", description: "Vencimientos con días restantes y proveedor.", needsAsset: false },
] as const

export default async function ReportesPage() {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const canExport = can(session, "ti:export")
  const scope = worksiteScopeSql(session, itAssets.worksiteId)

  const assets = await db
    .select({ id: itAssets.id, code: itAssets.code })
    .from(itAssets)
    .where(and(isNull(itAssets.deletedAt), scope ?? undefined))
    .orderBy(itAssets.code)

  return (
    <PageContainer>
      <PageHeader
        title="Reportes TI"
        description="Exporta el estado del parque tecnológico en Excel (formato estándar de la plataforma)."
        breadcrumb={<Breadcrumbs items={[{ label: "TI", href: "/ti" }, { label: "Reportes" }]} />}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((report) => (
          <ReportCard
            key={report.type}
            type={report.type}
            title={report.title}
            description={report.description}
            needsAsset={report.needsAsset}
            assets={assets}
            enabled={canExport}
          />
        ))}
      </div>

      {!canExport && (
        <p className="mt-4 text-sm text-[var(--color-text-muted)]">
          No tienes permiso para exportar reportes TI. Pídeselo al administrador.
        </p>
      )}
    </PageContainer>
  )
}

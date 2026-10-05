import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { and, asc, eq, isNull } from "drizzle-orm"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { db } from "@/db"
import { itAccessSystems, itAssets, worksites } from "@/db/schema"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { ReportCard } from "./report-card"
import type { TiReportType } from "./actions"

export const metadata: Metadata = { title: "Reportes TI" }

interface ReportDef {
  type: TiReportType
  title: string
  description: string
  needsAsset?: boolean
  filters?: { period?: boolean; worksite?: boolean; system?: boolean }
}

/** Agrupados por tema: 13 tarjetas planas no dejaban ver qué cubre cada área. */
const GROUPS: { id: string; title: string; reports: ReportDef[] }[] = [
  {
    id: "inventario",
    title: "Inventario y custodia",
    reports: [
      { type: "inventario_general", title: "Inventario general", description: "Todos los activos TI con tipo, estado, faena, costo y garantía." },
      { type: "inventario_faena", title: "Inventario por faena", description: "Una hoja por faena con sus activos." },
      { type: "equipos_trabajador", title: "Equipos asignados por trabajador", description: "Los equipos en custodia de cada trabajador, ordenados por persona." },
      { type: "disponibles", title: "Equipos disponibles", description: "Activos en estado disponible para entrega." },
      { type: "reparacion", title: "Equipos en reparación", description: "Activos actualmente en reparación." },
      { type: "historial_activo", title: "Historial de un activo", description: "Línea de tiempo completa de un activo específico.", needsAsset: true },
      { type: "costo_reparacion", title: "Costo de reparación por activo", description: "Ranking de gasto acumulado para identificar reemplazos." },
      { type: "antiguedad", title: "Activos por antigüedad", description: "Años de uso desde la fecha de compra." },
      { type: "garantias", title: "Garantías", description: "Vencimientos con días restantes y proveedor." },
    ],
  },
  {
    id: "mesa",
    title: "Mesa de ayuda",
    reports: [
      {
        type: "tickets", title: "Tickets",
        description: "Cada caso con categoría, prioridad, estado, técnico, fechas y si se atendió dentro o fuera de plazo.",
        filters: { period: true, worksite: true },
      },
    ],
  },
  {
    id: "licencias-accesos",
    title: "Licencias y accesos",
    reports: [
      { type: "licencias", title: "Licencias", description: "Cupos comprados, asignados y libres, costo, renovación y responsable; con una hoja de asignaciones." },
      {
        type: "accesos", title: "Accesos a sistemas",
        description: "Qué trabajador tiene acceso a qué sistema, su estado y quién lo administra.",
        filters: { worksite: true, system: true },
      },
      {
        type: "ingresos_egresos", title: "Ingresos y egresos",
        description: "Listas de ingreso y egreso de trabajadores con su avance y las tareas que faltan.",
        filters: { worksite: true },
      },
    ],
  },
]

export default async function ReportesPage() {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const canExport = can(session, "ti:export")
  const scope = worksiteScopeSql(session, itAssets.worksiteId)
  const worksiteScope = worksiteScopeSql(session, worksites.id)

  const [assets, worksiteOptions, systems] = await Promise.all([
    db.select({ id: itAssets.id, code: itAssets.code }).from(itAssets)
      .where(and(isNull(itAssets.deletedAt), scope)).orderBy(itAssets.code),
    db.select({ id: worksites.id, name: worksites.name }).from(worksites)
      .where(and(eq(worksites.isActive, true), worksiteScope)).orderBy(asc(worksites.name)),
    db.select({ id: itAccessSystems.id, name: itAccessSystems.name }).from(itAccessSystems)
      .where(eq(itAccessSystems.isActive, true)).orderBy(asc(itAccessSystems.name)),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Reportes TI"
        description="Exporta a Excel el parque, la mesa de ayuda, las licencias y los accesos de tus faenas."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "TI", href: "/ti" }, { label: "Reportes TI" }]} />}
      />

      <div className="flex flex-col gap-8">
        {GROUPS.map((group) => (
          <section key={group.id} aria-labelledby={`rep-${group.id}`}>
            <h2 id={`rep-${group.id}`} className="mb-3 text-base font-semibold text-[var(--color-text)]">{group.title}</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.reports.map((report) => (
                <ReportCard
                  key={report.type}
                  {...report}
                  assets={report.needsAsset ? assets : undefined}
                  worksites={worksiteOptions}
                  systems={systems}
                  enabled={canExport}
                />
              ))}
            </div>
          </section>
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

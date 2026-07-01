import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listEquipmentChecklists } from "@/lib/services/prevention-equipment"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { PreventionExportButton } from "@/components/prevention/export-button"
import { formatDateSafe } from "@/lib/sst/date"

export const metadata: Metadata = { title: "Checklists de equipos" }

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function EquiposChecklistsPage({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:equipment_reports:view")) redirect("/forbidden")

  const query = await searchParams
  const scope = scopeToIds(resolveWorksiteScope(session))
  const items = await listEquipmentChecklists(scope, query.tipo)

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Equipos", href: "/prevencion/equipos/reportes" }, { label: "Checklists" }]} />
      <PageHeader title="Checklists de equipos" description="Contenedores, maquinaria, carros, bateas, taller/RESPEL (N° 27-30 PDTP)" actions={<PreventionExportButton href="/api/prevencion/equipos/checklists/export" label="Exportar checklists" />} />
      <TableRoot>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Activo</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Faena</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Cierre requerido</TableHead>
              <TableHead>Fecha</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <EmptyState compact title="Sin checklists" description="Aún no se han registrado checklists para esta faena." />
                </TableCell>
              </TableRow>
            ) : items.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{c.assetCode}</TableCell>
                <TableCell>{c.kind}</TableCell>
                <TableCell className="font-mono text-xs text-[var(--color-text-subtle)]">{c.worksiteId}</TableCell>
                <TableCell>{c.status}</TableCell>
                <TableCell>{c.closeRequired ? "Sí" : "No"}</TableCell>
                <TableCell>{formatDateSafe(c.performedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </PageContainer>
  )
}

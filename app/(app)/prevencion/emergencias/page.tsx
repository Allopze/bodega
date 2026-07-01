import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listDrills, getOverdueEquipmentInspections } from "@/lib/services/prevention-emergency"
import { listScopedWorksites } from "@/lib/services/ppa"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { PreventionExportButton } from "@/components/prevention/export-button"
import { formatDateSafe } from "@/lib/sst/date"

export const metadata: Metadata = { title: "Emergencias y CGRD" }

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function EmergenciasPage({ searchParams }: { searchParams: Promise<{ faena?: string }> }) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:emergency:view")) redirect("/forbidden")

  const query = await searchParams
  const scope = scopeToIds(resolveWorksiteScope(session))
  const worksites = await listScopedWorksites(scope)
  const selectedWs = worksites.find((w) => w.id === query.faena)?.id ?? worksites[0]?.id

  const [drills, overdue] = selectedWs
    ? await Promise.all([listDrills(scope), getOverdueEquipmentInspections(selectedWs, scope)])
    : [await listDrills(scope), [] as Array<{ id: string; kind: string; code: string; location: string }>]

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Emergencias" }]} />
      <PageHeader title="Emergencias y CGRD" description="Planes, simulacros, brigadas y equipos de emergencia (N° 79-84 PDTP)" actions={<PreventionExportButton href="/api/prevencion/emergencias/export" label="Exportar emergencias" />} />

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <div className="rounded border p-4">
          <p className="text-xs text-muted-foreground">Simulacros {new Date().getFullYear()}</p>
          <p className="text-h1 font-semibold">{drills.length}</p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-muted-foreground">Equipos con inspección vencida</p>
          <p className="text-h1 font-semibold">{overdue.length}</p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-muted-foreground">Último simulacro</p>
          <p className="text-h1 font-semibold text-sm">
            {drills.find((d) => d.executedAt)?.executedAt ? formatDateSafe(drills.find((d) => d.executedAt)!.executedAt) : "Sin registro"}
          </p>
        </div>
      </div>

      <TableRoot>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo</TableHead>
              <TableHead>Programado</TableHead>
              <TableHead>Ejecutado</TableHead>
              <TableHead>Asistentes</TableHead>
              <TableHead>Efectividad</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {drills.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <EmptyState compact title="Sin simulacros" description="Aún no se han registrado simulacros para esta faena." />
                </TableCell>
              </TableRow>
            ) : drills.map((d) => (
              <TableRow key={d.id}>
                <TableCell>{d.type}</TableCell>
                <TableCell>{formatDateSafe(d.scheduledAt)}</TableCell>
                <TableCell>{d.executedAt ? formatDateSafe(d.executedAt) : "Pendiente"}</TableCell>
                <TableCell>{d.attendees ?? "-"}</TableCell>
                <TableCell>{d.effectiveness ?? "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </PageContainer>
  )
}

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { listInspectionFollowup } from "@/lib/services/prevention-inspection-followup"
import { formatDate } from "@/lib/utils"

export const metadata: Metadata = { title: "Seguimiento de inspecciones" }

export default async function InspectionFollowupPage() {
  let session
  try { session = await requirePermission("prevention:inspections:view") }
  catch { redirect("/forbidden?desde=%2Fprevencion%2Finspecciones%2Fseguimiento") }
  const access = { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
  const rows = await listInspectionFollowup(access)
  const canExport = session.user.permissions.includes("prevention:inspections:export")

  return <PageContainer>
    <PageHeader
      title="Seguimiento de inspecciones"
      description="Vista derivada de hallazgos, acciones CAPA y sus seguimientos. No mantiene una base paralela."
      breadcrumb={<Breadcrumbs items={[
        { label: "Inicio", href: "/dashboard" },
        { label: "Prevención" },
        { label: "Inspecciones", href: "/prevencion/inspecciones" },
        { label: "Seguimiento" },
      ]} />}
      actions={canExport ? <Button asChild variant="secondary"><Link href="/api/prevencion/inspecciones/seguimiento/export" prefetch={false}>Exportar Excel</Link></Button> : undefined}
    />
    {rows.length === 0 ? <EmptyState
      title="Aún no hay hallazgos para seguir"
      description="Cuando una inspección u observación levante una desviación, aparecerá aquí junto con su acción correctiva."
      action={<Button asChild><Link href="/prevencion/inspecciones">Ir a inspecciones</Link></Button>}
    /> : <div className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white shadow-xs">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Fecha</TableHead><TableHead>Área</TableHead><TableHead>Desviación</TableHead>
          <TableHead>Medida correctiva</TableHead><TableHead>Responsable</TableHead><TableHead>Fecha ejecución MC</TableHead>
          <TableHead>Estado</TableHead><TableHead>% Cumplimiento</TableHead><TableHead>Comentarios</TableHead>
        </TableRow></TableHeader>
        <TableBody>{rows.map((row) => <TableRow key={row.findingId}>
          <TableCell>{row.date ? formatDate(row.date) : "—"}</TableCell>
          <TableCell>{row.area}</TableCell><TableCell className="min-w-64 whitespace-normal">{row.deviation}</TableCell>
          <TableCell className="min-w-64 whitespace-normal">{row.correctiveMeasure || "Sin CAPA"}</TableCell>
          <TableCell>{row.responsible || "Sin asignar"}</TableCell><TableCell>{row.targetDate ? formatDate(row.targetDate) : "—"}</TableCell>
          <TableCell>{row.status}</TableCell><TableCell>{row.progress}%</TableCell>
          <TableCell className="min-w-72 whitespace-pre-wrap">{row.comments || "—"}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div>}
  </PageContainer>
}

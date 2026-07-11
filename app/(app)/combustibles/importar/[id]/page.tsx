import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import { fuelImportBatches, fuelVehicles } from "@/db/schema"
import { eq } from "drizzle-orm"
import { can, requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { buildFuelVehiclesWhere } from "@/lib/combustibles/queries"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCLP, formatQty, formatDateTime } from "@/lib/utils"
import { RevertBatchButton, LinkPlateForm } from "../batch-detail-actions"

export const metadata: Metadata = { title: "Detalle de importación" }

export default async function ImportBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requirePermission("combustibles:import") }
  catch { redirect("/forbidden") }

  const { id } = await params
  const batch = await db.query.fuelImportBatches.findFirst({
    where: eq(fuelImportBatches.id, id),
    with: {
      worksite: { columns: { name: true } },
      importer: { columns: { name: true, email: true } },
      records: { with: { vehicle: { columns: { id: true, plate: true } } }, orderBy: (t, { asc }) => [asc(t.patente)] },
    },
  })
  if (!batch) notFound()
  if (!canAccessWorksite(session, batch.worksiteId)) redirect("/forbidden")

  const unassociatedPlates = [...new Set(batch.records.filter((r) => !r.vehicle).map((r) => r.patente))].sort()
  const canManageVehicles = can(session, "combustibles:manage_vehicles")
  const canRevert = can(session, "combustibles:revert") && batch.estado !== "revertido"

  const vehicles = canManageVehicles
    ? await db.query.fuelVehicles.findMany({ where: buildFuelVehiclesWhere(session), orderBy: [fuelVehicles.plate] })
    : []

  return (
    <PageContainer>
      <PageHeader
        title="Detalle de importación"
        description={`${batch.archivoNombre} — ${batch.periodoDesde} a ${batch.periodoHasta}`}
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Importar consumos", href: "/combustibles/importar" }, { label: batch.archivoNombre }]} />}
        headerActions={<RevertBatchButton batchId={batch.id} canRevert={canRevert} />}
      />

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Resumen del lote</CardTitle>
          <Badge variant={batch.estado === "revertido" ? "danger" : "success"}>
            {batch.estado === "revertido" ? "Revertido" : "Importado"}
          </Badge>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Faena" value={batch.worksite?.name ?? "—"} />
          <Field label="Fuente" value={batch.fuente ?? "—"} />
          <Field label="Filas válidas" value={formatQty(batch.filasValidas)} />
          <Field label="Filas rechazadas" value={formatQty(batch.filasInvalidas)} />
          <Field label="Patentes" value={formatQty(batch.totalPatentes)} />
          <Field label="Cantidad total" value={formatQty(Math.round(batch.totalCantidad), "L")} />
          <Field label="Monto total" value={formatCLP(batch.totalMonto)} />
          <Field label="Importado por" value={`${batch.importer?.name ?? batch.importer?.email ?? "—"} · ${formatDateTime(batch.createdAt)}`} />
        </CardContent>
      </Card>

      {unassociatedPlates.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Patentes sin asociar ({unassociatedPlates.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!canManageVehicles && (
              <p className="text-sm text-muted-foreground">No tienes permiso para vincular patentes a vehículos.</p>
            )}
            {unassociatedPlates.map((patente) => (
              <div key={patente} className="flex items-center justify-between gap-3 p-2 rounded-md bg-[var(--color-warning-tint)]">
                <span className="font-mono text-sm">{patente}</span>
                {canManageVehicles && <LinkPlateForm batchId={batch.id} patente={patente} vehicles={vehicles} />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Registros del lote ({batch.records.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-x-auto">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Patente</TableHead>
                  <TableHead>Vehículo</TableHead>
                  <TableHead className="text-right">Tarjetas</TableHead>
                  <TableHead className="text-right">Transacc.</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right">Rendimiento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batch.records.map((r) => (
                  <TableRow key={r.id} className={r.vehicle ? undefined : "bg-[var(--color-warning-tint)]"}>
                    <TableCell className="font-mono text-sm">{r.patente}</TableCell>
                    <TableCell>{r.vehicle?.plate ?? <Badge variant="warning" size="sm">Sin asociar</Badge>}</TableCell>
                    <TableCell className="text-right font-mono">{formatQty(r.numeroTarjetas)}</TableCell>
                    <TableCell className="text-right font-mono">{formatQty(r.numeroTransacciones)}</TableCell>
                    <TableCell className="text-right font-mono">{formatQty(r.cantidadUnidad, "L")}</TableCell>
                    <TableCell className="text-right font-mono">{formatCLP(r.monto)}</TableCell>
                    <TableCell className="text-right font-mono">{r.rendimientoPromedio > 0 ? r.rendimientoPromedio.toFixed(2) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-[var(--color-text)]">{value}</p>
    </div>
  )
}

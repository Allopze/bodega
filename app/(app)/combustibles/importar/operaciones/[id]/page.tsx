import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { db } from "@/db"
import { fuelOperationBatches, fuelOperationRecords, fuelVehicles, worksites } from "@/db/schema"
import { and, asc, eq, isNull, isNotNull } from "drizzle-orm"
import { can, requirePermission } from "@/lib/auth/can"
import { isGlobalRole } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MetaBadge } from "@/components/states/state-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCLP, formatQty, formatDateTime } from "@/lib/utils"
import { RevertOperationsBatchButton, LinkOperationVehicleForm, LinkOperationWorksiteForm } from "../batch-detail-actions"
import { OperationRejectionsExport } from "../operation-rejections-export"
import { countOperationRejections, listOperationRejections } from "@/lib/combustibles/operations-import-rejections"

export const metadata: Metadata = { title: "Detalle de importación (Log operacional)" }

const SAMPLE_LIMIT = 50
const REJECTION_PREVIEW_LIMIT = 50

export default async function OperationsBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requirePermission("combustibles:import") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/combustibles/importar/operaciones")}`) }
  if (!isGlobalRole(session)) redirect(`/forbidden?desde=${encodeURIComponent("/combustibles/importar/operaciones")}`)

  const { id } = await params
  const batch = await db.query.fuelOperationBatches.findFirst({
    where: eq(fuelOperationBatches.id, id),
    with: { importer: { columns: { name: true, email: true } } },
  })
  if (!batch) notFound()

  const canManageVehicles = can(session, "combustibles:manage_vehicles")
  const canRevert = can(session, "combustibles:revert") && batch.estado !== "revertido"

  const [unmatchedPlateRows, unmatchedFaenaRows, sampleRecords, vehicles, worksitesList, rejections, rejectionCount] = await Promise.all([
    db.selectDistinct({ plate: fuelOperationRecords.plate })
      .from(fuelOperationRecords)
      .where(and(eq(fuelOperationRecords.batchId, id), isNull(fuelOperationRecords.vehicleId))),
    db.selectDistinct({ faenaNombre: fuelOperationRecords.faenaNombre })
      .from(fuelOperationRecords)
      .where(and(eq(fuelOperationRecords.batchId, id), isNull(fuelOperationRecords.worksiteId), isNotNull(fuelOperationRecords.faenaNombre))),
    db.query.fuelOperationRecords.findMany({
      where: eq(fuelOperationRecords.batchId, id),
      with: { vehicle: { columns: { id: true, plate: true } }, worksite: { columns: { name: true } } },
      orderBy: [asc(fuelOperationRecords.fecha)],
      limit: SAMPLE_LIMIT,
    }),
    canManageVehicles ? db.query.fuelVehicles.findMany({ orderBy: [fuelVehicles.plate] }) : Promise.resolve([]),
    canManageVehicles ? db.query.worksites.findMany({ orderBy: [worksites.name] }) : Promise.resolve([]),
    listOperationRejections(id, REJECTION_PREVIEW_LIMIT),
    countOperationRejections(id),
  ])

  const unmatchedPlates = unmatchedPlateRows.map((r) => r.plate).sort()
  const unmatchedFaenas = unmatchedFaenaRows.map((r) => r.faenaNombre!).sort()

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Detalle de importación (Log operacional)"
        description={`${batch.archivoNombre} · ${batch.periodoDesde} a ${batch.periodoHasta}`}
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Cargas", href: "/combustibles/bitacora" }, { label: "Importar consumos", href: "/combustibles/importar?tab=operaciones" }, { label: batch.archivoNombre }]} />}
        headerActions={<RevertOperationsBatchButton batchId={batch.id} canRevert={canRevert} />}
      />

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Resumen del lote</CardTitle>
          <MetaBadge meta={{ label: `${batch.estado === "revertido" ? "Revertido" : "Importado"}`, variant: batch.estado === "revertido" ? "danger" : "success" }} />
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Período" value={`${batch.periodoDesde} a ${batch.periodoHasta}`} />
          <Field label="Equipos" value={formatQty(batch.totalEquipos)} />
          <Field label="Filas válidas" value={formatQty(batch.filasValidas)} />
          <Field label="Filas rechazadas" value={formatQty(batch.filasInvalidas)} />
          <Field label="Litros totales" value={formatQty(Math.round(batch.totalLitros), "L")} />
          <Field label="Monto total" value={formatCLP(batch.totalMonto)} />
          <Field label="Importado por" value={`${batch.importer?.name ?? batch.importer?.email ?? "—"}`} />
          <Field label="Fecha de importación" value={formatDateTime(batch.createdAt)} />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Filas rechazadas ({formatQty(rejectionCount)})</CardTitle>
          {rejectionCount > 0 && <OperationRejectionsExport batchId={batch.id} />}
        </CardHeader>
        <CardContent>
          {rejectionCount === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">Ninguna fila de este archivo fue rechazada. Las que no cuadran (lectura menor que la anterior, proveedor desconocido) se importaron y están marcadas en Control › Revisión.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-text-muted)]">Estas filas no se convirtieron en carga. Descarga el Excel, corrige el dato indicado y vuelve a subirlas como un archivo nuevo.</p>
              <div className="border rounded-lg overflow-x-auto">
                <Table className="min-w-[600px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">Fila</TableHead>
                      <TableHead>Campo</TableHead>
                      <TableHead>Motivo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rejections.slice(0, REJECTION_PREVIEW_LIMIT).map((rejection) => (
                      <TableRow key={rejection.id}>
                        <TableCell className="text-right font-mono text-xs">{rejection.rowIndex}</TableCell>
                        <TableCell className="text-sm">{rejection.field ?? "—"}</TableCell>
                        <TableCell className="text-sm">{rejection.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {rejectionCount > REJECTION_PREVIEW_LIMIT && (
                <p className="text-xs text-[var(--color-text-muted)]">Se muestran las primeras {REJECTION_PREVIEW_LIMIT}. El Excel incluye las {formatQty(rejectionCount)}.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {unmatchedFaenas.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Faenas sin asociar ({unmatchedFaenas.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!canManageVehicles && <p className="text-sm text-[var(--color-text-muted)]">No tienes permiso para vincular faenas.</p>}
            {unmatchedFaenas.map((faenaNombre) => (
              <div key={faenaNombre} className="flex items-center justify-between gap-3 p-2 rounded-md bg-[var(--color-warning-tint)]">
                <span className="text-sm">{faenaNombre}</span>
                {canManageVehicles && <LinkOperationWorksiteForm batchId={batch.id} faenaNombre={faenaNombre} worksites={worksitesList} />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {unmatchedPlates.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Patentes sin asociar ({unmatchedPlates.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!canManageVehicles && <p className="text-sm text-[var(--color-text-muted)]">No tienes permiso para vincular patentes a vehículos.</p>}
            {unmatchedPlates.map((plate) => (
              <div key={plate} className="flex items-center justify-between gap-3 p-2 rounded-md bg-[var(--color-warning-tint)]">
                <span className="font-mono text-sm">{plate}</span>
                {canManageVehicles && <LinkOperationVehicleForm batchId={batch.id} plate={plate} vehicles={vehicles} />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Muestra de registros (primeros {SAMPLE_LIMIT} por fecha, de {formatQty(batch.filasValidas)})</CardTitle></CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Patente</TableHead>
                  <TableHead>Vehículo</TableHead>
                  <TableHead>Faena</TableHead>
                  <TableHead className="text-right">Litros</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right" title="Valor que traía la planilla. No es el rendimiento calculado por la plataforma.">Rend. declarado</TableHead>
                  <TableHead>Operador</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sampleRecords.map((r) => (
                  <TableRow key={r.id} className={r.vehicle ? undefined : "bg-[var(--color-warning-tint)]"}>
                    <TableCell className="font-mono text-xs">{r.fecha}{r.horaCarga ? ` ${r.horaCarga}` : ""}</TableCell>
                    <TableCell className="font-mono text-sm">{r.plate}</TableCell>
                    <TableCell>{r.vehicle?.plate ?? <MetaBadge meta={{ label: "Sin asociar", variant: "warning" }} />}</TableCell>
                    <TableCell>{r.worksite?.name ?? r.faenaNombre ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{formatQty(r.liters, "L")}</TableCell>
                    <TableCell className="text-right font-mono">{r.monto != null ? formatCLP(r.monto) : "—"}</TableCell>
                    <TableCell className="text-right font-mono">{r.rendimiento != null ? r.rendimiento.toFixed(2) : "—"}</TableCell>
                    <TableCell className="text-sm">{r.operador ?? "—"}</TableCell>
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
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
      <p className="text-sm font-medium text-[var(--color-text)]">{value}</p>
    </div>
  )
}

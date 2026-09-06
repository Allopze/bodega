import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelTaeImportBatches, fuelTaeSubmissions, fuelTaeVehicleMappings, fuelTaeWorkerMappings, fuelVehicles, workers } from "@/db/schema"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { taeLedgerIsGlobal } from "@/lib/combustibles/tae-import-ledger"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { MetaBadge } from "@/components/states/state-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime, formatQty } from "@/lib/utils"
import { vehicleMappingKey, workerMappingKey } from "@/lib/combustibles/tae-import-service"
import { ReprocessTaeBatchButton, RevertTaeBatchButton } from "../tae-batch-actions"
import { TaeMappingReview, type AmbiguousIdentity, type CatalogOption } from "./tae-mapping-review"

export const metadata: Metadata = { title: "Detalle de lote TAE" }

export default async function TaeImportBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requirePermission("combustibles:tae_import") } catch { redirect(`/forbidden?desde=${encodeURIComponent("/combustibles/tae/importar")}`) }
  const { id } = await params
  // Un lote de importación histórica es multi-faena por naturaleza. Sin
  // acotar `submissions` al alcance de la sesión, un rol scoped con
  // `combustibles:tae_import` (hoy sólo lo tienen roles globales, pero nada
  // en el código lo impide) vería las cargas, faenas, equipos y patentes de
  // TODAS las faenas del lote, no sólo las suyas.
  const isGlobal = taeLedgerIsGlobal(session)
  const scope = worksiteScopeSql(session, fuelTaeSubmissions.worksiteId)
  const batch = await db.query.fuelTaeImportBatches.findFirst({
    where: eq(fuelTaeImportBatches.id, id),
    with: {
      importer: { columns: { name: true, email: true } },
      submissions: {
        where: scope,
        orderBy: (submissions, { asc }) => [asc(submissions.loadedAt)],
        with: {
          worksite: { columns: { name: true } },
          vehicle: { columns: { code: true, plate: true } },
          product: { columns: { name: true } },
        },
      },
      // Las filas rechazadas no tienen faena resuelta —ése es justamente su
      // motivo de rechazo— y conservan `raw_row` con equipos y nombres del
      // archivo completo. Sólo un rol global puede leerlas.
      rejections: isGlobal
        ? { orderBy: (rejections, { asc }) => [asc(rejections.rowIndex)] }
        : { where: sql`false`, limit: 0 },
    },
  })
  if (!batch) notFound()
  // `scope` sólo viene definido (no `undefined`) para roles NO globales — ver
  // `worksiteScopeSql`. Para esos, cero submissions tras el filtro significa
  // "el lote es enteramente de otra faena", no "el lote no tiene cargas": un
  // lote real con todas sus filas rechazadas también llega en 0 para un rol
  // global, y ese caso sí debe renderizar (para ver los rechazos).
  if (scope !== undefined && batch.submissions.length === 0) notFound()
  // Los contadores persistidos describen el archivo completo. Un rol acotado
  // ve los suyos recalculados; lo no atribuible se omite en vez de mostrarse
  // como cero.
  const scopedSummary = isGlobal ? null : {
    validRows: batch.submissions.filter((submission) => submission.status !== "observed").length,
    observedRows: batch.submissions.filter((submission) => submission.status === "observed").length,
    totalLiters: batch.submissions.reduce((total, submission) => total + Number(submission.liters), 0),
  }
  const canRevert = batch.status === "imported" && can(session, "combustibles:revert")
  const canManageMappings = can(session, "combustibles:tae_import")
  // Un rol acotado no lee las filas rechazadas, pero sí puede reprocesarlas:
  // la acción sólo recupera las que resuelven dentro de su alcance y responde
  // "no hubo filas listas" cuando no hay ninguna. Ofrecer el botón sin contarlas
  // conserva el flujo sin publicar el tamaño del lote ajeno.
  const canReprocess = batch.status === "imported" && (isGlobal
    ? batch.rejections.some((rejection) => rejection.stage === "worksite" && rejection.rawRow && typeof rejection.rawRow === "object")
    : true)

  const worksiteIds = [...new Set(batch.submissions.map((s) => s.worksiteId))]
  const [vehicleMappings, workerMappings, worksiteVehicles, worksiteWorkers] = worksiteIds.length
    ? await Promise.all([
        db.query.fuelTaeVehicleMappings.findMany({ where: inArray(fuelTaeVehicleMappings.worksiteId, worksiteIds), columns: { worksiteId: true, legacyCode: true } }),
        db.query.fuelTaeWorkerMappings.findMany({ where: inArray(fuelTaeWorkerMappings.worksiteId, worksiteIds), columns: { worksiteId: true, role: true, legacyName: true } }),
        db.query.fuelVehicles.findMany({ where: inArray(fuelVehicles.worksiteId, worksiteIds), columns: { id: true, worksiteId: true, code: true, plate: true } }),
        db.query.workers.findMany({ where: inArray(workers.worksiteId, worksiteIds), columns: { id: true, worksiteId: true, firstName: true, lastName: true } }),
      ])
    : [[], [], [], []]
  const decidedVehicleKeys = new Set(vehicleMappings.map((m) => vehicleMappingKey(m.worksiteId, m.legacyCode)))
  const decidedWorkerKeys = new Set(workerMappings.map((m) => `${m.role}:${workerMappingKey(m.worksiteId, m.legacyName)}`))

  const ambiguous = new Map<string, AmbiguousIdentity>()
  for (const submission of batch.submissions) {
    if (submission.status !== "observed") continue
    const worksiteName = submission.worksite?.name ?? "—"
    if (!submission.vehicleId && !decidedVehicleKeys.has(vehicleMappingKey(submission.worksiteId, submission.equipmentCodeSnapshot))) {
      const key = `vehicle:${submission.worksiteId}:${submission.equipmentCodeSnapshot}`
      if (!ambiguous.has(key)) ambiguous.set(key, { kind: "vehicle", worksiteId: submission.worksiteId, worksiteName, legacyValue: submission.equipmentCodeSnapshot })
    }
    if (!submission.driverWorkerId && !decidedWorkerKeys.has(`driver:${workerMappingKey(submission.worksiteId, submission.driverNameSnapshot)}`)) {
      const key = `driver:${submission.worksiteId}:${submission.driverNameSnapshot}`
      if (!ambiguous.has(key)) ambiguous.set(key, { kind: "driver", worksiteId: submission.worksiteId, worksiteName, legacyValue: submission.driverNameSnapshot })
    }
    if (!submission.supervisorWorkerId && !decidedWorkerKeys.has(`supervisor:${workerMappingKey(submission.worksiteId, submission.supervisorNameSnapshot)}`)) {
      const key = `supervisor:${submission.worksiteId}:${submission.supervisorNameSnapshot}`
      if (!ambiguous.has(key)) ambiguous.set(key, { kind: "supervisor", worksiteId: submission.worksiteId, worksiteName, legacyValue: submission.supervisorNameSnapshot })
    }
  }
  const vehicleOptions: Record<string, CatalogOption[]> = {}
  for (const vehicle of worksiteVehicles) (vehicleOptions[vehicle.worksiteId] ??= []).push({ id: vehicle.id, label: `${vehicle.code ?? vehicle.plate} · ${vehicle.plate}` })
  const workerOptions: Record<string, CatalogOption[]> = {}
  for (const worker of worksiteWorkers) (workerOptions[worker.worksiteId] ??= []).push({ id: worker.id, label: `${worker.firstName} ${worker.lastName}` })

  return (
    <PageContainer>
      <PageHeader
        title="Detalle de lote TAE"
        description={batch.fileName}
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Control TAE", href: "/combustibles/tae" }, { label: "Importar histórico", href: "/combustibles/tae/importar" }, { label: "Historial", href: "/combustibles/tae/importar/historial" }, { label: batch.fileName }]} />}
        actions={<div className="flex flex-wrap gap-2"><ReprocessTaeBatchButton batchId={batch.id} canReprocess={canReprocess} /><RevertTaeBatchButton batchId={batch.id} canRevert={canRevert} /></div>}
      />

      <Card className="mb-5">
        <CardHeader className="flex flex-row items-center justify-between"><CardTitle>{isGlobal ? "Resumen del lote" : "Resumen de tus faenas en el lote"}</CardTitle><MetaBadge meta={{ label: `${batch.status === "reverted" ? "Revertido" : "Importado"}`, variant: batch.status === "reverted" ? "danger" : "success" }} /></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {isGlobal && <Field label="Filas totales" value={formatQty(batch.totalRows)} />}
          <Field label="Importadas" value={formatQty(scopedSummary?.validRows ?? batch.validRows)} />
          <Field label="Observadas" value={formatQty(scopedSummary?.observedRows ?? batch.observedRows)} />
          {isGlobal && <Field label="Rechazadas" value={formatQty(batch.invalidRows)} />}
          <Field label="Volumen" value={formatQty(scopedSummary?.totalLiters ?? Number(batch.totalLiters), "L")} />
          <Field label="Importado por" value={batch.importer?.name ?? batch.importer?.email ?? "—"} />
          <Field label="Fecha" value={formatDateTime(batch.createdAt)} />
          {isGlobal && <Field label="Hash de archivo" value={batch.fileHash.slice(0, 16)} mono />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Cargas conservadas ({formatQty(batch.submissions.length)})</CardTitle></CardHeader>
        <CardContent>
          {batch.status === "reverted" && <p className="mb-4 text-sm text-(--color-text-muted)">Las cargas fueron eliminadas por la reversa. El resumen del lote permanece disponible para auditoría.</p>}
          <div className="overflow-x-auto rounded-lg border border-(--color-border)">
            <Table className="min-w-[960px]">
              <TableHeader><TableRow><TableHead>Fecha carga</TableHead><TableHead>Faena</TableHead><TableHead>Equipo</TableHead><TableHead>Producto</TableHead><TableHead>Conductor</TableHead><TableHead>Supervisor</TableHead><TableHead>Medidor</TableHead><TableHead className="text-right">Litros</TableHead><TableHead>Estado</TableHead></TableRow></TableHeader>
              <TableBody>
                {batch.submissions.map((submission) => <TableRow key={submission.id}><TableCell>{formatDateTime(submission.loadedAt)}</TableCell><TableCell>{submission.worksite?.name ?? "—"}</TableCell><TableCell>{submission.vehicle?.code ?? submission.equipmentCodeSnapshot}{(submission.vehicle?.plate ?? submission.plateSnapshot) ? ` · ${submission.vehicle?.plate ?? submission.plateSnapshot}` : ""}</TableCell><TableCell>{submission.product?.name ?? "—"}</TableCell><TableCell>{submission.driverNameSnapshot}</TableCell><TableCell>{submission.supervisorNameSnapshot}</TableCell><TableCell className="font-mono">{submission.meterReading == null ? "—" : formatQty(Number(submission.meterReading))}</TableCell><TableCell className="text-right font-mono">{formatQty(Number(submission.liters), "L")}</TableCell><TableCell><MetaBadge meta={{ label: `${submission.status === "observed" ? "Observada" : "Validada"}`, variant: submission.status === "observed" ? "warning" : "success" }} /></TableCell></TableRow>)}
                {batch.submissions.length === 0 && <TableRow><TableCell colSpan={9} className="py-10 text-center text-(--color-text-muted)">No hay cargas vigentes en este lote.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {canManageMappings && ambiguous.size > 0 && (
        <Card className="mt-5">
          <CardHeader><CardTitle>Identidades sin equivalente ({ambiguous.size})</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-(--color-text-muted)">Asigna el equipo o persona real del catálogo. La decisión se guarda por faena y se aplica sola en la próxima importación del mismo histórico: no corrige las cargas ya importadas en este lote.</p>
            <TaeMappingReview items={[...ambiguous.values()]} vehicleOptions={vehicleOptions} workerOptions={workerOptions} />
          </CardContent>
        </Card>
      )}

      {batch.rejections.length > 0 && (
        <Card className="mt-5">
          <CardHeader><CardTitle>Filas rechazadas ({formatQty(batch.rejections.length)})</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border border-(--color-border)">
              <Table className="min-w-[720px]">
                <TableHeader><TableRow><TableHead>Fila</TableHead><TableHead>Etapa</TableHead><TableHead>Campo</TableHead><TableHead>Motivo</TableHead></TableRow></TableHeader>
                <TableBody>
                  {batch.rejections.map((rejection) => <TableRow key={rejection.id}><TableCell className="font-mono">{rejection.rowIndex}</TableCell><TableCell>{rejection.stage === "parse" ? "Formato" : "Faena"}</TableCell><TableCell>{rejection.field ?? "—"}</TableCell><TableCell>{rejection.message}</TableCell></TableRow>)}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  )
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><p className="text-xs text-(--color-text-muted)">{label}</p><p className={mono ? "font-mono text-sm" : "text-sm font-medium"}>{value}</p></div>
}

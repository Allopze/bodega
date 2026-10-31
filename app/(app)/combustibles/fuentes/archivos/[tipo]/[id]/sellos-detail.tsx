import { notFound, redirect } from "next/navigation"
import type { Session } from "next-auth"
import { eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelTaeImportBatches, fuelTaeSubmissions, fuelTaeVehicleMappings, fuelTaeWorkerMappings, fuelVehicles, workers } from "@/db/schema"
import { can } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { MetaBadge } from "@/components/states/state-badge"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { taeLedgerIsGlobal } from "@/lib/combustibles/tae-import-ledger"
import { vehicleMappingKey, workerMappingKey } from "@/lib/combustibles/tae-import-service"
import { formatDateTime, formatQty } from "@/lib/utils"
import { ReprocessTaeBatchButton } from "../../../../tae/importar/tae-batch-actions"
import { TaeMappingReview, type AmbiguousIdentity, type CatalogOption } from "../../../../tae/importar/[id]/tae-mapping-review"
import { RevertFileButton } from "../../../revert-file"
import { Section, SummaryCard } from "./summary"

/** Las cargas conservadas se listan hasta aquí: un histórico trae miles de filas y la ficha no es el lugar de recorrerlas todas. */
const SUBMISSIONS_LIMIT = 500

/** Ficha de un lote del histórico de sellos: resumen, cargas conservadas, identidades sin equivalente (mapeo) y filas rechazadas. */
export async function SellosDetail({ session, id }: { session: Session; id: string }) {
  if (!can(session, "combustibles:tae_import")) redirect("/forbidden")

  // Un lote histórico es multi-faena por naturaleza. Sin acotar las cargas al alcance de la sesión, un rol
  // acotado con `tae_import` vería faenas, equipos y patentes de TODAS las faenas del lote.
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
      // Las filas rechazadas no tienen faena resuelta (ése es su motivo) y conservan `raw_row` con equipos y
      // nombres del archivo completo: sólo un rol global puede leerlas.
      rejections: isGlobal
        ? { orderBy: (rejections, { asc }) => [asc(rejections.rowIndex)] }
        : { where: sql`false`, limit: 0 },
    },
  })
  if (!batch) notFound()
  // `scope` sólo viene definido para roles NO globales: para ellos, cero cargas tras el filtro significa «el lote es
  // enteramente de otra faena». Un lote con todas sus filas rechazadas también llega en 0 para un rol global, y ése sí se muestra.
  if (scope !== undefined && batch.submissions.length === 0) notFound()

  // Los contadores guardados describen el archivo completo: un rol acotado ve los suyos recalculados.
  const scopedSummary = isGlobal ? null : {
    validRows: batch.submissions.filter((submission) => submission.status !== "observed").length,
    observedRows: batch.submissions.filter((submission) => submission.status === "observed").length,
    totalLiters: batch.submissions.reduce((total, submission) => total + Number(submission.liters), 0),
  }
  const canRevert = batch.status === "imported" && can(session, "combustibles:revert")
  const canManageMappings = can(session, "combustibles:tae_import")
  // Un rol acotado no lee las filas rechazadas, pero sí puede reprocesarlas: la acción sólo recupera las que
  // resuelven dentro de su alcance. Ofrecer el botón sin contarlas conserva el flujo sin publicar el tamaño del lote ajeno.
  const canReprocess = batch.status === "imported" && (isGlobal
    ? batch.rejections.some((rejection) => rejection.stage === "worksite" && rejection.rawRow && typeof rejection.rawRow === "object")
    : true)

  const worksiteIds = [...new Set(batch.submissions.map((submission) => submission.worksiteId))]
  const [vehicleMappings, workerMappings, worksiteVehicles, worksiteWorkers] = worksiteIds.length
    ? await Promise.all([
        db.query.fuelTaeVehicleMappings.findMany({ where: inArray(fuelTaeVehicleMappings.worksiteId, worksiteIds), columns: { worksiteId: true, legacyCode: true } }),
        db.query.fuelTaeWorkerMappings.findMany({ where: inArray(fuelTaeWorkerMappings.worksiteId, worksiteIds), columns: { worksiteId: true, role: true, legacyName: true } }),
        db.query.fuelVehicles.findMany({ where: inArray(fuelVehicles.worksiteId, worksiteIds), columns: { id: true, worksiteId: true, code: true, plate: true } }),
        db.query.workers.findMany({ where: inArray(workers.worksiteId, worksiteIds), columns: { id: true, worksiteId: true, firstName: true, lastName: true } }),
      ])
    : [[], [], [], []]
  const decidedVehicleKeys = new Set(vehicleMappings.map((mapping) => vehicleMappingKey(mapping.worksiteId, mapping.legacyCode)))
  const decidedWorkerKeys = new Set(workerMappings.map((mapping) => `${mapping.role}:${workerMappingKey(mapping.worksiteId, mapping.legacyName)}`))

  // Nombres de conductor y supervisor son datos personales: sin `view_personal` se muestran reservados y no se
  // ofrecen para mapear (no hay cómo decidir a ciegas a qué persona corresponde un nombre).
  const canViewPersonal = can(session, "combustibles:view_personal")
  const ambiguous = new Map<string, AmbiguousIdentity>()
  for (const submission of batch.submissions) {
    if (submission.status !== "observed") continue
    const worksiteName = submission.worksite?.name ?? "—"
    if (!submission.vehicleId && !decidedVehicleKeys.has(vehicleMappingKey(submission.worksiteId, submission.equipmentCodeSnapshot))) {
      const key = `vehicle:${submission.worksiteId}:${submission.equipmentCodeSnapshot}`
      if (!ambiguous.has(key)) ambiguous.set(key, { kind: "vehicle", worksiteId: submission.worksiteId, worksiteName, legacyValue: submission.equipmentCodeSnapshot })
    }
    if (!canViewPersonal) continue
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

  const shown = batch.submissions.slice(0, SUBMISSIONS_LIMIT)
  const status = batch.status === "reverted" ? "revertido" : "importado"

  return (
    <PageContainer>
      <PageHeader
        title="Histórico de sellos"
        description={batch.fileName}
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Fuentes de datos", href: FUEL_PATHS.fuentes }, { label: "Archivos importados", href: FUEL_PATHS.fuentesArchivos }, { label: batch.fileName }]} />}
        actions={
          <FuelHeaderActions>
            <ReprocessTaeBatchButton batchId={batch.id} canReprocess={canReprocess} />
            <RevertFileButton target={{ kind: "sellos", id: batch.id, fileName: batch.fileName }} canRevert={canRevert} />
          </FuelHeaderActions>
        }
      />

      <SummaryCard
        title={isGlobal ? "Resumen del archivo" : "Resumen de tus faenas en el archivo"}
        status={status}
        items={[
          ...(isGlobal ? [{ label: "Filas totales", value: formatQty(batch.totalRows), mono: true }] : []),
          { label: "Importadas", value: formatQty(scopedSummary?.validRows ?? batch.validRows), mono: true },
          { label: "Observadas", value: formatQty(scopedSummary?.observedRows ?? batch.observedRows), mono: true },
          ...(isGlobal ? [{ label: "Rechazadas", value: formatQty(batch.invalidRows), mono: true }] : []),
          { label: "Litros", value: formatQty(scopedSummary?.totalLiters ?? Number(batch.totalLiters), "L"), mono: true },
          { label: "Importado por", value: batch.importer?.name ?? batch.importer?.email },
          { label: "Fecha", value: formatDateTime(batch.createdAt) },
          ...(isGlobal ? [{ label: "Huella del archivo", value: batch.fileHash.slice(0, 16), mono: true }] : []),
        ]}
      />

      <Section title={`Cargas conservadas (${formatQty(batch.submissions.length)})`}>
        {batch.status === "reverted" ? <p className="mb-4 text-sm text-[var(--color-text-muted)]">Las cargas se eliminaron al revertir el archivo. El resumen queda disponible para auditoría.</p> : null}
        <TableRoot aria-label="Cargas conservadas del histórico de sellos">
          <Table className="min-w-[960px]">
            <TableHeader>
              <TableRow>
                <TableHead>Fecha de la carga</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Equipo</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead>Conductor</TableHead>
                <TableHead>Supervisor</TableHead>
                <TableHead>Medidor</TableHead>
                <TableHead className="text-right">Litros</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((submission) => (
                <TableRow key={submission.id}>
                  <TableCell>{formatDateTime(submission.loadedAt)}</TableCell>
                  <TableCell>{submission.worksite?.name ?? "—"}</TableCell>
                  <TableCell>{submission.vehicle?.code ?? submission.equipmentCodeSnapshot}{(submission.vehicle?.plate ?? submission.plateSnapshot) ? ` · ${submission.vehicle?.plate ?? submission.plateSnapshot}` : ""}</TableCell>
                  <TableCell>{submission.product?.name ?? "—"}</TableCell>
                  <TableCell>{canViewPersonal ? submission.driverNameSnapshot : "Reservado"}</TableCell>
                  <TableCell>{canViewPersonal ? submission.supervisorNameSnapshot : "Reservado"}</TableCell>
                  <TableCell className="font-mono tabular-nums">{submission.meterReading == null ? "—" : formatQty(Number(submission.meterReading))}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatQty(Number(submission.liters), "L")}</TableCell>
                  <TableCell><MetaBadge meta={{ label: submission.status === "observed" ? "Observada" : "Validada", variant: submission.status === "observed" ? "warning" : "success" }} /></TableCell>
                </TableRow>
              ))}
              {shown.length === 0 ? <TableRow><TableCell colSpan={9} className="py-10 text-center text-[var(--color-text-muted)]">No hay cargas vigentes en este archivo.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </TableRoot>
        {batch.submissions.length > SUBMISSIONS_LIMIT ? <p className="mt-3 text-xs text-[var(--color-text-muted)]">Se muestran las primeras {formatQty(SUBMISSIONS_LIMIT)} cargas, de {formatQty(batch.submissions.length)}. Todas están en Cargas.</p> : null}
      </Section>

      {canManageMappings && ambiguous.size > 0 ? (
        <Section title={`Identidades sin equivalente (${ambiguous.size})`}>
          <p className="mb-4 text-sm text-[var(--color-text-muted)]">Asigna el equipo o persona real del catálogo. La decisión se guarda por faena y se aplica sola desde la próxima importación del mismo histórico: no corrige las cargas ya importadas en este archivo.</p>
          <TaeMappingReview items={[...ambiguous.values()]} vehicleOptions={vehicleOptions} workerOptions={workerOptions} />
        </Section>
      ) : null}

      {batch.rejections.length > 0 ? (
        <Section title={`Filas rechazadas (${formatQty(batch.rejections.length)})`}>
          <TableRoot aria-label="Filas rechazadas del histórico de sellos">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Fila</TableHead>
                  <TableHead>Etapa</TableHead>
                  <TableHead>Campo</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batch.rejections.map((rejection) => (
                  <TableRow key={rejection.id}>
                    <TableCell className="font-mono tabular-nums">{rejection.rowIndex}</TableCell>
                    <TableCell>{rejection.stage === "parse" ? "Formato" : "Faena"}</TableCell>
                    <TableCell>{rejection.field ?? "—"}</TableCell>
                    <TableCell>{rejection.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
        </Section>
      ) : null}
    </PageContainer>
  )
}

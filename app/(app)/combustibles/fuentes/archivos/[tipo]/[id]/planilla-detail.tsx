import { notFound, redirect } from "next/navigation"
import type { Session } from "next-auth"
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm"
import { db } from "@/db"
import { fuelOperationBatches, fuelOperationRecords, fuelVehicles, worksites } from "@/db/schema"
import { can } from "@/lib/auth/can"
import { isGlobalRole } from "@/lib/auth/scope"
import { Badge } from "@/components/ui/badge"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { countOperationRejections, listOperationRejections } from "@/lib/combustibles/operations-import-rejections"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { formatCLP, formatDate, formatDateTime, formatQty } from "@/lib/utils"
import { LinkOperationVehicleForm, LinkOperationWorksiteForm } from "../../../../importar/operaciones/batch-detail-actions"
import { OperationRejectionsExport } from "../../../../importar/operaciones/operation-rejections-export"
import { RevertFileButton } from "../../../revert-file"
import { canSeeFuelCosts } from "./costs"
import { Section, SummaryCard } from "./summary"

const SAMPLE_LIMIT = 50
const REJECTION_PREVIEW_LIMIT = 50

/** Ficha de una planilla de cargas: lo que trajo, las filas rechazadas (en Excel), las faenas y patentes sin vincular y una muestra de los registros. */
export async function PlanillaDetail({ session, id }: { session: Session; id: string }) {
  // La planilla abarca varias faenas por archivo: sólo un rol global con permiso de importar.
  if (!can(session, "combustibles:import") || !isGlobalRole(session)) redirect("/forbidden")

  const batch = await db.query.fuelOperationBatches.findFirst({
    where: eq(fuelOperationBatches.id, id),
    with: { importer: { columns: { name: true, email: true } } },
  })
  if (!batch) notFound()

  const showCosts = canSeeFuelCosts(session)
  const canLink = can(session, "combustibles:manage_vehicles")
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
    canLink ? db.query.fuelVehicles.findMany({ orderBy: [fuelVehicles.plate] }) : Promise.resolve([]),
    canLink ? db.query.worksites.findMany({ orderBy: [worksites.name] }) : Promise.resolve([]),
    listOperationRejections(id, REJECTION_PREVIEW_LIMIT),
    countOperationRejections(id),
  ])
  const unmatchedPlates = unmatchedPlateRows.map((row) => row.plate).sort()
  const unmatchedFaenas = unmatchedFaenaRows.flatMap((row) => (row.faenaNombre ? [row.faenaNombre] : [])).sort()
  const status = batch.estado === "revertido" ? "revertido" : "importado"

  return (
    <PageContainer>
      <PageHeader
        title="Planilla de cargas"
        description={`${batch.archivoNombre} · ${formatDate(batch.periodoDesde)} a ${formatDate(batch.periodoHasta)}`}
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Fuentes de datos", href: FUEL_PATHS.fuentes }, { label: "Archivos importados", href: FUEL_PATHS.fuentesArchivos }, { label: batch.archivoNombre }]} />}
        actions={
          <FuelHeaderActions>
            <RevertFileButton target={{ kind: "planilla", id: batch.id, fileName: batch.archivoNombre }} canRevert={canRevert} />
          </FuelHeaderActions>
        }
      />

      <SummaryCard
        status={status}
        items={[
          { label: "Período", value: `${formatDate(batch.periodoDesde)} a ${formatDate(batch.periodoHasta)}` },
          { label: "Equipos", value: formatQty(batch.totalEquipos), mono: true },
          { label: "Filas válidas", value: formatQty(batch.filasValidas), mono: true },
          { label: "Filas rechazadas", value: formatQty(batch.filasInvalidas), mono: true },
          { label: "Litros", value: formatQty(Math.round(batch.totalLitros), "L"), mono: true },
          ...(showCosts ? [{ label: "Monto", value: formatCLP(batch.totalMonto), mono: true }] : []),
          { label: "Importado por", value: batch.importer?.name ?? batch.importer?.email },
          { label: "Fecha de importación", value: formatDateTime(batch.createdAt) },
        ]}
      />

      <Section
        title={`Filas rechazadas (${formatQty(rejectionCount)})`}
        action={rejectionCount > 0 ? <OperationRejectionsExport batchId={batch.id} /> : null}
      >
        {rejectionCount === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">Ninguna fila de este archivo fue rechazada. Las que no cuadran (lectura menor que la anterior, proveedor desconocido) se importaron y quedaron en «Por revisar».</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-text-muted)]">Estas filas no se convirtieron en carga. Descarga el Excel, corrige el dato indicado y vuelve a subirlas como un archivo nuevo.</p>
            <TableRoot framed={false} aria-label="Filas rechazadas de la planilla">
              <Table className="min-w-[600px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">Fila</TableHead>
                    <TableHead>Campo</TableHead>
                    <TableHead>Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rejections.map((rejection) => (
                    <TableRow key={rejection.id}>
                      <TableCell className="text-right font-mono text-xs">{rejection.rowIndex}</TableCell>
                      <TableCell className="text-sm">{rejection.field ?? "—"}</TableCell>
                      <TableCell className="text-sm">{rejection.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableRoot>
            {rejectionCount > REJECTION_PREVIEW_LIMIT ? (
              <p className="text-xs text-[var(--color-text-muted)]">Se muestran las primeras {REJECTION_PREVIEW_LIMIT}. El Excel incluye las {formatQty(rejectionCount)}.</p>
            ) : null}
          </div>
        )}
      </Section>

      {unmatchedFaenas.length > 0 ? (
        <Section title={`Faenas sin asociar (${unmatchedFaenas.length})`} description="Las cargas de estas faenas no llegan a ninguna faena de la plataforma hasta asociarlas.">
          {!canLink ? <p className="mb-2 text-sm text-[var(--color-text-muted)]">No tienes permiso para vincular faenas.</p> : null}
          <ul className="space-y-2">
            {unmatchedFaenas.map((faenaNombre) => (
              <li key={faenaNombre} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-warning-tint)] p-2">
                <span className="text-sm">{faenaNombre}</span>
                {canLink ? <LinkOperationWorksiteForm batchId={batch.id} faenaNombre={faenaNombre} worksites={worksitesList} /> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {unmatchedPlates.length > 0 ? (
        <Section title={`Patentes sin vincular (${unmatchedPlates.length})`} description="Estas patentes no están asociadas a un equipo: sus cargas no cuentan en el rendimiento hasta vincularlas.">
          {!canLink ? <p className="mb-2 text-sm text-[var(--color-text-muted)]">No tienes permiso para vincular patentes a equipos.</p> : null}
          <ul className="space-y-2">
            {unmatchedPlates.map((plate) => (
              <li key={plate} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-warning-tint)] p-2">
                <span className="font-mono text-sm">{plate}</span>
                {canLink ? <LinkOperationVehicleForm batchId={batch.id} plate={plate} vehicles={vehicles} /> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title={`Muestra de registros (los primeros ${SAMPLE_LIMIT} por fecha, de ${formatQty(batch.filasValidas)})`}>
        <TableRoot framed={false} aria-label="Muestra de registros de la planilla">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Patente</TableHead>
                <TableHead>Equipo</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead className="text-right">Litros</TableHead>
                {showCosts ? <TableHead className="text-right">Monto</TableHead> : null}
                <TableHead className="text-right" title="Valor que traía la planilla. No es el rendimiento calculado por la plataforma.">Rendimiento declarado</TableHead>
                <TableHead>Operador</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sampleRecords.map((record) => (
                <TableRow key={record.id} className={record.vehicle ? undefined : "bg-[var(--color-warning-tint)]"}>
                  <TableCell className="font-mono text-xs">{formatDate(record.fecha)}{record.horaCarga ? ` ${record.horaCarga}` : ""}</TableCell>
                  <TableCell className="font-mono text-sm">{record.plate}</TableCell>
                  <TableCell>{record.vehicle?.plate ?? <Badge variant="signal">Sin vincular</Badge>}</TableCell>
                  <TableCell>{record.worksite?.name ?? record.faenaNombre ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatQty(record.liters, "L")}</TableCell>
                  {showCosts ? <TableCell className="text-right font-mono tabular-nums">{record.monto != null ? formatCLP(record.monto) : "—"}</TableCell> : null}
                  <TableCell className="text-right font-mono tabular-nums">{record.rendimiento != null ? formatQty(record.rendimiento, record.tipoRendimiento === "lt_hr" ? "L/h" : record.tipoRendimiento === "km_lt" ? "km/L" : undefined, { maximumFractionDigits: 2 }) : "—"}</TableCell>
                  <TableCell className="text-sm">{record.operador ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
      </Section>
    </PageContainer>
  )
}

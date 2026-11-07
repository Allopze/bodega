import { notFound, redirect } from "next/navigation"
import type { Session } from "next-auth"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelImportBatches, fuelVehicles } from "@/db/schema"
import { can } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { Badge } from "@/components/ui/badge"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { getConsumptionImportRejections, getImportRejectionAccess } from "@/lib/combustibles/consumption-import-rejections"
import { buildFuelVehiclesWhere } from "@/lib/combustibles/queries"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { formatCLP, formatDate, formatDateTime, formatQty } from "@/lib/utils"
import { LinkPlateForm } from "../../../../importar/batch-detail-actions"
import { cardSourceLabel } from "../../../imported-file-kinds"
import { RevertFileButton } from "../../../revert-file"
import { Section, SummaryCard } from "./summary"
import { canSeeFuelCosts } from "./costs"

/** Ficha de un reporte de tarjeta: lo que trajo, las patentes sin vincular y los registros por patente. */
export async function TarjetaDetail({ session, id }: { session: Session; id: string }) {
  // Los lotes de las sincronizaciones automáticas también son reportes de tarjeta.
  if (!(can(session, "combustibles:import") || can(session, "combustibles:sync_integrations"))) redirect("/forbidden")

  const batch = await db.query.fuelImportBatches.findFirst({
    where: eq(fuelImportBatches.id, id),
    with: {
      worksite: { columns: { name: true } },
      importer: { columns: { name: true, email: true } },
      records: { with: { vehicle: { columns: { id: true, plate: true } } }, orderBy: (table, { asc }) => [asc(table.patente)] },
    },
  })
  if (!batch) notFound()
  if (!canAccessWorksite(session, batch.worksiteId)) redirect("/forbidden")

  const showCosts = canSeeFuelCosts(session)
  // Ledger de rechazos de la importación completa: `filasInvalidas` es por lote
  // y en modo «todas las faenas» vale 0 porque el rechazo no tiene faena.
  const rejectionAccess = await getImportRejectionAccess(session, batch.hashArchivo)
  const rejections = rejectionAccess.visible ? await getConsumptionImportRejections(batch.hashArchivo) : []
  const unlinkedPlates = [...new Set(batch.records.filter((record) => !record.vehicle).map((record) => record.patente))].sort()
  const canLinkVehicles = can(session, "combustibles:manage_vehicles")
  const canRevert = can(session, "combustibles:revert") && batch.estado !== "revertido"
  const vehicles = canLinkVehicles && unlinkedPlates.length > 0
    ? await db.query.fuelVehicles.findMany({ where: buildFuelVehiclesWhere(session), orderBy: [fuelVehicles.plate] })
    : []
  const status = batch.estado === "revertido" ? "revertido" : "importado"

  return (
    <PageContainer>
      <PageHeader
        title="Reporte de tarjeta"
        description={`${batch.archivoNombre} · ${formatDate(batch.periodoDesde)} a ${formatDate(batch.periodoHasta)}`}
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Fuentes de datos", href: FUEL_PATHS.fuentes }, { label: "Archivos importados", href: FUEL_PATHS.fuentesArchivos }, { label: batch.archivoNombre }]} />}
        actions={
          <FuelHeaderActions>
            <RevertFileButton target={{ kind: "tarjeta", id: batch.id, fileName: batch.archivoNombre }} canRevert={canRevert} />
          </FuelHeaderActions>
        }
      />

      <SummaryCard
        status={status}
        items={[
          { label: "Faena", value: batch.worksite?.name },
          { label: "De dónde", value: cardSourceLabel(batch.fuente) },
          { label: "Filas válidas", value: formatQty(batch.filasValidas), mono: true },
          { label: "Filas rechazadas", value: rejectionAccess.visible ? formatQty(rejections.length) : "—", mono: true },
          { label: "Patentes", value: formatQty(batch.totalPatentes), mono: true },
          { label: "Litros", value: formatQty(Math.round(batch.totalCantidad), "L"), mono: true },
          ...(showCosts ? [{ label: "Monto", value: formatCLP(batch.totalMonto), mono: true }] : []),
          { label: "Importado por", value: `${batch.importer?.name ?? batch.importer?.email ?? "—"} · ${formatDateTime(batch.createdAt)}` },
        ]}
      />

      {unlinkedPlates.length > 0 ? (
        <Section
          title={`Patentes sin vincular (${unlinkedPlates.length})`}
          description="Estas patentes no están asociadas a un equipo, así que sus litros no llegan a Cargas ni a la cuadratura. Vincúlalas y quedan vinculadas para los próximos reportes."
        >
          {!canLinkVehicles ? <p className="mb-2 text-sm text-[var(--color-text-muted)]">No tienes permiso para vincular patentes a equipos.</p> : null}
          <ul className="space-y-2">
            {unlinkedPlates.map((plate) => (
              <li key={plate} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-warning-tint)] p-2">
                <span className="font-mono text-sm">{plate}</span>
                {canLinkVehicles ? <LinkPlateForm batchId={batch.id} patente={plate} vehicles={vehicles} /> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {rejectionAccess.multiWorksite && !rejectionAccess.visible && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Esta importación cubrió varias faenas. Los rechazos del archivo los revisa un administrador global.
        </p>
      )}

      {rejections.length > 0 && (
        <Section
          title={`Filas rechazadas (${rejections.length})`}
          description="Filas del archivo que no se importaron: patentes sin vehículo, colisiones de catálogo o filas inválidas. Quedan registradas para corregirlas y reprocesar el archivo."
        >
          <TableRoot aria-label="Filas rechazadas de la importación">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Fila</TableHead>
                  <TableHead>Patente</TableHead>
                  <TableHead>Campo</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rejections.map((rejection, index) => (
                  <TableRow key={`${rejection.rowIndex}-${index}`}>
                    <TableCell className="font-mono tabular-nums">{rejection.rowIndex}</TableCell>
                    <TableCell className="font-mono">{rejection.patente ?? "—"}</TableCell>
                    <TableCell>{rejection.field}</TableCell>
                    <TableCell>{rejection.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
        </Section>
      )}

      <Section title={`Registros del archivo (${batch.records.length})`}>
        <TableRoot aria-label="Registros del reporte de tarjeta">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead>Patente</TableHead>
                <TableHead>Equipo</TableHead>
                <TableHead className="text-right">Tarjetas</TableHead>
                <TableHead className="text-right">Transacciones</TableHead>
                <TableHead className="text-right">Litros</TableHead>
                {showCosts ? <TableHead className="text-right">Monto</TableHead> : null}
                <TableHead className="text-right" title="Valor que informó el proveedor; no es el rendimiento que calcula la plataforma.">Rendimiento informado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batch.records.map((record) => (
                <TableRow key={record.id} className={record.vehicle ? undefined : "bg-[var(--color-warning-tint)]"}>
                  <TableCell className="font-mono text-sm">{record.patente}</TableCell>
                  <TableCell>{record.vehicle?.plate ?? <Badge variant="signal">Sin vincular</Badge>}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatQty(record.numeroTarjetas)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatQty(record.numeroTransacciones)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatQty(record.cantidadUnidad, "L")}</TableCell>
                  {showCosts ? <TableCell className="text-right font-mono tabular-nums">{formatCLP(record.monto)}</TableCell> : null}
                  <TableCell className="text-right font-mono tabular-nums">{record.rendimientoPromedio > 0 ? record.rendimientoPromedio.toFixed(2) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
      </Section>
    </PageContainer>
  )
}

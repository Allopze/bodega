import type { ReactNode } from "react"
import { CheckSquare, Square } from "@phosphor-icons/react/dist/ssr"
import { Callout } from "@/components/ui/callout"
import { DetailItem } from "@/components/ui/detail-item"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { MetaBadge } from "@/components/states/state-badge"
import { formatNumber } from "@/lib/mantencion/format"
import { OT_ITEM_KIND_LABELS, type OtItemKind } from "@/lib/mantencion/work-order-states"
import type { WorkOrderDetail, WorkOrderItemDetail } from "@/lib/services/mantencion/work-orders/types"
import { SectionCard } from "../shared/section-card"
import { OT_STATE_META, equipmentText } from "./ot-labels"
import { formatDay, formatTimeOnly, sortEventsNewestFirst } from "./ot-format"
import { formatDateTime } from "@/lib/utils"
import { EstimateCell } from "./ot-table"

const GRID = "grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3"

/** Casilla de papel: marcada o no, con el texto que la lee un lector de pantalla. */
function PaperCheck({ checked, label }: { checked: boolean; label: string }) {
  const Icon = checked ? CheckSquare : Square
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text)]">
      <Icon size={18} weight={checked ? "fill" : "regular"} aria-hidden className={checked ? "text-[var(--color-primary-ink)]" : "text-[var(--color-text-subtle)]"} />
      {label}
      <span className="sr-only">{checked ? ": marcada" : ": sin marcar"}</span>
    </span>
  )
}

/** Un paso del taller que aún no ocurre: se dice en texto, no con un hueco. */
function Pending({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[var(--color-text-muted)]">{children}</p>
}

/** ORDEN DE TRABAJO: Nº, equipo, REPARACIÓN / MANTENCIÓN, fecha de la OT y solicitante. */
export function OtHeaderSection({ detail }: { detail: WorkOrderDetail }) {
  return (
    <SectionCard title="Orden de trabajo" description="Reparación / mantención">
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2" role="group" aria-label="Tipo de trabajo">
        <PaperCheck checked={detail.repair} label="Reparación" />
        <PaperCheck checked={detail.maintenance} label="Mantención" />
      </div>
      <dl className={GRID}>
        <DetailItem layout="stacked" label="Nº (folio)" value={detail.folio} mono />
        <DetailItem layout="stacked" label="Equipo" value={equipmentText(detail)} mono />
        <DetailItem layout="stacked" label="Estado" value={<MetaBadge meta={OT_STATE_META[detail.status]} size="sm" />} />
        <DetailItem layout="stacked" label="Fecha OT" value={formatDay(detail.requestDate)} mono />
        <DetailItem layout="stacked" label="Solicitante" value={detail.requesterName} />
        <DetailItem layout="stacked" label="Faena" value={detail.worksiteName} />
        <DetailItem layout="stacked" label="Tipo de equipo" value={detail.equipmentType} />
        <DetailItem
          layout="stacked"
          label="Mecánico"
          value={detail.assignedToName ? `${detail.assignedToName}${detail.assignedAt ? ` · desde ${formatDateTime(detail.assignedAt)}` : ""}` : "Sin asignar"}
        />
        <DetailItem layout="stacked" label="Creada por" value={detail.requestedByName} />
      </dl>
    </SectionCard>
  )
}

export function OtRepairSection({ detail }: { detail: WorkOrderDetail }) {
  if (!detail.repair) return null
  return (
    <SectionCard title="Reparación">
      <p className="whitespace-pre-wrap text-sm text-[var(--color-text)]">{detail.repairDescription || "Sin descripción."}</p>
    </SectionCard>
  )
}

function DoneCell({ item }: { item: WorkOrderItemDetail }) {
  if (item.done === "si") return <span className="font-semibold text-[var(--color-success-ink)]">SÍ</span>
  if (item.done === "no") return <span className="font-semibold text-[var(--color-signal-ink)]">NO</span>
  return <span className="text-[var(--color-text-muted)]">Pendiente</span>
}

/** «TRABAJOS ANEXOS (REPARACIÓN)» y «REGISTRO DE MANTENCIONES SOLICITADAS O ASIGNADAS EN TALLER»: líneas numeradas con SÍ / NO. */
export function OtItemsSection({ detail, kind }: { detail: WorkOrderDetail; kind: OtItemKind }) {
  const items = detail.items.filter((item) => item.kind === kind).sort((a, b) => a.sortOrder - b.sortOrder)
  if (kind === "anexo" && !detail.repair && items.length === 0) return null
  const title = OT_ITEM_KIND_LABELS[kind]
  return (
    <SectionCard title={title}>
      {items.length === 0 ? (
        <Pending>No hay líneas en esta lista.</Pending>
      ) : (
        <TableRoot aria-label={title} className="-mx-5 w-auto rounded-none border-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">N°</TableHead>
                <TableHead>Trabajo</TableHead>
                <TableHead>¿Realizado?</TableHead>
                <TableHead>Nota</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs tabular-nums">{index + 1}</TableCell>
                  <TableCell>
                    {item.description}
                    {item.origin === "taller" && <span className="block text-xs text-[var(--color-text-muted)]">Agregado en el taller</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <DoneCell item={item} />
                    {item.markedByName && item.markedAt && (
                      <span className="block text-xs text-[var(--color-text-muted)]">{item.markedByName} · {formatDateTime(item.markedAt)}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{item.note ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
      )}
    </SectionCard>
  )
}

export function OtObservationsSection({ detail }: { detail: WorkOrderDetail }) {
  return (
    <SectionCard title="Observaciones">
      {detail.observations
        ? <p className="whitespace-pre-wrap text-sm text-[var(--color-text)]">{detail.observations}</p>
        : <Pending>Sin observaciones.</Pending>}
    </SectionCard>
  )
}

/** INGRESO A TALLER: encargado, taller, hora, kilómetro, operador, fecha, horómetro y fecha estimada de entrega. */
export function OtEntrySection({ detail }: { detail: WorkOrderDetail }) {
  const entry = detail.entry
  return (
    <SectionCard title="Ingreso a taller">
      {!entry ? (
        <Pending>El equipo aún no ingresa al taller. El mecánico registra el ingreso desde su app o la jefatura desde aquí.</Pending>
      ) : (
        <dl className={GRID}>
          <DetailItem layout="stacked" label="Encargado" value={entry.workshopManagerName} />
          <DetailItem layout="stacked" label="Taller" value={entry.workshopName ? `${entry.workshopName} (${entry.workshopKind === "interno" ? "interno" : "externo"})` : entry.workshopKind === "interno" ? "Taller interno" : "Taller externo"} />
          <DetailItem layout="stacked" label="Operador" value={entry.operatorName} />
          <DetailItem layout="stacked" label="Fecha ingreso" value={formatDay(entry.entryAt)} mono />
          <DetailItem layout="stacked" label="Hora ingreso" value={formatTimeOnly(entry.entryAt)} mono />
          <DetailItem layout="stacked" label="Fec. estimada entrega" value={<EstimateCell row={detail} />} />
          <DetailItem layout="stacked" label="Kilómetro" value={entry.odometer != null ? formatNumber(entry.odometer) : null} mono />
          <DetailItem layout="stacked" label="Horómetro" value={entry.hourmeter != null ? formatNumber(entry.hourmeter) : null} mono />
          <DetailItem layout="stacked" label="Ingreso registrado por" value={entry.startedByName} />
        </dl>
      )}
    </SectionCard>
  )
}

export function OtExitSection({ detail }: { detail: WorkOrderDetail }) {
  const exit = detail.exit
  return (
    <SectionCard title="Salida taller">
      {!exit ? (
        <Pending>El equipo aún no sale del taller.</Pending>
      ) : (
        <dl className={GRID}>
          <DetailItem layout="stacked" label="Fecha" value={formatDay(exit.exitAt)} mono />
          <DetailItem layout="stacked" label="Hora" value={formatTimeOnly(exit.exitAt)} mono />
          <DetailItem layout="stacked" label="Registrada por" value={exit.finishedByName} />
        </dl>
      )}
    </SectionCard>
  )
}

export function OtReceptionSection({ detail }: { detail: WorkOrderDetail }) {
  const reception = detail.reception
  return (
    <SectionCard title="Recepción" description="La registra quien retira el equipo del taller.">
      {!reception ? (
        <Pending>Aún no se registra la recepción.</Pending>
      ) : (
        <dl className={GRID}>
          <DetailItem layout="stacked" label="Fecha" value={formatDay(reception.receivedAt)} mono />
          <DetailItem layout="stacked" label="Hora" value={formatTimeOnly(reception.receivedAt)} mono />
          <DetailItem layout="stacked" label="Sr." value={reception.receiverName} />
          <DetailItem layout="stacked" label="Registrada por" value={reception.recordedByName ? `${reception.recordedByName} · ${formatDateTime(reception.recordedAt)}` : formatDateTime(reception.recordedAt)} />
        </dl>
      )}
    </SectionCard>
  )
}

export function OtFaenaReceptionSection({ detail }: { detail: WorkOrderDetail }) {
  const faena = detail.faenaReception
  return (
    <SectionCard title="Recepción en faena" description="Es la conformidad del administrador de contrato y cierra la OT.">
      {!faena ? (
        <Pending>Aún sin conformidad en faena.</Pending>
      ) : (
        <dl className={GRID}>
          <DetailItem layout="stacked" label="Fecha" value={formatDay(faena.receivedAt)} mono />
          <DetailItem layout="stacked" label="Hora" value={formatTimeOnly(faena.receivedAt)} mono />
          <DetailItem layout="stacked" label="Sr." value={faena.receiverName} />
          <DetailItem layout="stacked" label="Registrada por" value={faena.recordedByName ? `${faena.recordedByName} · ${formatDateTime(faena.closedAt)}` : formatDateTime(faena.closedAt)} />
        </dl>
      )}
    </SectionCard>
  )
}

/** Una OT anulada sigue visible y marcada. */
export function OtVoidedNotice({ detail }: { detail: WorkOrderDetail }) {
  if (!detail.voided) return null
  return (
    <Callout tone="danger" title="Esta orden está anulada" className="mb-4">
      <p>Motivo: {detail.voided.reason}</p>
      <p className="mt-0.5">{detail.voided.byName ?? "Sin nombre"} · {formatDateTime(detail.voided.at)}</p>
    </Callout>
  )
}

/** Aviso con el último rechazo mientras la OT sigue abierta: lo que el mecánico debe corregir. */
export function OtRejectionNotice({ detail }: { detail: WorkOrderDetail }) {
  if (detail.rejectionCount === 0 || detail.status === "cerrada" || detail.status === "anulada") return null
  const last = sortEventsNewestFirst(detail.events).find((event) => event.type === "rejected")
  return (
    <Callout tone="warning" title={detail.rejectionCount === 1 ? "Esta orden fue devuelta una vez" : `Esta orden fue devuelta ${detail.rejectionCount} veces`} className="mb-4">
      {last?.reason && <p>Motivo: {last.reason}</p>}
      {last && <p className="mt-0.5">{last.actorName} · {formatDateTime(last.createdAt)}</p>}
    </Callout>
  )
}


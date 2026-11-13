import type { ReactNode } from "react"
import Link from "next/link"
import { CheckCircle, Circle, CheckSquare, Package, Square } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { DetailItem } from "@/components/ui/detail-item"
import { EmptyState } from "@/components/ui/empty-state"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { MetaBadge, StateBadge } from "@/components/states/state-badge"
import { formatNumber } from "@/lib/mantencion/format"
import { OT_ITEM_KIND_LABELS, type OtItemKind } from "@/lib/mantencion/work-order-states"
import type { WorkOrderDetail, WorkOrderItemDetail, WorkOrderPartsRequest } from "@/lib/services/mantencion/work-orders/types"
import { SparePartIdentity, SparePartName, SparePartReference, sparePartIdentity } from "@/components/mantencion/spare-part-reference"
import { SectionCard } from "../shared/section-card"
import { OT_STATE_META } from "./ot-labels"
import { formatDay, sortEventsNewestFirst } from "./ot-format"
import { formatDateTime, todayInChile } from "@/lib/utils"
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

/**
 * Qué falta para que la orden avance, en una frase. Es el «siguiente paso» del bloque «Avance»: el estado dice dónde está
 * la orden y esto dice qué sigue, sin que haya que deducirlo de cuatro tarjetas vacías.
 */
export function nextStepText(detail: Pick<WorkOrderDetail, "status" | "assignedToName" | "needsLinkedRecord">): string {
  switch (detail.status) {
    case "solicitada": return "Falta asignar un mecánico."
    case "asignada": return detail.assignedToName ? `Falta que ${detail.assignedToName} registre el ingreso del equipo al taller.` : "Falta registrar el ingreso del equipo al taller."
    case "en_ejecucion": return detail.needsLinkedRecord ? "Falta registrar el trabajo y la salida de taller." : "Falta registrar la salida de taller."
    case "trabajo_terminado": return "Falta recibir el equipo, a cargo de quien lo retira del taller."
    case "recepcionada": return "Falta la conformidad en faena del administrador de contrato; con ella la orden se cierra."
    case "cerrada": return "La orden está cerrada."
    case "anulada": return "La orden está anulada."
  }
}

interface Stage {
  key: string
  label: string
  at: string | null
  /** Detalle de la etapa, un renglón por elemento; cada renglón junta sus partes con « · ». */
  lines: string[]
}

function stagesOf(detail: WorkOrderDetail): Stage[] {
  const { entry, exit, reception, faenaReception } = detail
  const workshop = entry
    ? entry.workshopName
      ? `${entry.workshopName} (${entry.workshopKind === "interno" ? "interno" : "externo"})`
      : entry.workshopKind === "interno" ? "Taller interno" : "Taller externo"
    : null
  const join = (...parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join(" · ")
  const recorded = (name: string | null, at: string) => (name ? `Registrada por ${name} · ${formatDateTime(at)}` : `Registrada el ${formatDateTime(at)}`)
  return [
    {
      key: "entry",
      label: "Ingreso a taller",
      at: entry?.entryAt ?? null,
      lines: entry
        ? [
            join(workshop, entry.workshopManagerName && `Encargado ${entry.workshopManagerName}`),
            join(
              entry.operatorName && `Operador ${entry.operatorName}`,
              entry.odometer != null && `Kilómetro ${formatNumber(entry.odometer)}`,
              entry.hourmeter != null && `Horómetro ${formatNumber(entry.hourmeter)}`,
            ),
            entry.startedByName ? `Registrado por ${entry.startedByName}` : "",
          ].filter(Boolean)
        : [],
    },
    {
      key: "exit",
      label: "Salida de taller",
      at: exit?.exitAt ?? null,
      lines: exit?.finishedByName ? [`Registrada por ${exit.finishedByName}`] : [],
    },
    {
      key: "reception",
      label: "Recepción del equipo",
      at: reception?.receivedAt ?? null,
      lines: reception ? [`Recibió ${reception.receiverName}`, recorded(reception.recordedByName, reception.recordedAt)] : [],
    },
    {
      key: "faena",
      label: "Conformidad en faena",
      at: faenaReception?.receivedAt ?? null,
      lines: faenaReception ? [`Recibió ${faenaReception.receiverName}`, recorded(faenaReception.recordedByName, faenaReception.closedAt)] : [],
    },
  ]
}

/**
 * «Avance»: el estado de la orden, lo que falta, y las cuatro etapas del taller en línea, cada una con su fecha o
 * «Pendiente». Reemplaza a cuatro tarjetas casi vacías («Aún no…») que repetían el estado en prosa (auditoría
 * 2026-11-13, M6). Va ANTES del resto de las tarjetas: lo primero que se quiere saber de una orden es dónde está.
 */
export function OtProgressSection({ detail }: { detail: WorkOrderDetail }) {
  const stages = stagesOf(detail)
  return (
    <SectionCard title="Avance" description="Dónde está la orden y qué sigue. Cada etapa muestra quién la registró.">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span data-testid="ot-estado"><MetaBadge meta={OT_STATE_META[detail.status]} size="sm" /></span>
        <p className="text-sm text-[var(--color-text)]">{nextStepText(detail)}</p>
        {detail.entry && detail.status === "en_ejecucion" && (
          <p className="text-sm text-[var(--color-text-muted)]">
            Entrega estimada: <EstimateCell row={detail} />
          </p>
        )}
      </div>
      <ol aria-label="Etapas de la orden" className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
        {stages.map((stage) => {
          const done = stage.at !== null
          return (
            <li key={stage.key} className="min-w-0 border-t-2 pt-2" style={{ borderColor: done ? "var(--color-success)" : "var(--color-border)" }}>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text)]">
                {done
                  ? <CheckCircle size={16} weight="fill" aria-hidden className="shrink-0 text-[var(--color-success-ink)]" />
                  : <Circle size={16} aria-hidden className="shrink-0 text-[var(--color-text-subtle)]" />}
                {stage.label}
              </p>
              <p className={done ? "mt-0.5 font-mono text-sm tabular-nums text-[var(--color-text)]" : "mt-0.5 text-sm text-[var(--color-text-muted)]"}>
                {done ? formatDateTime(stage.at!) : "Pendiente"}
              </p>
              {stage.lines.map((line) => <p key={line} className="mt-0.5 break-words text-xs text-[var(--color-text-muted)]">{line}</p>)}
            </li>
          )
        })}
      </ol>
    </SectionCard>
  )
}

/** Orden de trabajo: tipo, fecha, solicitante, mecánico y quién la creó. El folio, el equipo y la faena ya están en el título de la página. */
export function OtHeaderSection({ detail }: { detail: WorkOrderDetail }) {
  return (
    <SectionCard title="Orden de trabajo" description="Reparación / mantención">
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2" role="group" aria-label="Tipo de trabajo">
        <PaperCheck checked={detail.repair} label="Reparación" />
        <PaperCheck checked={detail.maintenance} label="Mantención" />
      </div>
      <dl className={GRID}>
        <DetailItem layout="stacked" label="Fecha de la orden" value={formatDay(detail.requestDate)} mono />
        <DetailItem layout="stacked" label="Solicitante" value={detail.requesterName} />
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
  if (item.done === "si") return <span className="font-semibold text-[var(--color-success-ink)]">Sí</span>
  if (item.done === "no") return <span className="font-semibold text-[var(--color-signal-ink)]">No</span>
  return <span className="text-[var(--color-text-muted)]">Pendiente</span>
}

/** «TRABAJOS ANEXOS (REPARACIÓN)» y «REGISTRO DE MANTENCIONES SOLICITADAS O ASIGNADAS EN TALLER»: líneas numeradas con Sí / No. */
export function OtItemsSection({ detail, kind }: { detail: WorkOrderDetail; kind: OtItemKind }) {
  const items = detail.items.filter((item) => item.kind === kind).sort((a, b) => a.sortOrder - b.sortOrder)
  if (kind === "anexo" && !detail.repair && items.length === 0) return null
  const title = OT_ITEM_KIND_LABELS[kind]
  return (
    <SectionCard title={title}>
      {items.length === 0 ? (
        <Pending>No hay líneas en esta lista.</Pending>
      ) : (
        <TableRoot aria-label={title} framed={false} className="-mx-5 w-auto">
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

const TEXT_LINK = "font-mono text-sm font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline"

/** Una línea recibida completa ya no se espera: la fecha estimada pasada sólo cuenta mientras falte algo por llegar. */
function lineOverdue(line: WorkOrderPartsRequest, today: string): boolean {
  return !!line.estimatedDelivery && line.estimatedDelivery < today && line.quantityReceived < line.quantity
}

function quantityText(line: Pick<WorkOrderPartsRequest, "quantity" | "unitOfMeasure">): string {
  return line.unitOfMeasure && line.unitOfMeasure !== "unidad" ? `${formatNumber(line.quantity)} ${line.unitOfMeasure}` : formatNumber(line.quantity)
}

/**
 * «Repuestos pedidos»: las solicitudes de compra vinculadas a la OT y su avance, y
 * debajo lo que los registros enlazados declararon usar. Es INFORMACIÓN: la OT no
 * lleva repuestos en su documento; el mecánico declara lo usado en el registro de
 * la correctiva y las compras salen de una solicitud. El código de la solicitud
 * sólo es enlace con `repuestos:view_all` (con `view_own` el enlace daría 404 sobre
 * una ajena). `partsRequestHref` lo calcula la página (permiso y OT no cerrada).
 * Una línea con producto de catálogo muestra su SKU y N° de parte; el nombre enlaza
 * a la ficha del repuesto sólo con `canOpenSpareParts` (`repuestos:catalog`).
 */
export function OtPartsRequestsSection({
  detail,
  canOpenRequests,
  canOpenSpareParts = false,
  partsRequestHref,
}: {
  detail: WorkOrderDetail
  canOpenRequests: boolean
  canOpenSpareParts?: boolean
  partsRequestHref: string | null
}) {
  const lines = detail.partsRequests
  const today = todayInChile()
  const orderLink = partsRequestHref
    ? <Button asChild variant="secondary" size="sm"><Link href={partsRequestHref}>Pedir repuestos</Link></Button>
    : null
  const openable = new Set(detail.linkedRecords.filter((record) => record.canOpen).map((record) => record.id))

  return (
    <SectionCard
      title="Repuestos pedidos"
      description="Solicitudes de compra vinculadas a esta orden y su avance."
      action={lines.length > 0 ? orderLink : null}
    >
      {lines.length === 0 ? (
        orderLink ? (
          <EmptyState
            compact
            as="p"
            icon={<Package size={20} aria-hidden />}
            title="Sin repuestos pedidos"
            description="Si esta orden necesita repuestos, pídelos desde aquí: la solicitud queda vinculada a la OT y al equipo."
            action={orderLink}
          />
        ) : (
          <Pending>Nadie ha pedido repuestos para esta orden.</Pending>
        )
      ) : (
        <>
          {/* Bajo md, tarjetas: a 390 px la tabla partía el SKU en cuatro renglones y cortaba el estado. */}
          <ul aria-label="Repuestos pedidos" className="flex flex-col gap-2 md:hidden">
            {lines.map((line) => (
              <li key={line.itemId}>
                <ResponsiveDataListCard
                  title={<SparePartName name={line.description} product={line} canOpen={canOpenSpareParts} />}
                  description={sparePartIdentity(line) ? <SparePartIdentity product={line} className="font-mono" /> : undefined}
                  status={<StateBadge state={line.itemStatus} entity="item" size="sm" />}
                >
                  <ResponsiveDataListField label="Solicitud">
                    {canOpenRequests
                      ? <Link href={`/solicitudes/${line.requestId}`} className={TEXT_LINK}>{line.requestCode}</Link>
                      : <span className="font-mono">{line.requestCode}</span>}
                  </ResponsiveDataListField>
                  <ResponsiveDataListField label="Cantidad"><span className="font-mono tabular-nums">{quantityText(line)}</span></ResponsiveDataListField>
                  <ResponsiveDataListField label="Recibido">
                    <span className="font-mono tabular-nums">{formatNumber(line.quantityReceived)}/{formatNumber(line.quantity)}</span>
                  </ResponsiveDataListField>
                  <ResponsiveDataListField label="Orden de compra"><span className="font-mono">{line.orderCode ?? "—"}</span></ResponsiveDataListField>
                  <ResponsiveDataListField label="Entrega estimada">
                    <EstimateCell row={{ estimatedDeliveryDate: line.estimatedDelivery, estimateOverdue: lineOverdue(line, today) }} />
                  </ResponsiveDataListField>
                </ResponsiveDataListCard>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <TableRoot aria-label="Repuestos pedidos" framed={false} className="-mx-5 w-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Solicitud</TableHead>
                    <TableHead>Repuesto</TableHead>
                    <TableHead>Cantidad</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Orden de compra</TableHead>
                    <TableHead>Entrega estimada</TableHead>
                    <TableHead>Recibido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => (
                    <TableRow key={line.itemId}>
                      <TableCell className="whitespace-nowrap">
                        {canOpenRequests
                          ? <Link href={`/solicitudes/${line.requestId}`} className={TEXT_LINK}>{line.requestCode}</Link>
                          : <span className="font-mono text-sm">{line.requestCode}</span>}
                      </TableCell>
                      <TableCell><SparePartReference name={line.description} product={line} canOpen={canOpenSpareParts} /></TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">{quantityText(line)}</TableCell>
                      <TableCell><StateBadge state={line.itemStatus} entity="item" size="sm" /></TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-sm">
                        {line.orderCode ?? <span className="text-[var(--color-text-muted)]">—</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        <EstimateCell row={{ estimatedDeliveryDate: line.estimatedDelivery, estimateOverdue: lineOverdue(line, today) }} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">
                        {formatNumber(line.quantityReceived)}/{formatNumber(line.quantity)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableRoot>
          </div>
        </>
      )}

      <div className="mt-4 border-t border-[var(--color-border)] pt-3">
        <h3 className="mb-1.5 text-sm font-semibold text-[var(--color-text)]">Declarados en los registros</h3>
        {detail.partsUsed.length === 0 ? (
          <Pending>Ningún registro enlazado declara repuestos.</Pending>
        ) : (
          <ul aria-label="Repuestos declarados en los registros" className="flex flex-col gap-1 text-sm text-[var(--color-text)]">
            {detail.partsUsed.map((part, index) => (
              <li key={`${part.recordId}-${index}`}>
                <span className="tabular-nums">{formatNumber(part.quantity)} × {part.description}</span>
                <span className="text-[var(--color-text-muted)]"> · </span>
                {openable.has(part.recordId)
                  ? <Link href={`/mantencion/registros/${part.recordId}`} className={TEXT_LINK}>{part.recordFolio ?? "Registro"}</Link>
                  : <span className="font-mono text-sm text-[var(--color-text-muted)]">{part.recordFolio ?? "Registro"}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
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


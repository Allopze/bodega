import type { ReactNode } from "react"
import Link from "next/link"
import { VehicleIdentity } from "@/components/fleet/vehicle-identity"
import { MetaBadge, StateBadge } from "@/components/states/state-badge"
import { Badge } from "@/components/ui/badge"
import { Callout } from "@/components/ui/callout"
import { DetailItem } from "@/components/ui/detail-item"
import { bodegaProductHref } from "@/lib/routing/bodega-product"
import type { PartsNoteDetail, PartsNoteDetailLine } from "@/lib/services/mantencion/parts/types"
import { formatDateTime, formatQty } from "@/lib/utils"
import { SectionCard } from "../shared/section-card"
import { NoteLineActions } from "./note-line-actions"
import { isNotePending, STAGE_META } from "./parts-notes-format"

const TEXT_LINK = "font-mono text-sm font-semibold text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline"
const PLAIN_LINK = "text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline"

function CodeLink({ href, children }: { href: string | null; children: ReactNode }) {
  return href ? <Link href={href} className={TEXT_LINK}>{children}</Link> : <span className="font-mono text-sm">{children}</span>
}

function lineResolvedText(line: PartsNoteDetailLine): string | null {
  const by = line.resolvedByName ? `${line.resolvedByName}${line.resolvedAt ? ` · ${formatDateTime(line.resolvedAt)}` : ""}` : null
  if (line.resolution === "rechazada") return `Motivo: ${line.resolutionReason ?? "sin motivo"}${by ? ` · ${by}` : ""}`
  if (!by) return null
  if (line.resolution === "desde_stock") return `Reservado por ${by}`
  if (line.resolution === "en_compra") return `Enviada a compra por ${by}`
  return null
}

function Line({ note, line, canAct, buyHref, canOpenRequests, canOpenOrders, canOpenBodega }: {
  note: PartsNoteDetail
  line: PartsNoteDetailLine
  canAct: boolean
  buyHref: string | null
  canOpenRequests: boolean
  canOpenOrders: boolean
  canOpenBodega: boolean
}) {
  const resolved = lineResolvedText(line)
  const identity = [
    line.productName && line.productName !== line.description ? line.productName : null,
    line.partNumber ? `N° de parte ${line.partNumber}` : null,
  ].filter(Boolean).join(" · ")
  const showArrival = line.stage === "en_bodega" || line.arrived > 0 || line.used > 0
  return (
    <li className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--color-text)]">
            {line.description}{" "}
            <span className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]">× {formatQty(line.quantity)}{line.unit && line.unit !== "unidad" ? ` ${line.unit}` : ""}</span>
          </p>
          {identity && <p className="mt-0.5 break-words text-xs text-[var(--color-text-muted)]">{identity}</p>}
        </div>
        <MetaBadge meta={STAGE_META[line.stage]} size="sm" />
      </div>
      {showArrival && (
        <p className="mt-1.5 font-mono text-sm tabular-nums text-[var(--color-text)]">Llegó {formatQty(line.arrived)} · Usado {formatQty(line.used)}</p>
      )}
      {/* Sólo una línea del catálogo tiene producto que mirar; Bodega valida el permiso y la faena igual. */}
      {canOpenBodega && line.productId && (
        <p className="mt-1.5 text-xs">
          <Link href={bodegaProductHref(line.productId, note.worksiteId)} aria-label={`Ver en bodega: ${line.description}`} className={PLAIN_LINK}>Ver en bodega</Link>
        </p>
      )}
      {resolved && <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">{resolved}</p>}
      {line.purchases.length > 0 && (
        <ul aria-label={`Compras de ${line.description}`} className="mt-2 flex flex-col gap-1">
          {line.purchases.map((purchase) => (
            <li key={purchase.requestItemId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="text-xs text-[var(--color-text-muted)]">Solicitud</span>
              <CodeLink href={canOpenRequests ? `/solicitudes/${purchase.requestId}` : null}>{purchase.requestCode}</CodeLink>
              <StateBadge state={purchase.status} entity="item" size="sm" />
              {purchase.orderCode && (
                <>
                  <span className="text-xs text-[var(--color-text-muted)]">OC</span>
                  <CodeLink href={canOpenOrders && purchase.orderId ? `/compras/${purchase.orderId}` : null}>{purchase.orderCode}</CodeLink>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {canAct && <NoteLineActions noteId={note.id} line={line} worksiteName={note.worksiteName} buyHref={buyHref} stockOptions={note.stockOptions ?? []} />}
    </li>
  )
}

/**
 * Detalle de una nota de pedido: de quién es, para qué orden y equipo, y una fila por línea con su etapa, lo que
 * llegó y se usó, sus compras y —para quien la administra y mientras la línea siga pendiente— las tres salidas:
 * reservar de bodega, comprar o rechazar. Cada línea del catálogo enlaza a Bodega, ya filtrada por el producto y por
 * la faena de la OT, para quien puede abrirla. «Anular nota» vive en el encabezado de la página (`VoidNoteButton`).
 * Componente de servidor; sólo las acciones son de cliente.
 */
export function PartsNoteDetailView({ note, buyHref, canOpenWorkOrder, canOpenRequests, canOpenOrders, canOpenBodega }: {
  note: PartsNoteDetail
  buyHref: string | null
  canOpenWorkOrder: boolean
  canOpenRequests: boolean
  canOpenOrders: boolean
  /** `warehouse:view_stock`: el permiso que exige `/bodega`. Sin él, la línea no ofrece el enlace. */
  canOpenBodega: boolean
}) {
  const open = note.status === "enviada" || note.status === "en_gestion"
  const pending = isNotePending({ status: note.status, pendingLines: note.lines.filter((line) => line.resolution === "pendiente").length })
  const canAct = note.canManage && open
  return (
    <div className="flex flex-col gap-4">
      {note.status === "anulada" && (
        <Callout tone="danger" title="Esta nota está anulada">
          <p>Motivo: {note.voidReason ?? "sin motivo"}</p>
        </Callout>
      )}
      <SectionCard title="Datos de la nota">
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
          <DetailItem
            layout="stacked"
            label="Orden de trabajo"
            value={<CodeLink href={canOpenWorkOrder ? `/mantencion/ot/${note.workOrderId}` : null}>{note.workOrderFolio}</CodeLink>}
          />
          <DetailItem layout="stacked" label="Equipo" value={<VehicleIdentity code={note.equipmentCode} plate={note.equipmentPlate} />} />
          <DetailItem layout="stacked" label="Faena" value={note.worksiteName} />
          <DetailItem layout="stacked" label="Pedida por" value={`${note.requestedByName} · ${formatDateTime(note.createdAt)}`} />
          <DetailItem
            layout="stacked"
            label="Urgencia"
            value={note.equipmentStopped
              ? (pending ? <Badge variant="signal" size="sm">Equipo detenido</Badge> : "El equipo estaba detenido esperando estos repuestos")
              : "Normal"}
          />
          <DetailItem layout="stacked" label="Comentario" value={note.notes ?? "Sin comentario"} className="sm:col-span-2 xl:col-span-3" />
        </dl>
      </SectionCard>
      <SectionCard title="Líneas de la nota">
        <ul aria-label="Líneas de la nota" className="flex flex-col gap-3">
          {note.lines.map((line) => (
            <Line
              key={line.id}
              note={note}
              line={line}
              canAct={canAct && line.resolution === "pendiente"}
              buyHref={buyHref}
              canOpenRequests={canOpenRequests}
              canOpenOrders={canOpenOrders}
              canOpenBodega={canOpenBodega}
            />
          ))}
        </ul>
      </SectionCard>
    </div>
  )
}

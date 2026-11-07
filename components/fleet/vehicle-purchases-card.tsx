import type { ReactNode } from "react"
import Link from "next/link"
import { StateBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { REQUEST_TYPE_LABELS } from "@/lib/request-types"
import type { VehiclePurchaseRecord } from "@/lib/services/vehicle-purchase-history"
import { formatCLP, formatDate, formatQty } from "@/lib/utils"

const LINK_CLASS = "inline-flex min-h-11 items-center font-mono text-xs text-[var(--color-primary-ink)] underline-offset-4 hover:underline sm:min-h-0"

/** Código con enlace sólo si quien mira puede abrir el destino; si no, texto: un enlace que da 403/404 es peor que ninguno. */
function Code({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return <span className="font-mono text-xs text-[var(--color-text-muted)]">{children}</span>
  return <Link href={href} className={LINK_CLASS}>{children}</Link>
}

/** Costo desconocido no es $0: sin OC no hay costo y sin precio cargado se dice «pendiente». */
function Cost({ record }: { record: VehiclePurchaseRecord }) {
  if (record.orderId === null) return <span className="text-xs text-[var(--color-text-subtle)]">—</span>
  if (record.subtotal === null) return <span className="text-xs text-[var(--color-warning-ink)]">Costo pendiente</span>
  return <span className="font-mono text-sm font-medium tabular-nums text-[var(--color-text)]">{formatCLP(record.subtotal)}</span>
}

function PurchaseRow({ record, canOpenRequests, canOpenOrders }: { record: VehiclePurchaseRecord; canOpenRequests: boolean; canOpenOrders: boolean }) {
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--color-text)]">{record.itemName}</p>
          <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
            {REQUEST_TYPE_LABELS[record.requestType] ?? record.requestType} · {formatQty(record.quantity, record.unitOfMeasure)} · {formatDate(record.requestedAt)}
            {record.requesterName ? ` · ${record.requesterName}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right"><Cost record={record} /></div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <StateBadge state={record.itemStatus} entity="item" size="sm" />
        <Code href={canOpenRequests ? `/solicitudes/${record.requestId}` : null}>{record.requestCode}</Code>
        {record.orderId && record.orderCode
          ? <Code href={canOpenOrders ? `/compras/${record.orderId}` : null}>{record.orderCode}</Code>
          : <span className="text-xs text-[var(--color-text-subtle)]">Sin OC</span>}
        {record.workOrderFolio && <span className="text-xs text-[var(--color-text-muted)]">OT {record.workOrderFolio}</span>}
      </div>
    </li>
  )
}

/**
 * «Repuestos y servicios comprados»: las solicitudes de repuestos y de servicios
 * vinculadas a un vehículo, con su OC y su costo. Es una sola tarjeta para la
 * ficha del equipo (mantención) y la del vehículo (flota): quien la monta decide
 * si se dibuja (sin la capacidad de ver compras no se dibuja) y qué enlaces
 * ofrece según sus permisos.
 *
 * - `canOpenRequests`: puede abrir la solicitud (`repuestos:view_all`).
 * - `canOpenOrders`: puede abrir la OC (`purchasing:view`).
 * - `newRequestHref`: URL de prellenado de «Nueva solicitud» con el vehículo, o
 *   `null` si no puede crear solicitudes de repuestos.
 */
export function VehiclePurchasesCard({
  records,
  canOpenRequests,
  canOpenOrders = false,
  newRequestHref,
}: {
  records: VehiclePurchaseRecord[]
  canOpenRequests: boolean
  canOpenOrders?: boolean
  newRequestHref: string | null
}) {
  const requestButton = newRequestHref
    ? <Button asChild size="sm" variant="secondary"><Link href={newRequestHref}>Pedir repuestos</Link></Button>
    : null

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle as="h2">Repuestos y servicios comprados</CardTitle>
          <CardDescription className="mt-0.5">Solicitudes de compra vinculadas a este equipo y su orden de compra.</CardDescription>
        </div>
        {records.length > 0 && requestButton}
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <EmptyState
            compact
            align="start"
            title="Sin compras vinculadas"
            description={requestButton
              ? "Aquí aparecerán los repuestos y servicios que se pidan para este equipo, con su orden de compra y su costo."
              : "Nadie ha pedido repuestos ni servicios para este equipo."}
            action={requestButton}
          />
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {records.map((record) => (
              <PurchaseRow key={record.requestItemId} record={record} canOpenRequests={canOpenRequests} canOpenOrders={canOpenOrders} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

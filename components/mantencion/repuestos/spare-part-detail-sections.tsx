import type { ReactNode } from "react"
import Link from "next/link"
import { StateBadge } from "@/components/states/state-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DetailItem } from "@/components/ui/detail-item"
import { EmptyState } from "@/components/ui/empty-state"
import { TableCell, TableCellNum, TableHead, TableHeader, TableRoot, Table, TableBody, TableRow } from "@/components/ui/table"
import { plural } from "@/lib/mantencion/format"
import type {
  SparePartPriceHistoryEntry,
  SparePartPurchaseLine,
  SparePartRecord,
  SparePartSupplierPrice,
  SparePartVehicleUsage,
} from "@/lib/services/spare-parts-catalog"
import { formatCLP, formatDate, formatQty } from "@/lib/utils"

/**
 * Secciones de lectura de la ficha de un repuesto. Son componentes de servidor sin estado: la edición y el
 * cambio de estado viven en `SparePartDetailActions`. Cada enlace se pinta sólo si quien mira puede abrir el
 * destino (un enlace que da 403 es peor que ninguno), la misma regla que la tarjeta de compras del equipo.
 */

export interface SparePartLinkAccess {
  /** `flota:view` o, a falta de él, una vista de mantención de equipos: la ficha del equipo a la que enlazar. */
  vehicleHref: ((vehicleId: string) => string) | null
  /** `repuestos:view_all`: abre la solicitud. */
  canOpenRequests: boolean
  /** `purchasing:view`: abre la OC. */
  canOpenOrders: boolean
  /** `repuestos:create`: ofrece «Pedir repuestos» en los vacíos. */
  canRequestParts: boolean
}

const LINK_CLASS = "font-mono text-xs text-[var(--color-primary-ink)] underline-offset-4 hover:underline"
const MUTED = "text-[var(--color-text-subtle)]"

/** Origen de un precio del historial, en lenguaje de usuario (nunca el valor crudo del enum). */
export const PRICE_SOURCE_LABELS: Record<string, string> = {
  purchase_order: "Orden de compra",
  invoice_reconciliation: "Conciliación de factura",
  product_form: "Edición del catálogo",
  variant_creator: "Alta de variantes",
  epp_import: "Importación",
  baseline: "Precio inicial",
}

export function priceSourceLabel(source: string): string {
  return PRICE_SOURCE_LABELS[source] ?? "Otro origen"
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div>
        <h2 id={id} className="text-h3 text-[var(--color-text)]">{title}</h2>
        {description && <p className="mt-0.5 text-sub">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function EmptyCard({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <Card>
      <EmptyState compact align="start" className="py-5" title={title} description={description} action={action} />
    </Card>
  )
}

/**
 * Un repuesto recién creado no tiene proveedores, precios, equipos ni compras: cuatro tarjetas vacías seguidas
 * se leen como un muro de nada. Mientras no haya ninguna actividad, la ficha dice una sola vez qué falta y cómo se llena.
 */
export function NoActivityNotice({ access }: { access: SparePartLinkAccess }) {
  return (
    <EmptyCard
      title="Todavía no se ha comprado"
      description="Cuando alguien pida este repuesto y se emita una orden de compra, aquí aparecen sus proveedores y precios, el historial de precio, los equipos para los que se compró y las últimas solicitudes."
      action={access.canRequestParts ? <Button asChild size="sm" variant="secondary"><Link href="/solicitudes/nueva?tipo=repuestos">Pedir repuestos</Link></Button> : undefined}
    />
  )
}

function Code({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return <span className="font-mono text-xs text-[var(--color-text-muted)]">{children}</span>
  return <Link href={href} className={LINK_CLASS}>{children}</Link>
}

/* ── Datos ─────────────────────────────────────────────────────────────────── */

export function SparePartDataCard({ part, unitLabel }: { part: SparePartRecord; unitLabel: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle as="h2">Datos del repuesto</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="divide-y divide-[var(--color-border)]">
          <DetailItem label="Estado" value={part.isActive ? <Badge variant="success" size="sm">Activo</Badge> : <Badge variant="default" size="sm">Inactivo</Badge>} />
          <DetailItem label="SKU" value={part.sku} mono />
          <DetailItem label="N° de parte" value={part.partNumber} mono />
          <DetailItem label="Marca del repuesto" value={part.partBrand} />
          <DetailItem label="Unidad" value={unitLabel} />
          <DetailItem label="Precio de referencia" value={part.referencePrice === null ? null : formatCLP(part.referencePrice)} mono />
          <DetailItem label="Creado" value={formatDate(part.createdAt)} mono />
          <DetailItem label="Última edición" value={formatDate(part.updatedAt)} mono />
        </dl>
        {part.notes && (
          <div className="mt-3 border-t border-[var(--color-border)] pt-3">
            <p className="text-xs text-[var(--color-text-subtle)]">Notas</p>
            <p className="mt-1 whitespace-pre-line text-sm text-[var(--color-text)]">{part.notes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ── Proveedores y precio vigente ─────────────────────────────────────────── */

export function SupplierPricesSection({ suppliers, ordersHref }: { suppliers: SparePartSupplierPrice[]; ordersHref: string | null }) {
  return (
    <Section id="rp-suppliers" title="Proveedores y precio vigente" description="Lo que cada proveedor cobró por última vez. El preferido va primero.">
      {suppliers.length === 0 ? (
        <EmptyCard
          title="Todavía no hay precios registrados"
          description="El precio de cada proveedor queda aquí cuando se emite una orden de compra que incluye este repuesto."
          action={ordersHref ? <Button asChild size="sm" variant="secondary"><Link href={ordersHref}>Ver órdenes de compra</Link></Button> : undefined}
        />
      ) : (
        <TableRoot aria-label="Tabla de proveedores y precios">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proveedor</TableHead>
                <TableHead className="text-right">Precio unitario</TableHead>
                <TableHead>Actualizado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((supplier) => (
                <TableRow key={supplier.supplierId}>
                  <TableCell>
                    <span className="font-medium">{supplier.supplierName}</span>
                    {supplier.isPreferred && <Badge variant="primary" size="sm" className="ml-2 align-middle">Preferido</Badge>}
                  </TableCell>
                  <TableCellNum>{supplier.unitPrice === null ? <span className={MUTED}>Sin precio</span> : formatCLP(supplier.unitPrice)}</TableCellNum>
                  <TableCell nowrap className="font-mono text-[13px]">{formatDate(supplier.lastUpdated)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
      )}
    </Section>
  )
}

/* ── Historial de precio ───────────────────────────────────────────────────── */

/**
 * Tabla compacta, sin gráfico: con pocas compras una línea de dos o tres puntos es ruido, y la comparación que
 * importa («antes → ahora», con el proveedor y el origen) se lee mejor en filas.
 */
export function PriceHistorySection({ history }: { history: SparePartPriceHistoryEntry[] }) {
  return (
    <Section id="rp-history" title="Historial de precio" description="Cada cambio de precio con su proveedor, del más reciente al más antiguo.">
      {history.length === 0 ? (
        <EmptyCard
          title="Sin cambios de precio"
          description="Cuando un proveedor cobre un precio distinto —al emitir una orden de compra o al conciliar una factura— queda anotado aquí."
        />
      ) : (
        <TableRoot aria-label="Tabla del historial de precio">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead className="text-right">Antes</TableHead>
                <TableHead className="text-right">Ahora</TableHead>
                <TableHead>Origen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell nowrap className="font-mono text-[13px]">{formatDate(entry.effectiveDate)}</TableCell>
                  <TableCell>{entry.supplierName}</TableCell>
                  <TableCellNum className={MUTED}>{entry.previousPrice === null ? "—" : formatCLP(entry.previousPrice)}</TableCellNum>
                  <TableCellNum className="font-medium">{entry.newPrice === null ? "Sin precio" : formatCLP(entry.newPrice)}</TableCellNum>
                  <TableCell>
                    {priceSourceLabel(entry.source)}
                    {entry.createdByName && <span className={`block text-xs ${MUTED}`}>{entry.createdByName}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
      )}
    </Section>
  )
}

/* ── Comprado para ─────────────────────────────────────────────────────────── */

export function PurchasedForSection({ usage, access }: { usage: SparePartVehicleUsage[]; access: SparePartLinkAccess }) {
  return (
    <Section id="rp-vehicles" title="Comprado para" description="Los equipos para los que se pidió este repuesto. Sirve para saber a qué máquinas les calza.">
      {usage.length === 0 ? (
        <EmptyCard
          title="Todavía no se pidió para ningún equipo"
          description="Cuando una solicitud de repuestos lleve este repuesto y un equipo, el equipo aparece aquí."
          action={access.canRequestParts ? <Button asChild size="sm" variant="secondary"><Link href="/solicitudes/nueva?tipo=repuestos">Pedir repuestos</Link></Button> : undefined}
        />
      ) : (
        <TableRoot aria-label="Tabla de equipos para los que se compró">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Equipo</TableHead>
                <TableHead>Marca y modelo</TableHead>
                <TableHead className="text-right">Pedidos</TableHead>
                <TableHead>Último pedido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.map((vehicle) => {
                const label = vehicle.vehicleCode && vehicle.vehicleCode !== vehicle.vehiclePlate
                  ? `${vehicle.vehicleCode} · ${vehicle.vehiclePlate}`
                  : vehicle.vehiclePlate
                const href = access.vehicleHref?.(vehicle.vehicleId) ?? null
                return (
                  <TableRow key={vehicle.vehicleId}>
                    <TableCell>
                      {href
                        ? <Link href={href} className="font-medium text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline">{label}</Link>
                        : <span className="font-medium">{label}</span>}
                    </TableCell>
                    <TableCell>{[vehicle.vehicleBrand, vehicle.vehicleModel].filter(Boolean).join(" ") || <span className={MUTED}>—</span>}</TableCell>
                    <TableCellNum>{vehicle.requestCount}</TableCellNum>
                    <TableCell nowrap className="font-mono text-[13px]">{formatDate(vehicle.lastRequestedAt)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableRoot>
      )}
    </Section>
  )
}

/* ── Últimas solicitudes y OC ──────────────────────────────────────────────── */

export function RecentLinesSection({ lines, access }: { lines: SparePartPurchaseLine[]; access: SparePartLinkAccess }) {
  return (
    <Section id="rp-lines" title="Últimas solicitudes y órdenes de compra" description="Las compras más recientes que incluyen este repuesto.">
      {lines.length === 0 ? (
        <EmptyCard
          title="Todavía no hay solicitudes ni órdenes con este repuesto"
          description="Aparecen aquí cuando alguien lo pide o Compras lo incluye en una orden de compra."
          action={access.canRequestParts ? <Button asChild size="sm" variant="secondary"><Link href="/solicitudes/nueva?tipo=repuestos">Pedir repuestos</Link></Button> : undefined}
        />
      ) : (
        <TableRoot aria-label="Tabla de últimas solicitudes y órdenes de compra">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Solicitud y OC</TableHead>
                <TableHead>Equipo</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Precio unitario</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => {
                const vehicleLabel = line.vehicleCode && line.vehicleCode !== line.vehiclePlate
                  ? `${line.vehicleCode} · ${line.vehiclePlate}`
                  : line.vehiclePlate
                const vehicleLink = line.vehicleId ? access.vehicleHref?.(line.vehicleId) ?? null : null
                return (
                  <TableRow key={`${line.orderId ?? "sin-oc"}-${line.requestItemId ?? index}`}>
                    <TableCell nowrap className="font-mono text-[13px]">{formatDate(line.date)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {line.requestId && line.requestCode
                          ? <Code href={access.canOpenRequests ? `/solicitudes/${line.requestId}` : null}>{line.requestCode}</Code>
                          : <span className={`text-xs ${MUTED}`}>Sin solicitud</span>}
                        {line.orderId && line.orderCode
                          ? <Code href={access.canOpenOrders ? `/compras/${line.orderId}` : null}>{line.orderCode}</Code>
                          : <span className={`text-xs ${MUTED}`}>Sin OC</span>}
                        {line.orderStatus && <StateBadge state={line.orderStatus} entity="oc" size="sm" />}
                      </div>
                      {line.supplierName && <p className={`mt-0.5 text-xs ${MUTED}`}>{line.supplierName}</p>}
                    </TableCell>
                    <TableCell nowrap>
                      {vehicleLabel
                        ? (vehicleLink
                          ? <Link href={vehicleLink} className="text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline">{vehicleLabel}</Link>
                          : vehicleLabel)
                        : <span className={MUTED}>—</span>}
                    </TableCell>
                    <TableCellNum>{formatQty(line.quantity)}</TableCellNum>
                    <TableCellNum>{line.unitPrice === null ? <span className={MUTED}>Sin precio</span> : formatCLP(line.unitPrice)}</TableCellNum>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableRoot>
      )}
    </Section>
  )
}

/** Resumen de una línea para la descripción de la página: «3 equipos» / «Sin compras». */
export function purchaseSummary(usage: SparePartVehicleUsage[]): string {
  return usage.length === 0 ? "Sin compras registradas" : `Comprado para ${plural(usage.length, "equipo", "equipos")}`
}

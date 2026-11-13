import type { ReactNode } from "react"
import Link from "next/link"
import { StateBadge } from "@/components/states/state-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DetailItem } from "@/components/ui/detail-item"
import { EmptyState } from "@/components/ui/empty-state"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
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
 *
 * Cada tabla tiene su versión en tarjetas bajo `md` (`md:hidden` + `hidden md:block`, el patrón de la
 * plataforma): a 390 px las tablas cortaban columnas y obligaban a desplazar dentro de la tarjeta.
 */

export interface SparePartLinkAccess {
  /** `flota:view` o, a falta de él, una vista de mantención de equipos: la ficha del equipo a la que enlazar. */
  vehicleHref: ((vehicleId: string) => string) | null
  /** `repuestos:view_all`: abre la solicitud. */
  canOpenRequests: boolean
  /** `purchasing:view`: abre la OC. */
  canOpenOrders: boolean
  /**
   * `repuestos:create`: el destino de «Pedir repuestos» en los vacíos (con el repuesto ya elegido si está
   * activo); `null` sin permiso.
   */
  requestPartsHref: string | null
}

function RequestPartsButton({ access }: { access: SparePartLinkAccess }) {
  if (!access.requestPartsHref) return null
  return <Button asChild size="sm" variant="secondary"><Link href={access.requestPartsHref}>Pedir repuestos</Link></Button>
}

/** La tabla en escritorio y las tarjetas en móvil; las dos quedan en el DOM. */
function Responsive({ cards, cardsLabel, table }: { cards: ReactNode; cardsLabel: string; table: ReactNode }) {
  return (
    <>
      <ul aria-label={cardsLabel} className="flex flex-col gap-2 md:hidden">{cards}</ul>
      <div className="hidden md:block">{table}</div>
    </>
  )
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
      action={access.requestPartsHref ? <RequestPartsButton access={access} /> : undefined}
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
        <Responsive
          cardsLabel="Proveedores y precios"
          cards={suppliers.map((supplier) => (
            <li key={supplier.supplierId}>
              <ResponsiveDataListCard
                title={supplier.supplierName}
                status={supplier.isPreferred ? <Badge variant="primary" size="sm">Preferido</Badge> : undefined}
              >
                <ResponsiveDataListField label="Precio unitario">
                  {supplier.unitPrice === null ? "Sin precio" : <span className="font-mono">{formatCLP(supplier.unitPrice)}</span>}
                </ResponsiveDataListField>
                <ResponsiveDataListField label="Actualizado"><span className="font-mono">{formatDate(supplier.lastUpdated)}</span></ResponsiveDataListField>
              </ResponsiveDataListCard>
            </li>
          ))}
          table={(
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
                      <TableCell nowrap className="font-mono text-sm">{formatDate(supplier.lastUpdated)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableRoot>
          )}
        />
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
        <Responsive
          cardsLabel="Historial de precio"
          cards={history.map((entry) => (
            <li key={entry.id}>
              <ResponsiveDataListCard
                title={entry.supplierName}
                description={<span className="font-mono">{formatDate(entry.effectiveDate)}</span>}
              >
                <ResponsiveDataListField label="Antes">
                  {entry.previousPrice === null ? "—" : <span className="font-mono">{formatCLP(entry.previousPrice)}</span>}
                </ResponsiveDataListField>
                <ResponsiveDataListField label="Ahora">
                  {entry.newPrice === null ? "Sin precio" : <span className="font-mono font-medium text-[var(--color-text)]">{formatCLP(entry.newPrice)}</span>}
                </ResponsiveDataListField>
                <ResponsiveDataListField label="Origen" className="col-span-2">
                  {priceSourceLabel(entry.source)}{entry.createdByName ? ` · ${entry.createdByName}` : ""}
                </ResponsiveDataListField>
              </ResponsiveDataListCard>
            </li>
          ))}
          table={(
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
                      <TableCell nowrap className="font-mono text-sm">{formatDate(entry.effectiveDate)}</TableCell>
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
        />
      )}
    </Section>
  )
}

/* ── Comprado para ─────────────────────────────────────────────────────────── */

function vehicleLabelOf(vehicle: { vehicleCode: string | null; vehiclePlate: string }): string {
  return vehicle.vehicleCode && vehicle.vehicleCode !== vehicle.vehiclePlate
    ? `${vehicle.vehicleCode} · ${vehicle.vehiclePlate}`
    : vehicle.vehiclePlate
}

function VehicleName({ label, href }: { label: string; href: string | null }) {
  return href
    ? <Link href={href} className="font-medium text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline">{label}</Link>
    : <span className="font-medium">{label}</span>
}

export function PurchasedForSection({ usage, access }: { usage: SparePartVehicleUsage[]; access: SparePartLinkAccess }) {
  return (
    <Section id="rp-vehicles" title="Comprado para" description="Los equipos para los que se compró este repuesto con orden de compra emitida. Sirve para saber a qué máquinas les calza.">
      {usage.length === 0 ? (
        <EmptyCard
          title="Todavía no se compró para ningún equipo"
          description="Cuando se emita una orden de compra con este repuesto pedido para un equipo, el equipo aparece aquí."
          action={access.requestPartsHref ? <RequestPartsButton access={access} /> : undefined}
        />
      ) : (
        <Responsive
          cardsLabel="Equipos para los que se compró"
          cards={usage.map((vehicle) => (
            <li key={vehicle.vehicleId}>
              <ResponsiveDataListCard
                title={<VehicleName label={vehicleLabelOf(vehicle)} href={access.vehicleHref?.(vehicle.vehicleId) ?? null} />}
                description={[vehicle.vehicleBrand, vehicle.vehicleModel].filter(Boolean).join(" ") || undefined}
              >
                <ResponsiveDataListField label="Compras">{vehicle.requestCount}</ResponsiveDataListField>
                <ResponsiveDataListField label="Último pedido"><span className="font-mono">{formatDate(vehicle.lastRequestedAt)}</span></ResponsiveDataListField>
              </ResponsiveDataListCard>
            </li>
          ))}
          table={(
            <TableRoot aria-label="Tabla de equipos para los que se compró">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Equipo</TableHead>
                    <TableHead>Marca y modelo</TableHead>
                    <TableHead className="text-right">Compras</TableHead>
                    <TableHead>Último pedido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.map((vehicle) => {
                    return (
                      <TableRow key={vehicle.vehicleId}>
                        <TableCell>
                          <VehicleName label={vehicleLabelOf(vehicle)} href={access.vehicleHref?.(vehicle.vehicleId) ?? null} />
                        </TableCell>
                        <TableCell>{[vehicle.vehicleBrand, vehicle.vehicleModel].filter(Boolean).join(" ") || <span className={MUTED}>—</span>}</TableCell>
                        <TableCellNum>{vehicle.requestCount}</TableCellNum>
                        <TableCell nowrap className="font-mono text-sm">{formatDate(vehicle.lastRequestedAt)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableRoot>
          )}
        />
      )}
    </Section>
  )
}

/* ── Últimas solicitudes y órdenes de compra ──────────────────────────────────────────────── */

function LineCodes({ line, access }: { line: SparePartPurchaseLine; access: SparePartLinkAccess }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {line.requestId && line.requestCode
        ? <Code href={access.canOpenRequests ? `/solicitudes/${line.requestId}` : null}>{line.requestCode}</Code>
        : <span className={`text-xs ${MUTED}`}>Sin solicitud</span>}
      {line.orderId && line.orderCode
        ? <Code href={access.canOpenOrders ? `/compras/${line.orderId}` : null}>{line.orderCode}</Code>
        : <span className={`text-xs ${MUTED}`}>Sin orden de compra</span>}
      {line.orderStatus && <StateBadge state={line.orderStatus} entity="oc" size="sm" />}
    </div>
  )
}

function LineVehicle({ line, access }: { line: SparePartPurchaseLine; access: SparePartLinkAccess }) {
  if (!line.vehiclePlate) return <span className={MUTED}>—</span>
  const label = vehicleLabelOf({ vehicleCode: line.vehicleCode, vehiclePlate: line.vehiclePlate })
  const href = line.vehicleId ? access.vehicleHref?.(line.vehicleId) ?? null : null
  return href
    ? <Link href={href} className="text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline">{label}</Link>
    : <>{label}</>
}

export function RecentLinesSection({ lines, access }: { lines: SparePartPurchaseLine[]; access: SparePartLinkAccess }) {
  return (
    <Section id="rp-lines" title="Últimas solicitudes y órdenes de compra" description="Las compras más recientes que incluyen este repuesto.">
      {lines.length === 0 ? (
        <EmptyCard
          title="Todavía no hay solicitudes ni órdenes con este repuesto"
          description="Aparecen aquí cuando alguien lo pide o Compras lo incluye en una orden de compra."
          action={access.requestPartsHref ? <RequestPartsButton access={access} /> : undefined}
        />
      ) : (
        <Responsive
          cardsLabel="Últimas solicitudes y órdenes de compra"
          cards={lines.map((line, index) => (
            <li key={`${line.orderId ?? "sin-oc"}-${line.requestItemId ?? index}`}>
              <ResponsiveDataListCard
                title={<LineCodes line={line} access={access} />}
                description={line.supplierName ?? undefined}
              >
                <ResponsiveDataListField label="Fecha"><span className="font-mono">{formatDate(line.date)}</span></ResponsiveDataListField>
                <ResponsiveDataListField label="Equipo"><LineVehicle line={line} access={access} /></ResponsiveDataListField>
                <ResponsiveDataListField label="Cantidad"><span className="font-mono">{formatQty(line.quantity)}</span></ResponsiveDataListField>
                <ResponsiveDataListField label="Precio unitario">
                  {line.unitPrice === null ? "Sin precio" : <span className="font-mono">{formatCLP(line.unitPrice)}</span>}
                </ResponsiveDataListField>
              </ResponsiveDataListCard>
            </li>
          ))}
          table={(
            <TableRoot aria-label="Tabla de últimas solicitudes y órdenes de compra">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Solicitud y orden de compra</TableHead>
                    <TableHead>Equipo</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead className="text-right">Precio unitario</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, index) => {
                    return (
                      <TableRow key={`${line.orderId ?? "sin-oc"}-${line.requestItemId ?? index}`}>
                        <TableCell nowrap className="font-mono text-sm">{formatDate(line.date)}</TableCell>
                        <TableCell>
                          <LineCodes line={line} access={access} />
                          {line.supplierName && <p className={`mt-0.5 text-xs ${MUTED}`}>{line.supplierName}</p>}
                        </TableCell>
                        <TableCell nowrap>
                          <LineVehicle line={line} access={access} />
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
        />
      )}
    </Section>
  )
}

/** Resumen de una línea para la descripción de la página: «3 equipos» / «Sin compras». */
export function purchaseSummary(usage: SparePartVehicleUsage[]): string {
  return usage.length === 0 ? "Sin compras registradas" : `Comprado para ${plural(usage.length, "equipo", "equipos")}`
}

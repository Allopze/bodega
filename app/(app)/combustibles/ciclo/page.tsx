import Link from "next/link"
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm"
import { redirect } from "next/navigation"
import { ArrowLeft, ArrowSquareOut, Database, WarningCircle } from "@phosphor-icons/react/dist/ssr"
import { settle } from "@/lib/async-settle"
import { db } from "@/db"
import { fuelCycleMovements, fuelProducts, fuelStorageLocations, fuelSuppliers, fuelVehicles, worksites } from "@/db/schema"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { getFuelCycleComparison, getFuelStorageBalances, differenceSeverity, type CycleDifference } from "@/lib/combustibles/fuel-cycle"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DatePicker } from "@/components/ui/date-picker"
import { CycleWorkbench } from "./cycle-workbench"
import { CycleStageChart, type CycleStagePoint } from "./cycle-stage-chart"
import { FilterSelect } from "../filter-select"

const liters = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 })
const dateTime = new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" })

type TraceStage = "received" | "delivered"

const CYCLE_FALLBACK = { received: null, registered: null, delivered: null, consumed: null, differences: { receivedVsRegistered: { status: "unavailable" as const, absolute: null, percent: null }, receivedVsDelivered: { status: "unavailable" as const, absolute: null, percent: null } } }

const sourceHref = (type: string | null, id: string | null) =>
  type === "fuel_load" && id
    ? `/combustibles/${id}`
    : type === "tae_submission" && id
      ? `/combustibles/tae/${id}`
      : null

function amount(value: { liters: number; records: number } | null) {
  return value ? `${liters.format(value.liters)} L` : "Sin registros"
}

function cycleQuery(filters: { from: string; to: string; worksiteId?: string; productId?: string }, stage?: TraceStage) {
  const query = new URLSearchParams({ desde: filters.from, hasta: filters.to })
  if (filters.worksiteId) query.set("faena", filters.worksiteId)
  if (filters.productId) query.set("producto", filters.productId)
  if (stage) query.set("etapa", stage)
  return `/combustibles/ciclo?${query.toString()}#movimientos-ciclo`
}

function registeredQuery(filters: { from: string; to: string; worksiteId?: string; productId?: string }) {
  const query = new URLSearchParams({ startDate: filters.from, endDate: filters.to })
  if (filters.worksiteId) query.set("faena", filters.worksiteId)
  if (filters.productId) query.set("productoId", filters.productId)
  return `/combustibles/facturas?${query.toString()}`
}

export default async function FuelCyclePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let session
  try { session = await requirePermission("combustibles:view") }
  catch { redirect("/forbidden") }

  const sp = await searchParams
  const from = typeof sp.desde === "string" ? sp.desde : new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().slice(0, 10)
  const to = typeof sp.hasta === "string" ? sp.hasta : new Date().toISOString().slice(0, 10)
  const worksiteId = typeof sp.faena === "string" ? sp.faena : undefined
  const productId = typeof sp.producto === "string" ? sp.producto : undefined
  const traceStage: TraceStage | undefined = sp.etapa === "received" || sp.etapa === "delivered" ? sp.etapa : undefined
  const filters = { from, to, worksiteId, productId }
  const fromTimestamp = `${from}T00:00:00.000Z`
  const toTimestamp = `${to}T23:59:59.999Z`
  const stageTypes = traceStage === "received"
    ? ["received"]
    : traceStage === "delivered"
      ? ["tank_delivery", "direct_delivery"]
      : undefined
  const scope = worksiteScopeSql(session, worksites.id)

  const [comparison, balances, worksitesList, products, suppliers, locations, vehicles, movements] = await Promise.all([
    settle(getFuelCycleComparison(session, { from: fromTimestamp, to: toTimestamp, worksiteId, productId }), CYCLE_FALLBACK, "cycle-comparison"),
    settle(getFuelStorageBalances(session, { from: fromTimestamp, to: toTimestamp, worksiteId, productId }), [], "cycle-balances"),
    settle(db.query.worksites.findMany({ where: scope, orderBy: [worksites.name] }), [], "cycle-worksites"),
    settle(db.query.fuelProducts.findMany({ where: eq(fuelProducts.isActive, true), orderBy: [fuelProducts.name] }), [], "cycle-products"),
    settle(db.query.fuelSuppliers.findMany({ where: eq(fuelSuppliers.isActive, true), orderBy: [fuelSuppliers.name] }), [], "cycle-suppliers"),
    settle(
      db.query.fuelStorageLocations.findMany({
        where: and(eq(fuelStorageLocations.isActive, true), worksiteScopeSql(session, fuelStorageLocations.worksiteId)),
        with: { worksite: { columns: { name: true } }, product: { columns: { name: true } } },
        orderBy: [fuelStorageLocations.name],
      }),
      [],
      "cycle-locations",
    ),
    settle(
      db.query.fuelVehicles.findMany({
        where: and(eq(fuelVehicles.isActive, true), worksiteScopeSql(session, fuelVehicles.worksiteId)),
        orderBy: [fuelVehicles.plate],
      }),
      [],
      "cycle-vehicles",
    ),
    settle(
      db.query.fuelCycleMovements.findMany({
        where: and(
          gte(fuelCycleMovements.occurredAt, fromTimestamp),
          lte(fuelCycleMovements.occurredAt, toTimestamp),
          worksiteScopeSql(session, fuelCycleMovements.worksiteId),
          worksiteId ? eq(fuelCycleMovements.worksiteId, worksiteId) : undefined,
          productId ? eq(fuelCycleMovements.productId, productId) : undefined,
          stageTypes ? inArray(fuelCycleMovements.eventType, stageTypes) : undefined,
        ),
        with: {
          worksite: { columns: { name: true } },
          product: { columns: { name: true } },
          sourceLocation: { columns: { name: true } },
          targetLocation: { columns: { name: true } },
          vehicle: { columns: { plate: true, code: true } },
          supplier: { columns: { name: true } },
        },
        orderBy: [desc(fuelCycleMovements.occurredAt)],
        limit: 100,
      }),
      [],
      "cycle-movements",
    ),
  ])

  const canCreate = can(session, "combustibles:create")
  const receivedHref = cycleQuery(filters, "received")
  const deliveredHref = cycleQuery(filters, "delivered")
  const registeredHref = registeredQuery(filters)
  const receivedVsRegistered = comparison.differences.receivedVsRegistered
  const receivedVsDelivered = comparison.differences.receivedVsDelivered

  return (
    <PageContainer>
      <PageHeader
        title="Ciclo físico de combustible"
        description="Recepciones, transferencias y entregas conciliadas contra las cargas registradas."
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Ciclo físico" }]} />}
        actions={(
          <div className="flex gap-2">
            <Button asChild variant="secondary" size="sm"><Link href="/combustibles"><ArrowLeft size={16} />Panel</Link></Button>
            <CycleWorkbench canCreate={canCreate} worksites={worksitesList} products={products} suppliers={suppliers} locations={locations} vehicles={vehicles} />
          </div>
        )}
      />

      <form className="mb-5 grid gap-3 border-y border-[var(--color-border)] py-4 md:grid-cols-5">
        <label className="grid gap-1 text-xs font-medium">Desde<DatePicker name="desde" defaultValue={from} placeholder="Desde" /></label>
        <label className="grid gap-1 text-xs font-medium">Hasta<DatePicker name="hasta" defaultValue={to} placeholder="Hasta" /></label>
        <label className="grid gap-1 text-xs font-medium">Faena<FilterSelect name="faena" defaultValue={worksiteId} options={worksitesList.map((item) => ({ value: item.id, label: item.name }))} placeholder="Todas las autorizadas" /></label>
        <label className="grid gap-1 text-xs font-medium">Producto<FilterSelect name="producto" defaultValue={productId} options={products.map((item) => ({ value: item.id, label: item.name }))} placeholder="Todos" /></label>
        <div className="flex items-end"><Button type="submit" variant="secondary" className="w-full">Aplicar</Button></div>
      </form>

      <section className="grid gap-px overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-border)] md:grid-cols-3" aria-label="Etapas del ciclo">
        <Metric label="Recibido físico" value={amount(comparison.received)} detail={comparison.received ? `${comparison.received.records} eventos` : "Registra una recepción"} trace={<TraceLink href={receivedHref}>Abrir recepciones</TraceLink>} />
        <Metric label="Cargas registradas" value={amount(comparison.registered)} detail={comparison.registered ? `${comparison.registered.records} registros` : "Registra una carga"} trace={<TraceLink href={registeredHref}>Abrir cargas</TraceLink>} />
        <Metric label="Entregado a equipos" value={amount(comparison.delivered)} detail={comparison.delivered ? `${comparison.delivered.records} eventos` : "Sin entregas físicas"} trace={<TraceLink href={deliveredHref}>Abrir entregas</TraceLink>} />
      </section>

      <section className="mt-px grid gap-px overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-border)] md:grid-cols-3" aria-label="Diferencias y consumo">
        <DifferenceMetric
          label="Diferencia recibido / registrado"
          difference={receivedVsRegistered}
          trace={<span className="flex flex-wrap gap-x-3"><TraceLink href={receivedHref}>Origen recibido</TraceLink><TraceLink href={registeredHref}>Origen registrado</TraceLink></span>}
        />
        <DifferenceMetric
          label="Diferencia recibido / entregado"
          difference={receivedVsDelivered}
          trace={<span className="flex flex-wrap gap-x-3"><TraceLink href={receivedHref}>Origen recibido</TraceLink><TraceLink href={deliveredHref}>Origen entregado</TraceLink></span>}
        />
        <Metric label="Consumido" value="Aún no disponible" detail="Se calculará cuando se registren entregas a equipos en el período. El consumo no se estima a partir de recibido o entregado." trace={<TraceLink href={deliveredHref}>Registrar entrega</TraceLink>} />
      </section>

      <section className="mt-7">
        <div className="mb-3">
          <p className="text-eyebrow">Flujo</p>
          <h2 className="text-lg font-semibold tracking-tight">Recibido → registrado → entregado → consumido</h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">¿Dónde se pierde combustible entre etapas? Cada caída entre barras es la diferencia entre esas dos etapas.</p>
        </div>
        <CycleStageChart stages={[
          { stage: "Recibido", liters: comparison.received?.liters ?? null, records: comparison.received?.records ?? null },
          { stage: "Registrado", liters: comparison.registered?.liters ?? null, records: comparison.registered?.records ?? null },
          { stage: "Entregado", liters: comparison.delivered?.liters ?? null, records: comparison.delivered?.records ?? null },
          { stage: "Consumido", liters: null, records: null },
        ] satisfies CycleStagePoint[]} />
      </section>

      <section className="mt-7">
        <div className="mb-3">
          <p className="text-eyebrow">Saldo</p>
          <h2 className="text-lg font-semibold tracking-tight">Saldo por vasija</h2>
        </div>
        {balances.length === 0 ? (
          <div className="flex gap-3 border border-dashed border-[var(--color-border-strong)] p-6 text-sm text-[var(--color-text-muted)]"><Database size={20} />No hay vasijas activas en este filtro.</div>
        ) : (
          <div className="overflow-x-auto border border-[var(--color-border)]">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-[var(--color-surface-2)] text-left th-type"><tr><th scope="col" className="p-3">Vasija</th><th>Recibido</th><th>Entregado</th><th>Saldo</th><th>Capacidad</th></tr></thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {balances.map((balance) => {
                  const overCapacity = balance.capacityLiters != null && balance.balanceLiters > balance.capacityLiters
                  return (
                    <tr key={balance.storageLocationId}>
                      <td className="p-3 font-medium">{balance.name}</td>
                      <td className="font-mono">{liters.format(balance.receivedLiters + balance.transferInLiters)} L</td>
                      <td className="font-mono">{liters.format(balance.deliveredLiters + balance.transferOutLiters)} L</td>
                      <td className={`font-mono ${overCapacity ? "text-[var(--color-danger)]" : ""}`}>{liters.format(balance.balanceLiters)} L{overCapacity && " ⚠"}</td>
                      <td className="font-mono text-[var(--color-text-muted)]">{balance.capacityLiters != null ? `${liters.format(balance.capacityLiters)} L` : "Sin capacidad informada"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">El saldo no distingue merma real de una carga no registrada: para eso falta el aforo físico periódico del estanque.</p>
      </section>

      <section id="movimientos-ciclo" className="mt-7 scroll-mt-24">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-eyebrow">Trazabilidad</p>
            <h2 className="text-lg font-semibold tracking-tight">Movimientos del ciclo</h2>
          </div>
          <div className="flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
            {traceStage && <Button asChild variant="ghost" size="sm"><Link href={cycleQuery(filters)}>Quitar filtro de etapa</Link></Button>}
            <span>Últimos {movements.length} registros{traceStage === "received" ? " recibidos" : traceStage === "delivered" ? " entregados" : ""}</span>
          </div>
        </div>
        {movements.length === 0 ? (
          <div className="flex gap-3 border border-dashed border-[var(--color-border-strong)] p-6 text-sm text-[var(--color-text-muted)]"><Database size={20} />No hay movimientos físicos en este filtro.</div>
        ) : (
          <div className="overflow-x-auto border border-[var(--color-border)]">
            <table className="w-full min-w-[850px] text-sm">
              <thead className="bg-[var(--color-surface-2)] text-left th-type"><tr><th scope="col" className="p-3">Momento</th><th>Evento</th><th>Faena / producto</th><th>Ruta</th><th>Litros</th><th>Origen documental</th></tr></thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {movements.map((movement) => {
                  const href = sourceHref(movement.sourceType, movement.sourceId)
                  return (
                    <tr key={movement.id}>
                      <td className="p-3 font-mono text-xs">{dateTime.format(new Date(movement.occurredAt))}</td>
                      <td className="font-medium">{movement.eventType === "received" ? "Recepción" : movement.eventType === "transfer" ? "Transferencia" : movement.eventType === "tank_delivery" ? "Entrega desde estanque" : "Entrega directa"}</td>
                      <td>{movement.worksite.name}<span className="block text-xs text-[var(--color-text-muted)]">{movement.product.name}</span></td>
                      <td>{movement.sourceLocation?.name ?? movement.supplier?.name ?? "—"} <span className="text-[var(--color-text-muted)]">→</span> {movement.targetLocation?.name ?? movement.vehicle?.code ?? movement.vehicle?.plate ?? "—"}</td>
                      <td className="font-mono">{liters.format(movement.quantity)} L</td>
                      <td>{href ? <Link className="inline-flex items-center gap-1 text-[var(--color-primary-ink)] hover:underline" href={href}>Abrir registro <ArrowSquareOut size={14} /></Link> : <span className="inline-flex items-center gap-1 text-[var(--color-text-muted)]"><WarningCircle size={14} />Sin registro asociado</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageContainer>
  )
}

function TraceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary-ink)] hover:underline">{children}<ArrowSquareOut size={12} /></Link>
}

function Metric({ label, value, detail, trace }: { label: string; value: string; detail: string; trace?: React.ReactNode }) {
  return <div className="bg-[var(--color-surface)] p-4"><p className="text-xs font-medium text-[var(--color-text-muted)]">{label}</p><p className="mt-2 text-xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-xs text-[var(--color-text-muted)]">{detail}</p>{trace && <div className="mt-3">{trace}</div>}</div>
}

const SEVERITY_BADGE = {
  normal:      { label: "Normal", variant: "success" as const },
  warning:     { label: "Advertencia", variant: "warning" as const },
  critical:    { label: "Crítico", variant: "danger" as const },
  unavailable: { label: "Sin datos", variant: "default" as const },
}

function DifferenceMetric({ label, difference, trace }: { label: string; difference: CycleDifference; trace?: React.ReactNode }) {
  const severity = differenceSeverity(difference)
  const badge = SEVERITY_BADGE[severity]
  return (
    <div className="bg-[var(--color-surface)] p-4">
      <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-[var(--color-text-muted)]">{label}</p><Badge variant={badge.variant} size="sm">{badge.label}</Badge></div>
      <p className="mt-2 text-xl font-semibold tracking-tight">{difference.status === "available" ? `${liters.format(difference.absolute)} L` : "—"}</p>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">{difference.status === "available" ? (difference.percent === null ? "base cero" : `${difference.percent.toFixed(1)}%`) : "Registra las dos etapas para comparar"}</p>
      {trace && <div className="mt-3">{trace}</div>}
    </div>
  )
}

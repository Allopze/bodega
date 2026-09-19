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
import { MetaBadge } from "@/components/states/state-badge"
import { DatePicker } from "@/components/ui/date-picker"
import { addDaysToPlainDate, formatQty, todayInChile } from "@/lib/utils"
import { CycleWorkbench } from "./cycle-workbench"
import { CycleStageChart, type CycleStagePoint } from "./cycle-stage-chart"
import { FilterSelect } from "@/components/ui/filter-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"

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
  return value ? `${formatQty(value.liters, undefined, { maximumFractionDigits: 2 })} L` : "Sin registros"
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
  // Período por defecto en calendario chileno, no UTC.
  const today = todayInChile()
  const from = typeof sp.desde === "string" ? sp.desde : addDaysToPlainDate(today, -30)
  const to = typeof sp.hasta === "string" ? sp.hasta : today
  const worksiteId = typeof sp.faena === "string" ? sp.faena : undefined
  const productId = typeof sp.producto === "string" ? sp.producto : undefined
  const traceStage: TraceStage | undefined = sp.etapa === "received" || sp.etapa === "delivered" ? sp.etapa : undefined
  const filters = { from, to, worksiteId, productId }
  // El rango son días CIVILES chilenos, y `occurredAt` es un instante. Anclar
  // los extremos en "Z" recortaba una ventana UTC: incluía las últimas 4 horas
  // del día chileno anterior y perdía las 4 últimas del día final, así que los
  // movimientos de la tabla no cuadraban con los tiles de la misma página.
  // Sin sufijo de zona, `new Date` interpreta en la zona del proceso
  // (America/Santiago, ver docker-compose.yml).
  const fromTimestamp = new Date(`${from}T00:00:00.000`).toISOString()
  const toTimestamp = new Date(`${to}T23:59:59.999`).toISOString()
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

      {/* 4 tiles (regla A1): las 3 etapas físicas más la diferencia que importa
          operativamente — recibido vs. entregado, la merma de punta a punta.
          La diferencia recibido/registrado (conciliación documental) y el tile
          de "Consumido" (sin fuente de datos, siempre "Aún no disponible")
          se retiraron — ninguno tenía una cifra real que mostrar. */}
      <section className="grid gap-px overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-2 lg:grid-cols-4" aria-label="Etapas del ciclo y diferencia">
        <Metric label="Recibido físico" value={amount(comparison.received)} detail={comparison.received ? `${comparison.received.records} eventos` : "Registra una recepción"} trace={<TraceLink href={receivedHref}>Abrir recepciones</TraceLink>} />
        <Metric label="Cargas registradas" value={amount(comparison.registered)} detail={comparison.registered ? `${comparison.registered.records} registros` : "Registra una carga"} trace={<TraceLink href={registeredHref}>Abrir cargas</TraceLink>} />
        <Metric label="Entregado a equipos" value={amount(comparison.delivered)} detail={comparison.delivered ? `${comparison.delivered.records} eventos` : "Sin entregas físicas"} trace={<TraceLink href={deliveredHref}>Abrir entregas</TraceLink>} />
        <DifferenceMetric
          label="Diferencia recibido / entregado"
          difference={receivedVsDelivered}
          trace={<span className="flex flex-wrap gap-x-3"><TraceLink href={receivedHref}>Origen recibido</TraceLink><TraceLink href={deliveredHref}>Origen entregado</TraceLink></span>}
        />
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
          <p className="text-eyebrow">Nivel</p>
          <h2 className="text-lg font-semibold tracking-tight">Nivel por estanque</h2>
        </div>
        {balances.length === 0 ? (
          <div className="flex gap-3 border border-dashed border-[var(--color-border-strong)] p-6 text-sm text-[var(--color-text-muted)]"><Database size={20} />No hay estanques activas en este filtro.</div>
        ) : (
          <div className="overflow-x-auto border border-[var(--color-border)]">
            <TableRoot>
            <Table className="min-w-[700px]">
              <caption className="sr-only">Nivel de los estanques de combustible</caption>
              {/*
                COM-001 (auditoría 2026-09-14): la columna se llamaba «Saldo» y
                mostraba el flujo neto del período —negativo si el rango sólo
                contenía entregas—, y aun así se comparaba con la capacidad
                física del estanque. Ahora la apertura es una columna propia y
                el nivel es la suma, que es lo único comparable con la capacidad.
              */}
              <TableHeader><TableRow><TableHead>Estanque</TableHead><TableHead>Al inicio</TableHead><TableHead>Recibido</TableHead><TableHead>Entregado</TableHead><TableHead>Nivel</TableHead><TableHead>Capacidad</TableHead></TableRow></TableHeader>
              <TableBody>
                {balances.map((balance) => {
                  const overCapacity = balance.capacityLiters != null && balance.balanceLiters > balance.capacityLiters
                  return (
                    <TableRow key={balance.storageLocationId}>
                      <TableCell className="font-medium">{balance.name}</TableCell>
                      <TableCell className="font-mono text-[var(--color-text-muted)]">{formatQty(balance.openingLiters, undefined, { maximumFractionDigits: 2 })} L</TableCell>
                      <TableCell className="font-mono">{formatQty(balance.receivedLiters + balance.transferInLiters, undefined, { maximumFractionDigits: 2 })} L</TableCell>
                      <TableCell className="font-mono">{formatQty(balance.deliveredLiters + balance.transferOutLiters, undefined, { maximumFractionDigits: 2 })} L</TableCell>
                      <TableCell className={`font-mono ${overCapacity ? "text-[var(--color-danger)]" : ""}`}>{formatQty(balance.balanceLiters, undefined, { maximumFractionDigits: 2 })} L{overCapacity && " ⚠"}</TableCell>
                      <TableCell className="font-mono text-[var(--color-text-muted)]">{balance.capacityLiters != null ? `${formatQty(balance.capacityLiters, undefined, { maximumFractionDigits: 2 })} L` : "Sin capacidad informada"}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            </TableRoot>
          </div>
        )}
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">El nivel arrastra todo lo registrado antes del período («Al inicio») y le suma el movimiento del rango. No distingue merma real de una carga no registrada: para eso falta el aforo físico periódico del estanque.</p>
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
            <TableRoot>
            <Table className="min-w-[850px]">
              <caption className="sr-only">Movimientos del ciclo de combustible</caption>
              <TableHeader><TableRow><TableHead>Momento</TableHead><TableHead>Evento</TableHead><TableHead>Faena / producto</TableHead><TableHead>Ruta</TableHead><TableHead>Litros</TableHead><TableHead>Origen documental</TableHead></TableRow></TableHeader>
              <TableBody>
                {movements.map((movement) => {
                  const href = sourceHref(movement.sourceType, movement.sourceId)
                  return (
                    <TableRow key={movement.id}>
                      <TableCell className="font-mono text-xs">{dateTime.format(new Date(movement.occurredAt))}</TableCell>
                      <TableCell className="font-medium">{movement.eventType === "received" ? "Recepción" : movement.eventType === "transfer" ? "Transferencia" : movement.eventType === "tank_delivery" ? "Entrega desde estanque" : "Entrega directa"}</TableCell>
                      <TableCell>{movement.worksite.name}<span className="block text-xs text-[var(--color-text-muted)]">{movement.product.name}</span></TableCell>
                      <TableCell>{movement.sourceLocation?.name ?? movement.supplier?.name ?? "—"} <span className="text-[var(--color-text-muted)]">→</span> {movement.targetLocation?.name ?? movement.vehicle?.code ?? movement.vehicle?.plate ?? "—"}</TableCell>
                      <TableCell className="font-mono">{formatQty(movement.quantity, undefined, { maximumFractionDigits: 2 })} L</TableCell>
                      <TableCell>{href ? <Link className="inline-flex min-h-6 items-center gap-1 text-[var(--color-primary-ink)] hover:underline" href={href}>Abrir registro <ArrowSquareOut size={14} /></Link> : <span className="inline-flex min-h-6 items-center gap-1 text-[var(--color-text-muted)]"><WarningCircle size={14} />Sin registro asociado</span>}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            </TableRoot>
          </div>
        )}
      </section>
    </PageContainer>
  )
}

function TraceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="inline-flex min-h-6 items-center gap-1 text-xs font-medium text-[var(--color-primary-ink)] hover:underline">{children}<ArrowSquareOut size={12} /></Link>
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
      <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-[var(--color-text-muted)]">{label}</p><MetaBadge meta={{ label: `${badge.label}`, variant: badge.variant }} /></div>
      <p className="mt-2 text-xl font-semibold tracking-tight">{difference.status === "available" ? `${formatQty(difference.absolute, undefined, { maximumFractionDigits: 2 })} L` : "—"}</p>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">{difference.status === "available" ? (difference.percent === null ? "base cero" : `${difference.percent.toFixed(1)}%`) : "Registra las dos etapas para comparar"}</p>
      {trace && <div className="mt-3">{trace}</div>}
    </div>
  )
}

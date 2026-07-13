import Link from "next/link"
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm"
import { redirect } from "next/navigation"
import { ArrowLeft, ArrowSquareOut, Database, WarningCircle } from "@phosphor-icons/react/dist/ssr"
import { db } from "@/db"
import { fuelCycleMovements, fuelProducts, fuelStorageLocations, fuelSuppliers, fuelVehicles, worksites } from "@/db/schema"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { getFuelCycleComparison } from "@/lib/combustibles/fuel-cycle"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { CycleWorkbench } from "./cycle-workbench"

const liters = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 })
const dateTime = new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" })

type TraceStage = "received" | "delivered"

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

  const [comparison, worksitesList, products, suppliers, locations, vehicles, movements] = await Promise.all([
    getFuelCycleComparison(session, { from: fromTimestamp, to: toTimestamp, worksiteId, productId }),
    db.query.worksites.findMany({ where: scope, orderBy: [worksites.name] }),
    db.query.fuelProducts.findMany({ where: eq(fuelProducts.isActive, true), orderBy: [fuelProducts.name] }),
    db.query.fuelSuppliers.findMany({ where: eq(fuelSuppliers.isActive, true), orderBy: [fuelSuppliers.name] }),
    db.query.fuelStorageLocations.findMany({
      where: and(eq(fuelStorageLocations.isActive, true), worksiteScopeSql(session, fuelStorageLocations.worksiteId)),
      with: { worksite: { columns: { name: true } }, product: { columns: { name: true } } },
      orderBy: [fuelStorageLocations.name],
    }),
    db.query.fuelVehicles.findMany({
      where: and(eq(fuelVehicles.isActive, true), worksiteScopeSql(session, fuelVehicles.worksiteId)),
      orderBy: [fuelVehicles.plate],
    }),
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
  ])

  const canCreate = can(session, "combustibles:create")
  const receivedHref = cycleQuery(filters, "received")
  const deliveredHref = cycleQuery(filters, "delivered")
  const registeredHref = registeredQuery(filters)
  const difference = comparison.differences.receivedVsRegistered

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
        <label className="grid gap-1 text-xs font-medium">Desde<input name="desde" type="date" defaultValue={from} className="control" /></label>
        <label className="grid gap-1 text-xs font-medium">Hasta<input name="hasta" type="date" defaultValue={to} className="control" /></label>
        <label className="grid gap-1 text-xs font-medium">Faena<select name="faena" defaultValue={worksiteId} className="control"><option value="">Todas las autorizadas</option>{worksitesList.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="grid gap-1 text-xs font-medium">Producto<select name="producto" defaultValue={productId} className="control"><option value="">Todos</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div className="flex items-end"><Button type="submit" variant="secondary" className="w-full">Aplicar</Button></div>
      </form>

      <section className="grid gap-px overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-border)] md:grid-cols-4" aria-label="Conciliación">
        <Metric label="Recibido físico" value={amount(comparison.received)} detail={comparison.received ? `${comparison.received.records} eventos` : "Registra una recepción"} trace={<TraceLink href={receivedHref}>Abrir recepciones</TraceLink>} />
        <Metric label="Cargas registradas" value={amount(comparison.registered)} detail={comparison.registered ? `${comparison.registered.records} registros` : "Sin fuente homologada"} trace={<TraceLink href={registeredHref}>Abrir cargas</TraceLink>} />
        <Metric label="Entregado a equipos" value={amount(comparison.delivered)} detail={comparison.delivered ? `${comparison.delivered.records} eventos` : "Sin entregas físicas"} trace={<TraceLink href={deliveredHref}>Abrir entregas</TraceLink>} />
        <Metric
          label="Diferencia recibido / registrado"
          value={difference.status === "available" ? `${liters.format(difference.absolute)} L` : "No disponible"}
          detail={difference.status === "available" ? (difference.percent === null ? "base cero" : `${difference.percent.toFixed(1)}%`) : "Falta una de las fuentes"}
          trace={<span className="flex flex-wrap gap-x-3"><TraceLink href={receivedHref}>Origen recibido</TraceLink><TraceLink href={registeredHref}>Origen registrado</TraceLink></span>}
        />
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
              <thead className="bg-[var(--color-surface-2)] text-left text-xs text-[var(--color-text-muted)]"><tr><th className="p-3">Momento</th><th>Evento</th><th>Faena / producto</th><th>Ruta</th><th>Litros</th><th>Origen documental</th></tr></thead>
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
                      <td>{href ? <Link className="inline-flex items-center gap-1 text-[var(--color-primary-ink)] hover:underline" href={href}>Abrir registro <ArrowSquareOut size={14} /></Link> : <span className="inline-flex items-center gap-1 text-[var(--color-text-muted)]"><WarningCircle size={14} />Sin fuente disponible</span>}</td>
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

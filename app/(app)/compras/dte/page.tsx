import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { and, desc, eq, inArray, isNull, isNotNull, ne, or } from "drizzle-orm"
import { Receipt } from "@phosphor-icons/react/dist/ssr"
import { db } from "@/db"
import { dteDocuments, purchaseOrderInvoices, fuelLoads } from "@/db/schema"
import { can, requirePermission } from "@/lib/auth/can"
import { requireDteCodEmp, DteCodEmpMissingError, DTE_COD_EMP_MISSING_MESSAGE } from "@/lib/services/dte-portal/require-cod-emp"
import { dteTipoLabel, estadoPlataformaLabel } from "@/lib/services/dte-portal/labels"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { EmptyState } from "@/components/ui/empty-state"
import { MetaBadge } from "@/components/states/state-badge"
import { formatCLP, todayInChile } from "@/lib/utils"
import { logger } from "@/lib/logger"
import {
  reconciliationMonths,
  shapeDteCoverage,
  shapeReconciliationMonths,
} from "@/lib/purchasing/reconciliation-charts"
import { getDteCoverageByPeriod, getOrderReconciliationByMonth } from "@/lib/services/purchasing-module/reconciliation-overview"
import { DteCharts } from "./dte-charts"
import { PeriodPicker } from "@/components/ui/period-picker"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import Link from "next/link"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Documentos DTE" }

const DISCREPANCY_TOLERANCE_CLP = 1
/**
 * Una consulta de los gráficos que puede fallar sin tumbar la lista: se anota y la
 * página avisa. `value` queda `null` al fallar, igual que cuando el dato no aplica;
 * `failed` es lo que los distingue.
 */
async function attempt<T>(promise: Promise<T>, label: string): Promise<{ value: T | null; failed: boolean }> {
  try {
    return { value: await promise, failed: false }
  } catch (error) {
    logger.error(`[compras/dte] No se pudo calcular ${label}`, error)
    return { value: null, failed: true }
  }
}

/** Rótulo del filtro `?vinculo=` que la lista deja a la vista (no hay otro control para quitarlo). */
const VINCULO_LABELS: Record<string, string> = {
  sin_oc: "los DTE sin vincular",
  oc: "los DTE vinculados a una OC",
  combustible: "los DTE vinculados a combustible",
  discrepancia: "los DTE con discrepancia de monto",
}
/** Tope de filas en pantalla. Se pide una de más para saber si hubo recorte. */
const ROW_LIMIT = 300

/**
 * Lista mínima de documentos DTE recibidos (Bandeja de Entrada), aterrizaje
 * de los tiles del Dashboard. Por defecto muestra el mes actual (hora de
 * Chile) y `?periodo=YYYY-MM` navega meses anteriores. Sin paginación a propósito,
 * pero el recorte se declara en pantalla: un mes real trae ~681 documentos y
 * antes se cortaba en 300 en silencio.
 */
export default async function DteListPage({
  searchParams,
}: {
  searchParams: Promise<{ vinculo?: string; tipo?: string; periodo?: string }>
}) {
  let session
  try { session = await requirePermission("purchasing:view") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/compras")}`) }

  const { vinculo, tipo, periodo: periodoParam } = await searchParams
  // Sin `codEmp` configurado la consulta no calza con ninguna fila histórica:
  // hay que decir "no configurado", no "sin documentos".
  let codEmp: string
  try { codEmp = await requireDteCodEmp() }
  catch (error) {
    if (!(error instanceof DteCodEmpMissingError)) throw error
    return (
      <PageContainer>
        <PageHeader
          title="Documentos DTE"
          description="Documentos tributarios recibidos de proveedores. Solo lectura del portal DTE FacturaEnLínea."
          breadcrumb={
            <Breadcrumbs items={[
              { label: "Inicio", href: "/dashboard" },
              { label: "Compras", href: "/compras" },
              { label: "Documentos DTE" },
            ]} />
          }
        />
        <EmptyState
          icon={<Receipt size={28} />}
          title="Sincronización DTE sin configurar"
          description={DTE_COD_EMP_MISSING_MESSAGE}
        />
      </PageContainer>
    )
  }
  // Mes actual en hora de Chile: con `toISOString()` (UTC) el cambio de mes
  // llegaba horas antes y dejaba la bandeja "vacía" la noche del día 31
  // (auditoría UI/UX 2026-08-05, A4). El período es navegable por la URL.
  const currentPeriod = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit",
  }).format(new Date()).slice(0, 7)
  const periodo = periodoParam && /^\d{4}-\d{2}$/.test(periodoParam) ? periodoParam : currentPeriod

  const conditions = [eq(dteDocuments.codEmp, codEmp), eq(dteDocuments.periodo, periodo)]
  if (tipo) conditions.push(eq(dteDocuments.tipoDte, tipo))
  // El filtro de negocio va en el WHERE, no después del recorte: filtrando en
  // memoria sobre los 300 más recientes, los DTE sin vínculo de la primera
  // quincena quedaban declarados inexistentes.
  if (vinculo === "sin_oc") {
    conditions.push(isNull(dteDocuments.purchaseOrderInvoiceId), isNull(dteDocuments.fuelLoadId))
  } else if (vinculo === "oc") {
    conditions.push(isNotNull(dteDocuments.purchaseOrderInvoiceId))
  } else if (vinculo === "combustible") {
    conditions.push(isNotNull(dteDocuments.fuelLoadId))
  } else if (vinculo === "discrepancia") {
    // La discrepancia sólo existe contra una entidad vinculada; el monto de
    // esa entidad se compara en memoria, pero el universo ya viene acotado.
    conditions.push(or(isNotNull(dteDocuments.purchaseOrderInvoiceId), isNotNull(dteDocuments.fuelLoadId))!)
  }

  // Los tres vínculos son los de la cobertura del gráfico de arriba, que no cuenta los
  // anulados en el SII: la lista a la que lleva una barra debe contar lo mismo.
  if (vinculo === "sin_oc" || vinculo === "oc" || vinculo === "combustible") {
    conditions.push(or(isNull(dteDocuments.estadoSii), ne(dteDocuments.estadoSii, "anulado"))!)
  }

  // Gráficos de cobertura (CHART-034). Una falla de sus consultas no tumba la lista:
  // se avisa y la lista sigue siendo la fuente de verdad.
  const chartsToday = todayInChile()
  const chartMonths = reconciliationMonths(chartsToday)
  const [orderResult, dteResult] = await Promise.all([
    attempt(getOrderReconciliationByMonth(session, { today: chartsToday }), "conciliación de OC"),
    attempt(getDteCoverageByPeriod(session, codEmp, { today: chartsToday }), "cobertura DTE"),
  ])
  const chartsFailed = orderResult.failed || dteResult.failed
  const orderRows = orderResult.value
  // `null` en la cobertura es «no la ve un rol acotado a faenas», no «falló».
  const dteRows = dteResult.value
  const orderShape = orderRows ? shapeReconciliationMonths(orderRows, chartMonths, chartsToday) : null
  const dteShape = dteRows ? shapeDteCoverage(dteRows, chartMonths, chartsToday) : null

  const found = await db.query.dteDocuments.findMany({
    where: and(...conditions),
    orderBy: [desc(dteDocuments.fechaEmision)],
    limit: ROW_LIMIT + 1,
    columns: {
      id: true, tipoDte: true, folio: true, rutEmisor: true, razonSocialEmisor: true,
      fechaEmision: true, montoTotal: true, estadoPlataforma: true, purchaseOrderInvoiceId: true, fuelLoadId: true,
    },
  })
  const truncated = found.length > ROW_LIMIT
  const docs = truncated ? found.slice(0, ROW_LIMIT) : found

  const ocIds = docs.flatMap((d) => (d.purchaseOrderInvoiceId ? [d.purchaseOrderInvoiceId] : []))
  const fuelIds = docs.flatMap((d) => (d.fuelLoadId ? [d.fuelLoadId] : []))
  const [invoices, loads] = await Promise.all([
    ocIds.length > 0
      ? db.query.purchaseOrderInvoices.findMany({ where: inArray(purchaseOrderInvoices.id, ocIds), columns: { id: true, amount: true } })
      : Promise.resolve([]),
    fuelIds.length > 0
      ? db.query.fuelLoads.findMany({ where: inArray(fuelLoads.id, fuelIds), columns: { id: true, totalAmount: true } })
      : Promise.resolve([]),
  ])
  const invoiceAmountById = new Map(invoices.map((i) => [i.id, i.amount ?? 0]))
  const loadAmountById = new Map(loads.map((l) => [l.id, l.totalAmount ?? 0]))

  const rows = docs.map((d) => {
    const entityTotal = d.purchaseOrderInvoiceId
      ? invoiceAmountById.get(d.purchaseOrderInvoiceId)
      : d.fuelLoadId
        ? loadAmountById.get(d.fuelLoadId)
        : undefined
    const discrepancy = entityTotal !== undefined ? Math.abs(d.montoTotal - entityTotal) : null
    const vinculoTipo: "oc" | "combustible" | "ninguno" = d.purchaseOrderInvoiceId ? "oc" : d.fuelLoadId ? "combustible" : "ninguno"
    return { ...d, vinculoTipo, discrepancy }
  })

  const filtered = vinculo === "discrepancia"
    ? rows.filter((r) => r.discrepancy !== null && r.discrepancy > DISCREPANCY_TOLERANCE_CLP)
    : rows

  const vinculoLabel = vinculo ? VINCULO_LABELS[vinculo] : undefined

  return (
    <PageContainer>
      <PageHeader
        title="Documentos DTE"
        description={`Documentos tributarios recibidos de proveedores en ${periodo}. Solo lectura del portal DTE FacturaEnLínea.`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Compras", href: "/compras" },
            { label: "Documentos DTE" },
          ]} />
        }
        actions={<PeriodPicker period={periodo} />}
      />

      {orderShape && (
        <DteCharts
          orders={orderShape}
          dte={dteShape}
          periodo={periodo}
          syncHref={can(session, "admin:dte_sync") ? "/admin/dte" : undefined}
        />
      )}
      {chartsFailed && (
        <p className="text-sm text-[var(--color-text-muted)]">
          No se pudieron calcular los gráficos de conciliación. La lista de abajo no se ve afectada.
        </p>
      )}

      {vinculoLabel && (
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-[var(--color-text-muted)]">
          <span>Mostrando sólo <strong className="font-semibold text-[var(--color-text)]">{vinculoLabel}</strong> de {periodo}.</span>
          <Link
            href={`/compras/dte?periodo=${periodo}${tipo ? `&tipo=${encodeURIComponent(tipo)}` : ""}`}
            replace
            scroll={false}
            className="inline-flex min-h-11 items-center font-semibold text-[var(--color-primary-ink)] hover:underline sm:min-h-8"
          >
            Quitar filtro
          </Link>
        </p>
      )}

      {truncated && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Se muestran los {ROW_LIMIT} documentos más recientes de {periodo}; hay más.
          Usa el Libro de Compras Electrónico en Reportes para ver el período completo.
        </p>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Receipt size={28} />}
          title="Sin documentos para este filtro"
          description={vinculo || tipo ? `Prueba quitando el filtro, o revisa si ya se sincronizó ${periodo} desde Administración › Sincronización DTE.` : `Aún no hay documentos DTE sincronizados para ${periodo}.`}
        />
      ) : (
        <section className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
          <div className="overflow-x-auto">
            <TableRoot className="rounded-none border-0">
            <Table className="text-left">
              <caption className="sr-only">Documentos tributarios electrónicos recibidos</caption>
              <TableHeader>
                <TableRow className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                  <TableHead>Tipo · Folio</TableHead><TableHead>Proveedor</TableHead>
                  <TableHead className="hidden md:table-cell">Emisión</TableHead><TableHead>Total</TableHead>
                  <TableHead>Estado plataforma</TableHead><TableHead className="hidden lg:table-cell">Vínculo</TableHead>
                  <TableHead className="hidden lg:table-cell">Discrepancia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id} className="transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-primary-tint)]">
                    <TableCell className="whitespace-nowrap font-medium text-[var(--color-text)]">
                      {dteTipoLabel(r.tipoDte)} · {r.folio}
                    </TableCell>
                    <TableCell className="text-[var(--color-text-muted)]">
                      {r.razonSocialEmisor} <span className="text-xs text-[var(--color-text-subtle)]">({r.rutEmisor})</span>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-[var(--color-text-muted)] md:table-cell">{r.fechaEmision}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono tabular-nums text-[var(--color-text)]">{formatCLP(r.montoTotal)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {r.estadoPlataforma
                        ? <MetaBadge meta={{ label: `${estadoPlataformaLabel(r.estadoPlataforma)}`, variant: estadoPlataformaTone(r.estadoPlataforma) }} />
                        : <span className="text-xs text-[var(--color-text-faint)]">—</span>}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap lg:table-cell">
                      {r.vinculoTipo === "oc" && <MetaBadge meta={{ label: "Vinculado a OC", variant: "success" }} />}
                      {r.vinculoTipo === "combustible" && <MetaBadge meta={{ label: "Vinculado a combustible", variant: "info" }} />}
                      {r.vinculoTipo === "ninguno" && <MetaBadge meta={{ label: "Sin vínculo", variant: "outline" }} />}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap lg:table-cell">
                      {r.discrepancy !== null && r.discrepancy > DISCREPANCY_TOLERANCE_CLP
                        ? <span className="font-mono tabular-nums text-[var(--color-danger-ink)]">{formatCLP(r.discrepancy)}</span>
                        : <span className="text-xs text-[var(--color-text-faint)]">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </TableRoot>
          </div>
        </section>
      )}
    </PageContainer>
  )
}

/**
 * `estado_plataforma` es texto libre del portal (title del ícono penplata),
 * no un enum: el tono se decide por lo que dice, con neutro por defecto.
 */
function estadoPlataformaTone(estado: string): "warning" | "danger" | "outline" {
  if (/rechaz|bloque/i.test(estado)) return "danger"
  if (/pendiente/i.test(estado)) return "warning"
  return "outline"
}

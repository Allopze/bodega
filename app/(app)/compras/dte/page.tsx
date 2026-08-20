import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { and, desc, eq, inArray, isNull, isNotNull, or } from "drizzle-orm"
import { Receipt } from "@phosphor-icons/react/dist/ssr"
import { db } from "@/db"
import { dteDocuments, purchaseOrderInvoices, fuelLoads } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { requireDteCodEmp, DteCodEmpMissingError, DTE_COD_EMP_MISSING_MESSAGE } from "@/lib/services/dte-portal/require-cod-emp"
import { dteTipoLabel, estadoPlataformaLabel } from "@/lib/services/dte-portal/labels"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { EmptyState } from "@/components/ui/empty-state"
import { Badge } from "@/components/ui/badge"
import { formatCLP } from "@/lib/utils"
import { PeriodPicker } from "@/components/ui/period-picker"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Documentos DTE" }

const DISCREPANCY_TOLERANCE_CLP = 1
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
  try { await requirePermission("purchasing:view") }
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
  } else if (vinculo === "discrepancia") {
    // La discrepancia sólo existe contra una entidad vinculada; el monto de
    // esa entidad se compara en memoria, pero el universo ya viene acotado.
    conditions.push(or(isNotNull(dteDocuments.purchaseOrderInvoiceId), isNotNull(dteDocuments.fuelLoadId))!)
  }

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
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                  <th scope="col" className="px-4 py-2.5 th-type">Tipo · Folio</th>
                  <th scope="col" className="px-4 py-2.5 th-type">Proveedor</th>
                  <th scope="col" className="hidden px-4 py-2.5 th-type md:table-cell">Emisión</th>
                  <th scope="col" className="px-4 py-2.5 th-type">Total</th>
                  <th scope="col" className="px-4 py-2.5 th-type">Estado plataforma</th>
                  <th scope="col" className="hidden px-4 py-2.5 th-type lg:table-cell">Vínculo</th>
                  <th scope="col" className="hidden px-4 py-2.5 th-type lg:table-cell">Discrepancia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {filtered.map((r) => (
                  <tr key={r.id} className="transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-primary-tint)]">
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium text-[var(--color-text)]">
                      {dteTipoLabel(r.tipoDte)} · {r.folio}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-text-muted)]">
                      {r.razonSocialEmisor} <span className="text-xs text-[var(--color-text-subtle)]">({r.rutEmisor})</span>
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-2.5 text-[var(--color-text-muted)] md:table-cell">{r.fechaEmision}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono tabular-nums text-[var(--color-text)]">{formatCLP(r.montoTotal)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {r.estadoPlataforma
                        ? <Badge variant={estadoPlataformaTone(r.estadoPlataforma)} size="sm">{estadoPlataformaLabel(r.estadoPlataforma)}</Badge>
                        : <span className="text-xs text-[var(--color-text-faint)]">—</span>}
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-2.5 lg:table-cell">
                      {r.vinculoTipo === "oc" && <Badge variant="success" size="sm">Vinculado a OC</Badge>}
                      {r.vinculoTipo === "combustible" && <Badge variant="info" size="sm">Vinculado a combustible</Badge>}
                      {r.vinculoTipo === "ninguno" && <Badge variant="outline" size="sm">Sin vínculo</Badge>}
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-2.5 lg:table-cell">
                      {r.discrepancy !== null && r.discrepancy > DISCREPANCY_TOLERANCE_CLP
                        ? <span className="font-mono tabular-nums text-[var(--color-danger-ink)]">{formatCLP(r.discrepancy)}</span>
                        : <span className="text-xs text-[var(--color-text-faint)]">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

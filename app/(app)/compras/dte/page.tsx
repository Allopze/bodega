import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { and, desc, eq, inArray } from "drizzle-orm"
import { Receipt } from "@phosphor-icons/react/dist/ssr"
import { db } from "@/db"
import { dteDocuments, purchaseOrderInvoices, fuelLoads } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { readDtePortalConfig } from "@/lib/services/dte-portal/config"
import { dteTipoLabel } from "@/lib/services/dte-portal/labels"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { EmptyState } from "@/components/ui/empty-state"
import { Badge } from "@/components/ui/badge"
import { formatCLP } from "@/lib/utils"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Documentos DTE" }

const DISCREPANCY_TOLERANCE_CLP = 1

/**
 * Lista mínima de documentos DTE recibidos (Bandeja de Entrada), aterrizaje
 * de los tiles del Dashboard. Muestra el mes actual — mismo período que
 * `computeHealthStats` usa para calcular esas cifras. Sin diseño elaborado
 * a propósito: se puede enriquecer después (paginación, filtros de UI,
 * rango de fechas) una vez que alguien lo use de verdad.
 */
export default async function DteListPage({
  searchParams,
}: {
  searchParams: Promise<{ vinculo?: string; tipo?: string }>
}) {
  try { await requirePermission("purchasing:view") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/compras")}`) }

  const { vinculo, tipo } = await searchParams
  const codEmp = (await readDtePortalConfig()).credentials.codEmp
  const periodo = new Date().toISOString().slice(0, 7)

  const conditions = [eq(dteDocuments.codEmp, codEmp), eq(dteDocuments.periodo, periodo)]
  if (tipo) conditions.push(eq(dteDocuments.tipoDte, tipo))

  const docs = await db.query.dteDocuments.findMany({
    where: and(...conditions),
    orderBy: [desc(dteDocuments.fechaEmision)],
    limit: 300,
    columns: {
      id: true, tipoDte: true, folio: true, rutEmisor: true, razonSocialEmisor: true,
      montoTotal: true, estadoSii: true, purchaseOrderInvoiceId: true, fuelLoadId: true,
    },
  })

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

  const filtered = rows.filter((r) => {
    if (vinculo === "sin_oc") return r.vinculoTipo === "ninguno"
    if (vinculo === "discrepancia") return r.discrepancy !== null && r.discrepancy > DISCREPANCY_TOLERANCE_CLP
    return true
  })

  return (
    <PageContainer>
      <PageHeader
        title="Documentos DTE"
        description={`Documentos tributarios recibidos de proveedores en ${periodo} — solo lectura del portal DTE FacturaEnLínea.`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Órdenes de compra", href: "/compras" },
            { label: "Documentos DTE" },
          ]} />
        }
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Receipt size={28} />}
          title="Sin documentos para este filtro"
          description={vinculo || tipo ? "Prueba quitando el filtro, o revisa si ya se sincronizó el mes actual desde Administración › Sincronización DTE." : "Aún no hay documentos DTE sincronizados para el mes actual."}
        />
      ) : (
        <section className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                  <th scope="col" className="px-4 py-2.5 th-type">Tipo · Folio</th>
                  <th scope="col" className="px-4 py-2.5 th-type">Proveedor</th>
                  <th scope="col" className="px-4 py-2.5 th-type">Total</th>
                  <th scope="col" className="px-4 py-2.5 th-type">Vínculo</th>
                  <th scope="col" className="px-4 py-2.5 th-type">Discrepancia</th>
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
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono tabular-nums text-[var(--color-text)]">{formatCLP(r.montoTotal)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {r.vinculoTipo === "oc" && <Badge variant="success" size="sm">Vinculado a OC</Badge>}
                      {r.vinculoTipo === "combustible" && <Badge variant="info" size="sm">Vinculado a combustible</Badge>}
                      {r.vinculoTipo === "ninguno" && <Badge variant="outline" size="sm">Sin vínculo</Badge>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
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

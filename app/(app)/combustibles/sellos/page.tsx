import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { inArray } from "drizzle-orm"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { settle } from "@/lib/async-settle"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { SEAL_HISTORY_MAX_ROWS, getSealHistory } from "@/lib/combustibles/seal-history"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { formatDateTime } from "@/lib/utils"
import { FilterSelect } from "../filter-select"

export const metadata: Metadata = { title: "Historial de sellos" }

type SealSearchParams = { desde?: string; hasta?: string; faena?: string; sello?: string; patente?: string }

export default async function SealHistoryPage({ searchParams }: { searchParams: Promise<SealSearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view") } catch { redirect("/forbidden") }

  const sp = await searchParams
  const filters = {
    from: /^\d{4}-\d{2}-\d{2}$/.test(sp.desde ?? "") ? sp.desde : undefined,
    to: /^\d{4}-\d{2}-\d{2}$/.test(sp.hasta ?? "") ? sp.hasta : undefined,
    worksiteId: sp.faena?.trim() || undefined,
    sealNumber: sp.sello?.trim() || undefined,
    plate: sp.patente?.trim() || undefined,
  }

  const scope = resolveWorksiteScope(session)
  const [worksitesList, movements] = await Promise.all([
    settle(
      scope.mode === "none" ? Promise.resolve([]) : db.query.worksites.findMany({
        where: scope.mode === "some" ? inArray(worksites.id, scope.ids) : undefined,
        columns: { id: true, name: true },
        orderBy: [worksites.name],
      }),
      [] as Array<{ id: string; name: string }>,
      "sellos-worksites",
    ),
    settle(getSealHistory(session, filters), [], "sellos-history"),
  ])

  return (
    <PageContainer width="full">
      <PageHeader
        title="Historial de sellos"
        description="Movimientos de sellos derivados de cargas TAE validadas. Cada carga que registra sello retirado o instalado aparece aquí."
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Historial de sellos" }]} />}
      />

      {/* Los filtros no tienen etiqueta visible (van rotulados por placeholder):
          `aria-label` es lo que los hace anunciables por lector de pantalla. */}
      <form className="mb-4 grid gap-3 border-y border-(--color-border) py-4 md:grid-cols-5" aria-label="Filtros del historial de sellos">
        <DatePicker name="desde" defaultValue={sp.desde} placeholder="Desde" aria-label="Desde" />
        <DatePicker name="hasta" defaultValue={sp.hasta} placeholder="Hasta" aria-label="Hasta" />
        <FilterSelect name="faena" defaultValue={sp.faena} options={worksitesList.map((item) => ({ value: item.id, label: item.name }))} placeholder="Todas las faenas autorizadas" aria-label="Faena" />
        <Input name="sello" defaultValue={sp.sello} placeholder="Número de sello" aria-label="Número de sello" />
        <Input name="patente" defaultValue={sp.patente} placeholder="Patente" aria-label="Patente" />
        <div className="md:col-span-5"><Button type="submit" variant="secondary">Aplicar</Button></div>
      </form>

      <p className="mb-2 text-xs text-(--color-text-muted)">
        {movements.length} movimientos encontrados{". "}Los sellos repetidos o con continuidad rota se marcan en ámbar.
        {/* Los avisos se calculan sobre las filas traídas: con el tope alcanzado,
            el "siguiente" de un sello puede quedar fuera del corte. */}
        {movements.length >= SEAL_HISTORY_MAX_ROWS && ` Se alcanzó el tope de ${SEAL_HISTORY_MAX_ROWS.toLocaleString("es-CL")} movimientos: acota el período o la faena para que los avisos de continuidad sean completos.`}
      </p>

      {movements.length === 0 ? (
        <EmptyState
          title="Sin movimientos de sello para estos filtros"
          description="Sólo aparecen aquí las cargas TAE ya validadas que registraron sello retirado o instalado. Prueba con otro período, faena o número de sello."
          action={<Button asChild size="sm" variant="secondary"><Link href="/combustibles/sellos">Quitar filtros</Link></Button>}
        />
      ) : (
      <div className="overflow-x-auto border border-(--color-border)">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-(--color-surface-2) text-left th-type">
            <tr>
              <th scope="col" className="p-3">Fecha</th>
              <th>Faena</th>
              <th>Punto de carga</th>
              <th>Equipo</th>
              <th>Producto</th>
              <th>Litros</th>
              <th>Sello retirado</th>
              <th>Sello instalado</th>
              <th>Siguiente</th>
              <th>Carga</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--color-border)">
            {movements.map((m) => (
              <tr key={m.submissionId}>
                <td className="p-3 font-mono text-xs whitespace-nowrap">{formatDateTime(m.loadedAt)}</td>
                <td>{m.worksiteName ?? "—"}</td>
                <td className="text-xs">{m.loadingPointName ?? "—"}</td>
                <td className="font-medium whitespace-nowrap">{m.equipmentCode}{m.plate ? ` (${m.plate})` : ""}</td>
                <td>{m.productName ?? "—"}</td>
                <td className="font-mono">{m.liters.toLocaleString("es-CL")}</td>
                <td className="font-mono">{m.removedSeal ?? "—"}</td>
                <td className="font-mono">
                  {m.installedSeal ?? "—"}
                  {m.installedRepeated && <Badge variant="warning" size="sm" className="ml-1">repetido</Badge>}
                </td>
                <td className="text-xs">{m.nextRemovedBy && m.nextRemovedAt ? `${m.nextRemovedBy} · ${formatDateTime(m.nextRemovedAt)}` : m.continuityBroken ? <Badge variant="warning" size="sm">sin siguiente</Badge> : "—"}</td>
                <td><Link href={`/combustibles/tae/${m.submissionId}`} className="text-xs text-(--color-primary-ink) hover:underline">Ver carga</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </PageContainer>
  )
}

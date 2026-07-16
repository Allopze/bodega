import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { inArray } from "drizzle-orm"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { settle } from "@/lib/async-settle"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getSealHistory } from "@/lib/combustibles/seal-history"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Badge } from "@/components/ui/badge"

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

      <form className="mb-4 grid gap-3 border-y border-(--color-border) py-4 md:grid-cols-5">
        <DatePicker name="desde" defaultValue={sp.desde} placeholder="Desde" />
        <DatePicker name="hasta" defaultValue={sp.hasta} placeholder="Hasta" />
        <select name="faena" defaultValue={sp.faena} className="control"><option value="">Todas las faenas autorizadas</option>{worksitesList.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <Input name="sello" defaultValue={sp.sello} placeholder="Número de sello" className="control" />
        <Input name="patente" defaultValue={sp.patente} placeholder="Patente" className="control" />
        <div className="md:col-span-5"><Button type="submit" variant="secondary">Aplicar</Button></div>
      </form>

      <p className="mb-2 text-xs text-muted-foreground">{movements.length} movimientos encontrados{". "}Los sellos repetidos o con continuidad rota se marcan en ámbar.</p>

      <div className="overflow-x-auto border border-(--color-border)">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-(--color-surface-2) text-left text-xs text-(--color-text-muted)">
            <tr>
              <th className="p-3">Fecha</th>
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
                <td className="p-3 font-mono text-xs whitespace-nowrap">{m.loadedAt}</td>
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
                <td className="text-xs">{m.nextRemovedBy ? `${m.nextRemovedBy} · ${m.nextRemovedAt}` : m.continuityBroken ? <Badge variant="warning" size="sm">sin siguiente</Badge> : "—"}</td>
                <td><Link href={`/combustibles/tae/${m.submissionId}`} className="text-xs text-(--color-primary-ink) hover:underline">Ver carga</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageContainer>
  )
}

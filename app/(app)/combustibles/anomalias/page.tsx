import type { Metadata } from "next"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { ServerPagination } from "@/components/ui/server-pagination"
import Link from "next/link"
import { redirect } from "next/navigation"
import { inArray } from "drizzle-orm"
import { Gear } from "@phosphor-icons/react/dist/ssr"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { settle } from "@/lib/async-settle"
import { can, requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getAnomalyCases, getAnomalyDistribution, type AnomalyCaseStatus } from "@/lib/combustibles/anomaly-cases"
import { ANOMALY_STATUS_LABELS, ANOMALY_SEVERITY_LABELS } from "@/lib/combustibles/anomaly-labels"
import { parsePageParam } from "@/lib/utils"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { AnomalyCaseCard } from "./anomaly-case-card"
import { AnomalyDistributionChart } from "./anomaly-charts-lazy"
import { FilterSelect } from "@/components/ui/filter-select"

export const metadata: Metadata = { title: "Anomalías de combustible" }

const PAGE_SIZE = 50

type SearchParams = { faena?: string; estado?: string; severidad?: string; ref?: string; page?: string }

/** Mapea el `source` de la bitácora (`fuel-log.ts`) al `referenceEntityType` que usan los casos de anomalía. */
const SOURCE_TO_REFERENCE_TYPE: Record<string, string> = {
  tae_pwa: "fuel_tae_submission",
  invoiced: "fuel_load",
  operation_manual: "fuel_operation_record",
}

export default async function AnomalyCasesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view") } catch { redirect("/forbidden") }

  const sp = await searchParams
  const scope = resolveWorksiteScope(session)
  const canReview = can(session, "combustibles:review_anomalies")
  const canResolve = can(session, "combustibles:resolve_anomalies")
  const canManageRules = can(session, "combustibles:manage_anomaly_rules")

  const status = ["open", "in_review", "resolved", "dismissed", "reopened"].includes(sp.estado ?? "") ? sp.estado as AnomalyCaseStatus : undefined
  const severity = ["low", "medium", "high", "critical"].includes(sp.severidad ?? "") ? sp.severidad as "low" | "medium" | "high" | "critical" : undefined
  const worksiteId = sp.faena?.trim() || undefined
  // "Abrir el caso de anomalía relacionado" desde la bitácora llega como ?ref=<source>:<id>.
  const [refSource, ...refIdParts] = (sp.ref ?? "").split(":")
  const referenceEntityType = refSource ? SOURCE_TO_REFERENCE_TYPE[refSource] : undefined
  const referenceEntityId = refIdParts.length > 0 ? refIdParts.join(":") : undefined
  // `?page=` no numérico → 1, no NaN (guard compartido en lib/utils).
  const page = parsePageParam(sp.page)

  const [worksitesList, anomalyCasesResult, distribution] = await Promise.all([
    settle(
      scope.mode === "none" ? Promise.resolve([]) : db.query.worksites.findMany({
        where: scope.mode === "some" ? inArray(worksites.id, scope.ids) : undefined,
        columns: { id: true, name: true }, orderBy: [worksites.name],
      }),
      [] as Array<{ id: string; name: string }>,
      "anomalias-worksites",
    ),
    settle(
      getAnomalyCases({ worksiteId, status, severity, referenceEntityType, referenceEntityId, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }, session),
      { cases: [], total: 0 },
      "anomalias-cases",
    ),
    settle(
      getAnomalyDistribution({ worksiteId, status }, session),
      { total: 0, byStatus: [], bySeverity: [], byRuleCode: [] },
      "anomalias-distribution",
    ),
  ])
  const { cases, total } = anomalyCasesResult
  const pagination = resolvePagination({ pageParam: String(page), totalItems: total, pageSize: PAGE_SIZE })
  const totalPages = pagination.totalPages
  const pageHref = (target: number) => buildPaginationHref("/combustibles/anomalias", sp, target)

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Anomalías de combustible"
        description="Casos detectados por reglas de control. Asigna, revisa y resuelve cada caso desde aquí."
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Anomalías" }]} />}
        actions={canManageRules ? <Button asChild variant="secondary"><Link href="/combustibles/anomalias/reglas"><Gear size={16} />Reglas</Link></Button> : undefined}
      />

      <form className="mb-4 grid gap-3 border-y border-(--color-border) py-4 md:grid-cols-4">
        <FilterSelect name="faena" defaultValue={sp.faena} options={worksitesList.map((w) => ({ value: w.id, label: w.name }))} placeholder="Todas las faenas" />
        <FilterSelect name="estado" defaultValue={sp.estado} options={Object.entries(ANOMALY_STATUS_LABELS).map(([k, v]) => ({ value: k, label: v }))} placeholder="Todos los estados" />
        <FilterSelect name="severidad" defaultValue={sp.severidad} options={Object.entries(ANOMALY_SEVERITY_LABELS).map(([k, v]) => ({ value: k, label: v }))} placeholder="Todas las severidades" />
        <Button type="submit" variant="secondary">Aplicar</Button>
      </form>

      {sp.ref && (
        <p className="mb-3 flex items-center gap-2 text-xs text-(--color-text-muted)">
          Mostrando sólo el/los caso(s) del registro de origen. <Link href="/combustibles/anomalias" className="text-(--color-primary) hover:underline">Ver todos los casos</Link>
        </p>
      )}
      <p className="mb-3 text-xs text-(--color-text-muted)">
        {total} {total === 1 ? "caso encontrado" : "casos encontrados"}
        {totalPages > 1 && ` · página ${page} de ${totalPages}`}
      </p>

      {/* Gráfico de distribución (sección 5) */}
      <div className="mb-6">
        <AnomalyDistributionChart distribution={distribution} />
      </div>

      {cases.length === 0 ? (
        <div className="border border-dashed border-(--color-border-strong) p-8 text-center text-sm text-(--color-text-muted)">
          No se han detectado anomalías todavía. Las reglas de detección se ejecutan al validar cargas TAE y al analizar rendimientos.
        </div>
      ) : (
        <div className="space-y-4">
          {cases.map((c) => (
            <AnomalyCaseCard key={c.id} anomalyCase={c} canReview={canReview} canResolve={canResolve} />
          ))}
        </div>
      )}

      <ServerPagination pagination={pagination} hrefForPage={pageHref} />
    </PageContainer>
  )
}

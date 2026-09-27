import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { pdtpRegistrationActorFromSession } from "@/lib/auth/pdtp-registration"
import { listScopedWorksites } from "@/lib/services/ppa"
import { listPdtpDemandActivities } from "@/lib/services/prevention-pdtp"
import { listPdtpObligationsPage, type PdtpObligationListFilter } from "@/lib/services/pdtp/obligations"
import { listPdtpRegistrableActivityIds } from "@/lib/services/pdtp/registration-authority"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { DEFAULT_PAGE_SIZE } from "@/lib/constants"
import { ServerPagination } from "@/components/ui/server-pagination"
import { PdtpObligationsWorkbench } from "./pdtp-obligations-workbench"

export const metadata: Metadata = { title: "Actividades a demanda y por evento" }

const FILTERS: readonly PdtpObligationListFilter[] = ["open", "pending", "overdue", "reported"]

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function PdtpObligationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:view")) redirect("/forbidden")

  const sp = await searchParams
  const resolved = resolveWorksiteScope(session)
  const scope: string[] | "all" = resolved.mode === "all" ? "all" : resolved.mode === "some" ? resolved.ids : []
  const requestedFilter = one(sp.estado)
  const filter: PdtpObligationListFilter = FILTERS.includes(requestedFilter as PdtpObligationListFilter)
    ? requestedFilter as PdtpObligationListFilter
    : "open"
  const search = one(sp.q)?.trim() ?? ""

  // Esta pantalla es sólo de las actividades no calendarizadas. Las bandejas de
  // trabajo calendarizado (programadas de la semana y ejecuciones por aprobar)
  // se movieron a /prevencion/pdtp/aprobaciones, donde ya vivía la misma cola.
  const [worksites, activities] = await Promise.all([
    listScopedWorksites(scope),
    listPdtpDemandActivities(),
  ])
  // Una faena fuera del alcance (URL editada a mano) se ignora en vez de romper.
  const requestedWorksite = one(sp.faena)
  const worksiteId = requestedWorksite && worksites.some((worksite) => worksite.id === requestedWorksite) ? requestedWorksite : undefined

  // PREV-M09: la lista se pagina y se filtra en la base. Primero se pide la
  // página que trae la URL; si quedó fuera de rango (se cerraron casos), se
  // vuelve a pedir la última que existe.
  const requestedPage = Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1)
  const query = { scope, filter, worksiteId, search, limit: DEFAULT_PAGE_SIZE }
  let result = await listPdtpObligationsPage({ ...query, offset: (requestedPage - 1) * DEFAULT_PAGE_SIZE })
  const pagination = resolvePagination({ pageParam: String(requestedPage), totalItems: result.total, pageSize: DEFAULT_PAGE_SIZE })
  if (pagination.page !== requestedPage) {
    result = await listPdtpObligationsPage({ ...query, offset: pagination.offset })
  }

  // PREV-I03: "Reportar trabajo" sólo en los casos que el servidor aceptaría
  // de esta persona. Se calcula por faena y sólo para la página visible.
  const canExecute = can(session, "prevention:pdtp:execute")
  const actor = pdtpRegistrationActorFromSession(session)
  let reportableObligationIds: string[] | undefined
  if (canExecute && !actor.canRegisterAnyActivity) {
    const byWorksite = new Map<string, Set<string>>()
    for (const row of result.rows) {
      byWorksite.set(row.obligation.worksiteId, (byWorksite.get(row.obligation.worksiteId) ?? new Set()).add(row.obligation.activityId))
    }
    const allowed = new Set<string>()
    await Promise.all([...byWorksite].map(async ([siteId, activityIds]) => {
      const registrable = await listPdtpRegistrableActivityIds({ activityIds: [...activityIds], worksiteId: siteId, actor })
      for (const activityId of registrable) allowed.add(`${siteId}|${activityId}`)
    }))
    reportableObligationIds = result.rows
      .filter((row) => allowed.has(`${row.obligation.worksiteId}|${row.obligation.activityId}`))
      .map((row) => row.obligation.id)
  }

  return (
    <PdtpObligationsWorkbench
      worksites={worksites}
      activities={activities}
      obligations={result.rows}
      counts={result.counts}
      total={result.total}
      pagination={
        // Se arma en el servidor: `hrefForPage` es una función y no cruza al
        // cliente. Los enlaces conservan filtros y usan `scroll={false}`.
        <ServerPagination
          pagination={pagination}
          hrefForPage={(page) => buildPaginationHref("/prevencion/pdtp/obligaciones", sp, page)}
        />
      }
      filters={{ status: filter, worksiteId: worksiteId ?? "all", search }}
      canExecute={canExecute}
      canCancel={can(session, "prevention:pdtp:obligation:cancel")}
      reportableObligationIds={reportableObligationIds}
    />
  )
}

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { CheckCircle, ClipboardText } from "@phosphor-icons/react/dist/ssr"
import { settle } from "@/lib/async-settle"
import { can, requirePermission } from "@/lib/auth/can"
import { Button } from "@/components/ui/button"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { parseControlFilters } from "@/lib/combustibles/control/filters"
import { getReviewQueue, parseReviewTab, REVIEW_PAGE_SIZE, type ReviewQueueResult } from "@/lib/combustibles/control/review-queue"
import { ControlFilters } from "../_components/control-filters"
import { loadControlContext } from "../_components/control-context"
import { ControlNav } from "../_components/control-nav"
import { ReviewQueueList } from "./review-queue-list"
import { ReviewTabs } from "./review-tabs"

export const metadata: Metadata = { title: "Revisión de cargas" }

type SearchParams = Record<string, string | string[] | undefined>

const EMPTY_QUEUE: ReviewQueueResult = { rows: [], total: 0, counts: { "en-revision": 0, aprobadas: 0, rechazadas: 0 } }

const EMPTY_COPY = {
  "en-revision": {
    title: "No hay cargas esperando revisión",
    description: "Una carga llega aquí cuando el sistema duda de ella: rendimiento atípico o fuera de rango físico, lectura de medidor menor a la anterior, litros sobre la capacidad del estanque, sellos o fechas de relleno, posible duplicado o equipo sin ficha. Si cambias los filtros, revisa también otros períodos y faenas.",
  },
  aprobadas: {
    title: "Aún no hay cargas aprobadas",
    description: "Cuando apruebes una carga marcada, quedará aquí con tu nota y la fecha de la decisión.",
  },
  rechazadas: {
    title: "Aún no hay cargas rechazadas",
    description: "Una carga rechazada deja de contar en litros, promedios y desviaciones, pero no se borra: queda aquí con su motivo.",
  },
} as const

export default async function ReviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view") } catch { redirect("/forbidden") }

  const raw = await searchParams
  const filters = parseControlFilters(raw)
  const tab = parseReviewTab(raw.estado)
  const canDecide = can(session, "combustibles:approve_flagged")

  const [context, queue] = await Promise.all([
    loadControlContext(session),
    settle(getReviewQueue(session, filters, tab), EMPTY_QUEUE, "control-review-queue"),
  ])
  const degraded = queue === EMPTY_QUEUE
  const pagination = resolvePagination({ pageParam: raw.pagina, totalItems: queue.total, pageSize: REVIEW_PAGE_SIZE })
  const empty = EMPTY_COPY[tab.value]
  const hrefForPage = (page: number) => buildPaginationHref("/combustibles/control/revision", raw, page, "pagina")

  return (
    <PageContainer>
      <PageHeader
        title="Revisión de cargas"
        description="Cargas que el sistema marcó para que una persona decida si cuentan en el rendimiento del equipo"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Control", href: "/combustibles/control" }, { label: "Revisión" }]} />}
      />
      <ControlNav items={context.navItems} />
      <ControlFilters years={context.years} defaultYear={context.defaultYear} worksites={context.worksites} mandantes={context.mandantes} />
      <DegradedDataBanner degraded={degraded ? ["cola de revisión"] : []} total={1} />

      <ReviewTabs active={tab.value} counts={queue.counts} searchParams={raw} />

      {tab.value === "en-revision" && !canDecide && queue.total > 0 ? (
        <p className="mb-3 text-sm text-[var(--color-text-muted)]">
          Puedes ver las cargas en revisión. Aprobarlas o rechazarlas requiere el permiso de aprobación de cargas marcadas.
        </p>
      ) : null}

      {!degraded && queue.rows.length === 0 ? (
        <EmptyState
          icon={tab.value === "en-revision" ? <CheckCircle size={24} /> : <ClipboardText size={24} />}
          tone={tab.value === "en-revision" ? "success" : "neutral"}
          title={empty.title}
          description={empty.description}
          action={tab.value === "en-revision" ? (
            <Button asChild variant="secondary" size="sm"><Link href="/combustibles/control">Ir a la vista general</Link></Button>
          ) : (
            <Button asChild variant="secondary" size="sm"><Link href="/combustibles/control/revision">Ver cargas en revisión</Link></Button>
          )}
        />
      ) : (
        <>
          <ReviewQueueList rows={queue.rows} canDecide={canDecide} decided={tab.value !== "en-revision"} />
          <ServerPagination pagination={pagination} hrefForPage={hrefForPage} />
        </>
      )}
    </PageContainer>
  )
}

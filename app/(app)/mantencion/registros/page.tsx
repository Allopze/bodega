import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { CheckCircle, Truck, Warning, Wrench } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { ServerPagination } from "@/components/ui/server-pagination"
import { StageTabs, type StageTab } from "@/components/ui/stage-tabs"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { RecordsFilters } from "@/components/mantencion/jefatura/registros/records-filters"
import { RecordsTable } from "@/components/mantencion/jefatura/registros/records-table"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { plural } from "@/lib/mantencion/format"
import type { MantReview } from "@/lib/mantencion/types"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import {
  RECORDS_PAGE_SIZE, RECORD_FILTER_PARAMS, hasRecordFilters, parseRecordQuery, recordQueryToParams, type RawSearchParams, type RecordSortKey,
} from "@/lib/services/mantencion/records-filters"
import { listRecords, loadRecordFilterOptions, loadRecordIndicators, loadRecordReviewCounts } from "@/lib/services/mantencion/records-query"
import { formatDate } from "@/lib/utils"
import { RecordsExportButton } from "./records-export-button"

export const metadata: Metadata = { title: "Registros firmados" }
export const dynamic = "force-dynamic"

const PATHNAME = "/mantencion/registros"

/** Los parámetros de la URL como un objeto plano de textos (lo que viaja al botón de Excel). */
function flatParams(raw: RawSearchParams): Record<string, string> {
  const flat: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value
    if (first) flat[key] = first
  }
  return flat
}

/** La misma lista con otros parámetros; `null` quita el parámetro y la página vuelve a la 1. */
function hrefWith(current: Record<string, string>, overrides: Record<string, string | null>): string {
  const params = new URLSearchParams(current)
  params.delete("page")
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) params.delete(key)
    else params.set(key, value)
  }
  const query = params.toString()
  return query ? `${PATHNAME}?${query}` : PATHNAME
}

/**
 * Pestañas de revisión: la única representación de la revisión (regla A5). «Por revisar» es la primera y la que
 * abre la lista (como «Por asignar» en Órdenes de trabajo); «Todos» es la última y lleva `revision=todos`, un valor
 * que el servicio no interpreta como filtro (auditoría 2026-11-13, M8).
 */
function buildReviewTabs(counts: Record<MantReview, number>): StageTab[] {
  return [
    { value: "pendiente", label: "Por revisar", count: counts.pendiente, countTone: "signal" },
    { value: "observado", label: "Observados", count: counts.observado },
    { value: "revisado", label: "Revisados", count: counts.revisado },
    { value: "todos", label: "Todos" },
  ]
}

/** Lo que dice una pestaña sin registros: qué significa y qué hacer, sin jerga (regla A4). */
function emptyCopy(review: MantReview | undefined, filtered: boolean): { title: string; description: string } {
  if (filtered) {
    const where = review === "pendiente" ? "por revisar" : review === "observado" ? "observados" : review === "revisado" ? "revisados" : null
    return {
      title: where ? `No hay registros ${where} con estos filtros` : "Ningún registro coincide con estos filtros",
      description: "Prueba con otro período o quita algún filtro.",
    }
  }
  if (review === "pendiente") {
    return { title: "No hay registros por revisar", description: "Los registros nuevos aparecen aquí apenas un mecánico los firma y su teléfono los sincroniza." }
  }
  if (review === "observado") {
    return { title: "No hay registros observados", description: "Aquí quedan los registros en los que pediste una corrección, hasta que los marques como revisados." }
  }
  if (review === "revisado") {
    return { title: "Aún no hay registros revisados", description: "Cuando marques un registro como revisado, aparece aquí." }
  }
  return { title: "Aún no hay registros firmados", description: "Aparecen aquí apenas un mecánico firma una mantención y su teléfono la sincroniza." }
}

export default async function RecordsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  let session
  try {
    session = await requireAnyPermission(["mant:records:view_own", "mant:records:view_worksite", "mant:records:view_all"])
  } catch {
    redirect("/forbidden")
  }
  const viewer = viewerFromSession(session)
  const raw = await searchParams
  const params = flatParams(raw)
  const canReview = can(session, "mant:records:review")
  if (raw.revision === undefined || raw.revision === "") {
    // Sin pestaña en la URL: «Por revisar» para quien revisa y «Todos» para quien sólo mira. El destino lleva
    // `?revision=` para que la pestaña activa se vea marcada y los enlaces que piden «todos» lo digan.
    // Si la URL ya trae un filtro (`?estado=anulado`, `?equipo=…`), quien la armó pidió ese subconjunto
    // completo: recortarlo a «Por revisar» escondía, p. ej., los anulados enlazados desde un registro.
    const hasFilters = Object.keys(params).some((key) => key !== "pagina" && key !== "page")
    redirect(hrefWith(params, { revision: canReview && !hasFilters ? "pendiente" : "todos" }))
  }
  const query = parseRecordQuery(raw)

  const [options, list, indicators, reviewCounts] = await Promise.all([
    loadRecordFilterOptions(viewer),
    listRecords(viewer, query),
    loadRecordIndicators(viewer, query.filters),
    loadRecordReviewCounts(viewer, query.filters),
  ])

  const reviewTabs = buildReviewTabs(reviewCounts)
  const pagination = resolvePagination({ pageParam: String(list.page), totalItems: list.total, pageSize: RECORDS_PAGE_SIZE })
  // La pestaña de revisión no es un «filtro» para el aviso de lista vacía: vaciarla es una buena noticia, no un error de filtros.
  const filtered = hasRecordFilters({ ...query.filters, review: undefined })
  const canExport = can(session, "mant:export")
  // «Abrir la app del mecánico» es para quien firma desde ella: quien sólo ve lo propio. A la oficina no le sirve.
  const isMechanic = can(session, "mant:app:use") && can(session, "mant:records:view_own")
    && !can(session, "mant:records:view_worksite") && !can(session, "mant:records:view_all")
  // Los filtros y el orden de esta lista: cada fila los lleva al detalle para que ofrezca anterior y siguiente.
  const listParams = recordQueryToParams(query)
  if (!query.filters.review) listParams.set("revision", "todos")
  const listQuery = listParams.toString()

  const sortHref = (key: RecordSortKey) => {
    const sameColumn = query.sort === key
    const next = sameColumn ? (query.dir === "asc" ? "desc" : "asc") : key === "fecha" ? "desc" : "asc"
    return hrefWith(params, { orden: key, dir: next })
  }

  const range = indicators.range
    ? `${plural(indicators.total, "registro vigente", "registros vigentes")} del ${formatDate(indicators.range.from)} al ${formatDate(indicators.range.to)}`
    : query.filters.status === "anulado"
      ? "los registros anulados no cuentan en los indicadores"
      : "sin registros con estos filtros"

  // Una fila compacta, no tarjetas (regla A1): sólo lo que lleva a un subconjunto. El total vive en el
  // titular y la revisión en las pestañas (A5: una cifra no se repite en dos controles). Un indicador en
  // cero no se dibuja: «0 · Ninguno detenido» no cambia ninguna decisión (auditoría 2026-11-13, M9).
  const stats: SummaryStat[] = []
  if (indicators.workshopEquipment > 0) {
    stats.push({
      key: "workshop",
      label: "Equipos en taller",
      value: indicators.workshopEquipment,
      icon: <Truck size={14} aria-hidden />,
      tone: indicators.workshopStale > 0 ? "signal" : undefined,
      secondary: indicators.workshopStale > 0 ? `${plural(indicators.workshopStale, "sin actualizar", "sin actualizar")} hace más de 2 días` : "Todos con estado al día",
      href: hrefWith(params, { tipo: "C", situacion: "en_taller", estado: "vigente" }),
    })
  }
  if (indicators.notDoneItems > 0) {
    stats.push({
      key: "not-done",
      label: "Ítems no realizados",
      value: indicators.notDoneItems,
      icon: <Warning size={14} aria-hidden />,
      tone: "signal",
      secondary: `En ${plural(indicators.notDoneRecords, "preventiva", "preventivas")}`,
      href: hrefWith(params, { tipo: "P", situacion: "no_realizados", estado: "vigente" }),
    })
  }

  const empty = emptyCopy(query.filters.review, filtered)
  // «Quitar los filtros» deja la pestaña y el orden en los que se está: sólo suelta lo que filtra.
  const clearFiltersHref = hrefWith(params, Object.fromEntries(RECORD_FILTER_PARAMS.map((key) => [key, null])))
  const allHref = hrefWith(params, { revision: "todos" })

  return (
    <PageContainer>
      <PageHeader
        title="Registros firmados"
        description="Las mantenciones firmadas por los mecánicos. Un registro anulado sigue visible, marcado, pero no cuenta en los indicadores."
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Registros firmados" }]}
        actions={
          <>
            {(can(session, "mant:records:view_worksite") || can(session, "mant:records:view_all")) && (
              <Button asChild variant="secondary"><Link href="/mantencion/registros/historicos">Historial anterior</Link></Button>
            )}
            {canExport && <RecordsExportButton params={params} />}
          </>
        }
      />

      {stats.length > 0 && (
        <section aria-labelledby="registros-indicadores" className="mb-5">
          <h2 id="registros-indicadores" className="mb-2 text-sm font-semibold text-[var(--color-text)]">
            Indicadores <span className="font-normal text-[var(--color-text-muted)]">· {range}</span>
          </h2>
          <SummaryBar stats={stats} />
        </section>
      )}

      <div className="mb-3">
        <Suspense fallback={<div className="h-11 border-b border-[var(--color-border)] sm:h-9" aria-hidden />}>
          <StageTabs tabs={reviewTabs} ariaLabel="Revisión de los registros" param="revision" />
        </Suspense>
      </div>

      <RecordsFilters options={options} />

      {list.rows.length === 0 ? (
        <EmptyState
          icon={query.filters.review === "pendiente" && !filtered ? <CheckCircle size={22} aria-hidden /> : <Wrench size={22} aria-hidden />}
          title={empty.title}
          description={empty.description}
          action={filtered
            ? <Button asChild variant="secondary"><Link href={clearFiltersHref}>Quitar los filtros</Link></Button>
            : query.filters.review
              ? <Button asChild variant="secondary"><Link href={allHref}>Ver todos los registros</Link></Button>
              : isMechanic
                ? <Button asChild><Link href="/m/mantencion">Abrir la app del mecánico</Link></Button>
                : undefined}
        />
      ) : (
        <>
          <RecordsTable rows={list.rows} sort={query.sort} dir={query.dir} sortHref={sortHref} listQuery={listQuery} />
          <ServerPagination pagination={pagination} hrefForPage={(page) => buildPaginationHref(PATHNAME, raw, page)} />
        </>
      )}
    </PageContainer>
  )
}

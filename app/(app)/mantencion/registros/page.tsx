import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ClipboardText, Truck, Warning, Wrench, Users } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { ServerPagination } from "@/components/ui/server-pagination"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { RecordsFilters } from "@/components/mantencion/jefatura/registros/records-filters"
import { RecordsTable } from "@/components/mantencion/jefatura/registros/records-table"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { plural } from "@/lib/mantencion/format"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import {
  RECORDS_PAGE_SIZE, hasRecordFilters, parseRecordQuery, type RawSearchParams, type RecordSortKey,
} from "@/lib/services/mantencion/records-filters"
import { listRecords, loadRecordFilterOptions, loadRecordIndicators } from "@/lib/services/mantencion/records-query"
import { formatDate } from "@/lib/utils"
import { RecordsExportButton } from "./records-export-button"

export const metadata: Metadata = { title: "Registros de mantención" }
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
  const query = parseRecordQuery(raw)

  const [options, list, indicators] = await Promise.all([
    loadRecordFilterOptions(viewer),
    listRecords(viewer, query),
    loadRecordIndicators(viewer, query.filters),
  ])

  const pagination = resolvePagination({ pageParam: String(list.page), totalItems: list.total, pageSize: RECORDS_PAGE_SIZE })
  const filtered = hasRecordFilters(query.filters)
  const canExport = can(session, "mant:export")

  const sortHref = (key: RecordSortKey) => {
    const sameColumn = query.sort === key
    const next = sameColumn ? (query.dir === "asc" ? "desc" : "asc") : key === "fecha" ? "desc" : "asc"
    return hrefWith(params, { orden: key, dir: next })
  }

  const range = indicators.range
    ? `registros del ${formatDate(indicators.range.from)} al ${formatDate(indicators.range.to)}`
    : query.filters.status === "anulado"
      ? "los registros anulados no cuentan en los indicadores"
      : "sin registros con estos filtros"

  // Una fila compacta, no tarjetas (regla A1): lo que cambia una decisión es un enlace a su subconjunto.
  const stats: SummaryStat[] = [
    {
      key: "total",
      label: "Registros",
      value: indicators.total,
      icon: <ClipboardText size={14} aria-hidden />,
      secondary: `${plural(indicators.preventive, "preventiva", "preventivas")} · ${plural(indicators.corrective, "correctiva", "correctivas")}`,
    },
    {
      key: "workshop",
      label: "Equipos en taller",
      value: indicators.workshopEquipment,
      icon: <Truck size={14} aria-hidden />,
      tone: indicators.workshopStale > 0 ? "signal" : undefined,
      secondary: indicators.workshopEquipment === 0
        ? "Ninguno detenido"
        : indicators.workshopStale > 0 ? `${plural(indicators.workshopStale, "sin actualizar", "sin actualizar")} hace más de 2 días` : "Todos con estado al día",
      href: indicators.workshopEquipment > 0 ? hrefWith(params, { tipo: "C", situacion: "en_taller", estado: "vigente" }) : undefined,
    },
    {
      key: "not-done",
      label: "Ítems no realizados",
      value: indicators.notDoneItems,
      icon: <Warning size={14} aria-hidden />,
      tone: indicators.notDoneItems > 0 ? "signal" : undefined,
      secondary: indicators.notDoneItems > 0 ? `En ${plural(indicators.notDoneRecords, "preventiva", "preventivas")}` : "Ninguno pendiente",
      href: indicators.notDoneItems > 0 ? hrefWith(params, { tipo: "P", situacion: "no_realizados", estado: "vigente" }) : undefined,
    },
    {
      key: "registrars",
      label: "Mecánicos que registraron",
      value: indicators.registrars,
      icon: <Users size={14} aria-hidden />,
      secondary: indicators.registrars === 1 ? "persona distinta en estos registros" : "personas distintas en estos registros",
    },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Registros de mantención"
        description="Las mantenciones firmadas por los mecánicos. Un registro anulado sigue visible, marcado, pero no cuenta en los indicadores."
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Registros" }]}
        actions={canExport ? <RecordsExportButton params={params} /> : undefined}
      />

      <section aria-labelledby="registros-indicadores" className="mb-5">
        <h2 id="registros-indicadores" className="mb-2 text-sm font-semibold text-[var(--color-text)]">
          Indicadores <span className="font-normal text-[var(--color-text-muted)]">· {range}</span>
        </h2>
        <SummaryBar stats={stats} />
      </section>

      <RecordsFilters options={options} />

      {list.rows.length === 0 ? (
        <EmptyState
          icon={<Wrench size={22} aria-hidden />}
          title={filtered ? "Ningún registro coincide con estos filtros" : "Aún no hay registros de mantención"}
          description={filtered
            ? "Prueba con otro período o quita algún filtro."
            : "Aparecen aquí apenas un mecánico firma una mantención y su teléfono la sincroniza."}
          action={filtered
            ? <Button asChild variant="secondary"><Link href={PATHNAME}>Quitar los filtros</Link></Button>
            : can(session, "mant:app:use")
              ? <Button asChild><Link href="/m/mantencion">Abrir la app del mecánico</Link></Button>
              : undefined}
        />
      ) : (
        <>
          <RecordsTable rows={list.rows} sort={query.sort} dir={query.dir} sortHref={sortHref} />
          <ServerPagination pagination={pagination} hrefForPage={(page) => buildPaginationHref(PATHNAME, raw, page)} />
        </>
      )}
    </PageContainer>
  )
}

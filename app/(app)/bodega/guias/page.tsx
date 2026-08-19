import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { and, asc, eq } from "drizzle-orm"
import { Truck } from "@phosphor-icons/react/dist/ssr"
import { db } from "@/db"
import { dispatchGuides, worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { DEFAULT_PAGE_SIZE } from "@/lib/constants"
import {
  countDispatchGuides,
  listDispatchGuides,
  OFFICE_ORIGIN_LABEL,
  type DispatchGuideStatus,
} from "@/lib/services/dispatch-guides"
import { GuideFilters } from "./guide-filters"
import { DispatchGuidesTable } from "./guides-table"

export const metadata: Metadata = { title: "Guías de despacho internas" }

const STATUSES: DispatchGuideStatus[] = ["draft", "dispatched", "partially_received", "received", "cancelled"]

function readParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : ""
}

export default async function DispatchGuidesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("warehouse:view_guides") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/bodega/guias")}`) }

  const sp = await searchParams
  const estadoParam = readParam(sp.estado)
  const estado = STATUSES.includes(estadoParam as DispatchGuideStatus)
    ? (estadoParam as DispatchGuideStatus)
    : undefined
  const faena = readParam(sp.faena)
  const desde = readParam(sp.desde)
  const hasta = readParam(sp.hasta)
  const q = readParam(sp.q).trim()

  const filters = {
    scopeSql: worksiteScopeSql(session, dispatchGuides.destinationWorksiteId),
    q,
    status: estado,
    destinationWorksiteId: faena || undefined,
    from: desde || undefined,
    to: hasta || undefined,
  }

  const total = await countDispatchGuides(filters)
  const pagination = resolvePagination({ pageParam: sp.page, totalItems: total, pageSize: DEFAULT_PAGE_SIZE })

  const [guides, worksiteOptions] = await Promise.all([
    listDispatchGuides({ ...filters, limit: pagination.limit, offset: pagination.offset }),
    db
      .select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(and(eq(worksites.isActive, true), worksiteScopeSql(session, worksites.id)))
      .orderBy(asc(worksites.name)),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Historial de guías internas"
        description={`Consulta histórica de traslados desde ${OFFICE_ORIGIN_LABEL} hacia faena. Los nuevos despachos se preparan desde Recepciones.`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Bodega", href: "/bodega" },
            { label: "Guías de despacho" },
          ]} />
        }
      />

      <GuideFilters worksites={worksiteOptions} current={{ estado: estadoParam, faena, desde, hasta, q }} />

      {total === 0 ? (
        <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
          <EmptyState
            icon={<Truck size={24} />}
            title="Todavía no hay guías de despacho"
            description={`Las guías se crean automáticamente desde una recepción en oficina cuando hay bienes que deben continuar hacia una faena.`}
          />
        </div>
      ) : (
        <>
          <DispatchGuidesTable guides={guides} />
          <ServerPagination
            pagination={pagination}
            hrefForPage={(page) => buildPaginationHref("/bodega/guias", sp, page)}
          />
        </>
      )}
    </PageContainer>
  )
}

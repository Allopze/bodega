import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { and, asc, eq } from "drizzle-orm"
import { Truck } from "@phosphor-icons/react/dist/ssr"
import { db } from "@/db"
import { dispatchGuides, worksites } from "@/db/schema"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
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

const STATUSES: DispatchGuideStatus[] = ["draft", "dispatched", "received", "cancelled"]

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

  const filters = {
    scopeSql: worksiteScopeSql(session, dispatchGuides.destinationWorksiteId),
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

  const canCreate = can(session, "warehouse:create_guide")

  return (
    <PageContainer>
      <PageHeader
        title="Guías de despacho internas"
        description={`Traslados de bienes desde ${OFFICE_ORIGIN_LABEL} hacia faena. Documento interno, no tributario.`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Bodega", href: "/bodega" },
            { label: "Guías de despacho" },
          ]} />
        }
        actions={canCreate ? (
          <Button asChild>
            <Link href="/bodega/guias/nueva">
              <Truck size={15} aria-hidden />
              Nueva guía
            </Link>
          </Button>
        ) : undefined}
      />

      <GuideFilters worksites={worksiteOptions} current={{ estado: estadoParam, faena, desde, hasta }} />

      {total === 0 ? (
        <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
          <EmptyState
            icon={<Truck size={24} />}
            title="Todavía no hay guías de despacho"
            description={`Una guía documenta y respalda la salida de materiales, EPP, herramientas o equipos desde ${OFFICE_ORIGIN_LABEL} hacia una faena, y descuenta el stock al despacharla.`}
            action={canCreate ? (
              <Button asChild>
                <Link href="/bodega/guias/nueva">Crear la primera guía</Link>
              </Button>
            ) : undefined}
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

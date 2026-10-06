import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { and, asc, eq, inArray } from "drizzle-orm"
import { Truck } from "@phosphor-icons/react/dist/ssr"
import { db } from "@/db"
import { dispatchGuides, worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import Link from "next/link"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { DEFAULT_PAGE_SIZE } from "@/lib/constants"
import {
  countDispatchGuides,
  listDispatchGuides,
  OFFICE_ORIGIN_LABEL,
  type DispatchGuideStatus,
} from "@/lib/services/dispatch-guides"
import { ownVisibleWorksiteId, resolveFaena } from "../faena-scope"
import { GuideFilters } from "./guide-filters"
import { DispatchGuidesTable } from "./guides-table"

export const metadata: Metadata = { title: "Guías de despacho" }

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
  const explicitStatus = STATUSES.includes(estadoParam as DispatchGuideStatus)
    ? (estadoParam as DispatchGuideStatus)
    : undefined
  const desde = readParam(sp.desde)
  const hasta = readParam(sp.hasta)
  const q = readParam(sp.q).trim()
  const scopeSql = worksiteScopeSql(session, dispatchGuides.destinationWorksiteId)

  // Mismas faenas visibles y misma faena por defecto que Stock, Movimientos y
  // Documentos (BOD-06). Las guías sólo tienen como destino una faena, nunca la
  // oficina: si la bodega propia no ha recibido ninguna, partir en ella dejaría
  // la lista vacía sin motivo y el alcance por defecto pasa a ser "todas".
  const worksiteOptions = await db
    .select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(and(eq(worksites.isActive, true), worksiteScopeSql(session, worksites.id)))
    .orderBy(asc(worksites.name))
  const ownCandidate = ownVisibleWorksiteId(session.user.primaryWorksiteId, worksiteOptions)
  const ownWorksiteId = ownCandidate && (await countDispatchGuides({ scopeSql, destinationWorksiteId: ownCandidate })) > 0
    ? ownCandidate
    : ""
  const faena = resolveFaena(readParam(sp.faena), ownWorksiteId)

  // Lo primero que hace la bodega con esta lista es confirmar lo que llegó, así
  // que parte en "Por confirmar" (guías despachadas) cuando hay alguna. `todos`
  // es la elección explícita de ver todas; una búsqueda por folio tampoco se
  // limita a un estado.
  const dispatchedInScope = explicitStatus || estadoParam === "todos" || q
    ? 0
    : await countDispatchGuides({ scopeSql, destinationWorksiteId: faena || undefined, status: "dispatched" })
  const defaultedToDispatched = !explicitStatus && dispatchedInScope > 0
  const estado: DispatchGuideStatus | undefined = explicitStatus ?? (defaultedToDispatched ? "dispatched" : undefined)

  const filters = {
    scopeSql,
    q,
    status: estado,
    destinationWorksiteId: faena || undefined,
    from: desde || undefined,
    to: hasta || undefined,
  }

  const total = await countDispatchGuides(filters)
  const pagination = resolvePagination({ pageParam: sp.page, totalItems: total, pageSize: DEFAULT_PAGE_SIZE })

  const guides = await listDispatchGuides({ ...filters, limit: pagination.limit, offset: pagination.offset })

  // Cuándo salió cada guía por confirmar: es lo que dice cuánto lleva esperando
  // (BOD-03). `issuedAt` es cuándo se emitió, no cuándo se despachó.
  const dispatchedIds = guides.filter((guide) => guide.status === "dispatched").map((guide) => guide.id)
  const dispatchedRows = dispatchedIds.length > 0
    ? await db
        .select({ id: dispatchGuides.id, dispatchedAt: dispatchGuides.dispatchedAt })
        .from(dispatchGuides)
        .where(inArray(dispatchGuides.id, dispatchedIds))
    : []
  const dispatchedAtById: Record<string, string> = {}
  for (const row of dispatchedRows) if (row.dispatchedAt) dispatchedAtById[row.id] = row.dispatchedAt

  return (
    <PageContainer>
      <PageHeader
        title="Guías de despacho"
        description={`Traslados desde ${OFFICE_ORIGIN_LABEL} hacia faena: confirma lo que llegó y consulta el historial. Los nuevos despachos se preparan desde Recepciones.`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Bodega", href: "/bodega" },
            { label: "Guías de despacho" },
          ]} />
        }
      />

      <GuideFilters
        worksites={worksiteOptions}
        ownWorksiteId={ownWorksiteId}
        current={{ estado: estado ?? "", estadoByDefault: defaultedToDispatched, faena, desde, hasta, q }}
      />

      {total === 0 ? (
        <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
          <EmptyState
            icon={<Truck size={24} />}
            title={q || estado || desde || hasta || faena ? "Sin guías con estos filtros" : "Todavía no hay guías de despacho"}
            description={q || estado || desde || hasta || faena
              ? "Ninguna guía coincide con lo que filtraste. Quita algún filtro para ver más."
              : "Las guías se crean automáticamente desde una recepción en oficina cuando hay bienes que deben continuar hacia una faena."}
            action={q || estado || desde || hasta || faena ? (
              <Button asChild variant="secondary" size="sm">
                <Link href="/bodega/guias?estado=todos&faena=todas">Ver todas las guías</Link>
              </Button>
            ) : undefined}
          />
        </div>
      ) : (
        <>
          <DispatchGuidesTable guides={guides} dispatchedAtById={dispatchedAtById} />
          <ServerPagination
            pagination={pagination}
            hrefForPage={(page) => buildPaginationHref("/bodega/guias", sp, page)}
          />
        </>
      )}
    </PageContainer>
  )
}

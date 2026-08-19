import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { and, asc, eq } from "drizzle-orm"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { DEFAULT_PAGE_SIZE } from "@/lib/constants"
import {
  countStockDocuments,
  getStockCountDetail,
  listStockDocuments,
  type StockDocumentKindKey,
} from "@/lib/services/stock-documents"
import { DocumentsFilters } from "./documents-filters"
import { DocumentsTable } from "./documents-table"

export const metadata: Metadata = { title: "Documentos de bodega" }

const KINDS: StockDocumentKindKey[] = ["ajuste", "desecho", "devolucion", "conteo"]

function readParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : ""
}

export default async function StockDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("warehouse:view_stock") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/bodega/documentos")}`) }

  const sp = await searchParams
  const kindParam = readParam(sp.tipo)
  const kind: StockDocumentKindKey | "" = KINDS.includes(kindParam as StockDocumentKindKey) ? (kindParam as StockDocumentKindKey) : ""
  const faena = readParam(sp.faena)
  const q = readParam(sp.q).trim()
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(readParam(sp.desde)) ? readParam(sp.desde) : ""
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(readParam(sp.hasta)) ? readParam(sp.hasta) : ""
  const doc = readParam(sp.doc)

  const scope = serviceWorksiteScope(session)
  const filters = { worksiteIds: scope, faena, kind, q, desde, hasta }

  const total = await countStockDocuments(filters)
  const pagination = resolvePagination({ pageParam: sp.page, totalItems: total, pageSize: DEFAULT_PAGE_SIZE })

  const [documents, worksiteOptions, detailItems] = await Promise.all([
    listStockDocuments({ ...filters, limit: pagination.limit, offset: pagination.offset }),
    db
      .select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(and(eq(worksites.isActive, true), worksiteScopeSql(session, worksites.id)))
      .orderBy(asc(worksites.name)),
    // El detalle sólo se consulta cuando el enlace pide un documento concreto:
    // es la única fuente con más de una línea.
    doc ? getStockCountDetail(doc, scope) : Promise.resolve([]),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Documentos de bodega"
        description="Ajustes, bajas, devoluciones y conteos físicos con su folio."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Bodega", href: "/bodega" },
            { label: "Documentos" },
          ]} />
        }
      />

      <DocumentsFilters
        worksites={worksiteOptions}
        current={{ q, faena, tipo: kind, desde, hasta }}
      />

      <DocumentsTable
        documents={documents}
        detail={doc ? { id: doc, items: detailItems } : null}
        highlightId={doc || undefined}
      />

      <ServerPagination
        pagination={pagination}
        hrefForPage={(page) => buildPaginationHref("/bodega/documentos", sp, page)}
      />
    </PageContainer>
  )
}

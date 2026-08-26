import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { countTaeImportBatches, listTaeImportBatches, taeLedgerIsGlobal } from "@/lib/combustibles/tae-import-ledger"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { ServerPagination } from "@/components/ui/server-pagination"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime, formatQty } from "@/lib/utils"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"

export const metadata: Metadata = { title: "Historial de importaciones TAE" }

const PAGE_SIZE = 25

export default async function TaeImportHistoryPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  let session
  try { session = await requirePermission("combustibles:tae_import") } catch { redirect("/forbidden") }
  const query = await searchParams
  const isGlobal = taeLedgerIsGlobal(session)
  const count = await countTaeImportBatches(session)
  const pagination = resolvePagination({ pageParam: query.page, totalItems: count, pageSize: PAGE_SIZE })
  const currentPage = pagination.page
  const batches = await listTaeImportBatches(session, { limit: PAGE_SIZE, offset: (currentPage - 1) * PAGE_SIZE })

  return (
    <PageContainer>
      <PageHeader
        title="Historial de importaciones TAE"
        description={isGlobal
          ? `${formatQty(count)} lotes registrados con trazabilidad de estado y responsable.`
          : `${formatQty(count)} lotes con cargas de tus faenas. Las cifras corresponden sólo a tus faenas.`}
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Control TAE", href: "/combustibles/tae" }, { label: "Importar histórico", href: "/combustibles/tae/importar" }, { label: "Historial" }]} />}
        actions={<Button asChild><Link href="/combustibles/tae/importar">Nueva importación</Link></Button>}
      />

      <div className="overflow-x-auto rounded-lg border border-(--color-border)">
        <Table className="min-w-[920px]">
          <TableHeader><TableRow><TableHead>Archivo</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Válidas</TableHead><TableHead className="text-right">Observadas</TableHead>{isGlobal && <TableHead className="text-right">Rechazadas</TableHead>}<TableHead className="text-right">Litros</TableHead><TableHead>Responsable</TableHead><TableHead>Fecha</TableHead></TableRow></TableHeader>
          <TableBody>
            {batches.map((batch) => (
              <TableRow key={batch.id}>
                <TableCell><Link className="font-medium text-(--color-primary-ink) hover:underline" href={`/combustibles/tae/importar/${batch.id}`}>{batch.fileName}</Link></TableCell>
                <TableCell><Badge variant={batch.status === "reverted" ? "danger" : "success"}>{batch.status === "reverted" ? "Revertido" : "Importado"}</Badge></TableCell>
                <TableCell className="text-right font-mono">{formatQty(batch.validRows)}</TableCell>
                <TableCell className="text-right font-mono">{formatQty(batch.observedRows)}</TableCell>
                {isGlobal && <TableCell className="text-right font-mono">{formatQty(batch.invalidRows ?? 0)}</TableCell>}
                <TableCell className="text-right font-mono">{formatQty(batch.totalLiters, "L")}</TableCell>
                <TableCell>{batch.importerLabel}</TableCell>
                <TableCell>{formatDateTime(batch.createdAt)}</TableCell>
              </TableRow>
            ))}
            {batches.length === 0 && <TableRow><TableCell colSpan={isGlobal ? 8 : 7} className="py-10 text-center text-(--color-text-muted)">No hay lotes TAE importados.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <ServerPagination pagination={pagination} hrefForPage={(target) => buildPaginationHref("/combustibles/tae/importar/historial", {}, target)} />
    </PageContainer>
  )
}

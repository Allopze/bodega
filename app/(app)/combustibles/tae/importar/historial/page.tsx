import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { desc, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelTaeImportBatches } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime, formatQty } from "@/lib/utils"

export const metadata: Metadata = { title: "Historial de importaciones TAE" }

const PAGE_SIZE = 25

export default async function TaeImportHistoryPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  try { await requirePermission("combustibles:tae_import") } catch { redirect("/forbidden") }
  const query = await searchParams
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1)
  const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(fuelTaeImportBatches)
  const count = countRow?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const batches = await db.query.fuelTaeImportBatches.findMany({
    orderBy: [desc(fuelTaeImportBatches.createdAt)],
    limit: PAGE_SIZE,
    offset: (currentPage - 1) * PAGE_SIZE,
    with: { importer: { columns: { name: true, email: true } } },
  })

  return (
    <PageContainer>
      <PageHeader
        title="Historial de importaciones TAE"
        description={`${formatQty(count)} lotes registrados con trazabilidad de estado y responsable.`}
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Control TAE", href: "/combustibles/tae" }, { label: "Importar histórico", href: "/combustibles/tae/importar" }, { label: "Historial" }]} />}
        actions={<Button asChild><Link href="/combustibles/tae/importar">Nueva importación</Link></Button>}
      />

      <div className="overflow-x-auto rounded-lg border border-(--color-border)">
        <Table className="min-w-[920px]">
          <TableHeader><TableRow><TableHead>Archivo</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Válidas</TableHead><TableHead className="text-right">Observadas</TableHead><TableHead className="text-right">Rechazadas</TableHead><TableHead className="text-right">Litros</TableHead><TableHead>Responsable</TableHead><TableHead>Fecha</TableHead></TableRow></TableHeader>
          <TableBody>
            {batches.map((batch) => (
              <TableRow key={batch.id}>
                <TableCell><Link className="font-medium text-(--color-primary-ink) hover:underline" href={`/combustibles/tae/importar/${batch.id}`}>{batch.fileName}</Link></TableCell>
                <TableCell><Badge variant={batch.status === "reverted" ? "danger" : "success"}>{batch.status === "reverted" ? "Revertido" : "Importado"}</Badge></TableCell>
                <TableCell className="text-right font-mono">{formatQty(batch.validRows)}</TableCell>
                <TableCell className="text-right font-mono">{formatQty(batch.observedRows)}</TableCell>
                <TableCell className="text-right font-mono">{formatQty(batch.invalidRows)}</TableCell>
                <TableCell className="text-right font-mono">{formatQty(Number(batch.totalLiters), "L")}</TableCell>
                <TableCell>{batch.importer?.name ?? batch.importer?.email ?? "—"}</TableCell>
                <TableCell>{formatDateTime(batch.createdAt)}</TableCell>
              </TableRow>
            ))}
            {batches.length === 0 && <TableRow><TableCell colSpan={8} className="py-10 text-center text-(--color-text-muted)">No hay lotes TAE importados.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      {pageCount > 1 && <nav className="mt-4 flex items-center justify-between" aria-label="Paginación del historial"><Button asChild variant="secondary" size="sm"><Link aria-disabled={currentPage === 1} className={currentPage === 1 ? "pointer-events-none opacity-50" : undefined} href={`?page=${Math.max(1, currentPage - 1)}`}>Anterior</Link></Button><span className="text-sm text-(--color-text-muted)">Página {currentPage} de {pageCount}</span><Button asChild variant="secondary" size="sm"><Link aria-disabled={currentPage === pageCount} className={currentPage === pageCount ? "pointer-events-none opacity-50" : undefined} href={`?page=${Math.min(pageCount, currentPage + 1)}`}>Siguiente</Link></Button></nav>}
    </PageContainer>
  )
}

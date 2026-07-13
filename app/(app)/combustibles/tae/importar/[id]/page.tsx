import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelTaeImportBatches } from "@/db/schema"
import { can, requirePermission } from "@/lib/auth/can"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime, formatQty } from "@/lib/utils"
import { RevertTaeBatchButton } from "../tae-batch-actions"

export const metadata: Metadata = { title: "Detalle de lote TAE" }

export default async function TaeImportBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requirePermission("combustibles:tae_import") } catch { redirect("/forbidden") }
  const { id } = await params
  const batch = await db.query.fuelTaeImportBatches.findFirst({
    where: eq(fuelTaeImportBatches.id, id),
    with: {
      importer: { columns: { name: true, email: true } },
      submissions: {
        orderBy: (submissions, { asc }) => [asc(submissions.loadedAt)],
        with: {
          worksite: { columns: { name: true } },
          vehicle: { columns: { code: true, plate: true } },
          product: { columns: { name: true } },
        },
      },
    },
  })
  if (!batch) notFound()
  const canRevert = batch.status === "imported" && can(session, "combustibles:revert")

  return (
    <PageContainer>
      <PageHeader
        title="Detalle de lote TAE"
        description={batch.fileName}
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Control TAE", href: "/combustibles/tae" }, { label: "Importar histórico", href: "/combustibles/tae/importar" }, { label: "Historial", href: "/combustibles/tae/importar/historial" }, { label: batch.fileName }]} />}
        actions={<RevertTaeBatchButton batchId={batch.id} canRevert={canRevert} />}
      />

      <Card className="mb-5">
        <CardHeader className="flex flex-row items-center justify-between"><CardTitle>Resumen del lote</CardTitle><Badge variant={batch.status === "reverted" ? "danger" : "success"}>{batch.status === "reverted" ? "Revertido" : "Importado"}</Badge></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Filas totales" value={formatQty(batch.totalRows)} />
          <Field label="Importadas" value={formatQty(batch.validRows)} />
          <Field label="Observadas" value={formatQty(batch.observedRows)} />
          <Field label="Rechazadas" value={formatQty(batch.invalidRows)} />
          <Field label="Volumen" value={formatQty(Number(batch.totalLiters), "L")} />
          <Field label="Importado por" value={batch.importer?.name ?? batch.importer?.email ?? "—"} />
          <Field label="Fecha" value={formatDateTime(batch.createdAt)} />
          <Field label="Hash de archivo" value={batch.fileHash.slice(0, 16)} mono />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Cargas conservadas ({formatQty(batch.submissions.length)})</CardTitle></CardHeader>
        <CardContent>
          {batch.status === "reverted" && <p className="mb-4 text-sm text-(--color-text-muted)">Las cargas fueron eliminadas por la reversa. El resumen del lote permanece disponible para auditoría.</p>}
          {batch.invalidRows > 0 && <p className="mb-4 text-sm text-(--color-text-muted)">Las {formatQty(batch.invalidRows)} filas rechazadas se registran actualmente como conteo del lote; su detalle todavía no se persiste.</p>}
          <div className="overflow-x-auto rounded-lg border border-(--color-border)">
            <Table className="min-w-[960px]">
              <TableHeader><TableRow><TableHead>Fecha carga</TableHead><TableHead>Faena</TableHead><TableHead>Equipo</TableHead><TableHead>Producto</TableHead><TableHead>Conductor</TableHead><TableHead>Supervisor</TableHead><TableHead>Medidor</TableHead><TableHead className="text-right">Litros</TableHead><TableHead>Estado</TableHead></TableRow></TableHeader>
              <TableBody>
                {batch.submissions.map((submission) => <TableRow key={submission.id}><TableCell>{formatDateTime(submission.loadedAt)}</TableCell><TableCell>{submission.worksite?.name ?? "—"}</TableCell><TableCell>{submission.vehicle?.code ?? submission.equipmentCodeSnapshot}{(submission.vehicle?.plate ?? submission.plateSnapshot) ? ` · ${submission.vehicle?.plate ?? submission.plateSnapshot}` : ""}</TableCell><TableCell>{submission.product?.name ?? "—"}</TableCell><TableCell>{submission.driverNameSnapshot}</TableCell><TableCell>{submission.supervisorNameSnapshot}</TableCell><TableCell className="font-mono">{submission.meterReading == null ? "—" : formatQty(Number(submission.meterReading))}</TableCell><TableCell className="text-right font-mono">{formatQty(Number(submission.liters), "L")}</TableCell><TableCell><Badge variant={submission.status === "observed" ? "warning" : "success"}>{submission.status === "observed" ? "Observada" : "Validada"}</Badge></TableCell></TableRow>)}
                {batch.submissions.length === 0 && <TableRow><TableCell colSpan={9} className="py-10 text-center text-(--color-text-muted)">No hay cargas vigentes en este lote.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  )
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><p className="text-xs text-(--color-text-muted)">{label}</p><p className={mono ? "font-mono text-sm" : "text-sm font-medium"}>{value}</p></div>
}

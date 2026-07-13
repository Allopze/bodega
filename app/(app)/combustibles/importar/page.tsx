import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { QrCode } from "@phosphor-icons/react/dist/ssr"
import { db } from "@/db"
import { fuelImportBatches, fuelOperationBatches, worksites } from "@/db/schema"
import { desc, inArray } from "drizzle-orm"
import { can, requirePermission } from "@/lib/auth/can"
import { isGlobalRole, resolveWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { getCopecSyncStartOptions, getCopecSyncState } from "@/lib/combustibles/copec-sync"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ImportWizard } from "./import-wizard"
import { ImportBatchHistory } from "./import-batch-history"
import { OperationsImportWizard } from "./operations-import-wizard"
import { CopecSyncStatus } from "./copec-sync-status"
import { OperationsBatchHistory } from "./operations-batch-history"

export const metadata: Metadata = { title: "Importar consumos de combustible" }

export default async function ImportarConsumosPage() {
  let session
  try { session = await requirePermission("combustibles:import") }
  catch { redirect("/forbidden") }

  const worksiteScope = resolveWorksiteScope(session)
  const canImportOperations = isGlobalRole(session)
  const canViewTae = can(session, "combustibles:tae_view")

  const [worksitesList, batches, operationBatches, copecSyncState, copecSyncStartOptions] = await Promise.all([
    worksiteScope.mode === "none"
      ? Promise.resolve([])
      : db.query.worksites.findMany({
          where: worksiteScope.mode === "some" ? inArray(worksites.id, worksiteScope.ids) : undefined,
          orderBy: [worksites.name],
        }),
    db.query.fuelImportBatches.findMany({
      where: worksiteScopeSql(session, fuelImportBatches.worksiteId),
      with: { worksite: { columns: { name: true } }, importer: { columns: { name: true, email: true } } },
      orderBy: [desc(fuelImportBatches.createdAt)],
      limit: 50,
    }),
    canImportOperations
      ? db.query.fuelOperationBatches.findMany({
          with: { importer: { columns: { name: true, email: true } } },
          orderBy: [desc(fuelOperationBatches.createdAt)],
          limit: 50,
        })
      : Promise.resolve([]),
    getCopecSyncState(),
    getCopecSyncStartOptions(),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Importar consumos TCT"
        description="Sincroniza el detalle mensual de Diésel y BlueMax desde Copec, o carga un reporte XLSX manual"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Importar consumos" }]} />}
        actions={canViewTae ? (
          <Button asChild variant="secondary" size="sm">
            <Link href="/combustibles/tae"><QrCode className="mr-1 h-4 w-4" />Control manual TAE</Link>
          </Button>
        ) : undefined}
      />

      <Tabs defaultValue="consumos">
        <TabsList>
          <TabsTrigger value="consumos">TCT · Diésel y BlueMax</TabsTrigger>
          {canImportOperations && <TabsTrigger value="operaciones">Log operacional</TabsTrigger>}
        </TabsList>

        <TabsContent value="consumos">
          {canViewTae && (
            <div className="mb-4 flex flex-col gap-2 border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>TAE ya no se extrae junto con TCT. Las cargas físicas se registran en el control manual por QR.</span>
              <Link href="/combustibles/tae" className="shrink-0 font-medium text-[var(--color-primary)] hover:underline">Ir a Control TAE</Link>
            </div>
          )}
          <div className="mb-6">
            <CopecSyncStatus initialStatus={copecSyncState} initialStartOptions={copecSyncStartOptions} />
          </div>
          <div className="mb-8">
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Carga manual de reportes</h2>
            <ImportWizard worksites={worksitesList} canImportAllWorksites={canImportOperations} />
          </div>
          <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3">Historial de importaciones</h2>
          <ImportBatchHistory batches={batches} />
        </TabsContent>

        {canImportOperations && (
          <TabsContent value="operaciones">
            <div className="mb-8">
              <OperationsImportWizard />
            </div>
            <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3">Historial de importaciones</h2>
            <OperationsBatchHistory batches={operationBatches} />
          </TabsContent>
        )}
      </Tabs>
    </PageContainer>
  )
}

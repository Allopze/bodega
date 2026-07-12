import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { fuelImportBatches, fuelOperationBatches, worksites } from "@/db/schema"
import { desc, inArray } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { isGlobalRole, resolveWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { getCopecSyncStartOptions, getCopecSyncState } from "@/lib/combustibles/copec-sync"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
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
        title="Importar consumos de combustible"
        description="Carga reportes de tarjetas de combustible por patente y periodo, o el log operacional de cargas"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Importar consumos" }]} />}
      />

      <Tabs defaultValue="consumos">
        <TabsList>
          <TabsTrigger value="consumos">Consumos por patente</TabsTrigger>
          {canImportOperations && <TabsTrigger value="operaciones">Log operacional</TabsTrigger>}
        </TabsList>

        <TabsContent value="consumos">
          <p className="text-xs text-muted-foreground mb-3">Hay dos formas de traer los consumos — elige la que corresponda.</p>
          <div className="mb-6">
            <CopecSyncStatus initialStatus={copecSyncState} initialStartOptions={copecSyncStartOptions} />
          </div>
          <div className="mb-8">
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

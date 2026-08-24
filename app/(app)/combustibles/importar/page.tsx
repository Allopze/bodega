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
import { AramcoSyncStatus } from "./aramco-sync-status"
import { getAramcoSyncStatusAction } from "./aramco-sync-action"
import { OperationsBatchHistory } from "./operations-batch-history"
import { FuelProviderQualityExportButton } from "./fuel-provider-quality-export-button"

export const metadata: Metadata = { title: "Importar consumos de combustible" }

export default async function ImportarConsumosPage() {
  let session
  try { session = await requirePermission("combustibles:import") }
  catch { redirect("/forbidden") }

  const worksiteScope = resolveWorksiteScope(session)
  const canImportOperations = isGlobalRole(session)
  const canSyncIntegrations = can(session, "combustibles:sync_integrations")
  const canViewTae = can(session, "combustibles:tae_view")
  const canExportQuality = can(session, "combustibles:export")

  const [worksitesList, batches, operationBatches, copecSyncState, copecSyncStartOptions, aramcoStatus] = await Promise.all([
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
    canSyncIntegrations ? getCopecSyncState() : Promise.resolve(null),
    canSyncIntegrations ? getCopecSyncStartOptions() : Promise.resolve(null),
    canSyncIntegrations ? getAramcoSyncStatusAction() : Promise.resolve(null),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Importar consumos TCT"
        description="Sincroniza los consumos mensuales desde Copec y Aramco, o carga un reporte Excel manual"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Importar consumos" }]} />}
        actions={(canViewTae || canExportQuality) ? (
          <div className="flex flex-wrap gap-2">
            {canExportQuality && <FuelProviderQualityExportButton />}
            {canViewTae && (
              <Button asChild variant="secondary" size="sm">
                <Link href="/combustibles/tae"><QrCode className="mr-1 h-4 w-4" />Control manual TAE</Link>
              </Button>
            )}
          </div>
        ) : undefined}
      />

      <Tabs defaultValue="consumos">
        <TabsList>
          <TabsTrigger value="consumos">TCT · Diésel y BlueMax</TabsTrigger>
          {canImportOperations && <TabsTrigger value="operaciones">Log operacional</TabsTrigger>}
        </TabsList>

        <TabsContent value="consumos">
          {canViewTae && (
            <div className="mb-4 flex flex-col gap-2 border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5 text-xs text-[var(--color-text-muted)] sm:flex-row sm:items-center sm:justify-between">
              <span>TAE se extrae junto con la sincronización Copec y las cargas físicas también pueden registrarse manualmente por QR.</span>
              <Link href="/combustibles/tae" className="shrink-0 font-medium text-[var(--color-primary)] hover:underline">Ir a Control TAE</Link>
            </div>
          )}
          <div className="mb-6 grid gap-4">
            {canSyncIntegrations && copecSyncState && copecSyncStartOptions && (
              <CopecSyncStatus initialStatus={copecSyncState} initialStartOptions={copecSyncStartOptions} />
            )}
            {canSyncIntegrations && aramcoStatus?.ok && <AramcoSyncStatus initialStatus={aramcoStatus.data} />}
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

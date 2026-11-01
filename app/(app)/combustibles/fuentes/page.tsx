import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { fuelSupplyMedia, worksites } from "@/db/schema"
import { settle } from "@/lib/async-settle"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { ExportButton } from "@/components/ui/export-button"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { AddFuelDataButton } from "@/components/combustibles/add-fuel-data-button"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { getCopecSyncStartOptions, getCopecSyncState } from "@/lib/combustibles/copec-sync"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { fuelAddDataOptions } from "@/lib/combustibles/section-nav"
import { describeFuelSources, getFuelSourceStatuses, type FuelSourceStatus } from "@/lib/combustibles/sources-status"
import { downloadOperationsTemplateAction } from "../actions-operaciones"
import { downloadImportTemplateAction } from "../control/importar/actions"
import type { MediumOption } from "../control/importar/import-types"
import { getAramcoSyncStatusAction } from "../importar/aramco-sync-action"
import { AramcoSyncStatus } from "../importar/aramco-sync-status"
import { CopecSyncStatus } from "../importar/copec-sync-status"
import { FuelProviderQualityExportButton } from "../importar/fuel-provider-quality-export-button"
import { AddDataLauncher } from "./add-data-launcher"
import { resolveAddDataKind } from "./add-data-kind"
import { listImportedFiles, type ImportedFilesPage } from "./imported-files"
import { ImportedFilesTable } from "./imported-files-table"
import { SourceRow } from "./source-row"

export const metadata: Metadata = { title: "Fuentes de datos" }

type SearchParams = Record<string, string | string[] | undefined>

/** Una sección de la pantalla que no se pudo consultar: se avisa en vez de mostrar un vacío falso. */
const FAILED = Symbol("failed")

export default async function FuentesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireAnyPermission(["combustibles:import", "combustibles:tae_import", "combustibles:sync_integrations"], FUEL_PATHS.fuentes)
    .catch(() => redirect("/forbidden"))

  const sp = await searchParams
  const period = await resolveFuelPeriodForPage(session, sp)
  const options = fuelAddDataOptions(session)
  const canSync = can(session, "combustibles:sync_integrations")
  const canImport = can(session, "combustibles:import")
  const canManageIntegrations = can(session, "combustibles:manage_integrations")
  const canExportQuality = can(session, "combustibles:export")
  const addKind = resolveAddDataKind(sp.agregar, options)

  const scope = resolveWorksiteScope(session)
  const [statusesResult, filesResult, copecResult, copecStartResult, aramcoResult, worksitesResult, mediaResult] = await Promise.all([
    settle<FuelSourceStatus[] | typeof FAILED>(getFuelSourceStatuses(session, period), FAILED, "fuentes-estados"),
    settle<ImportedFilesPage | typeof FAILED>(listImportedFiles(session, { limit: 6 }), FAILED, "fuentes-archivos"),
    canSync ? settle<Awaited<ReturnType<typeof getCopecSyncState>> | typeof FAILED>(getCopecSyncState(), FAILED, "fuentes-copec") : Promise.resolve(null),
    canSync ? settle<Awaited<ReturnType<typeof getCopecSyncStartOptions>> | typeof FAILED>(getCopecSyncStartOptions(), FAILED, "fuentes-copec-inicio") : Promise.resolve(null),
    canSync ? settle<Awaited<ReturnType<typeof getAramcoSyncStatusAction>> | typeof FAILED>(getAramcoSyncStatusAction(), FAILED, "fuentes-aramco") : Promise.resolve(null),
    // Las faenas sólo se necesitan para mapear las del Excel de facturas, y los medios para el archivo de surtidor.
    addKind === "facturas" && scope.mode !== "none"
      ? settle<Array<{ id: string; name: string }> | typeof FAILED>(
          db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(scope.mode === "some" ? inArray(worksites.id, scope.ids) : undefined).orderBy(asc(worksites.name)),
          FAILED, "fuentes-faenas")
      : Promise.resolve([]),
    addKind === "surtidor"
      ? settle<MediumOption[] | typeof FAILED>(
          db.select({ id: fuelSupplyMedia.id, name: fuelSupplyMedia.name }).from(fuelSupplyMedia).where(eq(fuelSupplyMedia.isActive, true)).orderBy(asc(fuelSupplyMedia.sortOrder), asc(fuelSupplyMedia.name)),
          FAILED, "fuentes-medios")
      : Promise.resolve([]),
  ])

  const statuses = statusesResult === FAILED ? null : statusesResult
  const files = filesResult === FAILED ? null : filesResult
  const copecState = copecResult === FAILED ? null : copecResult
  const copecStart = copecStartResult === FAILED ? null : copecStartResult
  const aramco = aramcoResult === FAILED || aramcoResult === null || !aramcoResult.ok ? null : aramcoResult.data
  const degraded = [
    statuses === null ? "estado de las fuentes" : null,
    files === null ? "archivos importados" : null,
    canSync && (copecState === null || copecStart === null) ? "sincronización de Copec" : null,
    canSync && aramco === null ? "sincronización de Aramco" : null,
    worksitesResult === FAILED ? "faenas" : null,
    mediaResult === FAILED ? "medios de suministro" : null,
  ].filter((label): label is string => label !== null)

  const credentialsHref = canManageIntegrations ? FUEL_PATHS.ajustesIntegraciones : null
  const importHref = (kind: "telemetria" | "surtidor" | "facturas") => `${FUEL_PATHS.fuentes}?agregar=${kind}`
  const secondary = (href: string, label: string) => <Button asChild variant="secondary" size="sm"><Link href={href}>{label}</Link></Button>
  const ghost = (href: string, label: string) => <Button asChild variant="ghost" size="sm"><Link href={href}>{label}</Link></Button>

  function actionsFor(source: FuelSourceStatus) {
    switch (source.key) {
      // Quien exporta pero no administra la integración no recibe la fila interactiva: conserva el botón de exportar.
      case "copec":
      case "aramco":
        return canExportQuality ? <FuelProviderQualityExportButton /> : null
      case "planilla":
        return canImport ? (
          <>
            {secondary(`${FUEL_PATHS.fuentes}/agregar/planilla`, "Importar planilla")}
            <ExportButton action={downloadOperationsTemplateAction} label="Descargar plantilla" variant="ghost" />
          </>
        ) : null
      case "telemetria":
        return canImport ? (
          <>
            {secondary(importHref("telemetria"), "Importar telemetría")}
            <ExportButton action={downloadImportTemplateAction} filters="telemetry" label="Descargar plantilla" variant="ghost" />
          </>
        ) : null
      case "surtidor":
        return canImport ? (
          <>
            {secondary(importHref("surtidor"), "Importar despachos")}
            <ExportButton action={downloadImportTemplateAction} filters="supply_inputs" label="Descargar plantilla" variant="ghost" />
          </>
        ) : null
      case "facturas":
        return options.some((option) => option.kind === "facturas" && option.allowed) ? secondary(importHref("facturas"), "Importar facturas") : null
      case "historico-sellos":
        return can(session, "combustibles:tae_import") ? secondary(`${FUEL_PATHS.fuentes}/agregar/sellos`, "Importar histórico") : null
      case "terreno":
        return (
          <>
            {can(session, "combustibles:tae_manage_config") ? secondary(FUEL_PATHS.ajustesPuntos, "Puntos de carga y QR") : null}
            {ghost(FUEL_PATHS.cargas, "Ver las cargas")}
          </>
        )
      default:
        return null
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Fuentes de datos"
        description="De dónde llegan los datos de combustible y cuándo llegaron por última vez"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Fuentes de datos" }]} />}
        actions={<FuelHeaderActions period={period}><AddFuelDataButton options={options} /></FuelHeaderActions>}
      />
      <DegradedDataBanner degraded={degraded} total={4} />

      {statuses ? (
        <>
          <div role="status" className="mb-4 max-w-4xl text-sm text-[var(--color-text)]">
            <p className="font-medium">{describeFuelSources(statuses, period)}</p>
            {statuses.some((source) => source.problem) ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {statuses.filter((source) => source.problem).map((source) => (
                  <li key={source.key}><span className="font-medium">{source.name}:</span> {source.problem}</li>
                ))}
              </ul>
            ) : null}
          </div>
          {/* `grid-cols-1` y no la columna automática: con ella una fila de contenido ancho estira la columna de todas. */}
          <div className="grid grid-cols-1 gap-3">
            {statuses.map((source) => {
              if (source.key === "copec" && canSync && copecState && copecStart) {
                return (
                  <CopecSyncStatus
                    key={source.key}
                    source={source}
                    initialStatus={copecState}
                    initialStartOptions={copecStart}
                    qualityExport={canExportQuality ? <FuelProviderQualityExportButton /> : null}
                  />
                )
              }
              if (source.key === "aramco" && canSync && aramco) {
                return <AramcoSyncStatus key={source.key} source={source} initialStatus={aramco} credentialsHref={credentialsHref} />
              }
              return <SourceRow key={source.key} source={source} status={source} actions={actionsFor(source)} />
            })}
          </div>
        </>
      ) : null}

      {files ? (
        <section aria-labelledby="archivos-recientes" className="mt-8">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div className="max-w-2xl">
              <h2 id="archivos-recientes" className="text-h2 text-[var(--color-text)]">Archivos importados</h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">Todos los importadores en una sola lista. Revertir un archivo borra lo que trajo y recalcula los equipos afectados.</p>
            </div>
            {files.total > files.rows.length ? ghost(FUEL_PATHS.fuentesArchivos, `Ver los ${files.total} archivos`) : null}
          </div>
          {files.rows.length > 0 ? <ImportedFilesTable rows={files.rows} caption="Últimos archivos importados" /> : (
            <p className="text-sm text-[var(--color-text-muted)]">Todavía no se ha importado ningún archivo. Usa «Agregar datos» para subir el primero.</p>
          )}
        </section>
      ) : null}

      {addKind ? <AddDataLauncher kind={addKind} worksites={worksitesResult === FAILED ? [] : worksitesResult} media={mediaResult === FAILED ? [] : mediaResult} /> : null}
    </PageContainer>
  )
}

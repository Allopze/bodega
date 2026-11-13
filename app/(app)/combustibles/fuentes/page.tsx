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
import { EmptyState } from "@/components/ui/empty-state"
import { ExportButton } from "@/components/ui/export-button"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { AddFuelDataButton } from "@/components/combustibles/add-fuel-data-button"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { getCopecSyncStartOptions, getCopecSyncState } from "@/lib/combustibles/copec-sync"
import { getFuelCoverageMatrix, type FuelCoverageMatrix } from "@/lib/combustibles/coverage-matrix-data"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { fuelAddDataOptions } from "@/lib/combustibles/section-nav"
import { describeFuelSources, getFuelSourceStatuses, type FuelSourceStatus } from "@/lib/combustibles/sources-status"
import { downloadOperationsTemplateAction } from "../actions-operaciones"
import { downloadImportTemplateAction } from "../control/importar/actions"
import type { MediumOption } from "../control/importar/import-types"
import { CopecSyncStatus } from "./copec-sync-status"
import { CopecPeriodReview } from "./copec-period-review"
import { FuelProviderQualityExportButton } from "../importar/fuel-provider-quality-export-button"
import { AddDataLauncher } from "./add-data-launcher"
import { CoverageMap } from "./coverage-map"
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
  const canExportQuality = can(session, "combustibles:export")
  const addKind = resolveAddDataKind(sp.agregar, options)

  const scope = resolveWorksiteScope(session)
  const [statusesResult, coverageResult, filesResult, copecResult, copecStartResult, worksitesResult, mediaResult] = await Promise.all([
    settle<FuelSourceStatus[] | typeof FAILED>(getFuelSourceStatuses(session, period), FAILED, "fuentes-estados"),
    settle<FuelCoverageMatrix | typeof FAILED>(getFuelCoverageMatrix(session), FAILED, "fuentes-cobertura"),
    settle<ImportedFilesPage | typeof FAILED>(listImportedFiles(session, { limit: 6 }), FAILED, "fuentes-archivos"),
    canSync ? settle<Awaited<ReturnType<typeof getCopecSyncState>> | typeof FAILED>(getCopecSyncState(), FAILED, "fuentes-copec") : Promise.resolve(null),
    canSync ? settle<Awaited<ReturnType<typeof getCopecSyncStartOptions>> | typeof FAILED>(getCopecSyncStartOptions(), FAILED, "fuentes-copec-inicio") : Promise.resolve(null),
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
  const coverage = coverageResult === FAILED ? null : coverageResult
  const files = filesResult === FAILED ? null : filesResult
  const copecState = copecResult === FAILED ? null : copecResult
  const copecStart = copecStartResult === FAILED ? null : copecStartResult
  // Cada consulta que esta pantalla hace (y por tanto puede fallar) se declara una sola vez: el aviso de datos
  // incompletos toma de aquí cuáles fallaron y de cuántas, sin un total escrito a mano.
  const queries: Array<{ label: string; failed: boolean }> = [
    { label: "estado de las fuentes", failed: statuses === null },
    { label: "cobertura por mes", failed: coverage === null },
    { label: "archivos importados", failed: files === null },
    ...(canSync ? [{ label: "sincronización de Copec", failed: copecState === null || copecStart === null }] : []),
    ...(addKind === "facturas" && scope.mode !== "none" ? [{ label: "faenas", failed: worksitesResult === FAILED }] : []),
    ...(addKind === "surtidor" ? [{ label: "medios de suministro", failed: mediaResult === FAILED }] : []),
  ]
  const degraded = queries.filter((query) => query.failed).map((query) => query.label)

  const problemSources = statuses ? statuses.filter((source) => source.problem).length : 0
  const secondary = (href: string, label: string) => <Button asChild variant="secondary" size="sm"><Link href={href}>{label}</Link></Button>
  const ghost = (href: string, label: string) => <Button asChild variant="ghost" size="sm"><Link href={href}>{label}</Link></Button>

  /**
   * Para meter datos hay un solo verbo y un solo lugar: «Agregar datos», arriba. Las filas de cada fuente ya no
   * repiten un botón «Importar…» que abría el mismo diálogo; conservan lo que sólo ellas ofrecen (la plantilla, la
   * exportación de pendientes, los puntos de carga). Cada «Descargar plantilla» dice de qué fuente es.
   */
  function actionsFor(source: FuelSourceStatus) {
    switch (source.key) {
      // Quien exporta pero no administra la integración no recibe la fila interactiva: conserva el botón de exportar.
      case "copec":
        return canExportQuality ? <FuelProviderQualityExportButton /> : null
      case "planilla":
        return canImport ? <ExportButton action={downloadOperationsTemplateAction} label="Descargar plantilla" ariaLabel="Descargar la plantilla de la planilla de cargas" variant="ghost" /> : null
      case "telemetria":
        return canImport ? <ExportButton action={downloadImportTemplateAction} filters="telemetry" label="Descargar plantilla" ariaLabel="Descargar la plantilla de telemetría" variant="ghost" /> : null
      case "surtidor":
        return canImport ? <ExportButton action={downloadImportTemplateAction} filters="supply_inputs" label="Descargar plantilla" ariaLabel="Descargar la plantilla de despachos de surtidor" variant="ghost" /> : null
      case "terreno":
        return (
          <>
            {can(session, "combustibles:tae_manage_config") ? secondary(FUEL_PATHS.ajustesPuntos, "Ver puntos de carga y QR") : null}
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
      <DegradedDataBanner degraded={degraded} total={queries.length} />

      {statuses ? (
        <>
          {/* El detalle de cada problema vive en la tarjeta de su fuente («Falta»): listarlo también aquí lo repetía. */}
          <p role="status" className="mb-4 max-w-4xl text-sm font-medium text-[var(--color-text)]">
            {problemSources === 0
              ? describeFuelSources(statuses, period)
              : problemSources === 1
                ? "Una fuente necesita atención; el detalle está en su tarjeta."
                : `${problemSources} fuentes necesitan atención; el detalle está en cada tarjeta.`}
          </p>
          {coverage ? <CoverageMap matrix={coverage} /> : null}
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
              return <SourceRow key={source.key} source={source} status={source} actions={actionsFor(source)} />
            })}
          </div>
          {/* Meses y filas de Copec que esperan una decisión humana (4.1 y 4.2): sin esto el barrido no avanza. */}
          {canSync && copecState ? <CopecPeriodReview state={copecState} /> : null}
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
            <EmptyState
              compact
              title="Todavía no se ha importado ningún archivo"
              description="Cuando subas una planilla, un reporte de tarjeta o la telemetría de los equipos con «Agregar datos», arriba, quedará acá con lo que trajo."
            />
          )}
        </section>
      ) : null}

      {addKind ? <AddDataLauncher kind={addKind} worksites={worksitesResult === FAILED ? [] : worksitesResult} media={mediaResult === FAILED ? [] : mediaResult} /> : null}
    </PageContainer>
  )
}

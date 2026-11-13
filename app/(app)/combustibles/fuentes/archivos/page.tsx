import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { UploadSimple } from "@phosphor-icons/react/dist/ssr"
import { requireAnyPermission } from "@/lib/auth/can"
import { settle } from "@/lib/async-settle"
import { Button } from "@/components/ui/button"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { ServerPagination } from "@/components/ui/server-pagination"
import { AddFuelDataButton } from "@/components/combustibles/add-fuel-data-button"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { fuelAddDataOptions } from "@/lib/combustibles/section-nav"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { ArchivosFilters } from "./archivos-filters"
import { isImportedFileKind, isImportedFileStatus } from "../imported-file-kinds"
import { countImportedFiles, listImportedFiles, type ImportedFilesPage } from "../imported-files"
import { ImportedFilesTable } from "../imported-files-table"

export const metadata: Metadata = { title: "Archivos importados" }

const PAGE_SIZE = 25

type SearchParams = Record<string, string | string[] | undefined>
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export default async function ArchivosImportadosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requireAnyPermission(["combustibles:import", "combustibles:tae_import", "combustibles:sync_integrations"], FUEL_PATHS.fuentes) } catch { redirect("/forbidden") }

  const sp = await searchParams
  const tipo = first(sp.tipo)
  const estado = first(sp.estado)
  const kind = isImportedFileKind(tipo) ? tipo : undefined
  const status = isImportedFileStatus(estado) ? estado : undefined
  const pageParam = first(sp.pagina)

  const failed = Symbol("failed")
  // Primero los totales (para acotar la página pedida) y luego la página: una página fuera de rango cae en la última.
  const counted = await settle<Awaited<ReturnType<typeof countImportedFiles>> | typeof failed>(countImportedFiles(session, { kind, status }), failed, "fuentes-archivos-conteo")
  const pagination = resolvePagination({ pageParam, totalItems: counted === failed ? 0 : counted.total, pageSize: PAGE_SIZE })
  const listed = counted === failed
    ? failed
    : await settle<ImportedFilesPage | typeof failed>(listImportedFiles(session, { kind, status, limit: PAGE_SIZE, offset: pagination.offset }), failed, "fuentes-archivos")
  const page = listed === failed ? null : listed

  return (
    <PageContainer>
      <PageHeader
        title="Archivos importados"
        description="Cada archivo que se subió, con lo que trajo y la opción de revertirlo"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Fuentes de datos", href: FUEL_PATHS.fuentes }, { label: "Archivos importados" }]} />}
        actions={<FuelHeaderActions><AddFuelDataButton options={fuelAddDataOptions(session)} /></FuelHeaderActions>}
      />
      <DegradedDataBanner degraded={page ? [] : ["lista de archivos importados"]} total={1} />

      {page ? (
        <>
          <p className="mb-4 max-w-3xl text-sm text-[var(--color-text-muted)]">
            Todos los importadores en una sola lista. Revertir un archivo borra lo que trajo y recalcula los equipos afectados.
          </p>
          <ArchivosFilters kind={kind} status={status} counts={page.counts} visibleKinds={page.visibleKinds} total={page.total} />
          {page.rows.length === 0 ? (
            <EmptyState
              icon={<UploadSimple size={24} />}
              title={kind || status ? "Ningún archivo coincide con el filtro" : "Todavía no se ha importado ningún archivo"}
              description={kind || status
                ? "Quita el filtro de tipo o de estado para ver todos los archivos."
                : "Cuando subas una planilla, un reporte de tarjeta o la telemetría de los equipos, quedará acá con lo que trajo."}
              action={kind || status
                ? <Button asChild variant="secondary"><Link href={FUEL_PATHS.fuentesArchivos}>Quitar filtros</Link></Button>
                : <AddFuelDataButton options={fuelAddDataOptions(session)} />}
            />
          ) : (
            <>
              <ImportedFilesTable rows={page.rows} />
              <ServerPagination pagination={pagination} hrefForPage={(target) => buildPaginationHref(FUEL_PATHS.fuentesArchivos, sp, target, "pagina")} />
            </>
          )}
        </>
      ) : null}
    </PageContainer>
  )
}

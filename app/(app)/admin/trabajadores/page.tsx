import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { workerDriverLicenses, workers, worksites } from "@/db/schema"
import { and, eq } from "drizzle-orm"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { logger } from "@/lib/logger"
import { getTalanaWorkerSummaries } from "@/lib/integrations/talana/talana-read"
import { talanaWorkerChips } from "@/lib/integrations/talana/worker-hr-status"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { HeaderSignals, type HeaderSignal } from "@/components/ui/header-signals"
import { WorkerActions } from "./worker-actions"
import { WorkerList } from "./worker-list"
import { getSizeFamilyOptions } from "@/lib/services/sizes"
import {
  LICENSE_REQUIRING_CAPABILITY_CODES,
  listWorkerPositions,
  UNCLASSIFIED_POSITION_CODE,
} from "@/lib/services/worker-positions"
import type { AssignablePosition } from "./bulk-assign-dialog"

export const metadata: Metadata = { title: "Trabajadores" }

export default async function TrabajadoresPage() {
  let session
  try { session = await requirePermission("admin:workers") }
  catch { redirect("/forbidden") }

  const [allWorkers, allWorksites, sizeFamilies, positionCatalog, licensedRows] = await Promise.all([
    db.query.workers.findMany({
      with:    { worksite: true, positionCatalog: true },
      where:   worksiteScopeSql(session, workers.worksiteId),
      orderBy: (w, { asc }) => [asc(w.lastName), asc(w.firstName)],
    }),
    db.query.worksites.findMany({
      where: and(eq(worksites.isActive, true), worksiteScopeSql(session, worksites.id)),
      orderBy: (ws, { asc }) => [asc(ws.name)],
    }),
    // Las tallas del padrón salen de `size_catalog`, la misma fuente que usa el
    // asistente de variantes: sin eso el padrón y el catálogo se separaban.
    getSizeFamilyOptions(),
    // El selector de cargo y el badge "por revisar" salen del catálogo
    // canónico, no del texto libre que todavía guarda `workers.position`.
    listWorkerPositions(),
    // Sólo se sabe SI tiene licencia, no cuál ni hasta cuándo: alcanza para
    // anticipar, al clasificar, quién quedará «sin licencia registrada». El
    // detalle vive en Conductores, tras `flota:manage_licenses`.
    db.select({ workerId: workerDriverLicenses.workerId })
      .from(workerDriverLicenses)
      .innerJoin(workers, eq(workers.id, workerDriverLicenses.workerId))
      .where(worksiteScopeSql(session, workers.worksiteId)),
  ])
  const licensedWorkerIds = new Set(licensedRows.map((row) => row.workerId))

  // Contrato, término y licencias son datos laborales y de salud: sólo se
  // consultan —y sólo viajan al navegador— con `admin:workers_hr`. Sin el
  // permiso, la fila no lleva ni la clave `talana`.
  const talanaSummaries = can(session, "admin:workers_hr")
    ? await getTalanaWorkerSummaries(allWorkers.map((worker) => ({ id: worker.id, rut: worker.rut })))
      // Es un dato de apoyo: si falla la consulta, Trabajadores sigue funcionando.
      .catch((error: unknown) => { logger.error("[trabajadores:talana]", error); return null })
    : null

  const positions = positionCatalog.map((position) => ({
    id:          position.id,
    code:        position.code,
    name:        position.name,
    isActive:    position.isActive,
    needsReview: position.needsReview,
  }))

  // Lo que ofrece «Asignar cargo»: activos y reales. «Sin clasificar» es el
  // problema que se está resolviendo, no un destino.
  const assignablePositions: AssignablePosition[] = positionCatalog
    .filter((position) => position.isActive && !position.isSystem)
    .map((position) => ({
      id: position.id,
      name: position.name,
      needsReview: position.needsReview,
      aliases: position.aliases.map((alias) => alias.alias),
      capabilities: position.capabilities.map(({ id, name }) => ({ id, name })),
      drives: position.capabilities.some((capability) =>
        (LICENSE_REQUIRING_CAPABILITY_CODES as readonly string[]).includes(capability.code)),
      requiredLicenseClasses: position.requiredLicenseClasses,
    }))

  const activeCount = allWorkers.filter((w) => w.isActive).length
  const inactiveCount = allWorkers.length - activeCount
  const faenaCount = new Set(allWorkers.map((w) => w.worksiteId)).size
  // Solo "Inactivos" es accionable (revisar/borrar). Activos/faenas son
  // info: van en la descripción del título, no como chips en el TopBar.
  const headerSignals: HeaderSignal[] = [
    { key: "inactive", label: "Inactivos", value: inactiveCount, tone: "signal" },
  ]
  const description = allWorkers.length > 0
    ? `${allWorkers.length} trabajadores · ${activeCount} activos · ${faenaCount} faenas`
    : "Registro de trabajadores por faena para entrega de EPP y trazabilidad."

  return (
    <PageContainer>
      <PageHeader
        title="Trabajadores"
        description={description}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Administración", href: "/admin" },
            { label: "Trabajadores" },
          ]} />
        }
        headerActions={<HeaderSignals signals={headerSignals} />}
        actions={<WorkerActions worksites={allWorksites.map((ws) => ({ id: ws.id, name: ws.name }))} sizeFamilies={sizeFamilies} positions={positions} />}
      />
      <WorkerList
        workers={allWorkers.map((w) => ({
          id:           w.id,
          rut:          w.rut,
          firstName:    w.firstName,
          lastName:     w.lastName,
          sex:          w.sex,
          position:     w.positionCatalog?.name ?? w.position,
          positionId:   w.positionId,
          positionNeedsReview: w.positionCatalog?.needsReview ?? false,
          unclassified: w.positionId === null || w.positionCatalog?.code === UNCLASSIFIED_POSITION_CODE,
          hasDriverLicense: licensedWorkerIds.has(w.id),
          worksiteId:   w.worksiteId,
          worksiteName: w.worksite?.name ?? "—",
          isActive:     w.isActive,
          createdAt:    w.createdAt,
          sizeTop:      w.sizeTop,
          sizeBottom:   w.sizeBottom,
          sizeShoe:     w.sizeShoe,
          sizeGloves:   w.sizeGloves,
          sizeHelmet:   w.sizeHelmet,
          ...(talanaSummaries?.[w.id]
            ? { talana: { summary: talanaSummaries[w.id]!, chips: talanaWorkerChips(talanaSummaries[w.id]) } }
            : {}),
        }))}
        worksites={allWorksites.map((ws) => ({ id: ws.id, name: ws.name }))}
        sizeFamilies={sizeFamilies}
        positions={positions}
        assignablePositions={assignablePositions}
      />
    </PageContainer>
  )
}

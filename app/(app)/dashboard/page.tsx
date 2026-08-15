import { Suspense } from "react"
import type { Metadata } from "next"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { chileDateParts } from "@/lib/utils"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { OPERATIONAL_MODULE_LABELS, type WorkTaskType } from "@/lib/work-queue"
import { getOperationalWorkQueue, type OperationalModule } from "@/lib/services/operational-work-queue"
import { QuickActions } from "./quick-actions"
import { listVisibleWorksites } from "@/lib/services/prevention-indicadores"
import { scopeToWorksiteIds } from "./dashboard-helpers"
import {
  intersectWorksiteScope,
  parseDashboardScope,
  scopedWorksiteId,
  type DashboardScopeSearchParams,
} from "./dashboard-scope"
import { availableDashboardViews } from "./dashboard-views"
import { DashboardScopeControls } from "./dashboard-scope-controls"
import { DashboardViewTabs } from "./dashboard-view-tabs"
import { DashboardDomainSection } from "./dashboard-domain-sections"
import { DomainSectionFallback } from "./dashboard-domain-shell"
import { ResumenView, buildQueueShortcuts } from "./views/resumen-view"
import { TrabajoView, type DashboardTask } from "./views/trabajo-view"

// "Inicio", igual que el ítem del nav: la página se llamaba "Dashboard" al lado
// de un sidebar que decía "Inicio" (I-13; ya detectado en
// AUDITORIA_LENGUAJE_TECNICO §2.2 y migrado a medias).
export const metadata: Metadata = { title: "Inicio" }

/**
 * Tope de filas que baja a la vista "Mi trabajo"; el resto vive en /pendientes.
 *
 * 12 y no 50: con 50 la cola ocupaba tres pantallas de alto. Es un top-N para
 * decidir qué hacer ahora, no un sustituto de la cola completa — el pie y el
 * atajo "Todas" declaran el total.
 */
const QUEUE_PREVIEW_LIMIT = 12

const MODULE_TO_TASK_TYPE: Record<OperationalModule, WorkTaskType> = {
  solicitudes: "request_followup",
  aprobaciones: "approval",
  compras: "purchase",
  recepciones: "receipt",
  entregas: "warehouse_delivery",
  pdtp: "pdtp",
  capa: "capa",
  inspecciones: "inspection",
  documentacion: "documentation",
  ppa: "ppa",
  sst: "sst",
  cphs: "cphs",
}

function toDashboardTask(item: Awaited<ReturnType<typeof getOperationalWorkQueue>>["items"][number]): DashboardTask {
  return {
    id: item.id,
    type: MODULE_TO_TASK_TYPE[item.module],
    title: item.title,
    // El código sólo si el título no lo trae ya ("Aprobar Cinta…" → SOL-…;
    // "Recibir OC-2026-0001" ya lo contiene). La faena no va: el servicio dejó
    // de duplicarla en `subtitle` y la fila la pinta desde `worksiteName` (I-07).
    subtitle: [
      item.code && !item.title.includes(item.code) ? item.code : null,
      item.subtitle || null,
      item.assignee?.name ?? null,
    ].filter(Boolean).join(" · "),
    worksiteId: item.worksiteId,
    worksiteName: item.worksiteName,
    statusLabel: item.blocked ? `Bloqueada · ${item.statusLabel}` : item.statusLabel,
    priority: item.priority,
    createdAt: item.createdAt,
    href: item.href,
    ctaLabel: item.ctaLabel,
    operationalItem: item,
  }
}

/**
 * Inicio: cabecera con el alcance global, selector de vista, y **una** vista.
 *
 * Antes montaba el Centro de Control completo más las seis secciones de dominio
 * en la misma página: ~8.600 px de scroll en 1920, ~12.700 en móvil, y las seis
 * secciones consultando en paralelo cada carga. Ahora la página resuelve alcance
 * y vista, y delega.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<DashboardScopeSearchParams> }) {
  const session = await auth()
  if (!session) return null

  const roleScope = resolveWorksiteScope(session)
  // Hora de Chile: el proceso corre en UTC y el 31 de diciembre por la tarde
  // este año saltaba al siguiente, consultando PDTP/SST del año equivocado.
  const currentYear = chileDateParts().year

  // Los tres permisos que necesitan los atajos de la cola. El resto se resuelve
  // dentro de cada vista, que es la que sabe qué consulta.
  const canApprove = can(session, "approvals:approve")
  const canReceive = can(session, "receiving:view")
  const canDeliver = can(session, "deliveries:create")

  /*
   * El alcance global (faena + período + vista) se resuelve **antes** de
   * cualquier consulta porque todas lo reciben.
   *
   * `listVisibleWorksites` y no `queue.filterOptions.worksites`: esas son sólo
   * las faenas *con trabajo pendiente*, así que una faena sin tareas no era
   * seleccionable — y justamente para esa querría gerencia ver inversión o
   * cumplimiento. Es una consulta indexada sobre `worksites`.
   */
  const authorizedWorksites = await listVisibleWorksites(roleScope)
  const views = availableDashboardViews(session.user.permissions)
  const scope = parseDashboardScope(await searchParams, authorizedWorksites, views)

  const worksiteScope = intersectWorksiteScope(roleScope, scope)
  const pdtpScope = scopeToWorksiteIds(worksiteScope)
  // Ids explícitos del alcance: varios consumidores (tarjeta PDTP, secciones
  // por dominio) exigen `string[]`, nunca el centinela "all".
  const scopedWorksite = scopedWorksiteId(scope)
  const scopeWorksiteIds = scopedWorksite ? [scopedWorksite] : authorizedWorksites.map((worksite) => worksite.id)

  /*
   * La cola se consulta **siempre**, pero con una sola fila salvo en su vista.
   *
   * `summary` y `total` se calculan sobre la población completa del alcance, no
   * sobre la página (`getOperationalWorkQueuePage`: `summary` sale del CTE
   * `filtered`, los ítems de `paginated`), así que el saludo y la insignia de la
   * pestaña son exactos con `limit: 1`. Y el mínimo es 1: el servicio hace
   * `Math.max(1, …)`, un 0 no ahorraría nada.
   */
  const queue = await getOperationalWorkQueue(session, {
    limit: scope.view === "trabajo" ? QUEUE_PREVIEW_LIMIT : 1,
    worksiteId: scope.worksiteId,
  })

  // Se serializa una vez desde el Server Component; el cliente no recalcula la
  // hora durante la hidratación.
  const refreshedAt = new Date().toISOString()

  /*
   * El alcance elegido se declara **en el propio selector**, no en una línea
   * aparte: ésta decía "Todas las faenas activas" justo al lado de un select que
   * ya decía "Todas las faenas", o repetía el nombre de la faena elegida. Sólo
   * informaba de algo cuando "todas" no son todas, y eso cabe en la etiqueta de
   * esa opción.
   */
  const allWorksitesLabel = roleScope.mode === "all" ? "Todas las faenas" : "Todas mis faenas autorizadas"

  // Población completa del alcance, no las filas cargadas (D-02). La consume el
  // gráfico de distribución por módulo de Adquisiciones.
  const moduleWorkload = Object.entries(queue.summary.moduleCounts)
    .map(([module, count]) => ({ module: OPERATIONAL_MODULE_LABELS[module as OperationalModule] ?? module, count: count ?? 0 }))
    .filter((entry) => entry.count > 0)

  return (
    <PageContainer>
      {/* El saludo **es** el título de la página: lo emite el shell, que ya tiene
          la ranura (y el `h1`). Antes convivían dos identidades — un "Inicio" en
          la TopBar y un "Hola, …" en `text-3xl` debajo, más grande que el `h1`
          real— y la segunda costaba una banda entera antes del primer dato.
          Ninguna cifra en el saludo: el total de la cola ya está en la insignia
          de "Mi trabajo", que además navega hasta ella (§A5). */}
      <PageHeader
        title={`Hola, ${session.user.name?.split(" ")[0] ?? "usuario"}`}
        actions={<QuickActions session={session} />}
      />
      <div className="animate-in fade-in duration-(--duration-default)">
        {/* Modos y filtros comparten fila: son las dos preguntas del encuadre
            ("qué miro" / "de qué"). En bandas separadas eran dos líneas. */}
        <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-border">
          <DashboardViewTabs views={views} scope={scope} workCount={queue.total} />
          <div className="pb-2">
            <DashboardScopeControls
              scope={scope}
              worksites={authorizedWorksites}
              allWorksitesLabel={allWorksitesLabel}
            />
          </div>
        </div>

        {/* El `key` con el alcance completo es necesario: sin él, cambiar de
            faena reusaba el árbol suspendido y la vista mostraba los datos de la
            faena anterior mientras las consultas nuevas resolvían. */}
        <Suspense key={`${scope.view}:${scope.worksiteId}:${scope.period}`} fallback={<DomainSectionFallback />}>
          {scope.view === "trabajo" ? (
            <TrabajoView
              tasks={queue.items.map(toDashboardTask)}
              queueSummary={{
                total: queue.total,
                critical: queue.summary.critical,
                overdue: queue.summary.overdue,
                deliveries: queue.summary.moduleCounts.entregas ?? 0,
              }}
              queueShortcuts={buildQueueShortcuts({ queue, scope, canApprove, canReceive, canDeliver })}
              scope={scope}
              canAssign={session.user.permissions.includes("operations:assign_work")}
              refreshedAt={refreshedAt}
            />
          ) : scope.view === "resumen" ? (
            <ResumenView
              session={session}
              scope={scope}
              worksiteScope={worksiteScope}
              pdtpScope={pdtpScope}
              worksiteIds={scopeWorksiteIds}
              currentYear={currentYear}
              queueTotal={queue.total}
              queueSummary={queue.summary}
            />
          ) : (
            <DashboardDomainSection
              domain={scope.view}
              session={session}
              scope={scope}
              worksiteScope={worksiteScope}
              pdtpScope={pdtpScope}
              worksiteIds={scopeWorksiteIds}
              currentYear={currentYear}
              moduleWorkload={moduleWorkload}
              queueTotal={queue.total}
            />
          )}
        </Suspense>
      </div>
    </PageContainer>
  )
}

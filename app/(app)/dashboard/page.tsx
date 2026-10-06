import { Suspense } from "react"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { chileDateParts, formatDateLong, todayInChile } from "@/lib/utils"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { OPERATIONAL_MODULE_LABELS } from "@/lib/work-queue"
import { getOperationalWorkQueue, type OperationalModule } from "@/lib/services/operational-work-queue"
import { QuickActions } from "./quick-actions"
import { listVisibleWorksites } from "@/lib/services/prevention-indicadores"
import { scopeToWorksiteIds } from "./dashboard-helpers"
import {
  ALL_WORKSITES,
  intersectWorksiteScope,
  parseDashboardScope,
  scopedWorksiteId,
  type DashboardScopeSearchParams,
} from "./dashboard-scope"
import { availableDashboardViews, LEGACY_WORK_VIEW, viewRespondsToPeriod } from "./dashboard-views"
import { pickTodayItems, TODAY_ITEM_LIMIT } from "./dashboard-today"
import { DashboardScopeControls } from "./dashboard-scope-controls"
import { DashboardViewTabs } from "./dashboard-view-tabs"
import { DashboardDomainSection } from "./dashboard-domain-sections"
import { DomainSectionFallback } from "./dashboard-domain-shell"
import { ResumenView } from "./views/resumen-view"

// "Inicio", igual que el ítem del nav: la página se llamaba "Dashboard" al lado
// de un sidebar que decía "Inicio" (I-13; ya detectado en
// AUDITORIA_LENGUAJE_TECNICO §2.2 y migrado a medias).
export const metadata: Metadata = { title: "Inicio" }

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
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

  const params = await searchParams

  /*
   * "Mi trabajo" ya no es una vista: duplicaba `/pendientes` y se comportaba
   * distinto (INI-07). Los enlaces guardados a `?vista=trabajo` caen en la cola
   * de verdad, con la faena si venía una. El alcance (`faena`) de Inicio se
   * llama `worksiteId` allá; `/pendientes` lo valida contra el rol, así que un
   * id ajeno no amplía nada.
   */
  if (firstParam(params.vista) === LEGACY_WORK_VIEW) {
    const faena = firstParam(params.faena)
    redirect(faena && faena !== ALL_WORKSITES ? `/pendientes?worksiteId=${encodeURIComponent(faena)}` : "/pendientes")
  }

  // El resto de los permisos se resuelve dentro de cada vista, que es la que
  // sabe qué consulta.
  const canViewWork = can(session, "operations:view_work")

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
  const scope = parseDashboardScope(params, authorizedWorksites, views)

  const worksiteScope = intersectWorksiteScope(roleScope, scope)
  const pdtpScope = scopeToWorksiteIds(worksiteScope)
  // Ids explícitos del alcance: varios consumidores (tarjeta PDTP, secciones
  // por dominio) exigen `string[]`, nunca el centinela "all".
  const scopedWorksite = scopedWorksiteId(scope)
  const scopeWorksiteIds = scopedWorksite ? [scopedWorksite] : authorizedWorksites.map((worksite) => worksite.id)

  /*
   * La cola se consulta **siempre** —sus conteos alimentan las alertas de "Hoy"
   * y el número de "Ver todos mis pendientes"—, pero con filas sólo en el
   * Resumen.
   *
   * `summary` y `total` se calculan sobre la población completa del alcance, no
   * sobre la página (`getOperationalWorkQueuePage`: `summary` sale del CTE
   * `filtered`, los ítems de `paginated`), así que son exactos con `limit: 1`. Y
   * el mínimo es 1: el servicio hace `Math.max(1, …)`, un 0 no ahorraría nada.
   *
   * Para "Hoy" se piden **dos** páginas de cinco: una por vencimiento y otra por
   * prioridad. Ninguna sola da "vencidas primero, luego críticas": por
   * vencimiento una crítica sin fecha queda al final, y por prioridad una
   * vencida normal queda detrás de todas las críticas. `pickTodayItems` las
   * une, deduplica y reordena.
   */
  const wantsToday = scope.view === "resumen" && canViewWork
  const queueFilters = { worksiteId: scope.worksiteId, limit: wantsToday ? TODAY_ITEM_LIMIT : 1 } as const
  const [queue, priorityQueue] = await Promise.all([
    getOperationalWorkQueue(session, { ...queueFilters, sort: "due" }),
    wantsToday ? getOperationalWorkQueue(session, { ...queueFilters, sort: "priority" }) : Promise.resolve(null),
  ])
  const todayItems = wantsToday ? pickTodayItems([...queue.items, ...(priorityQueue?.items ?? [])], todayInChile()) : []

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
          Ninguna cifra en el saludo: el total de la cola vive en el enlace
          "Ver todos mis pendientes (N)" del bloque "Hoy" (§A5). El `description`
          lleva la fecha en lenguaje natural —es la única superficie de la app
          donde el "hoy" se nombra, y se nombra una vez, no en cada KPI. */}
      <PageHeader
        title={`Hola, ${session.user.name?.split(" ")[0] ?? "usuario"}`}
        // INI-02 (auditoría 2026-10-05): sin argumento `formatDateLong` devuelve "—".
        // Se le pasa el instante, no `todayInChile()`: el formateador ya fija
        // America/Santiago, y un "YYYY-MM-DD" se parsearía como medianoche UTC,
        // que en Chile es el día anterior.
        description={formatDateLong(new Date())}
        actions={<QuickActions session={session} scope={scope} summary={queue.summary} />}
      />
      <div className="animate-in fade-in duration-(--duration-default)">
        {/* Modos y filtros comparten fila: son las dos preguntas del encuadre
            ("qué miro" / "de qué"). En bandas separadas eran dos líneas. */}
        <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-border">
          <DashboardViewTabs views={views} scope={scope} />
          <div className="pb-2">
            <DashboardScopeControls
              scope={scope}
              worksites={authorizedWorksites}
              allWorksitesLabel={allWorksitesLabel}
              periodResponsive={viewRespondsToPeriod(scope.view, session.user.permissions)}
            />
          </div>
        </div>

        {/* El `key` con el alcance completo es necesario: sin él, cambiar de
            faena reusaba el árbol suspendido y la vista mostraba los datos de la
            faena anterior mientras las consultas nuevas resolvían. */}
        <Suspense key={`${scope.view}:${scope.worksiteId}:${scope.period}`} fallback={<DomainSectionFallback />}>
          {scope.view === "resumen" ? (
            <ResumenView
              session={session}
              scope={scope}
              worksiteScope={worksiteScope}
              worksiteIds={scopeWorksiteIds}
              currentYear={currentYear}
              queueTotal={queue.total}
              queueSummary={queue.summary}
              todayItems={todayItems}
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

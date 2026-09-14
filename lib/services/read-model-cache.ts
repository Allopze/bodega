import { unstable_cache } from "next/cache"
import type { Session } from "next-auth"
import { isGlobalRole } from "@/lib/auth/scope"
// Los nombres de etiqueta viven junto a quien invalida (`operational-cache`),
// para que caché e invalidación no puedan derivar.
import { ANALYTICS_DASHBOARD_TAG, OPERATIONAL_INTEGRITY_TAG } from "./operational-cache"
import { getAnalyticsDashboard } from "./analytics-module/dashboard"
import { normalizeAnalyticsFilters } from "./analytics-module/helpers"
import type { AnalyticsDashboardData, AnalyticsFilters } from "./analytics-module/types"
import { listOperationalIntegrityCases, type OperationalIntegrityCaseDto, type OperationalIntegrityFilters } from "./operational-integrity/ledger"

/**
 * ANA-002 y PER-T02 (auditoría 2026-09-14): los dos tableros más pesados
 * —Analítica, con veintiún agregados en un solo `Promise.all` por carga y por
 * cambio de filtro, y la cola de integridad operacional— se recalculaban
 * enteros en cada visita. La única caché declarada de la aplicación era la de
 * los badges del layout; ninguno de estos dos read models tenía la suya.
 *
 * Aquí viven sus envoltorios de caché, y no dentro de cada servicio, por dos
 * razones: el servicio sigue siendo invocable sin caché (exportaciones, cron y
 * pruebas piden evidencia fresca) y `next/cache` no entra en módulos que las
 * pruebas de dominio importan fuera de un request de Next.
 */

/**
 * Cuánto puede envejecer un tablero pesado.
 *
 * No lo inventamos: la plataforma **ya declara** 30 s como envejecimiento
 * aceptable para un read model de lectura frecuente —la caché de los badges del
 * layout, documentada como P-01 (`app/(app)/layout.tsx`)—. Es también el valor
 * más conservador que resuelve el hallazgo: absorbe la ráfaga de recargas y
 * cambios de filtro de una misma sesión sin que ningún dato quede visiblemente
 * atrasado. Subirlo exigiría una decisión de plataforma que nadie ha tomado.
 */
export const HEAVY_READ_MODEL_TTL_SECONDS = 30


/**
 * Lo único que determina la salida de estos read models: alcance de faenas y
 * permisos. Va entero en la clave de caché —permisos ordenados incluidos— para
 * que dos sesiones distintas jamás compartan una entrada si difieren en algo
 * que el servicio consulta. El id de usuario **no** entra: dos personas con el
 * mismo alcance ven exactamente el mismo tablero, y compartir esa entrada es
 * justamente lo que hace útil la caché.
 */
export interface ReadModelScopeKey {
  isGlobal: boolean
  isActive: boolean
  worksiteIds: string[]
  permissions: string[]
}

export function readModelScopeKey(session: Session): ReadModelScopeKey {
  return {
    isGlobal: isGlobalRole(session),
    isActive: session.user?.isActive === true,
    worksiteIds: [...(session.user?.worksiteIds ?? [])].sort(),
    permissions: [...(session.user?.permissions ?? [])].sort(),
  }
}

/**
 * Sesión mínima reconstruida dentro de la caché, con el mismo patrón que
 * `getCachedOperationalWorkCount` en el layout: la clave viaja como datos
 * serializables y el servicio recibe sólo el alcance, nunca la sesión real.
 */
function sessionFromScopeKey(key: ReadModelScopeKey): Session {
  return {
    expires: "",
    user: {
      id: "read-model-cache",
      email: "",
      roles: [],
      isGlobal: key.isGlobal,
      isActive: key.isActive,
      worksiteIds: key.worksiteIds,
      permissions: key.permissions,
    },
  } as unknown as Session
}

const cachedAnalyticsDashboard = unstable_cache(
  async (key: ReadModelScopeKey, filters: AnalyticsFilters) =>
    getAnalyticsDashboard(sessionFromScopeKey(key), filters),
  ["analytics-dashboard"],
  { revalidate: HEAVY_READ_MODEL_TTL_SECONDS, tags: [ANALYTICS_DASHBOARD_TAG] },
)

/**
 * ANA-002/PER-T02: entrada cacheada del tablero de Analítica. Los filtros se
 * normalizan **antes** de la clave para que "sin fechas" y el rango por defecto
 * sean la misma entrada en vez de dos.
 *
 * No se invalida desde `revalidateOperationalViews`: colgar esta etiqueta de las
 * 52 mutaciones operacionales reproduciría PER-T01 en el tablero más caro. El
 * envejecimiento máximo lo fija el TTL y está declarado arriba.
 */
export function getCachedAnalyticsDashboard(
  session: Session,
  rawFilters: AnalyticsFilters = {},
): Promise<AnalyticsDashboardData> {
  return cachedAnalyticsDashboard(readModelScopeKey(session), normalizeAnalyticsFilters(rawFilters))
}

const cachedIntegrityCases = unstable_cache(
  async (key: ReadModelScopeKey, filters: OperationalIntegrityFilters) =>
    listOperationalIntegrityCases(sessionFromScopeKey(key), filters),
  ["operational-integrity-cases"],
  { revalidate: HEAVY_READ_MODEL_TTL_SECONDS, tags: [OPERATIONAL_INTEGRITY_TAG] },
)

/**
 * PER-T02: entrada cacheada de la cola de integridad. Al contrario de la
 * analítica, ésta **sí** se invalida en el acto: escanear, reconocer y verificar
 * ocurren en la misma pantalla y el usuario debe ver el efecto de su propia
 * acción. Se invalida sólo su etiqueta —no el tablero ni la cola de pendientes
 * de todo el mundo—, que es la diferencia con lo que corregimos en PER-T01.
 */
export function getCachedOperationalIntegrityCases(
  session: Session,
  filters: OperationalIntegrityFilters = {},
): Promise<OperationalIntegrityCaseDto[]> {
  return cachedIntegrityCases(readModelScopeKey(session), filters)
}

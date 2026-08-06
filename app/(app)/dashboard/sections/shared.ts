import type { Session } from "next-auth"
import type { WorksiteScope } from "@/lib/auth/scope"
import { getOperationalCalendarBounds } from "@/lib/services/operational-period-metrics"
import { scopedWorksiteId, type DashboardScope } from "../dashboard-scope"
import type { ModuleWorkloadPoint } from "../dashboard-charts"

/**
 * Lo que comparten las siete secciones de dominio: su contrato de props y los
 * cuatro helpers de fecha y alcance.
 *
 * Vive acá y no en `dashboard-domain-sections.tsx` para romper el ciclo: el
 * orquestador importa cada sección, así que una sección no podía importar el
 * tipo de vuelta desde él sin cerrarlo. Era un ciclo sólo de tipos —inofensivo
 * en runtime— pero real, y con un archivo por dominio se habría multiplicado
 * por siete.
 */

const CHILE_TODAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Santiago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

export interface DomainSectionsProps {
  session: Session
  scope: DashboardScope
  worksiteScope: WorksiteScope
  pdtpScope: string[] | "all"
  /** Faenas del alcance ya resueltas a ids: varias funciones exigen `string[]`. */
  worksiteIds: string[]
  currentYear: number
  moduleWorkload: ModuleWorkloadPoint[]
  queueTotal: number
}

/** Filtros de `getAnalyticsDashboard` derivados del alcance global. */
export function analyticsFilters(scope: DashboardScope) {
  const bounds = getOperationalCalendarBounds(new Date(), scope.period)
  return {
    fromDate: bounds.currentStart.slice(0, 10),
    toDate: bounds.currentEnd.slice(0, 10),
    ...(scopedWorksiteId(scope) ? { worksiteId: scopedWorksiteId(scope)! } : {}),
  }
}

/** Hoy en calendario chileno: el proceso corre en UTC. */
export function todayInChile() {
  return CHILE_TODAY_FORMATTER.format(new Date())
}

/** Porcentaje entero, con 0 cuando no hay denominador (evita NaN en el gráfico). */
export function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

export function plusDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

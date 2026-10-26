import { ClipboardText, ShieldWarning, Siren, WarningOctagon } from "@phosphor-icons/react/dist/ssr"
import { ChartSlot } from "@/components/ui/dashboard-panel"
import { KpiCard } from "@/components/ui/kpi-card"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { getFieldControlSummary } from "@/lib/services/dashboard-domains-data"
import { getOperationalCalendarBounds } from "@/lib/services/operational-period-metrics"
import { DASHBOARD_DOMAINS } from "../dashboard-domains"
import { DASHBOARD_KPI, DomainSection } from "../dashboard-domain-shell"
import { periodScopeLabel, scopedWorksiteId } from "../dashboard-scope"
import { CHART_COLORS } from "@/lib/chart-palette"
import { StatusShareBar } from "../dashboard-domain-charts"

import type { DomainSectionsProps } from "./shared"

// ── Control preventivo en terreno ────────────────────────────────────────────

/**
 * Los cinco dominios que no tenían representación: inspecciones, permisos de
 * trabajo, simulacros, acuerdos del comité e higiene.
 *
 * Van en **una** sección y no en cinco: comparten la pregunta "¿el control
 * preventivo se está ejecutando en terreno?", y cinco secciones más habrían
 * devuelto la pantalla al muro que esta auditoría desarmó.
 *
 * Casi todas sus cifras son estado actual y por eso no heredan el período. La
 * excepción es el cumplimiento promedio de inspecciones: es un agregado de
 * ejecuciones, no un estado, y promediarlo sobre toda la historia lo volvía
 * cada vez más insensible (C-06, auditoría 2026-08-18). Ese —y sólo ese— se
 * acota al período del alcance, con el mismo helper que usa Adquisiciones.
 */
export async function FieldControlSection({ session, scope }: DomainSectionsProps) {
  const bounds = getOperationalCalendarBounds(new Date(), scope.period)
  const field = await getFieldControlSummary(session, scopedWorksiteId(scope), {
    from: bounds.currentStart,
    to: bounds.currentEnd,
  })

  const periodo = periodScopeLabel(scope.period).toLocaleLowerCase("es-CL")
  const permitTotal = field.visible.permits ? field.permitsActive + field.permitsSuspended : 0
  const drillTotal = field.visible.drills ? field.drillsCompleted : 0

  return (
    <DomainSection
      domain={DASHBOARD_DOMAINS.terreno}
      // Los atajos siguen la misma regla: no se ofrece la puerta de un módulo
      // que la sesión no puede abrir (DASH-001).
      links={[
        field.visible.inspections ? { label: "Inspecciones", href: "/prevencion/inspecciones" } : null,
        field.visible.permits ? { label: "Permisos", href: "/prevencion/permisos" } : null,
        field.visible.committee ? { label: "CPHS", href: "/prevencion/cphs" } : null,
      ].filter((link): link is { label: string; href: string } => link !== null)}
      kpis={
        <>
          {field.visible.inspections && (
          <KpiCard {...DASHBOARD_KPI} icon={<ClipboardText size={16} />} label="Cumplimiento de inspecciones"
            value={field.inspectionCompliance === null ? "—" : `${field.inspectionCompliance}%`}
            // INI-05: es la única cifra de la vista que sigue al período, y decía "ahora".
            detail={field.inspectionsReviewed > 0 ? `${field.inspectionsReviewed} revisadas · ${periodo}` : "Sin inspecciones con resultado"}
            // Sin inspecciones con resultado no hay promedio que mostrar: un "—"
            // pelado no dice por qué ni qué hacer (A1).
            empty={field.inspectionCompliance === null ? { message: `Sin inspecciones con resultado en ${periodo}`, actionLabel: "Ir a inspecciones" } : undefined}
            href="/prevencion/inspecciones" />
          )}
          {field.visible.inspections && (
          <KpiCard {...DASHBOARD_KPI} icon={<WarningOctagon size={16} />} label="Hallazgos críticos abiertos"
            value={String(field.criticalFindingsOpen)}
            detail={field.criticalFindingsOpen > 0 ? "Criticidad alta o crítica · ahora" : "Ninguno abierto, ahora"}
            tone={field.criticalFindingsOpen > 0 ? "danger" : "neutral"} href="/prevencion/inspecciones?vista=critical" />
          )}
          {field.visible.drills && (
          <KpiCard {...DASHBOARD_KPI} icon={<Siren size={16} />} label="Simulacros por mejorar"
            value={String(field.drillsNeedingImprovement)}
            detail={drillTotal > 0 ? `De ${drillTotal} ejecutado(s) · ahora` : "Sin simulacros ejecutados"}
            tone={field.drillsNeedingImprovement > 0 ? "signal" : "neutral"} href="/prevencion/emergencias?tab=drills&vista=needs_improvement" />
          )}
          {field.visible.hygiene && (
          <KpiCard {...DASHBOARD_KPI} icon={<ShieldWarning size={16} />} label="Mediciones sobre el límite"
            value={String(field.measurementsAboveLimit)}
            detail={field.measurementsAboveLimit > 0 ? "Exposición sobre el límite permisible · ahora" : "Ninguna sobre el límite"}
            tone={field.measurementsAboveLimit > 0 ? "danger" : "neutral"} href="/prevencion/higiene?tab=groups&vista=above_limit" />
          )}
        </>
      }
      summary={<SummaryBar numerals="sans" stats={fieldControlSummaryStats(field)} />}
      charts={
        /*
         * Las dos barras de reparto comparten fila cuando están las dos (1 + 1 en
         * xl, 1 + 2 en 2xl); si hay una sola, toma la fila completa en vez de
         * dejar el resto del panel en blanco.
         */
        permitTotal > 0 || drillTotal > 0 ? (
          <>
            {permitTotal > 0 && (
              <ChartSlot span={drillTotal > 0 ? "one" : "full"}>
                <StatusShareBar
                  title="Permisos de trabajo por estado" description="Reparto entre activos y suspendidos, ahora"
                  data={[
                    { key: "active", label: "Activos", value: field.permitsActive, color: CHART_COLORS.brand },
                    { key: "suspended", label: "Suspendidos", value: field.permitsSuspended, color: CHART_COLORS.signal },
                  ]}
                />
              </ChartSlot>
            )}
            {drillTotal > 0 && (
              <ChartSlot span={permitTotal > 0 ? "one" : "full"} className={permitTotal > 0 ? "2xl:col-span-2" : undefined}>
                <StatusShareBar
                  title="Resultado de los simulacros" description="Ejecutados, por resultado registrado"
                  data={[
                    { key: "ok", label: "Satisfactorios", value: Math.max(0, drillTotal - field.drillsNeedingImprovement), color: CHART_COLORS.brand },
                    { key: "mejora", label: "Por mejorar", value: field.drillsNeedingImprovement, color: CHART_COLORS.signal },
                  ]}
                />
              </ChartSlot>
            )}
          </>
        ) : null
      }
    />
  )
}

/**
 * DASH-001: cada cifra sale sólo si la sesión tiene el permiso de su módulo.
 * Un cero de "no tengo permiso" y un cero de "no hay nada" se leen igual en
 * pantalla y significan lo contrario, así que la cifra se omite en vez de
 * mostrarse vacía.
 */
function fieldControlSummaryStats(field: Awaited<ReturnType<typeof getFieldControlSummary>>): SummaryStat[] {
  const stats: (SummaryStat | null)[] = [
    !field.visible.permits ? null : {
      key: "permits-active",
      // "Permisos" a secas es ambiguo en una sección que también habla de
      // inspecciones, simulacros y mediciones: el dominio es permiso de trabajo.
      label: "Permisos de trabajo activos",
      value: field.permitsActive,
      secondary: field.permitsSuspended > 0 ? `${field.permitsSuspended} suspendido(s) · ahora` : "Ninguno suspendido, ahora",
      href: "/prevencion/permisos",
    },
    !field.visible.committee ? null : {
      key: "committee-agreements",
      label: "Acuerdos del comité abiertos",
      value: field.committeeAgreementsOpen,
      secondary: "Con acción correctiva (CAPA) sin cerrar · ahora",
      href: "/prevencion/cphs",
      tone: "signal",
    },
  ]
  return stats.filter((stat): stat is SummaryStat => stat !== null)
}

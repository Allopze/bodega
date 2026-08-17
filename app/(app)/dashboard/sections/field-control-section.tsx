import { ClipboardText, ShieldWarning, Siren, WarningOctagon } from "@phosphor-icons/react/dist/ssr"
import { KpiCard } from "@/components/ui/kpi-card"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { getFieldControlSummary } from "@/lib/services/dashboard-domains-data"
import { DASHBOARD_DOMAINS } from "../dashboard-domains"
import { DomainSection } from "../dashboard-domain-shell"
import { scopedWorksiteId } from "../dashboard-scope"
import { CHART_COLORS } from "@/lib/chart-palette"
import { StatusShareBar } from "../dashboard-domain-charts"

import type { DomainSectionsProps } from "./shared"

// ── Control preventivo en terreno ────────────────────────────────────────────

/**
 * Los seis dominios que no tenían representación: inspecciones, permisos de
 * trabajo, simulacros, acuerdos del comité, higiene y gestión del cambio.
 *
 * Van en **una** sección y no en seis: comparten la pregunta "¿el control
 * preventivo se está ejecutando en terreno?", y seis secciones más habrían
 * devuelto la pantalla al muro que esta auditoría desarmó. Todas sus cifras son
 * estado actual, así que ninguna hereda el período del alcance.
 */
export async function FieldControlSection({ session, scope }: DomainSectionsProps) {
  const field = await getFieldControlSummary(session, scopedWorksiteId(scope))

  const permitTotal = field.permitsActive + field.permitsSuspended
  const drillTotal = field.drillsCompleted

  return (
    <DomainSection
      domain={DASHBOARD_DOMAINS.terreno}
      links={[
        { label: "Inspecciones", href: "/prevencion/inspecciones" },
        { label: "Permisos", href: "/prevencion/permisos" },
        { label: "CPHS", href: "/prevencion/cphs" },
      ]}
      kpis={
        <>
          <KpiCard icon={<ClipboardText size={16} />} label="Cumplimiento de inspecciones"
            value={field.inspectionCompliance === null ? "—" : `${field.inspectionCompliance}%`}
            detail={field.inspectionsReviewed > 0 ? `${field.inspectionsReviewed} revisadas · ahora` : "Sin inspecciones con resultado"}
            href="/prevencion/inspecciones" />
          <KpiCard icon={<WarningOctagon size={16} />} label="Hallazgos críticos abiertos"
            value={String(field.criticalFindingsOpen)}
            detail={field.criticalFindingsOpen > 0 ? "Criticidad alta o crítica · ahora" : "Ninguno abierto, ahora"}
            tone={field.criticalFindingsOpen > 0 ? "danger" : "neutral"} href="/prevencion/inspecciones?vista=critical" />
          <KpiCard icon={<Siren size={16} />} label="Simulacros por mejorar"
            value={String(field.drillsNeedingImprovement)}
            detail={drillTotal > 0 ? `De ${drillTotal} ejecutado(s) · ahora` : "Sin simulacros ejecutados"}
            tone={field.drillsNeedingImprovement > 0 ? "signal" : "neutral"} href="/prevencion/emergencias?tab=drills&vista=needs_improvement" />
          <KpiCard icon={<ShieldWarning size={16} />} label="Mediciones sobre el límite"
            value={String(field.measurementsAboveLimit)}
            detail={field.measurementsAboveLimit > 0 ? "Exposición sobre el límite permisible · ahora" : "Ninguna sobre el límite"}
            tone={field.measurementsAboveLimit > 0 ? "danger" : "neutral"} href="/prevencion/higiene?tab=groups&vista=above_limit" />
        </>
      }
      summary={<SummaryBar stats={fieldControlSummaryStats(field)} />}
      charts={
        permitTotal > 0 || drillTotal > 0 ? (
          <>
            {permitTotal > 0 && (
              <StatusShareBar
                title="Permisos de trabajo por estado" description="Reparto entre activos y suspendidos, ahora"
                data={[
                  { key: "active", label: "Activos", value: field.permitsActive, color: CHART_COLORS.brand },
                  { key: "suspended", label: "Suspendidos", value: field.permitsSuspended, color: CHART_COLORS.signal },
                ]}
              />
            )}
            {drillTotal > 0 && (
              <StatusShareBar
                title="Resultado de los simulacros" description="Ejecutados, por resultado registrado"
                data={[
                  { key: "ok", label: "Satisfactorios", value: Math.max(0, drillTotal - field.drillsNeedingImprovement), color: CHART_COLORS.brand },
                  { key: "mejora", label: "Por mejorar", value: field.drillsNeedingImprovement, color: CHART_COLORS.signal },
                ]}
              />
            )}
          </>
        ) : null
      }
    />
  )
}

function fieldControlSummaryStats(field: Awaited<ReturnType<typeof getFieldControlSummary>>): SummaryStat[] {
  return [
    {
      key: "permits-active",
      // "Permisos" a secas es ambiguo en una sección que también habla de
      // inspecciones, simulacros y mediciones: el dominio es permiso de trabajo.
      label: "Permisos de trabajo activos",
      value: field.permitsActive,
      secondary: field.permitsSuspended > 0 ? `${field.permitsSuspended} suspendido(s) · ahora` : "Ninguno suspendido, ahora",
      href: "/prevencion/permisos",
    },
    {
      key: "committee-agreements",
      label: "Acuerdos del comité abiertos",
      value: field.committeeAgreementsOpen,
      secondary: "Con acción CAPA sin cerrar · ahora",
      href: "/prevencion/cphs",
      tone: "signal",
    },
    {
      key: "change-open",
      label: "Gestión del cambio abierta",
      value: field.changeRequestsOpen,
      secondary: "Cambios sin cerrar · ahora",
      href: "/prevencion/gestion-cambio",
      tone: "signal",
    },
  ]
}

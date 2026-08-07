import { Certificate, ShieldWarning, Siren } from "@phosphor-icons/react/dist/ssr"
import { KpiCard } from "@/components/ui/kpi-card"
import { SummaryBar } from "@/components/ui/summary-bar"
import { getCapaDashboardCounts } from "@/lib/services/prevention-capa"
import { getIncidentDashboardCounts } from "@/lib/services/prevention-incidents"
import { getLegalDashboard, getRiskDashboard } from "@/lib/services/prevention-risk-legal"
import {
  getCanonicalSafetyIndicatorYear,
  getMaterialEnvironmentalEvents,
} from "@/lib/services/prevention-indicadores"
import { getPdtpComplianceIndicatorsForScope } from "@/lib/services/pdtp/compliance"
import { DASHBOARD_DOMAINS } from "../dashboard-domains"
import { loadPdtpComplianceSummary, PdtpComplianceCard } from "../pdtp-compliance-card"
import { DomainSection } from "../dashboard-domain-shell"
import { MONTH_LABELS, toSstMonthlyPoints } from "../sst-monthly-points"
import {
  MaterialEnvironmentalChart,
  SstAccidentChart,
  SstTrendChart,
  ThresholdRankingChart,
} from "../dashboard-domain-charts"

import type { DomainSectionsProps } from "./shared"
import { pct } from "./shared"

// ── Prevención y SST ─────────────────────────────────────────────────────────

export async function PreventionSection({ session, worksiteScope, worksiteIds, currentYear }: DomainSectionsProps) {
  const permissions = session.user.permissions
  const has = (permission: string) => permissions.includes(permission)

  const [capa, incidents, legal, risk, sstYear, envEvents, pdtpByWorksite, pdtpSummary] = await Promise.all([
    has("prevention:capa:view")
      ? getCapaDashboardCounts({ scope: worksiteScope, permissions })
      : Promise.resolve({ open: 0, overdue: 0, pendingVerification: 0, unreconciled: 0 }),
    has("prevention:incidents:view")
      ? getIncidentDashboardCounts({ ctx: { userId: session.user.id }, scope: worksiteScope, permissions })
      : Promise.resolve({ totalOpen: 0, overdueNotifications: 0, fatalOrSerious: 0, pendingInvestigation: 0 }),
    has("prevention:legal:view") ? getLegalDashboard({ userId: session.user.id, scope: worksiteScope, permissions }).catch(() => null) : Promise.resolve(null),
    has("prevention:risk:view") ? getRiskDashboard({ userId: session.user.id, scope: worksiteScope, permissions }).catch(() => null) : Promise.resolve(null),
    has("prevention:indicadores:view") ? getCanonicalSafetyIndicatorYear(currentYear, worksiteScope).catch(() => null) : Promise.resolve(null),
    has("prevention:indicadores:view") ? getMaterialEnvironmentalEvents(currentYear, worksiteScope).catch(() => null) : Promise.resolve(null),
    has("prevention:pdtp:view") ? getPdtpComplianceIndicatorsForScope(currentYear, worksiteIds).catch(() => null) : Promise.resolve(null),
    /*
     * La tarjeta de cumplimiento PDTP vivía en el aside del Centro de Control.
     * Se muda acá, junto al resto del detalle preventivo: en el Resumen ahora
     * hay un medidor radial con la misma cifra, y A5 prohíbe que una cifra
     * tenga dos representaciones en la misma pantalla.
     */
    has("prevention:pdtp:view") ? loadPdtpComplianceSummary(worksiteIds).catch(() => null) : Promise.resolve(null),
  ])

  const totalGroup = sstYear?.groups.find((group) => group.worksiteId === "total")
  const sstPoints = totalGroup ? toSstMonthlyPoints(totalGroup.monthly) : []
  const materialEnvPoints = envEvents?.eventData.find((entry) => entry.worksiteId === "total")?.monthly.map((month) => ({
    month: MONTH_LABELS[month.month - 1] ?? `M${month.month}`,
    dangerousIncidents: month.dangerousIncidents,
    materialDamage: month.materialDamage,
    environmentalSpills: month.environmentalSpills,
  })) ?? []

  // `perWorksite` viene con ids; los nombres salen del propio dashboard legal,
  // que ya consulta las faenas visibles del alcance.
  const worksiteNames = new Map((legal?.worksites ?? risk?.worksites ?? []).map((w) => [w.id, w.name]))
  const pdtpPercent = pdtpByWorksite?.annual.percent ?? null
  // `getLegalDashboard` entrega las aplicabilidades crudas y la lista de brechas;
  // el porcentaje se deriva acá sobre el denominador correcto —sólo las
  // marcadas "applicable"—, no sobre el total de requisitos del catálogo.
  const applicableCount = legal?.applicabilities.filter((item) => item.applicability.applicabilityStatus === "applicable").length ?? 0
  const legalGaps = legal?.gaps.length ?? 0
  const legalCompliance = applicableCount > 0
    ? Math.round(((applicableCount - legalGaps) / applicableCount) * 100)
    : null

  return (
    <DomainSection
      domain={DASHBOARD_DOMAINS.prevencion}
      note="Las tasas y los eventos son anuales por norma; no siguen el período elegido arriba."
      links={[
        { label: "PDTP", href: "/prevencion/pdtp" },
        { label: "Incidentes", href: "/prevencion/incidentes" },
        { label: "Indicadores", href: "/prevencion/indicadores" },
      ]}
      kpis={
        <>
          <KpiCard icon={<Certificate size={16} />} label="Cumplimiento PDTP"
            value={pdtpPercent === null ? "—" : `${Math.round(pdtpPercent * 100)}%`}
            detail={pdtpPercent === null ? "Sin programa activo" : `Avance acreditado · año ${currentYear}`} href="/prevencion/pdtp" />
          <KpiCard icon={<Siren size={16} />} label="Incidentes abiertos" value={String(incidents.totalOpen)}
            detail={incidents.fatalOrSerious > 0 ? `${incidents.fatalOrSerious} fatal(es) o grave(s) · ahora` : "Ninguno fatal ni grave, ahora"}
            tone={incidents.fatalOrSerious > 0 ? "signal" : "neutral"} href="/prevencion/incidentes?quick=open" />
          <KpiCard icon={<ShieldWarning size={16} />} label="CAPA vencidas" value={String(capa.overdue)}
            detail={`${capa.open} abierta${capa.open === 1 ? "" : "s"} en total · ahora`} tone={capa.overdue > 0 ? "signal" : "neutral"} href="/prevencion/capa?vista=overdue" />
          {risk && (
            <KpiCard icon={<ShieldWarning size={16} />} label="Riesgos críticos sin control"
              value={String(risk.criticalBlockers.length)}
              detail={risk.criticalBlockers.length > 0 ? "Sin control verificado ni PDTP · ahora" : "Todos con control verificado"}
              tone={risk.criticalBlockers.length > 0 ? "signal" : "neutral"} href="/prevencion/miper#bloqueos" />
          )}
        </>
      }
      summary={
        <>
          <SummaryBar stats={[{
            key: "legal-compliance",
            label: "Cumplimiento legal",
            value: legalCompliance === null ? "—" : `${legalCompliance}%`,
            secondary: applicableCount > 0 ? `${legalGaps} brechas de ${applicableCount} aplicables · ahora` : "Sin requisitos evaluados",
            href: "/prevencion/requisitos-legales",
          }]} />
          {pdtpSummary && <div className="mt-3"><PdtpComplianceCard {...pdtpSummary} /></div>}
        </>
      }
      charts={
        <>
          {sstPoints.length > 0 && <div className="xl:col-span-2"><SstTrendChart data={sstPoints} /></div>}
          {sstPoints.length > 0 && <SstAccidentChart data={sstPoints} />}
          {materialEnvPoints.length > 0 && <div className="xl:col-span-2"><MaterialEnvironmentalChart data={materialEnvPoints} /></div>}
          {risk && (risk.coverage.activeProcesses > 0 || risk.coverage.activePositions > 0) && (
            <ThresholdRankingChart
              title="Cobertura MIPER" description="Procesos y cargos con matriz de riesgos publicada"
              data={[
                { name: "Procesos", value: pct(risk.coverage.coveredProcesses, risk.coverage.activeProcesses), detail: `${risk.coverage.coveredProcesses} de ${risk.coverage.activeProcesses}` },
                { name: "Cargos", value: pct(risk.coverage.coveredPositions, risk.coverage.activePositions), detail: `${risk.coverage.coveredPositions} de ${risk.coverage.activePositions}` },
              ]}
            />
          )}
          {pdtpByWorksite && pdtpByWorksite.perWorksite.length > 0 && (
            /* Ancho completo: cerraba la grilla solo en su fila (I-09) y un
               ranking de hasta 9 faenas gana con barras y rótulos más largos. */
            <div className="xl:col-span-2 2xl:col-span-3">
              <ThresholdRankingChart
                title="Cumplimiento PDTP por faena" description="Comparativa entre las faenas del alcance"
                data={pdtpByWorksite.perWorksite
                  .filter((entry) => entry.indicators !== null)
                  .map((entry) => ({
                    name: worksiteNames.get(entry.worksiteId) ?? entry.worksiteId,
                    value: Math.round((entry.indicators!.annual.percent ?? 0) * 100),
                    detail: `${entry.indicators!.annual.executed} de ${entry.indicators!.annual.planned}`,
                  }))}
              />
            </div>
          )}
        </>
      }
    />
  )
}

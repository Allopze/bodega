import { Certificate, FileText, ShieldWarning, Siren } from "@phosphor-icons/react/dist/ssr"
import { KpiCard } from "@/components/ui/kpi-card"
import { getDashboardCounters } from "@/lib/services/prevention-documents/search"
import { getPpaStats } from "@/lib/services/ppa-module/calculos"
import { getDashboardStats } from "@/lib/services/sst-module/dashboard"
import { listCompetencyGaps } from "@/lib/services/prevention-training"
import { DASHBOARD_DOMAINS } from "../dashboard-domains"
import { DomainSection } from "../dashboard-domain-shell"
import { periodScopeLabel } from "../dashboard-scope"
import { CHART_COLORS } from "@/lib/chart-palette"
import { CompositionDonutChart, StatusShareBar } from "../dashboard-domain-charts"

import type { DomainSectionsProps } from "./shared"

// ── Cumplimiento y gobernanza ────────────────────────────────────────────────

export async function GovernanceSection({ session, scope, worksiteScope, worksiteIds }: DomainSectionsProps) {
  const permissions = session.user.permissions
  const has = (permission: string) => permissions.includes(permission)

  const [docs, ppa, sstStats, gaps] = await Promise.all([
    has("prevention:docs:view")
      ? getDashboardCounters(worksiteScope, permissions)
      : Promise.resolve(null),
    has("ppa:view") ? getPpaStats(worksiteIds).catch(() => null) : Promise.resolve(null),
    has("sst:view") ? getDashboardStats(worksiteIds).catch(() => null) : Promise.resolve(null),
    has("prevention:training:view")
      ? listCompetencyGaps({ userId: session.user.id, scope: worksiteScope, permissions }).catch(() => [])
      : Promise.resolve([]),
  ])

  const blockingGaps = gaps.filter((gap) => gap.enforcement === "blocking").length
  const periodo = periodScopeLabel(scope.period).toLocaleLowerCase("es-CL")

  return (
    <DomainSection
      domain={DASHBOARD_DOMAINS.gobernanza}
      links={[
        { label: "Documentación", href: "/prevencion/documentacion" },
        { label: "Capacitación", href: "/prevencion/capacitacion" },
        { label: "PPA", href: "/prevencion/ppa" },
      ]}
      kpis={
        <>
          <KpiCard icon={<FileText size={16} />} label="Documentos por vencer"
            value={String(docs?.expiringSoon.within30 ?? 0)}
            detail={`${docs?.expiringSoon.within7 ?? 0} en 7 días · ${docs?.byStatus.vencido ?? 0} ya vencidos`}
            // El indicador lleva a la lista ya acotada al mismo rango que cuenta:
            // antes anunciaba una urgencia y dejaba al usuario buscándola a mano.
            tone={(docs?.expiringSoon.within7 ?? 0) > 0 ? "signal" : "neutral"} href="/prevencion/documentacion?vence=30" />
          <KpiCard icon={<Certificate size={16} />} label="Acuses pendientes" value={String(docs?.ackPending ?? 0)}
            detail="Distribuciones sin firmar, ahora" href="/prevencion/documentacion" />
          <KpiCard icon={<ShieldWarning size={16} />} label="Brechas de competencia" value={String(blockingGaps)}
            detail={`${gaps.length} en total · ahora`}
            tone={blockingGaps > 0 ? "signal" : "neutral"} href="/prevencion/capacitacion/brechas" />
          <KpiCard icon={<Siren size={16} />} label="Desviaciones PPA"
            value={ppa ? `${Math.round(ppa.porcentajeDesviaciones)}%` : "—"}
            detail={ppa ? `${ppa.detenidos} detenciones de ${ppa.total} · ${periodo}` : "Sin registros PPA"}
            tone={ppa && ppa.detenidos > 0 ? "signal" : "neutral"} href="/prevencion/ppa" />
        </>
      }
      charts={
        <>
          {docs && (
            <CompositionDonutChart
              title="Documentos por estado" description="Cómo se reparte la biblioteca documental SST"
              totalLabel="documentos"
              data={Object.entries(docs.byStatus).map(([status, value]) => ({
                key: status, label: status.replace(/_/g, " "), value,
              }))}
            />
          )}
          {sstStats && (
            <StatusShareBar
              title="Evaluaciones SST de trabajador" description="Reparto entre habilitados y no habilitados"
              data={[
                { key: "habilitados", label: "Habilitados", value: sstStats.habilitados, color: CHART_COLORS.brand },
                { key: "noHabilitados", label: "No habilitados", value: sstStats.noHabilitados, color: CHART_COLORS.danger },
                { key: "borrador", label: "En borrador", value: sstStats.borrador, color: CHART_COLORS.neutral },
              ]}
            />
          )}
        </>
      }
    />
  )
}

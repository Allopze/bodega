import Link from "next/link"
import { Certificate, ChartBar, FileText, ShieldWarning, Siren } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { ChartSlot, DashboardPanel, PanelBlock } from "@/components/ui/dashboard-panel"
import { EmptyState } from "@/components/ui/empty-state"
import { KpiCard } from "@/components/ui/kpi-card"
import { RankedList, type RankedListItem } from "@/components/ui/ranked-list"
import { getCapaDashboardCounts } from "@/lib/services/prevention-capa"
import { getIncidentDashboardCounts } from "@/lib/services/prevention-incidents"
import { getLegalDashboard, getRiskDashboard } from "@/lib/services/prevention-risk-legal"
import {
  getCanonicalSafetyIndicatorYear,
  getMaterialEnvironmentalEvents,
} from "@/lib/services/prevention-indicadores"
import { getPdtpComplianceIndicatorsForScope } from "@/lib/services/pdtp/compliance"
import { PORTFOLIO_PATH, PORTFOLIO_SUMMARY_HREF } from "@/lib/prevention/miper/portfolio"
import { getPdtpOperationalYears } from "@/lib/services/pdtp/operational-years"
import { DASHBOARD_DOMAINS } from "../dashboard-domains"
import { loadPdtpComplianceSummary, PdtpComplianceCard } from "../pdtp-compliance-card"
import { DASHBOARD_KPI, DomainSection } from "../dashboard-domain-shell"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "../charts/chart-frame"
import { MONTH_LABELS, toSstMonthlyPoints } from "../sst-monthly-points"
import {
  MaterialEnvironmentalChart,
  SstAccidentChart,
  SstTrendChart,
} from "../dashboard-domain-charts"

import type { DomainSectionsProps } from "./shared"
import { pct } from "./shared"
import { DASHBOARD_GLOSSARY } from "../dashboard-glossary"

// ── Prevención y SST ─────────────────────────────────────────────────────────

/**
 * Umbrales del semáforo de cobertura/cumplimiento: los mismos que usaba
 * `ThresholdRankingChart` (`goodAtOrAbove` 80, `warnAtOrAbove` 50), para que el
 * color de una faena no cambie de significado con el rediseño.
 */
const COMPLIANCE_THRESHOLDS = { good: 80, warn: 50 } as const

export async function PreventionSection({ session, worksiteScope, worksiteIds, currentYear }: DomainSectionsProps) {
  const permissions = session.user.permissions
  const has = (permission: string) => permissions.includes(permission)
  // PREV-C03.7: el KPI del PDTP mide el año operativo (en enero puede seguir
  // siendo el anterior); las tasas e indicadores siguen el año civil por norma.
  const pdtpYear = has("prevention:pdtp:view")
    ? (await getPdtpOperationalYears().catch(() => null))?.primary ?? currentYear
    : currentYear

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
    // PREV-C05-C: el año consolidado entre versiones, igual que la tarjeta.
    has("prevention:pdtp:view") ? getPdtpComplianceIndicatorsForScope(pdtpYear, worksiteIds, { consolidateYear: true }).catch(() => null) : Promise.resolve(null),
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
  // El denominador correcto no es el catálogo ni todas las "applicable": es el
  // de `counts`, que descuenta las aplicabilidades colgadas de un requisito
  // reemplazado o con vigencia terminada (LEGAL-01/03). Filtrarlo acá a mano
  // volvía a contar obligaciones derogadas.
  const applicableCount = legal?.counts.applicable ?? 0
  const legalGaps = legal?.counts.gaps ?? 0
  const legalCompliance = applicableCount > 0
    ? Math.round(((applicableCount - legalGaps) / applicableCount) * 100)
    : null

  const canManagePdtp = has("prevention:pdtp:program:manage")
  const canApprovePdtp = has("prevention:pdtp:approve")
  const pdtpPending = pdtpSummary?.pendingCount ?? 0

  /*
   * Cobertura de la matriz. Una fila cuyo universo es 0 ("0 de 0") no es una
   * cobertura baja sino una cobertura que no se puede medir: pintarla en rojo
   * como 0 % mandaba a "arreglar" algo que no existe.
   */
  const matrixRows: RankedListItem[] = (risk
    ? [
        { key: "procesos", label: "Procesos", covered: risk.coverage.coveredProcesses, total: risk.coverage.activeProcesses },
        { key: "cargos", label: "Cargos", covered: risk.coverage.coveredPositions, total: risk.coverage.activePositions },
      ]
    : []
  )
    .filter((row) => row.total > 0)
    .map((row) => ({ key: row.key, label: row.label, value: pct(row.covered, row.total), detail: `${row.covered} de ${row.total}`, href: PORTFOLIO_PATH }))

  // Sin plan (`percent` null) la faena cuenta 0 %, igual que antes: es el
  // comportamiento histórico del ranking y no se reinterpreta acá.
  const pdtpRows: RankedListItem[] = (pdtpByWorksite?.perWorksite ?? [])
    .filter((entry) => entry.indicators !== null)
    .map((entry) => ({
      key: entry.worksiteId,
      label: worksiteNames.get(entry.worksiteId) ?? entry.worksiteId,
      value: Math.round((entry.indicators!.annual.percent ?? 0) * 100),
      detail: `${entry.indicators!.annual.executed} de ${entry.indicators!.annual.planned}`,
      // La ficha del programa ya acepta `?faena=`: la fila lleva al detalle de esa faena.
      href: `/prevencion/pdtp?anio=${pdtpYear}&faena=${entry.worksiteId}`,
    }))
  // Todas en 0 %: un ranking de barras vacías no compara nada (A4).
  const pdtpAllZero = pdtpRows.length > 0 && pdtpRows.every((row) => row.value === 0)
  // Aprobadores con pendientes van directo a la bandeja; el resto, a las actividades.
  const pdtpEmptyAction = canApprovePdtp && pdtpPending > 0
    ? { label: `Revisar las ${pdtpPending} por aprobar`, href: "/prevencion/pdtp/aprobaciones" }
    : { label: "Ver las actividades", href: "/prevencion/pdtp/actividades" }

  const showLegal = has("prevention:legal:view")
  const showPdtpCard = pdtpSummary !== null
  // `legal` null con permiso es una consulta caída: no se la presenta como "aún
  // no hay requisitos evaluados", que sería afirmar algo que no se sabe.
  const legalFailed = showLegal && legal === null

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
          {/* Sin `prevention:pdtp:view` la cifra no existe: ni "—" ni un acceso
              a una pantalla que respondería 403. */}
          {has("prevention:pdtp:view") && (pdtpPercent === null ? (
            <KpiCard {...DASHBOARD_KPI} icon={<Certificate size={16} />} label="Cumplimiento PDTP" glossary={DASHBOARD_GLOSSARY.PDTP}
              value="—" detail=""
              empty={{ message: "Aún no hay un programa activo", actionLabel: canManagePdtp ? "Crear el programa" : "Ver el PDTP" }}
              href={canManagePdtp ? "/prevencion/pdtp/nuevo" : "/prevencion/pdtp"} />
          ) : (
            <KpiCard {...DASHBOARD_KPI} icon={<Certificate size={16} />} label="Cumplimiento PDTP" glossary={DASHBOARD_GLOSSARY.PDTP}
              value={`${Math.round(pdtpPercent * 100)}%`}
              detail={`Avance acreditado · año ${pdtpYear}`} href={`/prevencion/pdtp?anio=${pdtpYear}`} />
          ))}
          <KpiCard {...DASHBOARD_KPI} icon={<Siren size={16} />} label="Incidentes abiertos" value={String(incidents.totalOpen)}
            detail={incidents.fatalOrSerious > 0 ? `${incidents.fatalOrSerious} fatal(es) o grave(s) · ahora` : "Ninguno fatal ni grave, ahora"}
            tone={incidents.fatalOrSerious > 0 ? "signal" : "neutral"} href="/prevencion/incidentes?quick=open" />
          <KpiCard {...DASHBOARD_KPI} icon={<ShieldWarning size={16} />} label="CAPA vencidas" glossary={DASHBOARD_GLOSSARY.CAPA} value={String(capa.overdue)}
            detail={`${capa.open} abierta${capa.open === 1 ? "" : "s"} en total · ahora`} tone={capa.overdue > 0 ? "signal" : "neutral"} href="/prevencion/capa?vista=overdue" />
          {risk && (
            <KpiCard {...DASHBOARD_KPI} icon={<ShieldWarning size={16} />} label="Riesgos críticos sin control"
              value={String(risk.criticalBlockers.length)}
              detail={risk.criticalBlockers.length > 0 ? "Sin control verificado ni PDTP · ahora" : "Todos con control verificado"}
              tone={risk.criticalBlockers.length > 0 ? "signal" : "neutral"} href={PORTFOLIO_SUMMARY_HREF.critical} />
          )}
        </>
      }
      summary={(showPdtpCard || showLegal) && (
        /*
         * La tarjeta del PDTP y el cumplimiento legal comparten un solo panel de
         * 12 columnas (8 + 4): antes eran una banda `SummaryBar` y una tarjeta
         * flotante apiladas, con dos superficies distintas para el mismo nivel
         * de lectura. Con una sola de las dos, ocupa el ancho completo.
         */
        <DashboardPanel cols="twelve">
          {pdtpSummary !== null && (
            <PanelBlock padding="none" className={showLegal ? "lg:col-span-8" : "lg:col-span-12"}>
              <PdtpComplianceCard {...pdtpSummary} />
            </PanelBlock>
          )}
          {showLegal && (
            <PanelBlock padding="none" className={showPdtpCard ? "lg:col-span-4" : "lg:col-span-12"}>
              <ChartFrame title="Cumplimiento legal" description="Requisitos legales aplicables"
                headline={legalCompliance === null ? undefined : (
                  <>
                    <ChartHeadlineValue>{legalCompliance}%</ChartHeadlineValue>
                    <ChartHeadlineCaption>{legalGaps} {legalGaps === 1 ? "brecha" : "brechas"} de {applicableCount} aplicables · ahora</ChartHeadlineCaption>
                  </>
                )}>
                {legalCompliance !== null ? (
                  <Link href="/prevencion/requisitos-legales" className="inline-flex min-h-6 items-center text-xs font-semibold text-[var(--color-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">
                    Ver los requisitos
                  </Link>
                ) : legalFailed ? (
                  <p className="text-sm text-[var(--color-text-muted)]">No se pudo calcular el cumplimiento legal. Recarga la página para reintentar.</p>
                ) : (
                  <EmptyState
                    compact align="start" as="p" className="px-0 py-2"
                    icon={<FileText size={20} />}
                    title="Aún no hay requisitos evaluados"
                    description="Evalúa qué requisitos aplican a cada faena para medir brechas."
                    action={<Button asChild size="sm"><Link href="/prevencion/requisitos-legales">Evaluar requisitos</Link></Button>}
                  />
                )}
              </ChartFrame>
            </PanelBlock>
          )}
        </DashboardPanel>
      )}
      charts={
        /*
         * Cada gráfico va en su `ChartSlot`: si devuelve `null` (sin siniestros
         * en el año, tasas en cero) la celda se oculta en vez de dejar un hueco
         * del ancho de dos columnas. El orden —tasas, accidentes, cobertura
         * MIPER, eventos, PDTP por faena— cierra filas completas tanto en la
         * grilla de 3 columnas (2xl) como en la de 2 (xl) cuando todo está.
         */
        <>
          {sstPoints.length > 0 && <ChartSlot span="wide"><SstTrendChart data={sstPoints} /></ChartSlot>}
          {sstPoints.length > 0 && <ChartSlot><SstAccidentChart data={sstPoints} /></ChartSlot>}
          {matrixRows.length > 0 && (
            <ChartSlot>
              <ChartFrame title="Cobertura de la matriz de riesgos" description="MIPER: procesos y cargos con matriz de identificación de peligros y evaluación de riesgos publicada">
                <RankedList
                  items={matrixRows} format="percent" mode="threshold" thresholds={COMPLIANCE_THRESHOLDS}
                  ariaLabel="Cobertura de la matriz de riesgos por procesos y cargos"
                />
                {matrixRows.some((row) => row.value < 100) && (
                  <Link href={PORTFOLIO_PATH} className="mt-3 inline-flex min-h-6 items-center text-xs font-semibold text-[var(--color-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">
                    Publicar matrices
                  </Link>
                )}
              </ChartFrame>
            </ChartSlot>
          )}
          {materialEnvPoints.length > 0 && <ChartSlot span="wide"><MaterialEnvironmentalChart data={materialEnvPoints} /></ChartSlot>}
          {pdtpRows.length > 0 && (
            /* Una columna, junto a la cobertura MIPER: como lista ya no necesita
               el ancho de un gráfico de barras, y a ancho completo dejaba a la
               cobertura sola en su fila con media fila vacía. */
            <ChartSlot>
              <ChartFrame title="Cumplimiento del PDTP por faena" description={`Programa de Trabajo Preventivo ${pdtpYear}: comparativa entre las faenas del alcance`}>
                {pdtpAllZero ? (
                  <EmptyState
                    compact align="start" as="p" className="px-0 py-2"
                    icon={<ChartBar size={20} />}
                    title={`Ninguna faena tiene avance acreditado en ${pdtpYear}`}
                    description={`La comparación aparece cuando al menos una faena valide actividades del programa.${pdtpPending > 0 ? ` Hoy hay ${pdtpPending} ${pdtpPending === 1 ? "actividad esperando" : "actividades esperando"} aprobación.` : ""}`}
                    action={<Button asChild size="sm"><Link href={pdtpEmptyAction.href}>{pdtpEmptyAction.label}</Link></Button>}
                  />
                ) : (
                  <RankedList
                    items={pdtpRows} format="percent" mode="threshold" thresholds={COMPLIANCE_THRESHOLDS}
                    ariaLabel="Cumplimiento del PDTP por faena"
                    // Peor primero y sin descartar filas: el recorte anterior
                    // (`slice(-8)`) dejaba fuera a la faena que más atención pedía.
                    moreHref={`/prevencion/pdtp?anio=${pdtpYear}`}
                  />
                )}
              </ChartFrame>
            </ChartSlot>
          )}
        </>
      }
    />
  )
}

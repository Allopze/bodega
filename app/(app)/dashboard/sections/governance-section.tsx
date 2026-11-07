import { Certificate, FileText, ShieldWarning, Siren } from "@phosphor-icons/react/dist/ssr"
import { ChartSlot } from "@/components/ui/dashboard-panel"
import { KpiCard } from "@/components/ui/kpi-card"
import { getDashboardCounters } from "@/lib/services/prevention-documents/search"
import { getPpaStats } from "@/lib/services/ppa-module/calculos"
import { getDashboardStats } from "@/lib/services/sst-module/dashboard"
import { countTrainingOccurrencesByStatus, resolveTrainingOccurrenceYear } from "@/lib/services/prevention-training-occurrences"
import { DASHBOARD_DOMAINS } from "../dashboard-domains"
import { DASHBOARD_KPI, DomainSection } from "../dashboard-domain-shell"
import { CHART_COLORS } from "@/lib/chart-palette"
import { SST_DOCUMENT_STATUS_LABELS } from "@/lib/prevention/privacy-inventory"
import { DASHBOARD_GLOSSARY } from "../dashboard-glossary"
import { detentionFigure } from "@/lib/ppa/detention-rate"
import { CompositionDonutChart, StatusShareBar } from "../dashboard-domain-charts"

import type { DomainSectionsProps } from "./shared"

// ── Cumplimiento y gobernanza ────────────────────────────────────────────────

export async function GovernanceSection({ session, worksiteScope, worksiteIds }: DomainSectionsProps) {
  const permissions = session.user.permissions
  const has = (permission: string) => permissions.includes(permission)

  const [docs, ppa, sstStats, trainingCounts] = await Promise.all([
    has("prevention:docs:view")
      ? getDashboardCounters(worksiteScope, permissions)
      : Promise.resolve(null),
    has("ppa:view") ? getPpaStats(worksiteIds).catch(() => null) : Promise.resolve(null),
    has("sst:view") ? getDashboardStats(worksiteIds).catch(() => null) : Promise.resolve(null),
    has("prevention:training:view")
      ? countTrainingOccurrencesByStatus(
          { userId: session.user.id, scope: worksiteScope, permissions },
          { year: await resolveTrainingOccurrenceYear(undefined) },
        ).catch(() => null)
      : Promise.resolve(null),
  ])

  /* La tarjeta contaba brechas de competencia por persona hasta el 2026-09-19.
   * Con el modelo por actividad, lo que queda por hacer son las ocurrencias del
   * año que nadie marcó todavía; `not_completed` no entra, porque ésa ya fue
   * resuelta —declarada no hecha— y no es trabajo pendiente. `not_applicable`
   * tampoco: salió del programa de esa faena, así que no es ni numerador ni
   * denominador. Por eso se cuenta `pending` y no «todo menos completed». Los
   * cuenta la base por estado (`countTrainingOccurrencesByStatus`): cargar las
   * miles de ocurrencias del año con su evidencia sólo para contarlas era el costo. */
  const pendingTraining = trainingCounts?.pending ?? 0
  const notDoneTraining = trainingCounts?.not_completed ?? 0

  /* Es la misma magnitud que la tira de /prevencion/ppa y sigue su misma regla
   * (`detentionFigure`): bajo `PPA_RATE_MIN_SAMPLE` PPA no hay porcentaje, hay el
   * conteo («3 de 11») y la nota de que la base es demasiado chica. Se arma acá y
   * no en un componente aparte para que el tile siga a la vista del árbol. */
  const ppaFigure = ppa ? detentionFigure(ppa.detenidos, ppa.total) : null

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
          <KpiCard {...DASHBOARD_KPI} icon={<FileText size={16} />} label="Documentos por vencer"
            value={docs?.expiringSoon.within30 ?? 0}
            detail={`${docs?.expiringSoon.within7 ?? 0} en 7 días · ${docs?.byStatus.vencido ?? 0} ya vencidos`}
            // El indicador lleva a la lista ya acotada al mismo rango que cuenta:
            // antes anunciaba una urgencia y dejaba al usuario buscándola a mano.
            tone={(docs?.expiringSoon.within7 ?? 0) > 0 ? "signal" : "neutral"} href="/prevencion/documentacion?vence=30" />
          <KpiCard {...DASHBOARD_KPI} icon={<Certificate size={16} />} label="Acuses pendientes" value={docs?.ackPending ?? 0}
            detail="Distribuciones sin firmar, ahora" href="/prevencion/documentacion" />
          <KpiCard {...DASHBOARD_KPI} icon={<ShieldWarning size={16} />} label="Capacitaciones pendientes" value={pendingTraining}
            detail={`${notDoneTraining} declaradas no hechas · ahora`}
            tone={notDoneTraining > 0 ? "signal" : "neutral"} href="/prevencion/capacitacion" />
          {/* Sin `ppa:view` la cifra no existe: ni "—" ni un acceso a una pantalla
              que respondería 403. Con permiso y sin registros, un "0 %" de
              desviaciones sobre 0 PPA no mide nada; dice qué falta (A4). */}
          {has("ppa:view") && (ppa && ppaFigure && ppaFigure.kind !== "empty" ? (
            <KpiCard {...DASHBOARD_KPI} icon={<Siren size={16} />} label="Tasa de detención PPA"
              value={ppaFigure.value}
              // Los PPA no se acotan por fecha (`getPpaStats` no recibe período): decir
              // "· mes" era falso, y es la razón por la que el selector no aplica acá (INI-05).
              detail={ppaFigure.kind === "rate" ? `${ppaFigure.basis} · acumulado` : `PPA detenidos. ${ppaFigure.note}`}
              glossary={DASHBOARD_GLOSSARY.PPA}
              tone={ppa.detenidos > 0 ? "signal" : "neutral"} href="/prevencion/ppa" />
          ) : (
            <KpiCard {...DASHBOARD_KPI} icon={<Siren size={16} />} label="Tasa de detención PPA"
              value="—" detail="" glossary={DASHBOARD_GLOSSARY.PPA}
              empty={{ message: "Aún no hay registros PPA", actionLabel: "Ir al PPA" }} href="/prevencion/ppa" />
          ))}
        </>
      }
      charts={
        /*
         * Con las dos tarjetas, la dona (1 columna) y la barra de reparto
         * comparten la fila: la barra ocupa el resto (1 en xl, 2 en 2xl). Si
         * falta una, la que queda toma la fila completa en vez de dejar la mitad
         * del panel en blanco.
         */
        <>
          {docs && (
            <ChartSlot span={sstStats ? "one" : "full"}>
              <CompositionDonutChart
                title="Documentos por estado" description="Cómo se reparte la biblioteca documental SST"
                totalLabel="documentos"
                data={Object.entries(docs.byStatus).map(([status, value]) => ({
                  // Antes salía el valor crudo del enum ("borrador: 99", "en revision").
                  key: status, label: SST_DOCUMENT_STATUS_LABELS[status] ?? status, value,
                }))}
              />
            </ChartSlot>
          )}
          {sstStats && (
            <ChartSlot span={docs ? "one" : "full"} className={docs ? "2xl:col-span-2" : undefined}>
              <StatusShareBar
                title="Evaluaciones SST de trabajador" description="Reparto entre habilitados y no habilitados"
                data={[
                  { key: "habilitados", label: "Habilitados", value: sstStats.habilitados, color: CHART_COLORS.brand },
                  { key: "noHabilitados", label: "No habilitados", value: sstStats.noHabilitados, color: CHART_COLORS.danger },
                  { key: "borrador", label: "En borrador", value: sstStats.borrador, color: CHART_COLORS.neutral },
                ]}
              />
            </ChartSlot>
          )}
        </>
      }
    />
  )
}

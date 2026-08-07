import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { inArray } from "drizzle-orm"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getEquipmentPerformanceAnalysis, PRESET_LABEL, trendLabel, type AggregationLevel, type EquipmentPreset } from "@/lib/combustibles/equipment-performance"
import { histogram } from "@/lib/combustibles/performance-statistics"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartErrorBoundary } from "@/components/chart-error-boundary"
import { HistogramChart, PerformanceGroupChart } from "./analysis-charts-lazy"
import { FilterSelect } from "../filter-select"

export const metadata: Metadata = { title: "Análisis de rendimiento por equipo" }

const PRESETS: EquipmentPreset[] = ["truck", "loaders_pickups", "heavy"]
const AGGREGATIONS: Array<{ value: AggregationLevel; label: string }> = [
  { value: "worksite", label: "Por faena" },
  { value: "vehicle", label: "Por equipo" },
  { value: "equipmentType", label: "Por tipo de equipo" },
]
const UNIT_LABEL: Record<string, string> = { km_per_liter: "km/L", liters_per_hour: "L/h" }
const RELIABILITY_BADGE: Record<string, { label: string; variant: "danger" | "warning" | "success" }> = {
  insuficiente: { label: "Muestra no concluyente", variant: "danger" },
  baja: { label: "Confiabilidad baja", variant: "warning" },
  confiable: { label: "Confiable", variant: "success" },
}

type AnalisisSearchParams = { preset?: string; agrupar?: string; faena?: string; desde?: string; hasta?: string }

function isoDate(date: Date) { return date.toISOString().slice(0, 10) }

function bitacoraHref(group: { unit: string; singlePlate: string | null }, worksiteId: string | undefined, from: string, to: string) {
  const params = new URLSearchParams({ desde: from, hasta: to })
  if (group.singlePlate) params.set("q", group.singlePlate)
  if (worksiteId) params.set("faena", worksiteId)
  return `/combustibles/bitacora?${params.toString()}`
}

export default async function EquipmentPerformancePage({ searchParams }: { searchParams: Promise<AnalisisSearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view") } catch { redirect("/forbidden") }

  const sp = await searchParams
  const preset: EquipmentPreset = PRESETS.includes(sp.preset as EquipmentPreset) ? (sp.preset as EquipmentPreset) : "truck"
  const aggregateBy: AggregationLevel = AGGREGATIONS.some((a) => a.value === sp.agrupar) ? (sp.agrupar as AggregationLevel) : "worksite"
  const worksiteId = sp.faena?.trim() || undefined
  const now = new Date()
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.desde ?? "") ? sp.desde! : isoDate(new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000))
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.hasta ?? "") ? sp.hasta! : isoDate(now)

  const scope = resolveWorksiteScope(session)
  const [worksitesList, groups] = await Promise.all([
    scope.mode === "none" ? Promise.resolve([]) : db.query.worksites.findMany({
      where: scope.mode === "some" ? inArray(worksites.id, scope.ids) : undefined,
      columns: { id: true, name: true },
      orderBy: [worksites.name],
    }),
    getEquipmentPerformanceAnalysis(session, { preset, aggregateBy, worksiteId, from, to }),
  ])

  const presetHref = (nextPreset: EquipmentPreset) => {
    const params = new URLSearchParams({ preset: nextPreset, agrupar: aggregateBy, desde: from, hasta: to })
    if (worksiteId) params.set("faena", worksiteId)
    return `/combustibles/analisis?${params.toString()}`
  }

  return (
    <PageContainer width="full">
      <PageHeader
        title="Análisis de rendimiento por equipo"
        description="Estadística descriptiva por faena, equipo o tipo: nunca mezcla observaciones km/L con L/h."
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Análisis de rendimiento" }]} />}
      />

      <div className="mb-4 flex flex-wrap gap-2 border-b border-(--color-border) pb-3">
        {PRESETS.map((item) => (
          <Button key={item} asChild variant={item === preset ? "primary" : "secondary"} size="sm">
            <Link href={presetHref(item)}>{PRESET_LABEL[item]}</Link>
          </Button>
        ))}
      </div>

      <form className="mb-4 grid gap-3 border-b border-(--color-border) pb-4 md:grid-cols-5">
        <input type="hidden" name="preset" value={preset} />
        <FilterSelect name="agrupar" defaultValue={aggregateBy} options={AGGREGATIONS.map((a) => ({ value: a.value, label: a.label }))} placeholder="Selecciona agrupación" />
        <FilterSelect name="faena" defaultValue={worksiteId} options={worksitesList.map((item) => ({ value: item.id, label: item.name }))} placeholder="Todas las autorizadas" />
        <DatePicker name="desde" defaultValue={from} placeholder="Desde" />
        <DatePicker name="hasta" defaultValue={to} placeholder="Hasta" />
        <Button type="submit" variant="secondary">Aplicar</Button>
      </form>

      {groups.length === 0 ? (
        <div className="border border-dashed border-(--color-border-strong) p-8 text-center text-sm text-(--color-text-muted)">
          {worksiteId || preset !== "truck" || aggregateBy !== "worksite" ? (
            <>Sin coincidencias para estos filtros. Intenta con otro preset, faena, agregación o rango de fechas. Sólo el consumo TCT importado y el log operacional traen rendimiento calculado: TAE y facturación todavía no lo tienen.
            </>
          ) : (
            <>Sin observaciones de rendimiento para camiones en todas las faenas autorizadas. Sólo el consumo TCT importado y el log operacional traen rendimiento calculado.
            </>
          )}
        </div>
      ) : (
        <>
        <div className="mb-6 grid gap-5 lg:grid-cols-2">
          {[...new Set(groups.map((g) => g.unit))].map((unit) => (
            <Card key={unit}>
              <CardHeader>
                <CardTitle className="text-base">Rendimiento medio ({UNIT_LABEL[unit] ?? unit})</CardTitle>
                <CardDescription>¿Qué {AGGREGATIONS.find((a) => a.value === aggregateBy)?.label.toLowerCase().replace("por ", "")} rinde peor o mejor de lo esperado? Barra ámbar = muestra poco confiable.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartErrorBoundary chartName={`Rendimiento medio (${UNIT_LABEL[unit] ?? unit})`}>
                  <PerformanceGroupChart groups={groups.filter((g) => g.unit === unit)} drilldownHref={(group) => bitacoraHref(group, worksiteId, from, to)} />
                </ChartErrorBoundary>
              </CardContent>
            </Card>
          ))}
        </div>
        {groups.length > 0 && (
          <div className="mb-6 grid gap-5 lg:grid-cols-2">
            {[...new Set(groups.map((g) => g.unit))].map((unit) => {
              const unitGroups = groups.filter((g) => g.unit === unit)
              const allValues = unitGroups.flatMap((g) => g.values)
              const hBins = histogram(allValues)
              const unitLabel = UNIT_LABEL[unit] ?? unit
              return (
                <Card key={`histogram-${unit}`}>
                  <CardHeader>
                    <CardTitle className="text-base">Distribución de rendimiento ({unitLabel})</CardTitle>
                    <CardDescription>{allValues.length} observaciones agrupadas en intervalos. La línea punteada marca la media global.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <HistogramChart bins={hBins} mean={allValues.length > 0 ? allValues.reduce((s, v) => s + v, 0) / allValues.length : 0} unitLabel={unitLabel} />
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
        <div className="overflow-x-auto border border-(--color-border)">
          <table className="w-full min-w-[1200px] text-sm">
            <thead className="bg-(--color-surface-2) text-left th-type">
              <tr>
                <th scope="col" className="p-3">{AGGREGATIONS.find((a) => a.value === aggregateBy)?.label}</th>
                <th>Unidad</th>
                <th>Muestra</th>
                <th>Promedio</th>
                <th>Mediana</th>
                <th>Mín / Máx</th>
                <th>Desv. estándar</th>
                <th>CV</th>
                <th>P10–P90</th>
                <th>Rango esperado</th>
                <th>vs. período anterior</th>
                <th>Tendencia</th>
                <th>Cargas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--color-border)">
              {groups.map((group) => {
                const badge = RELIABILITY_BADGE[group.reliability]!
                return (
                  <tr key={group.key}>
                    <td className="p-3 font-medium">{group.label}</td>
                    <td className="font-mono text-xs">{UNIT_LABEL[group.unit] ?? group.unit}</td>
                    <td><Badge variant={badge.variant} size="sm">{group.stats.count} · {badge.label}</Badge></td>
                    <td className="font-mono">{group.stats.mean}</td>
                    <td className="font-mono">{group.stats.median}</td>
                    <td className="font-mono">{group.stats.min} / {group.stats.max}</td>
                    <td className="font-mono">{group.stats.stdDev}</td>
                    <td className="font-mono">{group.stats.coefficientOfVariation == null ? "—" : `${group.stats.coefficientOfVariation}%`}</td>
                    <td className="font-mono">{group.stats.p10} – {group.stats.p90}</td>
                    <td className="font-mono text-(--color-text-muted)">{group.expectedRange ? `${group.expectedRange.low} – ${group.expectedRange.high}` : "—"}</td>
                    <td className="font-mono">{group.variationPct == null ? "—" : `${group.variationPct > 0 ? "+" : ""}${group.variationPct}%`}</td>
                    <td className="font-mono text-xs">{trendLabel(group.trend)}<br /><span className="text-(--color-text-muted)">{group.trend ? `R²=${group.trend.r2}` : ""}</span></td>
                    <td><Link href={bitacoraHref(group, worksiteId, from, to)} className="text-xs text-(--color-primary-ink) hover:underline">Ver cargas</Link></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </PageContainer>
  )
}

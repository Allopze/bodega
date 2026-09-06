import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import {
  ArrowRight,
  ChartLineUp,
  ClockClockwise,
  ShieldCheck,
  Wrench,
} from "@phosphor-icons/react/dist/ssr"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { MetaBadge } from "@/components/states/state-badge"
import { KpiCard } from "@/components/ui/kpi-card"
import { can, canAny, requireAuth } from "@/lib/auth/can"
import {
  getOperationalControlHub,
  resolveOperationalControlPeriod,
} from "@/lib/services/operational-control"
import {
  addDaysToPlainDate,
  formatCLP,
  formatDate,
  formatDateTime,
  todayInChile,
} from "@/lib/utils"
import { OperationalAssetsTable } from "./operational-assets-table"
import { OperationalExportButton } from "./operational-export-button"

export const metadata: Metadata = { title: "Control operacional" }

/**
 * Trinidad de permisos que dan acceso al centro. Coincide con la guardia de
 * `getOperationalControlHub` (lib/services/operational-control.ts). P-01:
 * antes el page sólo pedía `flota:view`, dejando afuera a usuarios que sólo
 * tenían `mantenciones:view` o `prevention:inspections:view`.
 */
const PERMISSIONS_FOR_PAGE = [
  "flota:view",
  "mantenciones:view",
  "prevention:inspections:view",
] as const

function formatKpi(value: number | null, suffix = "", precision = 1): string {
  if (value == null) return "Sin datos"
  return `${value.toLocaleString("es-CL", { maximumFractionDigits: precision })}${suffix}`
}

function sourceHealthVariant(status: string): "success" | "signal" | "outline" {
  if (status === "importado") return "success"
  if (status === "revertido") return "signal"
  return "outline"
}

export default async function OperationalControlPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try {
    session = await requireAuth()
  } catch {
    redirect("/forbidden")
  }
  if (!canAny(session, ...PERMISSIONS_FOR_PAGE)) redirect("/forbidden")

  const sp = await searchParams
  const period = resolveOperationalControlPeriod({
    from: typeof sp.desde === "string" ? sp.desde : undefined,
    to: typeof sp.hasta === "string" ? sp.hasta : undefined,
  })
  const data = await getOperationalControlHub(session, period)

  // B-04: la métrica de backlog en la tira editorial SÓLO cuenta OT de
  // vehículos (los instrumentos de servicio aún no modelan OT). Lo decimos
  // explícitamente en el label para no vender un universo que el modelo
  // todavía no soporta.
  const isDefaultPeriod = !sp.desde && !sp.hasta
  const defaultFrom = addDaysToPlainDate(todayInChile(), -89)
  const headerDescription = `Salud, trabajo pendiente y desempeño de activos entre ${formatDate(period.from)} y ${formatDate(period.to)}.`

  const availabilityTone =
    data.metrics.availabilityPercent == null
      ? "neutral"
      : data.metrics.availabilityPercent < 80
        ? "danger"
        : data.metrics.availabilityPercent < 90
          ? "signal"
          : "neutral"
  const preventiveTone =
    data.metrics.preventiveCompliancePercent == null
      ? "neutral"
      : data.metrics.preventiveCompliancePercent < 70
        ? "danger"
        : data.metrics.preventiveCompliancePercent < 90
          ? "signal"
          : "neutral"

  return (
    <PageContainer>
      <PageHeader
        title="Control operacional"
        description={headerDescription}
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional" }]} />}
        actions={
          <>
            <OperationalExportButton period={period} />
            {data.permissions.canViewMaintenance && (
              <Button asChild>
                <Link href="/mantenciones">Gestionar OT</Link>
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="pt-6">
          <form method="get" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
            <Field label="Desde" htmlFor="operational-from">
              <DatePicker id="operational-from" name="desde" defaultValue={period.from} />
            </Field>
            <Field label="Hasta" htmlFor="operational-to">
              <DatePicker id="operational-to" name="hasta" defaultValue={period.to} />
            </Field>
            <Button type="submit" className="self-end">
              Aplicar período
            </Button>
            {!isDefaultPeriod && (
              <Button asChild type="button" variant="ghost" className="self-end">
                <Link href="/control-operacional">
                  Restablecer
                  <span className="sr-only">
                    {" "}
                    (período por defecto {formatDate(defaultFrom)} – {formatDate(todayInChile())})
                  </span>
                </Link>
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={<ChartLineUp size={16} weight="duotone" />}
          label="Disponibilidad"
          value={formatKpi(data.metrics.availabilityPercent, "%")}
          detail={
            data.metrics.availabilityPercent == null
              ? "Sin datos en el período"
              : "Horas operativas vs. horas calendario"
          }
          glossary="Porcentaje de horas del período en que los vehículos se mantuvieron operativos. Sin vehículos activos o sin intervalos registrados, el indicador devuelve 'Sin datos' en lugar de 0%."
          tone={availabilityTone}
        />
        <KpiCard
          icon={<ClockClockwise size={16} weight="duotone" />}
          label="MTBF"
          value={formatKpi(data.metrics.mtbfHours, " h", 0)}
          detail="Tiempo medio entre fallas correctivas"
          glossary="MTBF (Mean Time Between Failures): horas operativas promedio entre dos mantenciones correctivas completadas dentro del período. Útil para comparar con la cadencia objetivo por equipo."
        />
        <KpiCard
          icon={<Wrench size={16} weight="duotone" />}
          label="MTTR"
          value={formatKpi(data.metrics.mttrHours, " h", 1)}
          detail="Tiempo medio de reparación"
          glossary="MTTR (Mean Time To Repair): horas promedio de detención por mantención correctiva completada en el período. Una cifra alta sugiere piezas, mano de obra o aprobaciones que están frenando el retorno a operación."
        />
        <KpiCard
          icon={<ShieldCheck size={16} weight="duotone" />}
          label="Cumplimiento preventivo"
          value={formatKpi(data.metrics.preventiveCompliancePercent, "%")}
          detail="OT preventivas completadas / programadas"
          glossary="Porcentaje de mantenciones preventivas no canceladas que se cerraron como completadas dentro del período. Bajo 70% abre una alerta para revisar capacidad del equipo de planificación."
          tone={preventiveTone}
        />
      </div>

      <div
        className="mb-4 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-xl border border-[var(--color-border)] bg-white px-5 py-3 text-sm"
        aria-label="Resumen editorial de operación"
      >
        <span>
          <strong>{formatKpi(data.metrics.downtimeHours, " h", 0)}</strong> de detención
        </span>
        <span>
          <strong>{data.metrics.backlog.toLocaleString("es-CL")}</strong> OT de vehículos abiertas
        </span>
        {data.permissions.canViewCosts && (
          <span>
            <strong>{formatCLP(data.metrics.maintenanceCost ?? 0)}</strong> en mantenciones
          </span>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Activos y trabajo del período</CardTitle>
          </CardHeader>
          <CardContent>
            <OperationalAssetsTable assets={data.assets} canViewCosts={data.permissions.canViewCosts} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            {/* B-02: el card listaba una sola fuente (`fuel_import`) pero su
                título decía "Salud de fuentes" (plural), lo que sugería
                también mantención e inspecciones. Ahora el título describe
                fielmente el contenido. */}
            <CardTitle as="h2">Última importación de combustible</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {data.sourceHealth.map((source) => (
                <li key={source.key} className="rounded-lg border border-[var(--color-border)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{source.label}</span>
                    <MetaBadge meta={{ label: `${source.statusLabel}`, variant: sourceHealthVariant(source.status) }} />
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{source.detail}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
                    {source.lastRunAt
                      ? `Última corrida: ${formatDateTime(source.lastRunAt)}`
                      : "Sin ejecución visible"}
                  </p>
                  {source.lastBatchId && can(session, "combustibles:view") && (
                    <Button asChild variant="link" size="sm" className="mt-1 h-auto p-0 text-xs">
                      <Link href="/combustibles/importar">
                        Ver detalle
                        <ArrowRight size={12} className="ml-1" />
                      </Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
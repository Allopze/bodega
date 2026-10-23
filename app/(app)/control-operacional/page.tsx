import type { ReactNode } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import {
  ArrowRight,
  Certificate,
  GasPump,
  Truck,
  Wrench,
} from "@phosphor-icons/react/dist/ssr"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { MetaBadge } from "@/components/states/state-badge"
import { KpiCard } from "@/components/ui/kpi-card"
import { SummaryBar } from "@/components/ui/summary-bar"
import { can, requireAuth } from "@/lib/auth/can"
import { loadRevisionCounts, type RevisionCounts } from "@/lib/combustibles/revision-counts"
import {
  getOperationalControlHub,
  resolveOperationalControlPeriod,
  type OperationalControlPeriod,
} from "@/lib/services/operational-control"
import { canViewOperationalControl } from "@/lib/operational-control/capabilities"
import { formatDate, formatDateTime } from "@/lib/utils"
import {
  documentsTile,
  fuelReviewTile,
  stoppedTile,
  workOrdersTile,
  type AttentionTile,
  type AttentionTileKey,
} from "./attention-tiles"
import { OperationalAssetsTable } from "./operational-assets-table"
import { OperationalExportButton } from "./operational-export-button"
import { buildPerformanceGlossary, buildPerformanceStats } from "./performance-stats"

export const metadata: Metadata = { title: "Panel operacional" }

const ATTENTION_ICONS: Record<AttentionTileKey, ReactNode> = {
  stopped: <Truck size={16} weight="duotone" />,
  workOrders: <Wrench size={16} weight="duotone" />,
  documents: <Certificate size={16} weight="duotone" />,
  fuel: <GasPump size={16} weight="duotone" />,
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
  if (!canViewOperationalControl(session)) redirect("/forbidden")

  const sp = await searchParams
  // Un rango invertido (desde > hasta) rompe `resolveOperationalControlPeriod`.
  // No se cae a la página de error ni se redirige en silencio: se muestra el
  // período por defecto y se avisa por qué, para que quien lo escribió sepa que
  // su rango no se aplicó.
  let period: OperationalControlPeriod
  let invalidRange = false
  try {
    period = resolveOperationalControlPeriod({
      from: typeof sp.desde === "string" ? sp.desde : undefined,
      to: typeof sp.hasta === "string" ? sp.hasta : undefined,
    })
  } catch {
    period = resolveOperationalControlPeriod()
    invalidRange = true
  }

  const canViewFuel = can(session, "combustibles:view")
  const [data, revisionCounts] = await Promise.all([
    getOperationalControlHub(session, period),
    // Las dos colas de «Revisión»: cada conteo cae a null por separado y el
    // tile lo dice. El `catch` es sólo una red: `loadRevisionCounts` ya los atrapa.
    canViewFuel
      ? loadRevisionCounts(session).catch((): RevisionCounts => ({ flagged: null, anomalies: null }))
      : Promise.resolve(null),
  ])

  // El período «por defecto» es el que resuelve el servicio sin parámetros, no
  // la ausencia de `desde`/`hasta` en la URL: enviar el formulario con las
  // fechas de siempre no es un período distinto.
  const defaultPeriod = resolveOperationalControlPeriod()
  const isDefaultPeriod = period.from === defaultPeriod.from && period.to === defaultPeriod.to
  const periodLabel = `${formatDate(period.from)} – ${formatDate(period.to)}`
  const headerDescription = `Qué requiere atención hoy en flota, mantención y combustible, y el desempeño de los activos entre ${formatDate(period.from)} y ${formatDate(period.to)}.`

  const { canViewFleet, canViewMaintenance, canViewInspections, canViewCosts } = data.permissions
  const fleetSize = data.assets.filter((asset) => asset.kind === "vehicle").length

  // Orden de lectura: lo que está parado, el trabajo abierto, los papeles y, al
  // final, el combustible. Cada tile existe sólo con la capacidad de su dominio.
  const attentionTiles: AttentionTile[] = [
    ...(canViewFleet ? [stoppedTile(data.attention.stoppedVehicles, fleetSize)] : []),
    ...(canViewMaintenance ? [workOrdersTile(data.attention.openWorkOrders)] : []),
    ...(canViewFleet ? [documentsTile(data.attention.fleetDocuments)] : []),
    ...(revisionCounts ? [fuelReviewTile(revisionCounts)] : []),
  ]

  const performanceStats = buildPerformanceStats(data.metrics, { canViewFleet, canViewMaintenance, canViewCosts })
  const glossary = buildPerformanceGlossary({ canViewFleet, canViewMaintenance })

  return (
    <PageContainer>
      <PageHeader
        title="Panel operacional"
        description={headerDescription}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Control operacional", href: "/control-operacional" },
            { label: "Panel operacional" },
          ]} />
        }
        actions={
          <>
            <OperationalExportButton period={period} />
            {canViewMaintenance && (
              <Button asChild>
                <Link href="/mantenciones">Gestionar OT</Link>
              </Button>
            )}
          </>
        }
      />

      {attentionTiles.length > 0 && (
        <section aria-labelledby="atencion-ahora" className="mb-5">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
            <h2 id="atencion-ahora" className="text-eyebrow">Requiere atención ahora</h2>
            <p className="text-xs text-[var(--color-text-subtle)]">
              Foto de hoy: el período de más abajo no cambia estas cifras.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {attentionTiles.map((tile) => (
              <KpiCard
                key={tile.key}
                icon={ATTENTION_ICONS[tile.key]}
                label={tile.label}
                value={tile.value}
                detail={tile.detail}
                tone={tile.tone}
                href={tile.href}
              />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="desempeno-periodo" className="mb-4 space-y-3">
        <div>
          <h2 id="desempeno-periodo" className="text-eyebrow">Desempeño del período</h2>
          <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
            {periodLabel}
            {isDefaultPeriod && " · últimos 90 días"}
          </p>
        </div>

        {invalidRange && (
          <Callout tone="warning">
            El rango pedido no es válido: el inicio no puede ser posterior al término. Se muestra el período por defecto.
          </Callout>
        )}

        <Card>
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
                      (período por defecto {formatDate(defaultPeriod.from)} – {formatDate(defaultPeriod.to)})
                    </span>
                  </Link>
                </Button>
              )}
            </form>
          </CardContent>
        </Card>

        <SummaryBar stats={performanceStats} />

        {glossary.length > 0 && (
          <details className="rounded-[var(--radius-lg)] border border-[var(--color-border)] px-3.5 py-2.5">
            <summary className="cursor-pointer list-none text-sm font-medium text-[var(--color-text)] [&::-webkit-details-marker]:hidden">
              Cómo se calculan estas cifras
            </summary>
            <dl className="mt-3 grid gap-3 md:grid-cols-2">
              {glossary.map((entry) => (
                <div key={entry.key}>
                  <dt className="text-sm font-medium text-[var(--color-text)]">{entry.term}</dt>
                  <dd className="mt-0.5 text-xs leading-relaxed text-[var(--color-text-muted)]">{entry.definition}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </section>

      {/* `grid-cols-1` (= `minmax(0, 1fr)`) bajo xl: con la pista `auto` la
          tabla de activos —que desplaza dentro de su `TableRoot`— ensanchaba
          la columna 296 px fuera del pozo a 768 y 1024 px. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Activos y trabajo del período</CardTitle>
          </CardHeader>
          <CardContent>
            <OperationalAssetsTable
              assets={data.assets}
              canViewCosts={canViewCosts}
              canViewMaintenance={canViewMaintenance}
              canViewInspections={canViewInspections}
            />
          </CardContent>
        </Card>
        {data.permissions.canViewFuelImport && (
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
                    {source.lastBatchId && can(session, "combustibles:import") && (
                      <Button asChild variant="link" size="sm" className="mt-1 h-auto p-0 text-xs">
                        <Link href={`/combustibles/importar/${source.lastBatchId}`}>
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
        )}
      </div>
    </PageContainer>
  )
}

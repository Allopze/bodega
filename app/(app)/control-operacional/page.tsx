import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowRight } from "@phosphor-icons/react/dist/ssr"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PeriodControl } from "@/components/ui/period-control"
import { MetaBadge } from "@/components/states/state-badge"
import { KpiCard } from "@/components/ui/kpi-card"
import { SummaryBar } from "@/components/ui/summary-bar"
import { can, requireAuth } from "@/lib/auth/can"
import { getFuelInboxPendingForSession } from "@/lib/combustibles/inbox/queries"
import { getTaeCopecReconciliation } from "@/lib/combustibles/tae-copec-reconciliation"
import {
  getOperationalControlHub,
  resolveOperationalControlPeriod,
  type OperationalControlPeriod,
} from "@/lib/services/operational-control"
import { getOperationalSourceHealth, type OperationalReconciliationHealth } from "@/lib/services/operational-control-sources"
import { canViewOperationalControl } from "@/lib/operational-control/capabilities"
import { formatDate, formatDateTime } from "@/lib/utils"
import {
  documentsTile,
  fuelReviewTile,
  stoppedTile,
  workOrdersTile,
  type AttentionTile,
  type FuelPendingCounts,
} from "./attention-tiles"
import { OperationalAssetsTable } from "./operational-assets-table"
import { OperationalExportButton } from "./operational-export-button"
import { GpsCrossChecks } from "./gps-cross-checks"
import { buildPerformanceGlossary, buildPerformanceStats } from "./performance-stats"

export const metadata: Metadata = { title: "Panel operacional" }

/** Ninguna de las cuatro colas de «Por revisar» se pudo contar: el tile lo dice en vez de pintar 0. */
const NO_FUEL_COUNTS: FuelPendingCounts = { carga: null, caso: null, patente: null, pedido: null }

/** Una frase para la conciliación: no pinta un cero ni omite una excepción aceptada. */
function reconciliationText(reconciliation: OperationalReconciliationHealth): string {
  const parts: string[] = []
  if (reconciliation.unmatched > 0) parts.push(reconciliation.unmatched === 1 ? "1 sin resolver" : `${reconciliation.unmatched} sin resolver`)
  if (reconciliation.ambiguous > 0) parts.push(reconciliation.ambiguous === 1 ? "1 ambiguo" : `${reconciliation.ambiguous} ambiguos`)
  if (reconciliation.openRejections > 0) parts.push(reconciliation.openRejections === 1 ? "1 rechazo abierto" : `${reconciliation.openRejections} rechazos abiertos`)
  if (reconciliation.acceptedExceptions > 0) parts.push(reconciliation.acceptedExceptions === 1 ? "1 excepción aceptada" : `${reconciliation.acceptedExceptions} excepciones aceptadas`)
  return parts.length === 0 ? "Conciliación al día (hoy)." : `Conciliación (hoy): ${parts.join(" · ")}.`
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
  const revision = sp.revision === "medidor-gps" ? "medidor-gps" : undefined
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
  // La pantalla de Fuentes exige poder importar o sincronizar; sin eso, la
  // tarjeta resume pero no ofrece un enlace que terminaría en /forbidden.
  const canViewFuelSources = can(session, "combustibles:import")
    || can(session, "combustibles:tae_import")
    || can(session, "combustibles:sync_integrations")
  // Cruce de otro subdominio: cobertura de los dos canales de Copec del período
  // (requiere `combustibles:tae_view`). Las licencias de conducir ya no se
  // cuentan aquí: viven en Conductores.
  const canViewTae = can(session, "combustibles:tae_view")
  const [data, fuelPending, sourceHealth, taeCoverage] = await Promise.all([
    getOperationalControlHub(session, period),
    // Las cuatro colas de «Por revisar», las mismas que cuenta el menú y la
    // bandeja: cada tipo cae a null por separado y el tile lo dice. El `catch`
    // es sólo una red: `getFuelInboxPendingByKind` ya atrapa cada uno.
    canViewFuel
      ? getFuelInboxPendingForSession(session).catch((): FuelPendingCounts => NO_FUEL_COUNTS)
      : Promise.resolve(null),
    // La tarjeta de fuentes reutiliza el mismo read model de /combustibles/fuentes.
    canViewFuel
      ? getOperationalSourceHealth(session, period).catch(() => null)
      : Promise.resolve(null),
    canViewTae
      ? getTaeCopecReconciliation(session, { from: period.from, to: period.to })
          .then((result) => result.summary)
          .catch(() => null)
      : Promise.resolve(null),
  ])

  // El período «por defecto» es el que resuelve el servicio sin parámetros, no
  // la ausencia de `desde`/`hasta` en la URL: enviar el formulario con las
  // fechas de siempre no es un período distinto.
  const defaultPeriod = resolveOperationalControlPeriod()
  const isDefaultPeriod = period.from === defaultPeriod.from && period.to === defaultPeriod.to
  const periodLabel = `${formatDate(period.from)} – ${formatDate(period.to)}`
  // El período no va en la descripción: la cabecera la corta a dos líneas y el
  // rango quedaba truncado a mitad de fecha. Lo dice el selector del header y el
  // rótulo de «Desempeño del período».
  const headerDescription = "Qué requiere atención hoy en flota y combustible, y el desempeño de los vehículos en el período elegido."

  const { canViewFleet, canViewInspections, canViewCapa, canViewCosts, canViewServiceEquipment, canViewWorkOrders, canViewPurchaseCosts, canViewMaintenance } = data.permissions
  // Secciones que pueden degradarse: documentos, ajustes de flota y GPS (sólo
  // con flota), OT (con su capacidad), combustible y compras vinculadas (con
  // `purchasing:view`). El denominador se deriva de las secciones realmente
  // consultadas; antes era un 4 fijo.
  const degradedTotal = (canViewFleet ? 5 + (canViewMaintenance ? 1 : 0) : 0) + (canViewWorkOrders ? 1 : 0) + (canViewFuel ? 1 : 0) + (canViewPurchaseCosts ? 1 : 0)
  const operationalAssets = data.assets.filter((asset) => asset.kind === "vehicle")
  const visibleAssets = revision === "medidor-gps"
    ? operationalAssets.filter((asset) => asset.meterMismatch)
    : operationalAssets
  const fleetSize = operationalAssets.length
  const stateMismatchAssets = operationalAssets.filter((asset) => asset.stateMismatch)
  const serviceEquipmentCount = data.assets.filter((asset) => asset.kind === "service_equipment").length

  // Orden de lectura: lo que está parado y el trabajo que lo atiende, los papeles y, al final, el combustible. Cada tile existe sólo con la capacidad de su dominio.
  const attentionTiles: AttentionTile[] = [
    ...(canViewFleet ? [stoppedTile(data.attention.stoppedVehicles, fleetSize)] : []),
    ...(canViewWorkOrders ? [workOrdersTile(data.attention.workOrders)] : []),
    ...(canViewFleet ? [documentsTile(data.attention.fleetDocuments)] : []),
    ...(fuelPending ? [fuelReviewTile(fuelPending)] : []),
  ]

  const performanceStats = buildPerformanceStats(data.metrics, {
    canViewFleet,
    canViewWorkOrders,
  })
  const glossary = buildPerformanceGlossary({
    canViewFleet,
    canViewInspections,
    canViewCapa,
    canViewFuel,
    canViewCosts,
    canViewWorkOrders,
    canViewPurchaseCosts,
    canViewTaeCoverage: canViewTae,
    canViewMaintenance,
  })

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
        actions={<OperationalExportButton period={period} />}
      />

      {data.degradedSources.length > 0 && (
        <div className="mb-4">
          <DegradedDataBanner degraded={data.degradedSources} total={degradedTotal} />
        </div>
      )}

      {/* Lo de hoy va arriba y con su propio encabezado: el selector de período
          vive más abajo, en la zona que gobierna, así que ninguna nota tiene que
          avisar que estas cifras no cambian con él. */}
      {attentionTiles.length > 0 && (
        <section aria-labelledby="atencion-ahora" className="mb-5">
          <h2 id="atencion-ahora" className="text-eyebrow mb-2">Requiere atención ahora</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {attentionTiles.map((tile) => (
              // Sin ícono: la etiqueta ya dice de qué es la cifra (auditoría 2026-11-13, P6).
              <KpiCard
                key={tile.key}
                icon={null}
                label={tile.label}
                value={tile.value}
                valueKind={tile.valueKind}
                detail={tile.detail}
                tone={tile.tone}
                href={tile.href}
              />
            ))}
          </div>
        </section>
      )}

      {canViewFleet && stateMismatchAssets.length > 0 && (
        <div className="mb-4">
          <Callout tone="warning">
            {stateMismatchAssets.length === 1 ? "1 vehículo tiene" : `${stateMismatchAssets.length} vehículos tienen`} un
            estado distinto entre su ficha y el último intervalo operacional:{" "}
            {/* Sin un filtro de «discrepancia» en /flota, el aviso nombra los
                vehículos para que se puedan buscar por su código. */}
            {stateMismatchAssets.slice(0, 6).map((asset) => asset.code).join(", ")}
            {stateMismatchAssets.length > 6 && ` y ${stateMismatchAssets.length - 6} más`}.{" "}
            <Link href="/flota?revision=estado" className="underline underline-offset-4">Revisar en Vehículos</Link>.
          </Callout>
        </div>
      )}

      {/* Desde aquí, todo depende del período elegido. */}
      <section aria-labelledby="desempeno-periodo" className="mb-4 space-y-3 border-t border-[var(--color-border)] pt-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div>
            <h2 id="desempeno-periodo" className="text-eyebrow">Desempeño del período</h2>
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
              {periodLabel}
              {isDefaultPeriod && " · últimos 90 días"}
            </p>
          </div>
          <PeriodControl
            mode="range"
            from={period.from}
            to={period.to}
            defaultRange={{ ...defaultPeriod, label: "los últimos 90 días" }}
          />
        </div>

        {invalidRange && (
          <Callout tone="warning">
            El rango pedido no es válido: el inicio no puede ser posterior al término. Se muestra el período por defecto.
          </Callout>
        )}

        {performanceStats.length > 0 && (
          // Una tira de texto, no tiles: tres cifras que no mueven ninguna decisión
          // por sí solas no merecen una fila de tarjetas (A1). `justify-start`
          // porque la tira compacta se alinea a la derecha para el TopBar.
          <SummaryBar compact stats={performanceStats} className="justify-start text-sm" />
        )}

        {glossary.length > 0 && (
          <details className="rounded-[var(--radius-lg)] border border-[var(--color-border)] px-3.5 py-2.5">
            <summary className="cursor-pointer list-none text-sm font-medium text-[var(--color-text)] [&::-webkit-details-marker]:hidden">
              Cómo se calculan estas cifras
            </summary>
            <p className="mt-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
              Este panel mide el período que elijas. El Tablero usa el mes calendario y, en combustible, seis meses
              fijos: las cifras no son comparables entre pantallas.
            </p>
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

      {canViewFleet && (
        <GpsCrossChecks
          data={data.gpsCross}
          period={period}
          canViewFuel={canViewFuel}
          canViewMaintenance={canViewMaintenance}
          canViewPurchaseCosts={canViewPurchaseCosts}
          canViewCosts={canViewCosts}
          canViewWorkOrders={canViewWorkOrders}
          canViewCapa={canViewCapa}
          canViewInspections={canViewInspections}
          degradedSources={data.degradedSources}
          channelCoverage={taeCoverage}
        />
      )}

      {/* `grid-cols-1` (= `minmax(0, 1fr)`) bajo xl: con la pista `auto` la
          tabla de vehículos —que desplaza dentro de su `TableRoot`— ensanchaba
          la columna 296 px fuera del pozo a 768 y 1024 px. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Vehículos y estado operacional</CardTitle>
          </CardHeader>
          <CardContent>
            {revision === "medidor-gps" && (
              <div className="mb-3">
                <Callout tone="warning">
                  Mostrando {visibleAssets.length === 1 ? "1 vehículo" : `${visibleAssets.length} vehículos`} con discrepancia
                  entre la última carga y la lectura GPS del mismo medidor.{" "}
                  <Link
                    href={`/control-operacional?desde=${period.from}&hasta=${period.to}`}
                    className="underline underline-offset-4"
                  >
                    Quitar filtro
                  </Link>.
                </Callout>
              </div>
            )}
            <OperationalAssetsTable
              // En la revisión de medidores la columna «Discrepancia GPS» es el
              // motivo de la lista: se remonta para que arranque visible.
              key={revision ?? "todos"}
              assets={visibleAssets}
              canViewCosts={canViewCosts}
              canViewInspections={canViewInspections}
              canViewCapa={canViewCapa}
              canViewFuel={canViewFuel}
              canViewFleet={canViewFleet}
              canViewWorkOrders={canViewWorkOrders}
              canViewPurchaseCosts={canViewPurchaseCosts}
              canViewMaintenance={canViewMaintenance}
              showMeterMismatch={revision === "medidor-gps"}
            />
            {canViewServiceEquipment && serviceEquipmentCount > 0 && (
              <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                Instrumentos de servicio: {serviceEquipmentCount}.{" "}
                <Link href="/admin/equipos" className="text-[var(--color-primary-ink)] underline-offset-4 hover:underline">
                  Ver en Administración
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
        {sourceHealth && (
          <Card>
            <CardHeader>
              <CardTitle as="h2">Fuentes de combustible</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* El texto y la insignia no dicen lo mismo dos veces: la frase cuenta,
                  la insignia da el veredicto. */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {sourceHealth.pending.length > 0
                    ? `${sourceHealth.pending.length} de ${Math.max(sourceHealth.total, sourceHealth.pending.length)} con pendientes`
                    : sourceHealth.total === 0
                      ? "Sin fuentes visibles"
                      : sourceHealth.ready
                        ? "Todas reciben datos"
                        : "Sin datos del período"}
                </span>
                {sourceHealth.total > 0 && (
                  <MetaBadge meta={{
                    label: sourceHealth.ready ? "Al día" : sourceHealth.pending.length > 0 ? "Revisar" : "Sin datos",
                    variant: sourceHealth.ready ? "success" : sourceHealth.pending.length > 0 ? "signal" : "neutral",
                  }} />
                )}
              </div>

              {sourceHealth.lastUpdateAt && (
                <p className="text-xs text-[var(--color-text-subtle)]">
                  Última actualización:{" "}
                  <span className="font-mono">{formatDateTime(sourceHealth.lastUpdateAt)}</span>
                </p>
              )}

              {sourceHealth.pending.length > 0 && (
                <ul className="space-y-2 text-xs">
                  {sourceHealth.pending.slice(0, 3).map((source) => (
                    <li key={source.key}>
                      <p className="font-medium text-[var(--color-text)]">{source.name}</p>
                      <p className="text-[var(--color-text-muted)]">{source.problem ?? source.statusLabel}</p>
                      {source.problemLink && (
                        <Link
                          href={source.problemLink.href}
                          className="text-[var(--color-primary-ink)] underline-offset-4 hover:underline"
                        >
                          {source.problemLink.label}
                        </Link>
                      )}
                    </li>
                  ))}
                  {sourceHealth.pending.length > 3 && (
                    <li className="text-[var(--color-text-subtle)]">
                      También: {sourceHealth.pending.slice(3).map((source) => source.name).join(", ")}.
                    </li>
                  )}
                </ul>
              )}

              {sourceHealth.reconciliation ? (
                <p className={
                  sourceHealth.reconciliation.unmatched + sourceHealth.reconciliation.ambiguous + sourceHealth.reconciliation.openRejections > 0
                    ? "text-xs text-[var(--color-signal-ink)]"
                    : "text-xs text-[var(--color-text-muted)]"
                }>
                  {reconciliationText(sourceHealth.reconciliation)}
                </p>
              ) : (
                <p className="text-xs text-[var(--color-text-subtle)]">Conciliación: sin dato.</p>
              )}

              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {canViewFuelSources && (
                  <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
                    <Link href={`/combustibles/fuentes?desde=${period.from}&hasta=${period.to}`}>
                      Ver todas las fuentes
                      <ArrowRight size={12} className="ml-1" />
                    </Link>
                  </Button>
                )}
                <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
                  <Link href={`/combustibles/cuadratura?desde=${period.from}&hasta=${period.to}`}>
                    Ver conciliación
                    <ArrowRight size={12} className="ml-1" />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </PageContainer>
  )
}

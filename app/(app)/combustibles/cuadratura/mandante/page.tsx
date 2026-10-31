import type { Metadata } from "next"
import type { ReactNode } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Gear } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SectionNav } from "@/components/ui/section-nav"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { can, requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getMandantesReconciliation } from "@/lib/combustibles/control/queries/reconciliation-summary"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { FUEL_PATHS, withFuelContext } from "@/lib/combustibles/routes"
import { FUEL_CARRY_PARAMS, cuadraturaNavItems } from "@/lib/combustibles/section-nav"
import { ControlFilters } from "../../control/_components/control-filters"
import { loadCuadraturaContext } from "../_components/context"
import { firstParam, hrefWith, periodContext } from "../_components/params"
import { wholeMonthsNote, wholeMonthsPhrase } from "../_components/period-text"
import { ControlSection, SectionError } from "../_components/section"
import { createSourceTracker } from "../_components/track"
import { MandanteMonths, MandantesTable, WhatToCheck, mandanteAnswer } from "./mandante-sections"

export const metadata: Metadata = { title: "Cuadratura por mandante" }

type SearchParams = Record<string, string | string[] | undefined>

const PATH = FUEL_PATHS.cuadraturaMandante

export default async function CuadraturaMandantePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:tae_view", PATH) } catch { redirect("/forbidden") }
  const sp = await searchParams
  const period = await resolveFuelPeriodForPage(session, sp)
  const worksiteId = firstParam(sp, "faena")
  const ctxParams = periodContext(period, worksiteId)
  const mandanteId = firstParam(sp, "mandante")
  const equipment = firstParam(sp, "equipo")
  const ctx = await loadCuadraturaContext(session)
  const canManage = can(session, "combustibles:manage_control")
  const canSources = can(session, "combustibles:import") || can(session, "combustibles:tae_import") || can(session, "combustibles:sync_integrations")
  const partialScope = resolveWorksiteScope(session).mode !== "all"

  const chrome = (children: ReactNode) => (
    <PageContainer>
      <PageHeader
        title="Cuadratura por mandante"
        description="Lo que entró contra lo que se entregó a equipos, medido contra la tolerancia de cada mandante"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Cuadratura", href: FUEL_PATHS.cuadratura }, { label: "Por mandante" }]} />}
        actions={<FuelHeaderActions period={period} />}
      />
      <SectionNav items={cuadraturaNavItems(session)} activeKey="mandante" ariaLabel="Vistas de cuadratura" carryParams={FUEL_CARRY_PARAMS} />
      {children}
    </PageContainer>
  )

  if (ctx.mandantes.length === 0) {
    return chrome(
      <EmptyState
        title="Aún no hay mandantes configurados"
        description={canManage
          ? "Un mandante agrupa faenas y define la tolerancia con que se cuadra lo que entra y lo que se entrega. Crea el primero para ver esta vista."
          : "Un mandante agrupa faenas y define la tolerancia con que se cuadra lo que entra y lo que se entrega. Pide a quien administra el control de combustible que configure los mandantes."}
        action={canManage ? <Button asChild><Link href={FUEL_PATHS.ajustesMandantes}><Gear size={16} className="mr-1" />Configurar mandantes</Link></Button> : <Button asChild variant="secondary"><Link href={withFuelContext(FUEL_PATHS.cargas, ctxParams)}>Ver las cargas del período</Link></Button>}
      />,
    )
  }
  if (mandanteId && !ctx.mandantes.some((item) => item.id === mandanteId)) {
    return chrome(
      <EmptyState
        title="Ese mandante ya no existe o está inactivo"
        description="El enlace apunta a un mandante que no está disponible. Elige otro en los filtros o vuelve a ver todos los de tu alcance."
        action={<Button asChild variant="secondary"><Link href={hrefWith(PATH, sp, { mandante: null })}>Ver todos los mandantes</Link></Button>}
      />,
    )
  }

  const { track, degraded, total } = createSourceTracker("cuadratura-mandante")
  const result = await track(getMandantesReconciliation(session, period, { worksiteId, mandanteId }), null, "cuadratura por mandante")
  const data = result.data
  const rows = data?.rows ?? []
  const selected = rows.find((row) => row.mandanteId === mandanteId) ?? rows[0] ?? null
  const note = wholeMonthsNote(period)
  const phrase = wholeMonthsPhrase(period)

  return chrome(
    <>
      <DegradedDataBanner degraded={degraded} total={total()} />
      <ControlFilters worksites={ctx.worksites} mandantes={ctx.mandantes} extraKeys={["equipo"]} />

      {note ? <Callout tone="info" className="mb-4">{note}</Callout> : null}
      {equipment ? (
        <Callout tone="info" className="mb-4">
          El detalle por equipo ahora está en <Link className="font-medium underline underline-offset-4" href={withFuelContext(`${FUEL_PATHS.cuadraturaSellos}?vista=detalle&equipo=${encodeURIComponent(equipment)}`, ctxParams)}>Sellos</Link>; aquí la cuadratura se mide por mandante.
        </Callout>
      ) : null}

      {result.failed ? (
        <SectionError what="la cuadratura por mandante" />
      ) : rows.length === 0 ? (
        <EmptyState
          title={worksiteId ? "Ningún mandante tiene esa faena" : "Ningún mandante tiene faenas a tu alcance"}
          description={worksiteId ? "Esa faena no pertenece a ningún mandante, así que no hay nada que cuadrar. Quita el filtro de faena o asígnala a un mandante." : "Un mandante agrupa faenas; sin ellas no hay entradas ni entregas que comparar."}
          action={<Button asChild variant="secondary"><Link href={worksiteId ? hrefWith(PATH, sp, { faena: null }) : withFuelContext(FUEL_PATHS.cargas, ctxParams)}>{worksiteId ? "Ver todas las faenas" : "Ver las cargas del período"}</Link></Button>}
        />
      ) : (
        <div className="space-y-8">
          <p className="max-w-3xl text-base text-[var(--color-text)]" data-testid="mandante-answer">
            {mandanteAnswer(rows, phrase)}
            {partialScope ? <span className="text-[var(--color-text-muted)]"> Sólo cuentan las faenas de tu alcance.</span> : null}
          </p>

          <MandantesTable rows={rows} selectedId={selected?.mandanteId ?? null} hrefFor={(id) => hrefWith(PATH, sp, { mandante: id, pagina: null })} />

          {selected ? (
            <ControlSection
              id="mes-a-mes"
              title={`${selected.name}, mes a mes`}
              question={rows.length > 1 && !mandanteId ? "Se muestra el que más se aleja; elige otro mandante en el filtro o en la tabla para ver el suyo." : "Cada mes contra la tolerancia del mandante."}
            >
              <div className={selected.overTolerance ? "grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : undefined}>
                <MandanteMonths row={selected} />
                {selected.overTolerance ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Qué mirar si no cuadra</CardTitle>
                      <CardDescription>Lugares donde suele estar la diferencia.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <WhatToCheck
                        row={selected}
                        links={{
                          cargas: withFuelContext(`${FUEL_PATHS.cargas}?como=qr,app,historico`, ctxParams),
                          fuentes: canSources ? withFuelContext(FUEL_PATHS.fuentes, ctxParams) : null,
                          estanques: withFuelContext(FUEL_PATHS.cuadraturaEstanques, ctxParams),
                        }}
                      />
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            </ControlSection>
          ) : null}
        </div>
      )}
    </>,
  )
}

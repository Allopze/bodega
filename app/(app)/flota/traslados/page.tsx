import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { PeriodControl } from "@/components/ui/period-control"
import { ExportButton } from "@/components/ui/export-button"
import { TransferButton } from "@/components/fleet/transfer/transfer-button"
import { can, requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope, serviceWorksiteScope } from "@/lib/auth/scope"
import { listTransfers } from "@/lib/services/fleet-transfers"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { listVisibleWorksites } from "@/lib/services/prevention-indicadores"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { exportTransfersAction } from "./actions"
import { TransferFilters } from "./transfer-filters"
import { TransfersTable } from "./transfers-table"

export const metadata: Metadata = { title: "Traslados" }

type SearchParams = Record<string, string | string[] | undefined>

/** Desde cuándo mira «Ver todos los traslados»: antes de que existiera la plataforma. */
const ALL_TIME_FROM = "2000-01-01"

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/
const isPlainDate = (value: unknown): value is string =>
  typeof value === "string" && PLAIN_DATE.test(value) && addDaysToPlainDate(value, 0) === value

/** Por defecto, el año en curso hasta hoy; un rango roto o invertido en la URL vuelve a ese valor. */
function resolvePeriod(params: SearchParams, today: string): { from: string; to: string; defaults: { from: string; to: string } } {
  const defaults = { from: `${today.slice(0, 4)}-01-01`, to: today }
  const from = isPlainDate(params.desde) ? params.desde : defaults.from
  const to = isPlainDate(params.hasta) ? params.hasta : defaults.to
  return from <= to ? { from, to, defaults } : { ...defaults, defaults }
}

export default async function TransfersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("flota:view") }
  catch { redirect("/forbidden") }
  // Apagado de fábrica: lo enciende un administrador. Sin el interruptor la pantalla no existe para nadie.
  if (!(await isRouteOperational("/flota/traslados"))) redirect("/flota")

  const params = await searchParams
  const today = todayInChile()
  const { from, to, defaults } = resolvePeriod(params, today)
  const worksites = await listVisibleWorksites(resolveWorksiteScope(session))
  // Una faena fuera del alcance (o inventada en la URL) se ignora.
  const requested = typeof params.faena === "string" ? params.faena : ""
  const worksiteId = worksites.some((site) => site.id === requested) ? requested : ""

  const filters = { from, to, ...(worksiteId ? { worksiteId } : {}) }
  const rows = await listTransfers(serviceWorksiteScope(session), filters)
  const canTransfer = can(session, "flota:transfer")
  // Una lista vacía puede ser «aún no hay ninguno» o «los filtros lo esconden» (el período por defecto es el
  // año en curso: en enero el año pasado no se ve). Sólo con la lista vacía se mira todo el historial.
  const hiddenByFilters = rows.length === 0
    && (await listTransfers(serviceWorksiteScope(session), { from: ALL_TIME_FROM, to: today })).length > 0

  return (
    <PageContainer>
      <PageHeader
        title="Traslados"
        description="Equipos trasladados entre faenas, con su fecha, motivo y quién lo autorizó."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Control operacional", href: "/control-operacional" },
            { label: "Vehículos", href: "/flota" },
            { label: "Traslados" },
          ]} />
        }
        actions={<div className="flex flex-wrap items-center gap-2">
          <PeriodControl mode="range" from={from} to={to} defaultRange={{ ...defaults, label: "este año" }} />
          {can(session, "flota:export") && <ExportButton action={exportTransfersAction} filters={filters} />}
          {canTransfer && <TransferButton />}
        </div>}
      />
      <TransferFilters worksiteId={worksiteId} worksites={worksites} />
      <TransfersTable rows={rows} canTransfer={canTransfer} showAllHref={hiddenByFilters ? `/flota/traslados?desde=${ALL_TIME_FROM}` : undefined} />
    </PageContainer>
  )
}

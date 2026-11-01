import type { ReactNode } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { MetaBadge } from "@/components/states/state-badge"
import { Card, CardTitle } from "@/components/ui/card"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { AramcoCredentials } from "./aramco-credentials"
import { cronOutcomeBadge, lastRunText, type IntegrationRun } from "./integration-status"
import { loadIntegrationsData } from "./integrations-data"

export const metadata: Metadata = { title: "Integraciones" }

function IntegrationCard({ id, title, summary, run, runsFailed, children }: {
  id: string
  title: string
  summary: string
  run: IntegrationRun | null
  runsFailed: boolean
  children?: ReactNode
}) {
  const badge = runsFailed ? { label: "No se pudo leer", variant: "neutral" as const } : cronOutcomeBadge(run?.outcome)
  return (
    <Card role="region" aria-labelledby={`${id}-title`} className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <CardTitle as="h2" id={`${id}-title`}>{title}</CardTitle>
        <MetaBadge meta={badge} />
      </div>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">{summary}</p>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">{runsFailed ? "No se pudo leer cuándo corrió por última vez." : lastRunText(run)}</p>
      <div className="mt-5">{children}</div>
    </Card>
  )
}

export default async function AjustesIntegracionesPage() {
  let session
  try { session = await requirePermission("combustibles:manage_integrations", FUEL_PATHS.ajustes) } catch { redirect("/forbidden") }

  const data = await loadIntegrationsData()
  const canSeeSources = can(session, "combustibles:sync_integrations") || can(session, "combustibles:import") || can(session, "combustibles:tae_import")

  return (
    <PageContainer>
      <PageHeader
        title="Integraciones"
        description="Copec, Aramco y VisionLink"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Ajustes", href: FUEL_PATHS.ajustes }, { label: "Integraciones" }]} />}
        actions={<FuelHeaderActions />}
      />
      <div className="space-y-4">
        <DegradedDataBanner degraded={Array.from({ length: data.degraded }, () => "fuente")} total={3} />
        <p className="max-w-3xl text-sm text-[var(--color-text-muted)]">
          Credenciales y actualización automática de los proveedores. Cada mañana la plataforma lee lo nuevo, sin descargar planillas.
          {canSeeSources ? <> Para actualizar a mano o ver mes por mes lo que llegó, entra a <Link href={FUEL_PATHS.fuentes} className="font-medium text-[var(--color-primary-ink)] underline underline-offset-2">Fuentes de datos</Link>.</> : null}
        </p>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <IntegrationCard
            id="int-aramco"
            title="Aramco"
            summary="Se actualiza cada mañana hacia las 05:45, con la cuenta de la empresa en el portal de Aramco."
            run={data.runs.aramco}
            runsFailed={data.runsFailed}
          >
            <AramcoCredentials status={data.aramco} configuredAt={data.aramcoConfiguredAt} />
          </IntegrationCard>

          <div className="space-y-4">
            <IntegrationCard
              id="int-copec"
              title="Copec"
              summary="Se actualiza cada mañana hacia las 05:30, leyendo el servicio web de Copec."
              run={data.runs.copec}
              runsFailed={data.runsFailed}
            >
              <p className="text-sm text-[var(--color-text-muted)]">Las credenciales de Copec se configuran en el servidor; aquí no se editan.</p>
            </IntegrationCard>

            <IntegrationCard
              id="int-visionlink"
              title="VisionLink"
              summary="Se actualiza cada mañana hacia las 06:00 con la telemetría de los equipos: horas de motor y motor en vacío de los últimos 14 días."
              run={data.runs.visionlink}
              runsFailed={data.runsFailed}
            >
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-[var(--color-text-subtle)]">Credenciales</dt>
                  <dd className="text-[var(--color-text)]">{data.visionlink.hasCredentials ? "Configuradas en el servidor" : "Sin configurar"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-text-subtle)]">Actualización diaria</dt>
                  <dd className="text-[var(--color-text)]">{data.visionlink.syncEnabled ? "Activada" : "Desactivada"}</dd>
                </div>
              </dl>
              <p className="mt-3 text-sm text-[var(--color-text-muted)]">Se activa y se cambia en la configuración del servidor; aquí no hay interruptor.</p>
            </IntegrationCard>
          </div>
        </div>
      </div>
    </PageContainer>
  )
}

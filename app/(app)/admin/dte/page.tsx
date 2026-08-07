import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { desc } from "drizzle-orm"
import { db } from "@/db"
import { dteSyncRuns } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { readDtePortalConfig } from "@/lib/services/dte-portal/config"
import { hasStoredDteSettings } from "@/lib/services/dte-portal/settings"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { DteCredentialsForm } from "./credentials-form"
import { DteSyncActions, DteForceSyncControl } from "./dte-sync-actions"
import { DteSyncList } from "./dte-sync-list"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Sincronización DTE" }

const DTE_BREADCRUMBS = (
  <Breadcrumbs items={[
    { label: "Inicio", href: "/dashboard" },
    { label: "Administración", href: "/admin" },
    { label: "Sincronización DTE" },
  ]} />
)

const DTE_ACTIONS = <DteSyncActions />

export default async function DtePage() {
  try { await requirePermission("admin:dte_sync") }
  catch { redirect("/forbidden") }

  const [runs, config, hasStored] = await Promise.all([
    db.query.dteSyncRuns.findMany({
      orderBy: [desc(dteSyncRuns.startedAt)],
      limit: 30,
    }),
    readDtePortalConfig(),
    hasStoredDteSettings(),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Sincronización DTE"
        description="Documentos tributarios recibidos de proveedores (Bandeja de Entrada del portal DTE FacturaEnLínea). Solo lectura: nunca acepta ni rechaza documentos en el portal."
        breadcrumb={DTE_BREADCRUMBS}
        actions={DTE_ACTIONS}
      />

      {!config.syncEnabled && (
        <section role="alert" className="mb-5 rounded-[var(--radius-xl)] border border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-4 text-[var(--color-warning-ink)]">
          <h2 className="font-semibold">La sincronización no está habilitada</h2>
          <p className="mt-1 text-sm">Configure las credenciales del portal abajo y active la sincronización, o use las variables de entorno (<code>DTE_PORTAL_*</code> y <code>DTE_SYNC_ENABLED=true</code>).</p>
        </section>
      )}

      <DteCredentialsForm initial={config} hasStored={hasStored} />

      <div className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-h2 text-[var(--color-text)]">Historial de sincronización</h2>
          <DteForceSyncControl />
        </div>
        <DteSyncList runs={runs} />
      </div>
    </PageContainer>
  )
}

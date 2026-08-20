import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { desc } from "drizzle-orm"
import { db } from "@/db"
import { dteSyncRuns } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { readDtePortalAdminStatus } from "@/lib/services/dte-portal/settings"
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

/**
 * Release que clasifica y redacta el error antes de persistirlo
 * (`classifyDteFailure`, 2026-08-11). Las corridas anteriores pueden llevar
 * payload crudo del portal, así que su motivo no se muestra en pantalla.
 */
const REDACTED_ERROR_SINCE = "2026-08-11"

export default async function DtePage() {
  try { await requirePermission("admin:dte_sync") }
  catch { redirect("/forbidden") }

  const [runs, status] = await Promise.all([
    db.query.dteSyncRuns.findMany({
      orderBy: [desc(dteSyncRuns.startedAt)],
      limit: 30,
      // Las filas anteriores a la release que redacta pueden traer payload
      // crudo del portal: se seleccionan igual, pero sólo se envían al cliente
      // las posteriores (ver REDACTED_ERROR_SINCE). Sin el motivo, la alerta
      // manda a una pantalla donde no se puede diagnosticar nada.
      columns: {
        id: true,
        error: true,
        periodo: true,
        trigger: true,
        status: true,
        reconciliationStatus: true,
        reconciliationError: true,
        rowsSeen: true,
        rowsInserted: true,
        rowsUpdated: true,
        startedAt: true,
        finishedAt: true,
      },
    }),
    readDtePortalAdminStatus(),
  ])

  const runRows = runs.map((run) => ({
    ...run,
    error: run.startedAt >= REDACTED_ERROR_SINCE ? run.error : null,
  }))

  return (
    <PageContainer>
      <PageHeader
        title="Sincronización DTE"
        description="Documentos tributarios recibidos de proveedores (Bandeja de Entrada del portal DTE FacturaEnLínea). Solo lectura: nunca acepta ni rechaza documentos en el portal."
        breadcrumb={DTE_BREADCRUMBS}
        actions={DTE_ACTIONS}
      />

      {!status.syncEnabled && (
        <section role="alert" className="mb-5 rounded-[var(--radius-xl)] border border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-4 text-[var(--color-warning-ink)]">
          <h2 className="font-semibold">La sincronización no está habilitada</h2>
          <p className="mt-1 text-sm">Configure los campos faltantes abajo y active la sincronización. Los valores ya existentes no se exponen en esta pantalla.</p>
        </section>
      )}

      {!status.canStoreSecrets && status.encryptionMode !== "configuration_error" && (
        <section role="alert" className="mb-5 rounded-[var(--radius-xl)] border border-[var(--color-danger)] bg-[var(--color-danger-tint)] p-4 text-[var(--color-danger-ink)]">
          <h2 className="font-semibold">No hay keyring de cifrado configurado</h2>
          <p className="mt-1 text-sm">
            Sin <code>DTE_SETTINGS_KEYRING</code> en el servidor no se puede guardar ninguna credencial:
            el guardado se rechaza en vez de persistir la contraseña del portal en texto plano.
            Provisione el keyring en el host antes de configurar estos campos.
          </p>
        </section>
      )}

      <DteCredentialsForm status={status} />

      <div className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-h2 text-[var(--color-text)]">Historial de sincronización</h2>
          <DteForceSyncControl />
        </div>
        <DteSyncList runs={runRows} />
      </div>
    </PageContainer>
  )
}

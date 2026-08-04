import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { desc } from "drizzle-orm"
import { db } from "@/db"
import { dteSyncRuns } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { isDteSyncEnabled } from "@/lib/services/dte-portal/config"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { DteSyncActions } from "./dte-sync-actions"
import { DteSyncList } from "./dte-sync-list"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Sincronización DTE" }

const DTE_BREADCRUMBS = (
  <Breadcrumbs items={[
    { label: "Dashboard", href: "/dashboard" },
    { label: "Administración", href: "/admin" },
    { label: "Sincronización DTE" },
  ]} />
)

const DTE_ACTIONS = <DteSyncActions />

export default async function DtePage() {
  try { await requirePermission("admin:dte_sync") }
  catch { redirect("/forbidden") }

  const [runs, syncEnabled] = await Promise.all([
    db.query.dteSyncRuns.findMany({
      orderBy: [desc(dteSyncRuns.startedAt)],
      limit: 30,
    }),
    Promise.resolve(isDteSyncEnabled()),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Sincronización DTE"
        description="Documentos tributarios recibidos de proveedores (Bandeja de Entrada del portal DTE FacturaEnLínea) — solo lectura, nunca acepta ni rechaza documentos en el portal."
        breadcrumb={DTE_BREADCRUMBS}
        actions={DTE_ACTIONS}
      />

      {!syncEnabled && (
        <section role="alert" className="mb-5 rounded-[var(--radius-xl)] border border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-4 text-[var(--color-warning-ink)]">
          <h2 className="font-semibold">La sincronización no está habilitada</h2>
          <p className="mt-1 text-sm">Configure <code>DTE_SYNC_ENABLED=true</code> y las credenciales del portal (<code>DTE_PORTAL_*</code>) en las variables de entorno.</p>
        </section>
      )}

      <DteSyncList runs={runs} />
    </PageContainer>
  )
}

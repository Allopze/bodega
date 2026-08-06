import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowRight, LockKey, ShieldCheck } from "@phosphor-icons/react/dist/ssr"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { can, requireAuth } from "@/lib/auth/can"

export const metadata: Metadata = { title: "Privacidad | Prevención" }

export default async function PreventionPrivacyPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }

  const canAudit = can(session, "prevention:privacy:audit")
  const canManageRequests = can(session, "prevention:privacy:manage_requests")
  if (!canAudit && !canManageRequests) redirect("/forbidden")

  return (
    <PageContainer width="form">
      <PageHeader
        title="Privacidad"
        description="Gestiona derechos del titular y revisa accesos sensibles sin exponer información clínica o reservada."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Prevención", href: "/prevencion" }, { label: "Privacidad" }]} />}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {canManageRequests && (
          <Link
            href="/prevencion/privacidad/solicitudes"
            className="group rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--color-surface-2)]"
          >
            <ShieldCheck size={20} className="text-[var(--color-primary)]" />
            <h2 className="mt-3 text-sm font-semibold text-[var(--color-text)]">Solicitudes de derechos</h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">Valida identidad, retenciones y entregas auditadas.</p>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary-ink)] group-hover:underline">Gestionar solicitudes <ArrowRight size={12} weight="bold" /></span>
          </Link>
        )}
        {canAudit && (
          <Link
            href="/prevencion/privacidad/auditoria"
            className="group rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--color-surface-2)]"
          >
            <LockKey size={20} className="text-[var(--color-primary)]" />
            <h2 className="mt-3 text-sm font-semibold text-[var(--color-text)]">Auditoría de accesos</h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">Revisa consultas y descargas sin abrir contenido sensible.</p>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary-ink)] group-hover:underline">Ver auditoría <ArrowRight size={12} weight="bold" /></span>
          </Link>
        )}
      </div>
    </PageContainer>
  )
}

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ClipboardText } from "@phosphor-icons/react/dist/ssr"
import { can, requireAuth } from "@/lib/auth/can"
import { listPdtpTemplatesWithVersions } from "@/lib/services/prevention-pdtp"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { formatDate } from "@/lib/utils"

export const metadata: Metadata = { title: "Plantillas de programas preventivos" }

export default async function PdtpTemplatesPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:program:manage")) redirect("/forbidden")

  const templates = await listPdtpTemplatesWithVersions()

  return (
    <PageContainer width="workbench">
      <PageHeader
        title="Plantillas de programas preventivos"
        description="Versiones reutilizables y programas creados desde cada foto publicada."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Programas PDTP", href: "/prevencion/pdtp" },
          { label: "Plantillas" },
        ]} />}
        actions={<Button asChild size="sm"><Link href="/prevencion/pdtp/nuevo">Crear programa</Link></Button>}
      />

      {templates.length === 0 ? (
        <EmptyState
          icon={<ClipboardText size={24} />}
          title="Aún no hay plantillas publicadas"
          description="Completa un programa borrador y publícalo desde el paso Revisión para reutilizar su estructura sin copiar ejecuciones ni firmas."
          action={<Button asChild><Link href="/prevencion/pdtp">Abrir programas</Link></Button>}
        />
      ) : (
        <div className="space-y-4">
          {templates.map((template) => (
            <section key={template.id} className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-4">
                <div>
                  <h2 className="font-semibold text-[var(--color-text)]">{template.name}</h2>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">{template.description || "Base reutilizable sin descripción."}</p>
                </div>
                <MetaBadge meta={{ label: `${template.isActive ? "Activa" : "Inactiva"}`, variant: template.isActive ? "success" : "default" }} />
              </div>
              <div className="divide-y divide-[var(--color-border)]">
                {template.versions.map((version, index) => (
                  <div key={version.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[12rem_1fr]">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--color-text)]">Versión {version.version}</span>
                        {index === 0 && <MetaBadge meta={{ label: "Actual", variant: "info" }} />}
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-[var(--color-text-subtle)]" title={version.contentDigest}>
                        Huella {version.contentDigest.slice(0, 12)}…
                      </p>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        Publicada {formatDate(version.publishedAt)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">
                        {version.programs.length} programa(s) fijados a esta versión
                      </p>
                      {version.programs.length === 0 ? (
                        <p className="mt-2 text-sm text-[var(--color-text-muted)]">Todavía no se ha creado ningún programa desde esta versión.</p>
                      ) : (
                        <ul className="mt-2 flex flex-wrap gap-2">
                          {version.programs.map((program) => (
                            <li key={program.id}>
                              <Button asChild variant="secondary" size="sm">
                                <Link href={`/prevencion/pdtp/${program.id}`}>{program.title} · {program.year} v{program.version}</Link>
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageContainer>
  )
}

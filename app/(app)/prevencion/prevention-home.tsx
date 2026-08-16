import Link from "next/link"
import { redirect } from "next/navigation"
import { CaretRight } from "@phosphor-icons/react/dist/ssr"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getPreventionAttention } from "@/lib/services/prevention-attention"
import { getEnabledModuleIds } from "@/lib/services/module-toggles"
import { getVisibleAreas } from "@/components/layout/nav-items"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

function destinationForHome(item: { href: string; label: string }) {
  if (item.href === "/prevencion/ppa") {
    return { href: "/prevencion/ppa?estado=pendientes", label: "PPA por revisar" }
  }
  return item
}

export async function PreventionHome() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }

  const enabledModuleIds = await getEnabledModuleIds()
  const items = getVisibleAreas(session, enabledModuleIds)
    .find((area) => area.id === "prevencion")
    ?.items
    .filter((item) => item.href !== "/prevencion") ?? []

  if (items.length === 0) redirect("/forbidden")
  const scope = resolveWorksiteScope(session)
  const worksiteIds = scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
  const attention = await getPreventionAttention({
    worksiteIds,
    includeActions: can(session, "prevention:pdtp:view"),
    includeEvaluations: can(session, "sst:view"),
    includePpa: can(session, "ppa:view"),
    includeCphs: can(session, "prevention:cphs:view"),
    // Reevaluaciones de protocolos MINSAL y equipos de emergencia vencidos:
    // fechas que ya existían en la base y que ninguna pantalla leía.
    includeCompliance: can(session, "prevention:hygiene:view") || can(session, "prevention:emergency:view"),
  })

  return (
    <PageContainer width="form">
      <PageHeader
        title="Inicio de Prevención"
        description="Accede al trabajo disponible para tu rol y tus faenas autorizadas."
        breadcrumb={<Breadcrumbs items={[{ label: "Prevención" }]} />}
      />

      <section aria-labelledby="prevencion-modulos" className="border-y border-(--color-border)">
        <div className="py-4">
          <h2 id="prevencion-modulos" className="text-sm font-semibold text-(--color-text)">Módulos disponibles</h2>
          <p className="mt-1 text-sm text-(--color-text-muted)">Selecciona una área para continuar.</p>
        </div>
        <ul className="divide-y divide-(--color-border)">
          {items.map((item) => {
            const destination = destinationForHome(item)
            return (
            <li key={item.href}>
              <Link
                href={destination.href}
                className="group flex items-center justify-between gap-4 py-4 text-sm font-medium text-(--color-text) transition-colors hover:text-(--color-primary-ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)"
              >
                <span>{destination.label}</span>
                <CaretRight size={16} className="shrink-0 text-(--color-text-faint) transition-transform duration-(--duration-fast) group-hover:translate-x-0.5 group-hover:text-(--color-primary)" />
              </Link>
            </li>
          )})}
        </ul>
      </section>

      <section aria-labelledby="prevencion-attention" className="mt-6 border-y border-(--color-border)">
        <div className="py-4">
          <h2 id="prevencion-attention" className="text-sm font-semibold text-(--color-text)">Atención requerida</h2>
          <p className="mt-1 text-sm text-(--color-text-muted)">Pendientes autorizados, ordenados por urgencia y fecha.</p>
        </div>
        {attention.length === 0 ? <p className="border-t border-(--color-border) py-4 text-sm text-(--color-text-muted)">No hay pendientes que requieran atención en tus faenas.</p> : (
          <ul className="divide-y divide-(--color-border) border-t border-(--color-border)">
            {attention.map((item) => <li key={item.id}>
              <Link href={item.href} className="group flex items-center justify-between gap-4 py-3 text-sm hover:text-(--color-primary-ink)">
                <span><span className="block font-medium text-(--color-text)">{item.title}</span><span className="block text-xs text-(--color-text-muted)">{item.worksiteName} · {item.detail}{item.dueDate ? ` · ${item.dueDate}` : ""}</span></span>
                <CaretRight size={16} className={item.tone === "danger" ? "text-(--color-danger)" : "text-(--color-text-faint)"} />
              </Link>
            </li>)}
          </ul>
        )}
      </section>
    </PageContainer>
  )
}

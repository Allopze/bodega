import type { Metadata } from "next"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Wrench } from "@phosphor-icons/react/dist/ssr"

export const metadata: Metadata = { title: "Mantenciones" }

export default function MantencionesPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Mantenciones"
        description="Control de mantenciones preventivas y correctivas de la flota."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Vehículos", href: "/" },
            { label: "Mantenciones" },
          ]} />
        }
      />
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-muted-foreground/25 bg-muted/20 py-24 text-center">
        <Wrench className="mb-4 h-12 w-12 text-muted-foreground/40" />
        <h2 className="text-lg font-semibold text-muted-foreground">Próximamente…</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground/70">
          El módulo de mantenciones está en desarrollo. Aquí podrás registrar y
          dar seguimiento a mantenciones preventivas y correctivas de la flota.
        </p>
      </div>
    </PageContainer>
  )
}

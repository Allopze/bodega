import type { Metadata } from "next"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Truck } from "@phosphor-icons/react/dist/ssr"

export const metadata: Metadata = { title: "Flota" }

export default function FlotaPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Flota"
        description="Gestión del parque vehicular de la empresa."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Vehículos", href: "/" },
            { label: "Flota" },
          ]} />
        }
      />
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-muted-foreground/25 bg-muted/20 py-24 text-center">
        <Truck className="mb-4 h-12 w-12 text-muted-foreground/40" />
        <h2 className="text-lg font-semibold text-muted-foreground">Próximamente…</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground/70">
          El módulo de flota vehicular está en desarrollo. Aquí podrás administrar
          el registro completo de vehículos, documentación y estados.
        </p>
      </div>
    </PageContainer>
  )
}

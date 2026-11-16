import type * as React from "react"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Esqueleto de una pestaña de la ficha del vehículo: la cabecera, la barra de pestañas en su
 * lugar (para que el contenido no salte 64 px al llegar) y el cuerpo que pasa cada pestaña.
 * El `loading.tsx` no recibe el vehículo, así que el título es genérico.
 */
export function VehicleFichaLoading({ children }: { children: React.ReactNode }) {
  return (
    <PageContainer width="workbench">
      <PageHeader title="Vehículo" breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Vehículos", href: "/flota" }]} />
      <SectionNavSkeleton tabs={4} />
      <div role="status" aria-label="Cargando la ficha del vehículo">{children}</div>
    </PageContainer>
  )
}

/** Dos columnas de bloques, el arreglo de Flota y Mantención. */
export function FichaTwoColumnSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" aria-hidden>
      <div className="grid content-start gap-5">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
      <div className="grid content-start gap-5">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  )
}

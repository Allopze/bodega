import type { Metadata } from "next"
import { CatalogScreen } from "./catalog-screen"

export const metadata: Metadata = { title: "Catálogo de inspecciones" }

export default async function CatalogoInspeccionesPage() {
  return (
    <CatalogScreen
      kinds={["inspection", "observation"]}
      title="Catálogo de inspecciones"
      description="Plantillas versionadas del catálogo SST y programación por faena y frecuencia."
      breadcrumbLabel="Inspecciones"
      backHref="/prevencion/inspecciones"
    />
  )
}

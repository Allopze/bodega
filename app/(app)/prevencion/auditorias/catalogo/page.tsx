import type { Metadata } from "next"
import { CatalogScreen } from "../../inspecciones/catalogo/catalog-screen"

export const metadata: Metadata = { title: "Catálogo de auditorías" }

export default async function CatalogoAuditoriasPage() {
  return (
    <CatalogScreen
      kinds={["audit"]}
      title="Catálogo de auditorías"
      description="Plantillas versionadas del catálogo SST y programación por faena y frecuencia, para auditorías del SGSST (DS 44 art. 22 n°4)."
      breadcrumbLabel="Auditorías"
      backHref="/prevencion/auditorias"
    />
  )
}

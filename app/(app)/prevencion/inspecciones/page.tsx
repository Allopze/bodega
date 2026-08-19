import type { Metadata } from "next"
import { InspectionsScreen } from "./inspections-screen"

export const metadata: Metadata = { title: "Inspecciones" }

export default async function InspeccionesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolved = await searchParams
  return (
    <InspectionsScreen
      kinds={["inspection", "observation"]}
      title="Inspecciones"
      description="Inspecciones planeadas y observaciones de conducta, con hallazgos derivados a CAPA y cierre independiente."
      breadcrumbLabel="Inspecciones"
      catalogHref="/prevencion/inspecciones/catalogo"
      searchParams={resolved}
    />
  )
}

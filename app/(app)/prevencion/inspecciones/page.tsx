import type { Metadata } from "next"
import { InspectionsScreen } from "./inspections-screen"

export const metadata: Metadata = { title: "Inspecciones" }

export default async function InspeccionesPage() {
  return (
    <InspectionsScreen
      kinds={["inspection", "observation"]}
      title="Inspecciones"
      description="Inspecciones planeadas y observaciones de conducta, con hallazgos derivados a CAPA y cierre independiente."
      breadcrumbLabel="Inspecciones"
    />
  )
}

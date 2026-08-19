import type { Metadata } from "next"
import { InspectionsScreen } from "../inspecciones/inspections-screen"

export const metadata: Metadata = { title: "Auditorías del SGSST" }

/**
 * DS 44 art. 22 n°4: "la evaluación o auditoría periódica del desempeño del
 * Sistema de Gestión de la Seguridad y Salud en el Trabajo". No confundir con
 * el art. 14, que exige evaluar el cumplimiento *del programa de trabajo
 * preventivo* — eso lo resuelve /prevencion/pdtp/cobertura.
 */
export default async function AuditoriasPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolved = await searchParams
  return (
    <InspectionsScreen
      kinds={["audit"]}
      title="Auditorías del SGSST"
      description="Evaluación periódica del desempeño del Sistema de Gestión, exigida por el DS 44 art. 22 n°4. Los hallazgos derivan a acciones correctivas."
      breadcrumbLabel="Auditorías"
      catalogHref="/prevencion/auditorias/catalogo"
      searchParams={resolved}
    />
  )
}

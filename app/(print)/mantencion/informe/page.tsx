import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { InformeDocument } from "./informe-document"
import { INFORME_PRINT_STYLES } from "./informe-print-styles"
import { loadPanelReport, REPORT_PERMISSION, type ReportSearchParams } from "./report-data"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Informe de mantención" }

/**
 * Hoja imprimible del Panel de mantención para una faena y un período. La descarga
 * (`/mantencion/informe/pdf`) la abre con Chromium y la imprime. Exige leer el Panel (`mant:records:view_*`)
 * y exportar (`mant:export`) igual que la ruta; abrir esta URL a mano no da nada que el PDF no dé, y el
 * alcance de faena lo resuelven los mismos cargadores del Panel.
 */
export default async function MantencionInformePage({ searchParams }: { searchParams: Promise<ReportSearchParams> }) {
  let session
  try {
    session = await requireAnyPermission(["mant:records:view_worksite", "mant:records:view_all"], "/mantencion/panel")
  } catch {
    redirect("/forbidden")
  }
  if (!can(session, REPORT_PERMISSION)) redirect("/forbidden")
  const data = await loadPanelReport(session, await searchParams)
  return (
    <>
      <style>{INFORME_PRINT_STYLES}</style>
      <InformeDocument data={data} logoSrc="/chome_logo.svg" />
    </>
  )
}

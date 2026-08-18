import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { asc, eq } from "drizzle-orm"
import { db } from "@/db"
import { serviceEquipment, worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { HeaderSignals, type HeaderSignal } from "@/components/ui/header-signals"
import { EquipmentList, type EquipmentRow } from "./equipment-list"
import { EquipmentActions } from "./equipment-actions"
import { pluralize } from "@/lib/utils"

export const metadata: Metadata = { title: "Equipos de servicio" }

/**
 * Registro de los instrumentos que se mandan a mantener o calibrar. Las
 * solicitudes de "Mantención de monogás" y "Calibración de alcotest" apuntan
 * aquí en vez de re-escribir el código y la serie del aparato en cada una.
 */
export default async function EquiposPage() {
  try { await requirePermission("admin:service_equipment") }
  catch { redirect("/forbidden") }

  const [rows, allWorksites] = await Promise.all([
    db.select({
      id: serviceEquipment.id, code: serviceEquipment.code, name: serviceEquipment.name,
      kind: serviceEquipment.kind, brand: serviceEquipment.brand, model: serviceEquipment.model,
      serialNumber: serviceEquipment.serialNumber, worksiteId: serviceEquipment.worksiteId,
      notes: serviceEquipment.notes, isActive: serviceEquipment.isActive,
      needsReview: serviceEquipment.needsReview,
      worksiteName: worksites.name,
    })
      .from(serviceEquipment)
      .innerJoin(worksites, eq(serviceEquipment.worksiteId, worksites.id))
      .orderBy(asc(serviceEquipment.code)),
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(eq(worksites.isActive, true))
      .orderBy(asc(worksites.name)),
  ])

  const equipment: EquipmentRow[] = rows
  const inactiveCount = equipment.filter((e) => !e.isActive).length
  // Fichas que dio de alta una solicitud de mantención y que aún nadie completó.
  const needsReviewCount = equipment.filter((e) => e.needsReview).length
  const kindCount = new Set(equipment.map((e) => e.kind)).size

  const headerSignals: HeaderSignal[] = [
    // Lo accionable es completar las fichas que dio de alta una solicitud; las
    // de baja son informativas.
    { key: "needsReview", label: "Por completar", value: needsReviewCount, tone: "signal" },
    { key: "inactive", label: "De baja", value: inactiveCount },
  ]
  const description = equipment.length > 0
    ? `${equipment.length} ${pluralize(equipment.length, "equipo")} · ${kindCount} ${pluralize(kindCount, "tipo")}`
    : "El registro se llena solo: pedir la mantención de un monogás da de alta su ficha."

  return (
    <PageContainer>
      <PageHeader
        title="Equipos de servicio"
        description={description}
        breadcrumb={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Equipos de servicio" },
        ]}
        headerActions={<HeaderSignals signals={headerSignals} />}
        actions={<EquipmentActions worksites={allWorksites} />}
      />
      <EquipmentList equipment={equipment} worksites={allWorksites} />
    </PageContainer>
  )
}

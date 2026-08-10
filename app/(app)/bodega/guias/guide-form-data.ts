import { and, asc, eq, ne } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { fuelVehicles, users, workers, worksites } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { listOfficeStockOptions, resolveOfficeWorksite } from "@/lib/services/dispatch-guides"
import type {
  GuideProductOption,
  GuideVehicleOption,
  GuideWorkerOption,
  GuideWorksiteOption,
} from "./guide-form.types"

export interface GuideFormData {
  office: { id: string; name: string; code: string }
  worksites: GuideWorksiteOption[]
  workers: GuideWorkerOption[]
  vehicles: GuideVehicleOption[]
  products: GuideProductOption[]
}

/**
 * Catálogos del formulario de la guía.
 *
 * La oficina se excluye de las faenas de destino: es el origen, y un traslado
 * sobre sí mismo no existe (lo garantiza además un CHECK en la tabla).
 */
export async function loadGuideFormData(session: Session): Promise<GuideFormData> {
  const office = await resolveOfficeWorksite()

  const [worksiteRows, workerRows, vehicleRows, products] = await Promise.all([
    db
      .select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(and(
        eq(worksites.isActive, true),
        ne(worksites.id, office.id),
        worksiteScopeSql(session, worksites.id),
      ))
      .orderBy(asc(worksites.name)),
    db
      .select({
        id:         workers.id,
        firstName:  workers.firstName,
        lastName:   workers.lastName,
        rut:        workers.rut,
        position:   workers.position,
        worksiteId: workers.worksiteId,
        worksiteName: worksites.name,
      })
      .from(workers)
      .innerJoin(worksites, eq(workers.worksiteId, worksites.id))
      .where(eq(workers.isActive, true))
      .orderBy(asc(workers.lastName), asc(workers.firstName)),
    db
      .select({
        id:    fuelVehicles.id,
        plate: fuelVehicles.plate,
        code:  fuelVehicles.code,
        brand: fuelVehicles.brand,
        model: fuelVehicles.model,
        responsibleName: users.name,
      })
      .from(fuelVehicles)
      .leftJoin(users, eq(fuelVehicles.responsibleUserId, users.id))
      .where(eq(fuelVehicles.isActive, true))
      .orderBy(asc(fuelVehicles.plate)),
    listOfficeStockOptions(office.id),
  ])

  return {
    office,
    worksites: worksiteRows,
    workers: workerRows.map((worker) => ({
      id: worker.id,
      name: `${worker.firstName} ${worker.lastName}`.trim(),
      rut: worker.rut,
      position: worker.position,
      worksiteId: worker.worksiteId,
      worksiteName: worker.worksiteName,
    })),
    vehicles: vehicleRows,
    products,
  }
}

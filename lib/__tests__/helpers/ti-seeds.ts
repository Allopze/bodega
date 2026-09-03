import type { DB } from "@/db"
import * as schema from "@/db/schema"

export interface TiSeedData {
  userId: string
  secondUserId: string
  worksiteId: string
  otherWorksiteId: string
  workerId: string
  otherWorkerId: string
  supplierId: string
}

/** Datos base compartidos por los tests PGlite del módulo TI. */
export async function seedTiBase(db: DB): Promise<TiSeedData> {
  const now = new Date().toISOString()
  const data: TiSeedData = {
    userId: "user-ti-tecnico",
    secondUserId: "user-ti-gestor",
    worksiteId: "ws-ti-norte",
    otherWorksiteId: "ws-ti-sur",
    workerId: "wk-ti-juan",
    otherWorkerId: "wk-ti-maria",
    supplierId: "sup-ti-repuestos",
  }
  await db.insert(schema.users).values([
    { id: data.userId, name: "Técnico TI", email: "tecnico@ti.cl", hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now },
    { id: data.secondUserId, name: "Gestor TI", email: "gestor@ti.cl", hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now },
  ])
  await db.insert(schema.worksites).values([
    { id: data.worksiteId, name: "Faena Norte", code: "TI-N", isActive: true, createdAt: now, updatedAt: now },
    { id: data.otherWorksiteId, name: "Faena Sur", code: "TI-S", isActive: true, createdAt: now, updatedAt: now },
  ])
  await db.insert(schema.workers).values([
    { id: data.workerId, rut: "11111111-1", firstName: "Juan", lastName: "Pérez", worksiteId: data.worksiteId, isActive: true, createdAt: now },
    { id: data.otherWorkerId, rut: "22222222-2", firstName: "María", lastName: "Gómez", worksiteId: data.otherWorksiteId, isActive: true, createdAt: now },
  ])
  await db.insert(schema.suppliers).values({
    id: data.supplierId,
    name: "Repuestos TI Ltda.",
    rut: "76543210-5",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  return data
}

/** Crea un tipo de activo (por defecto computación con specs). */
export async function seedAssetType(
  db: DB,
  options?: { id?: string; name?: string; category?: string; hasSpecs?: boolean; isActive?: boolean },
): Promise<string> {
  const id = options?.id ?? "type-ti-notebook"
  await db.insert(schema.itAssetTypes).values({
    id,
    name: options?.name ?? "Notebook",
    category: options?.category ?? "computacion",
    hasSpecs: options?.hasSpecs ?? true,
    isActive: options?.isActive ?? true,
  })
  return id
}

/** Fecha plain "YYYY-MM-DD" a N días de hoy (útil para ventanas de garantía/licencia). */
export function plainDateIn(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}
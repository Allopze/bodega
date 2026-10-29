import { desc, eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { mantEquipmentHistory, users, type MantEquipmentHistoryAction, type MantFieldChanges } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { formatNumber } from "@/lib/mantencion/format"
import { formatDate } from "@/lib/utils"

/**
 * Historial de la ficha del equipo (§10): quién cambió qué y cuándo. Cada
 * cambio de equipo escribe una fila aquí y una de auditoría en la MISMA
 * transacción que el cambio, así que nunca hay un cambio sin rastro.
 */

/** Quien hace el cambio; lo resuelven las acciones desde la sesión. */
export interface MantActor {
  userId: string
  email: string | null
}

/** Los campos de la ficha que el historial compara, tal como los ve la persona. */
export interface EquipmentFields {
  code: string
  plate: string
  noPlate: boolean
  type: string
  brand: string
  model: string | null
  year: number | null
  worksite: string
  schedule: string | null
  initialReading: number | null
  initialReadingDate: string | null
}

/** Etiquetas en español de cada campo (las llaves de `changes` y de los resúmenes). */
export const EQUIPMENT_FIELD_LABELS: Record<keyof EquipmentFields, string> = {
  code: "Código",
  plate: "Patente",
  noPlate: "Sin patente",
  type: "Tipo",
  brand: "Marca",
  model: "Modelo",
  year: "Año",
  worksite: "Faena",
  schedule: "Pauta",
  initialReading: "Lectura inicial",
  initialReadingDate: "Fecha de la lectura inicial",
}

/** Orden en que se listan los cambios: el mismo de la ficha. */
const FIELD_ORDER = Object.keys(EQUIPMENT_FIELD_LABELS) as Array<keyof EquipmentFields>

/** Cambios entre dos versiones de la ficha, con etiquetas legibles como llave. */
export function diffEquipmentFields(before: EquipmentFields, after: EquipmentFields): MantFieldChanges {
  const changes: MantFieldChanges = {}
  for (const key of FIELD_ORDER) {
    if (before[key] !== after[key]) changes[EQUIPMENT_FIELD_LABELS[key]] = { from: before[key], to: after[key] }
  }
  return changes
}

function displayValue(label: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? "Sí" : "No"
  if (typeof value === "number") return formatNumber(value)
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && label.toLowerCase().includes("fecha")) return formatDate(value)
  return String(value)
}

/** «Código: KA-1 → KA-2 · Faena: Arauco → Teno». */
export function summarizeChanges(changes: MantFieldChanges): string {
  return Object.entries(changes)
    .map(([label, change]) => `${label}: ${displayValue(label, change.from)} → ${displayValue(label, change.to)}`)
    .join(" · ")
}

export interface EquipmentHistoryInput {
  vehicleId: string
  action: MantEquipmentHistoryAction
  summary: string
  changes?: MantFieldChanges
  userId: string | null
}

/** Escribe una fila del historial; siempre dentro de la transacción del cambio. */
export async function writeEquipmentHistory(tx: Pick<Tx, "insert">, input: EquipmentHistoryInput): Promise<void> {
  await tx.insert(mantEquipmentHistory).values({
    id: nanoid(),
    vehicleId: input.vehicleId,
    action: input.action,
    summary: input.summary,
    changes: input.changes ?? {},
    userId: input.userId,
  })
}

export interface EquipmentHistoryEntry {
  id: string
  action: MantEquipmentHistoryAction
  summary: string
  changes: MantFieldChanges
  userName: string | null
  createdAt: string
}

/** Historial de un equipo, del más reciente al más antiguo. */
export async function listEquipmentHistory(vehicleId: string, limit = 100): Promise<EquipmentHistoryEntry[]> {
  const rows = await db
    .select({
      id: mantEquipmentHistory.id,
      action: mantEquipmentHistory.action,
      summary: mantEquipmentHistory.summary,
      changes: mantEquipmentHistory.changes,
      userName: users.name,
      createdAt: mantEquipmentHistory.createdAt,
    })
    .from(mantEquipmentHistory)
    .leftJoin(users, eq(users.id, mantEquipmentHistory.userId))
    .where(eq(mantEquipmentHistory.vehicleId, vehicleId))
    .orderBy(desc(mantEquipmentHistory.createdAt), desc(mantEquipmentHistory.id))
    .limit(limit)
  return rows.map((row) => ({ ...row, action: row.action as MantEquipmentHistoryAction }))
}

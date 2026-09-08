import { eq } from "drizzle-orm"
import { type Tx } from "@/db"
import { eppTypes } from "@/db/schema"
import { inferEppItemType, EPP_TYPE_TO_BODY_PART_CODE } from "./epp-import.types"

/**
 * Traduce el nombre de un producto al `epp_types.id` con que Prevención
 * acredita cobertura, o `null` si el nombre no declara un ítem mapeable.
 *
 * Existe como módulo compartido porque la clasificación estaba sólo en el
 * importador XLSX: el alta manual y el asistente de EPP creaban la familia con
 * `eppTypeId` nulo incluso cuando el nombre decía "Casco Activex I", y una
 * familia sin clasificar es invisible para `computeEppCoverageGaps` — ninguna
 * de sus entregas acredita a nadie.
 *
 * Devolver `null` es deliberado y preferible a adivinar: un tipo equivocado no
 * deja la familia sin clasificar, la acredita en la zona corporal errónea, que
 * es un "cubierto" falso en un reporte de cumplimiento.
 */
export async function classifyEppTypeIdByName(tx: Tx, productName: string): Promise<string | null> {
  const itemType = inferEppItemType(productName)
  if (!itemType) return null
  const code = EPP_TYPE_TO_BODY_PART_CODE[itemType]
  if (!code) return null
  const type = await tx.query.eppTypes.findFirst({ where: eq(eppTypes.code, code) })
  return type?.id ?? null
}

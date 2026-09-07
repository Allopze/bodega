/**
 * Vuelve a leer `referenced_order_codes` desde el XML en disco para los
 * documentos que ya se habían examinado con el normalizador anterior.
 *
 * Por qué no basta `backfill-dte-order-refs.ts`: ese sólo mira filas en NULL
 * —"nunca se examinó"—, y estas filas ya tienen un valor. Lo tienen mal: se
 * escribieron cuando `normalizeOrderCodeRef` descartaba todo lo de menos de 3
 * caracteres, así que los 46 documentos reales que citan sólo el correlativo
 * ("26", "17", "14") quedaron guardados como cadena vacía, indistinguibles de
 * un proveedor que no citó nada.
 *
 * Sólo escribe cuando el valor cambia, así que es idempotente y una segunda
 * corrida no toca ninguna fila. No altera el estado de enriquecimiento ni sale
 * al portal: lee el XML cacheado y escribe una sola columna.
 *
 * Techo conocido, igual que el backfill: una fila cuyo `xml_path` ya no existe
 * en disco se deja como está. No es lo mismo que "sin referencia" y no conviene
 * borrar una señal que sí se leyó alguna vez.
 */
import { and, asc, gt, isNotNull, eq, ne } from "drizzle-orm"
import { db } from "@/db"
import { dteDocuments } from "@/db/schema"
import { readCachedXml } from "@/lib/services/dte-portal/cached-xml"

const BATCH = 500

async function main() {
  const result = { examinados: 0, actualizados: 0, sinCambio: 0, xmlIlegible: 0 }
  const ejemplos: Array<{ id: string; antes: string; despues: string }> = []

  let cursor = ""
  for (;;) {
    const pending = await db
      .select({
        id: dteDocuments.id,
        xmlPath: dteDocuments.xmlPath,
        referencedOrderCodes: dteDocuments.referencedOrderCodes,
      })
      .from(dteDocuments)
      .where(and(
        isNotNull(dteDocuments.xmlPath),
        // Las filas en NULL son trabajo del otro script: acá sólo se revisan
        // las que ya se examinaron con el normalizador viejo.
        isNotNull(dteDocuments.referencedOrderCodes),
        cursor ? gt(dteDocuments.id, cursor) : undefined,
      ))
      .orderBy(asc(dteDocuments.id))
      .limit(BATCH)
    if (pending.length === 0) break

    for (const doc of pending) {
      cursor = doc.id
      const parsed = doc.xmlPath ? await readCachedXml(doc.xmlPath) : null
      if (!parsed) {
        result.xmlIlegible += 1
        continue
      }
      result.examinados += 1
      const codes = parsed.referencedOrderCodes.join(",")
      if (codes === doc.referencedOrderCodes) {
        result.sinCambio += 1
        continue
      }
      // `ne` en el WHERE: si otra corrida escribió el valor nuevo entremedio,
      // esta no vuelve a tocar la fila ni la cuenta dos veces.
      const updated = await db.update(dteDocuments)
        .set({ referencedOrderCodes: codes })
        .where(and(eq(dteDocuments.id, doc.id), ne(dteDocuments.referencedOrderCodes, codes)))
        .returning({ id: dteDocuments.id })
      if (updated.length === 0) {
        result.sinCambio += 1
        continue
      }
      result.actualizados += 1
      if (ejemplos.length < 10) {
        ejemplos.push({ id: doc.id, antes: doc.referencedOrderCodes ?? "", despues: codes })
      }
    }
  }

  console.log(JSON.stringify({ ...result, ejemplos }, null, 2))
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)

/**
 * Rellena `dte_documents.referenced_order_codes` en los documentos que se
 * sincronizaron ANTES de que la columna existiera.
 *
 * Por qué es un script propio y no una rama de `enrich-historical-purchase-dtes`:
 * ese pasa por `enrichDteDocumentLines`, que arranca devolviendo el documento a
 * `pending`, le suma un intento y lo deja en `failed` si algo sale mal. Aplicado
 * sobre documentos que ya están `ready` —que es estado final y correcto— eso
 * degrada filas sanas para leer un dato que ya está en el XML de disco. Acá se
 * lee el XML cacheado y se escribe una sola columna; el estado de
 * enriquecimiento no se toca nunca.
 *
 * Sólo mira documentos con `xml_path`: sin XML en disco no hay nada que leer, y
 * salir al portal por una señal opcional no lo justifica. Esos quedan en NULL,
 * que es donde estaban antes del cambio —sin señal, no rotos— y los recoge la
 * sincronización normal si alguna vez descarga su XML.
 *
 * Idempotente: repetirlo sobre una base al día no escribe ninguna fila.
 *
 * Techo conocido: una fila cuyo `xml_path` apunta a un archivo que ya no está
 * se queda en NULL a propósito —no es lo mismo que "sin referencia"— y por eso
 * la vuelve a contar el condicional de `deploy-prod.sh`, que entonces ejecuta
 * este one-shot en cada deploy. Es barato (un stat por fila) y correcto; si
 * algún día molesta, el arreglo es marcar esas filas, no dejar de contarlas.
 */
import { and, asc, gt, isNull, isNotNull, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { dteDocuments } from "@/db/schema"
import { readCachedXml } from "@/lib/services/dte-portal/purchase-document-xml"

const BATCH = 500

async function main() {
  const result = { examinados: 0, conReferencia: 0, sinReferencia: 0, xmlIlegible: 0 }

  // Paginación por cursor y no por "las que sigan en NULL": un XML ilegible
  // deja la fila en NULL a propósito, así que una consulta que filtre por NULL
  // vuelve a traer las mismas filas para siempre. El id ordenado avanza pase lo
  // que pase con cada documento.
  let cursor = ""
  for (;;) {
    const pending = await db
      .select({ id: dteDocuments.id, xmlPath: dteDocuments.xmlPath })
      .from(dteDocuments)
      .where(and(
        isNull(dteDocuments.referencedOrderCodes),
        isNotNull(dteDocuments.xmlPath),
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
      // Cadena vacía, no NULL: "se leyó el XML y el proveedor no citó ninguna
      // OC" es un hecho distinto de "nunca se miró", y sin esa distinción esta
      // fila volvería a examinarse en cada corrida.
      const codes = parsed.referencedOrderCodes.join(",")
      if (codes) result.conReferencia += 1
      else result.sinReferencia += 1
      await db.update(dteDocuments)
        .set({ referencedOrderCodes: codes })
        .where(eq(dteDocuments.id, doc.id))
    }
  }

  const [restantes] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(dteDocuments)
    .where(and(isNull(dteDocuments.referencedOrderCodes), isNotNull(dteDocuments.xmlPath)))

  console.log(JSON.stringify({ ...result, sinExaminarPorXmlIlegible: restantes?.n ?? 0 }, null, 2))
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)

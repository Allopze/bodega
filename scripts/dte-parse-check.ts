/**
 * Uso: npx tsx scripts/dte-parse-check.ts <archivo.html> [codEmp]
 *
 * Corre el parser real del portal DTE contra un HTML capturado y muestra un
 * resumen: cuántas filas parseó, si coincide con tbxTotalDocumentos, y el
 * detalle de las primeras filas. Sirve para validar el parser contra HTML
 * real sin necesitar acceso a la base de datos ni al portal.
 */
import { readFileSync } from "node:fs"
import { parseDteTable } from "../lib/services/dte-portal/parser"

const [, , filePath, codEmp = "433"] = process.argv
if (!filePath) {
  console.error("Uso: npx tsx scripts/dte-parse-check.ts <archivo.html> [codEmp]")
  process.exit(1)
}

const html = readFileSync(filePath, "latin1")
const result = parseDteTable(html, codEmp)

console.log(`Documentos parseados: ${result.docs.length}`)
console.log(`Total declarado por el portal (tbxTotalDocumentos): ${result.totalDocs}`)
console.log(`Período detectado: ${result.periodo}`)
console.log("")

for (const doc of result.docs.slice(0, 5)) {
  console.log(JSON.stringify({
    folio: doc.folio,
    tipoDoc: doc.tipoDoc,
    fecha: doc.fecha,
    razonSocial: doc.razonSocial,
    estadoSii: doc.estadoSii,
    estadoIntercambio: doc.estadoIntercambio,
    montoNeto: doc.montoNeto,
    montoTotal: doc.montoTotal,
    rowId: doc.rowId,
    xmlUrl: doc.xmlUrl,
  }, null, 2))
}

if (result.docs.length < 5) {
  console.log(`(mostradas ${result.docs.length} de ${result.docs.length})`)
} else {
  console.log(`... (mostradas 5 de ${result.docs.length})`)
}

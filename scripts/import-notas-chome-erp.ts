/**
 * scripts/import-notas-chome-erp.ts
 *
 * Importa al historial de Mantención las notas de pedido (NP) de CHOME ERP desde un JSON entregado aparte.
 * Formato y reglas: `lib/services/mantencion/parts-notes/import/` (parse.ts, plan.ts, apply.ts). Ejemplo inventado:
 * `scripts/data/chome-erp-notas.ejemplo.json`.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/import-notas-chome-erp.ts --file <notas.json>                        # simulación (por defecto)
 *   npx tsx --env-file-if-exists=.env.local scripts/import-notas-chome-erp.ts --file <notas.json> --report <informe.xlsx>
 *   npx tsx --env-file-if-exists=.env.local scripts/import-notas-chome-erp.ts --file <notas.json> --actor-email <correo> --apply
 *
 * Opciones: `--cargos <ruta.json>` (tabla de equivalencias de cargos; por defecto `scripts/data/chome-erp-cargos.json`).
 *
 * - SIN `--apply` es una simulación: sólo LEE la base (maestros y notas ya importadas) y no escribe nada, ni siquiera folios.
 * - Con `--apply` escribe una transacción por nota, con folio `NP-AAAA-NNNN` nuevo (el año es el de la fecha de la nota),
 *   un único evento `migrada` y la auditoría `mant_parts_note` a nombre de `--actor-email` (obligatorio al aplicar).
 * - Idempotente por `external_ref = CHOME-<id>`: volver a correrlo no duplica; las que ya existen se saltan y se informan.
 * - Una faena que no calza deja la nota afuera (informe «Faenas sin calce»); sin faena no hay alcance. Producto, proveedor y
 *   cargo que no calzan NO bloquean: la línea conserva el texto y queda en los informes. Un cargo sólo calza con un equipo ACTIVO y de
 *   la faena de la nota (con otro, la línea no se podría comprar): si no, queda como cargo pendiente con el motivo en el informe.
 * - NO crea productos ni proveedores desde texto libre.
 * - Se conecta con el `db` del repo (DATABASE_URL); el archivo de notas NO se copia al repositorio.
 *
 * Regla de notas de prueba (se excluyen y se informan): arriba, en `EXCLUSION_RULE`.
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { and, eq } from "drizzle-orm"
import ExcelJS from "exceljs"
import { db } from "@/db"
import { users } from "@/db/schema"
import { parseCargoTable } from "@/lib/services/mantencion/parts-notes/import/cargos"
import { buildReportWorkbook, formatConsoleSummary } from "@/lib/services/mantencion/parts-notes/import/report"
import { runNoteImport } from "@/lib/services/mantencion/parts-notes/import/run"
import { DEFAULT_EXCLUSION_RULE, type ExclusionRule } from "@/lib/services/mantencion/parts-notes/import/types"
import { todayInChile } from "@/lib/utils"

/** Quién crea notas de prueba y qué texto las delata. Una nota de esos autores con «test» en la observación o un artículo se excluye. */
const EXCLUSION_RULE: ExclusionRule = { ...DEFAULT_EXCLUSION_RULE }

const DEFAULT_CARGOS = "scripts/data/chome-erp-cargos.json"

interface Args { file: string; apply: boolean; actorEmail: string | null; report: string | null; cargos: string }

function option(argv: string[], name: string): string | null {
  const index = argv.indexOf(name)
  if (index === -1) return null
  const value = argv[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`Falta el valor de ${name}.`)
  return value
}

export function parseArgs(argv: string[]): Args {
  const known = new Set(["--file", "--apply", "--actor-email", "--report", "--cargos"])
  const unknown = argv.slice(2).filter((arg) => arg.startsWith("--") && !known.has(arg))
  if (unknown.length) throw new Error(`Opción desconocida: ${unknown.join(", ")}.`)
  const file = option(argv, "--file")
  if (!file) throw new Error("Falta --file <ruta del archivo de notas .json>.")
  const apply = argv.includes("--apply")
  const actorEmail = option(argv, "--actor-email")
  if (apply && !actorEmail) throw new Error("Para aplicar falta --actor-email <correo>: la auditoría y las líneas resueltas necesitan un responsable.")
  return { file, apply, actorEmail, report: option(argv, "--report"), cargos: option(argv, "--cargos") ?? DEFAULT_CARGOS }
}

async function readJson(file: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch (error) {
    throw new Error(`No se pudo leer ${label} (${file}): ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function main(argv = process.argv) {
  const args = parseArgs(argv)
  const cargos = parseCargoTable(await readJson(args.cargos, "la tabla de cargos"))
  const json = await readJson(args.file, "el archivo de notas")

  let actor: { userId: string; email: string } | null = null
  if (args.actorEmail) {
    const row = await db.query.users.findFirst({ where: and(eq(users.email, args.actorEmail), eq(users.isActive, true)), columns: { id: true, email: true } })
    if (!row) throw new Error(`No hay un usuario activo con el correo ${args.actorEmail}: la importación necesita un responsable.`)
    actor = { userId: row.id, email: row.email }
  }

  console.log(`Importación de notas de pedido de CHOME ERP — ${args.apply ? "ESCRIBIENDO" : "simulación (no se guarda nada)"}`)
  const { plan, applied } = await runNoteImport(db, json, { apply: args.apply, actor, cargos, rule: EXCLUSION_RULE })
  const report = { fileName: path.basename(args.file), plan, applied }
  console.log(`\n${formatConsoleSummary(report)}`)

  const reportPath = args.report ?? `notas-chome-erp-${args.apply ? "aplicado" : "simulacion"}-${todayInChile()}.xlsx`
  const workbook: ExcelJS.Workbook = buildReportWorkbook(report)
  await workbook.xlsx.writeFile(reportPath)
  console.log(`\nInforme escrito en ${reportPath}`)
  if (applied?.failed.length) throw new Error(`${applied.failed.length} nota(s) fallaron al escribir (ver la hoja «Errores y avisos»). Las demás quedaron escritas; vuelve a correr para reintentar.`)
  console.log(args.apply ? "\nAplicado." : "\nSimulación terminada: no se escribió nada. Vuelve a correr con --apply --actor-email <correo> para guardar.")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}

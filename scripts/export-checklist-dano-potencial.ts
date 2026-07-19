/**
 * Genera la planilla de calibración de daño potencial de los checklists.
 *
 * `danoPotencial` gobierna dos decisiones automáticas que hoy están inertes
 * porque ningún ítem del catálogo lo declara:
 *   - la prioridad y el plazo de la acción correctiva en PDTP (producción);
 *   - la criticidad del hallazgo en el motor de inspecciones.
 *
 * Sin él todo cae al default "media / +7 días", incluidos incumplimientos de
 * consecuencia potencialmente fatal. La asignación es juicio de Prevención,
 * no de desarrollo: este script sólo produce el formulario para pedirla.
 *
 * Uso:  npx tsx scripts/export-checklist-dano-potencial.ts
 */
import ExcelJS from "exceljs"
import path from "node:path"
import { CHECKLIST_DEFINITIONS, isPersonEvaluationDefinition } from "@/lib/sst/definitions"
import type { ChecklistItem } from "@/lib/sst/types"

/** Sólo los ítems que producen cumple/no cumple generan hallazgo. */
const CONFORMITY_KIND = "cumple_nocumple_na_obs"

const OUTPUT = path.resolve(process.cwd(), "CALIBRACION_DANO_POTENCIAL_CHECKLISTS.xlsx")

async function main() {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Plataforma Chome"
  workbook.created = new Date()

  const sheet = workbook.addWorksheet("Daño potencial")
  sheet.addRow([
    "Checklist", "Código checklist", "Sección", "ID sección",
    "Ítem", "ID ítem", "Daño potencial (COMPLETAR)", "Comentario de Prevención",
  ])

  let rows = 0
  for (const [code, definition] of Object.entries(CHECKLIST_DEFINITIONS)) {
    // Las evaluaciones de personas no alimentan el motor de inspecciones.
    if (isPersonEvaluationDefinition(code)) continue
    for (const section of definition.sections) {
      for (const item of section.items as ChecklistItem[]) {
        if (item.kind !== CONFORMITY_KIND) continue
        sheet.addRow([
          definition.title, code, section.title, section.id,
          item.label, item.id, item.danoPotencial ?? "", "",
        ])
        rows += 1
      }
    }
  }

  sheet.getRow(1).font = { bold: true }
  sheet.columns.forEach((column, index) => {
    column.width = [38, 26, 34, 24, 60, 30, 28, 40][index] ?? 20
  })

  // Lista desplegable para que la columna sólo admita los valores válidos.
  const lastRow = rows + 1
  for (let row = 2; row <= lastRow; row += 1) {
    sheet.getCell(`G${row}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"leve,moderado,grave,fatal"'],
      showErrorMessage: true,
      errorTitle: "Valor no válido",
      error: "Usa exactamente: leve, moderado, grave o fatal.",
    }
  }

  const guide = workbook.addWorksheet("Instrucciones")
  guide.columns = [{ width: 22 }, { width: 96 }]
  guide.addRow(["Campo", "Qué significa"]).font = { bold: true }
  for (const [value, meaning] of [
    ["leve", "Consecuencia menor, sin tiempo perdido. Prioridad baja, plazo +30 días."],
    ["moderado", "Lesión con tiempo perdido recuperable. Prioridad media, plazo +7 días."],
    ["grave", "Lesión grave o incapacidad. Prioridad alta, plazo +3 días."],
    ["fatal", "Consecuencia potencialmente fatal. Prioridad crítica, plazo INMEDIATO (mismo día)."],
  ]) {
    guide.addRow([value, meaning])
  }
  guide.addRow([])
  guide.addRow(["Importante", "El valor describe la consecuencia POTENCIAL si el ítem resulta 'no cumple', no la probabilidad de que ocurra."])
  guide.addRow(["", "Un ítem sin valor seguirá cayendo al default 'moderado', que es lo que hoy ocurre con los 182 ítems."])
  guide.addRow(["", "Estas mismas prioridades ya rigen las acciones correctivas del PDTP en producción."])

  await workbook.xlsx.writeFile(OUTPUT)
  console.log(`${rows} ítems exportados a ${OUTPUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

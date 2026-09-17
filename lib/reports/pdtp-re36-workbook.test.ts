import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import type { PdtpRe36Cell, PdtpRe36Document } from "@/lib/services/pdtp/re36-document"
import { RE36_LAYOUT, re36CellAddress, renderPdtpRe36Buffer, renderPdtpRe36Workbook } from "./pdtp-re36-workbook"

/** Busca `recalc.py` bajo los skills sincronizados sin depender de `fs/promises#glob` (no disponible en el target de TS del proyecto). */
function findRecalcScript(): string | null {
  const skillsRoot = "/home/allopze/.claude/skills/synced"
  if (!fs.existsSync(skillsRoot)) return null
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(skillsRoot, entry.name, "xlsx/scripts/recalc.py")
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Fixture puro (sin PGlite, sin `@/db`): 2 hojas, 3 actividades en 2
 * objetivos, 1 de ellas "a demanda", P/E en 4 celdas repartidas entre las
 * tres filas — igual que pide el brief de la tarea 1.6.
 */
function buildFixtureDocument(): PdtpRe36Document {
  const emptyCells = (): PdtpRe36Cell[] => Array.from({ length: 48 }, () => ({ p: null, e: null }))

  const row1Cells = emptyCells()
  row1Cells[0] = { p: 1, e: 1 } // mes 1, semana 1
  const row2Cells = emptyCells()
  row2Cells[1] = { p: 1, e: 0 } // mes 1, semana 2
  row2Cells[9] = { p: 1, e: null } // mes 3, semana 2 (índice 8+1)
  const row3Cells = emptyCells()
  row3Cells[8] = { p: null, e: 1 } // mes 3, semana 1: reportado sin P (a demanda)

  return {
    program: {
      id: "prog-1",
      year: 2026,
      version: 1,
      title: "Programa de Trabajo Preventivo 2026",
      documentCode: "RE-36",
      documentRevision: "0",
      indicatorName: "Cumplimiento: Ejecución de actividades programadas",
      indicatorType: "Proceso",
      indicatorFormula: null,
      indicatorPeriodicity: "Mensual",
      measurementOwner: "Cada faena",
      complianceTarget: 0.9,
      annualPercent: 0.75,
    },
    worksite: { id: "worksite-1", name: "Faena Norte", code: "FN-01" },
    cutoff: { asOf: "2026-09-17T00:00:00.000Z", year: 2026, month: null },
    sheets: [
      {
        code: "pdtp_general",
        label: "PDTP GENERAL",
        rows: [
          {
            activityId: "act-1",
            n: 1,
            objectiveCode: "1",
            objectiveName: "Fortalecer el liderazgo de seguridad y salud en el trabajo",
            program: "Liderazgo visible",
            activity: "Reunión mensual de gerencia",
            responsibles: "JDPR",
            assigneeNames: [],
            scheduleMode: "scheduled",
            cells: row1Cells,
          },
          {
            activityId: "act-2",
            n: 2,
            objectiveCode: "1",
            objectiveName: "Fortalecer el liderazgo de seguridad y salud en el trabajo",
            program: "Difusión del programa",
            activity: "Reunión en faena con CPHS",
            responsibles: "PRF",
            assigneeNames: [],
            scheduleMode: "scheduled",
            cells: row2Cells,
          },
          {
            activityId: "act-3",
            n: 3,
            objectiveCode: "2",
            objectiveName: "Detectar, evaluar, medir y corregir condiciones y conductas sub-estándar",
            program: "Reporte de condiciones",
            activity: "Registro de hallazgos a demanda",
            responsibles: "Sup, JT",
            assigneeNames: [],
            scheduleMode: "on_demand",
            cells: row3Cells,
          },
        ],
        bands: [
          { code: "1", name: "Fortalecer el liderazgo de seguridad y salud en el trabajo", fromRow: 1, toRow: 2 },
          { code: "2", name: "Detectar, evaluar, medir y corregir condiciones y conductas sub-estándar", fromRow: 3, toRow: 3 },
        ],
      },
      {
        code: "cphs",
        label: "CPHS",
        rows: [
          {
            activityId: "act-1",
            n: 1,
            objectiveCode: "1",
            objectiveName: "Fortalecer el liderazgo de seguridad y salud en el trabajo",
            program: "Liderazgo visible",
            activity: "Reunión mensual de gerencia",
            responsibles: "JDPR",
            assigneeNames: [],
            scheduleMode: "scheduled",
            cells: row1Cells,
          },
        ],
        bands: [{ code: "1", name: "Fortalecer el liderazgo de seguridad y salud en el trabajo", fromRow: 1, toRow: 1 }],
      },
    ],
    platformIndicators: {
      monthly: Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        planned: index === 0 ? 2 : 0,
        executed: index === 0 ? 1 : 0,
        percent: index === 0 ? 0.5 : null,
        zeroActivities: 0,
      })),
      quarterly: Array.from({ length: 4 }, (_, index) => ({
        quarter: index + 1,
        planned: index === 0 ? 2 : 0,
        executed: index === 0 ? 1 : 0,
        percent: index === 0 ? 0.5 : null,
      })),
    },
    signatures: {
      elaboratedBy: { name: "Jefa Dpto. Prevención de Riesgos", title: "JDPR", at: "27-01-2026", atIso: "2026-01-27T00:00:00.000Z" },
      reviewedByJdpr: null,
      approvedByLegal: { name: "Gerente Legal y RRHH", title: "Legal", at: "04-02-2026", atIso: "2026-02-04T00:00:00.000Z" },
    },
    changeControl: [
      { at: "12-02-2026", atIso: "2026-02-12T00:00:00.000Z", description: "Ítem 3: se agrega difusión al CPHS.", actor: "JDPR" },
    ],
    glossary: [
      { code: "JDPR", label: "Jefa Dpto. Prevención de Riesgos" },
      { code: "PRF", label: "Prevencionista de riesgos" },
    ],
    legend: {
      onDemand: "Actividad con frecuencia: cada vez que sea necesario (a demanda).",
      e0: "E = 0: se reportó la semana y no se ejecutó.",
      eGte1: "E ≥ 1: se ejecutó.",
    },
    deviations: [],
  }
}

describe("renderPdtpRe36Workbook", () => {
  it("la banda OBJETIVO fusiona las filas de sus actividades", () => {
    const workbook = renderPdtpRe36Workbook(buildFixtureDocument())
    const ws = workbook.getWorksheet("PDTP GENERAL")!
    const merges = (ws.model as { merges: string[] }).merges ?? []
    expect(merges).toContain("A16:A17")
  })

  it("las columnas E tienen reglas condicionales 0→rojo y ≥1→verde", () => {
    const workbook = renderPdtpRe36Workbook(buildFixtureDocument())
    const ws = workbook.getWorksheet("PDTP GENERAL")!
    const cfs = (ws as unknown as { conditionalFormattings: Array<{ ref: string; rules: Array<{ type: string; operator?: string; style?: { fill?: { fgColor?: { argb?: string } } } }> }> }).conditionalFormattings
    const eColumnCf = cfs.find((cf) => cf.ref === "G16:G18")
    expect(eColumnCf).toBeDefined()
    const redRule = eColumnCf!.rules.find((rule) => rule.operator === "equal")
    // ExcelJS no tipa `greaterThanOrEqual`; el renderizador usa `greaterThan`
    // con 0, condición equivalente para enteros no negativos (ver comentario
    // en `renderConditionalFormatting`).
    const greenRule = eColumnCf!.rules.find((rule) => rule.operator === "greaterThan")
    expect(redRule?.style?.fill?.fgColor?.argb).toBe("FFFF0000")
    expect(greenRule?.style?.fill?.fgColor?.argb).toBe("FF00B050")
  })

  it("la fila a demanda tiene relleno lightUp en las 96 celdas", () => {
    const workbook = renderPdtpRe36Workbook(buildFixtureDocument())
    const ws = workbook.getWorksheet("PDTP GENERAL")!
    const row = ws.getRow(18) // act-3, tercera fila de datos (firstDataRow=16 + 2)
    let hatched = 0
    for (let col = RE36_LAYOUT.fixedColumns + 1; col <= RE36_LAYOUT.fixedColumns + 96; col++) {
      const cell = row.getCell(col)
      const fill = cell.fill as { type?: string; pattern?: string } | undefined
      if (fill?.type === "pattern" && fill.pattern === "lightUp") hatched += 1
    }
    expect(hatched).toBe(96)
  })

  it("los totales P/E son fórmulas SUM sobre el rango de datos", () => {
    const workbook = renderPdtpRe36Workbook(buildFixtureDocument())
    const ws = workbook.getWorksheet("PDTP GENERAL")!
    // 3 filas de datos: firstDataRow=16 → lastDataRow=18 → totalPRow=19, totalERow=20.
    const totalP = ws.getCell("F19").value as { formula: string }
    const totalE = ws.getCell("G20").value as { formula: string }
    expect(totalP.formula).toBe("SUM(F16:F18)")
    expect(totalE.formula).toBe("SUM(G16:G18)")
  })

  it("el % semanal es IFERROR(E/P,'')", () => {
    const workbook = renderPdtpRe36Workbook(buildFixtureDocument())
    const ws = workbook.getWorksheet("PDTP GENERAL")!
    // weeklyPercentRow = lastDataRow + 3 = 21.
    const percent = ws.getCell("G21").value as { formula: string }
    expect(percent.formula).toBe('IFERROR(G20/F19,"")')
  })

  it("paneles congelados en 5 columnas y 15 filas", () => {
    const workbook = renderPdtpRe36Workbook(buildFixtureDocument())
    const ws = workbook.getWorksheet("PDTP GENERAL")!
    expect(ws.views).toEqual([{ state: "frozen", xSplit: 5, ySplit: 15 }])
  })

  it("firmas, control de cambios y glosario aparecen tras los totales", () => {
    const workbook = renderPdtpRe36Workbook(buildFixtureDocument())
    const ws = workbook.getWorksheet("PDTP GENERAL")!
    const rowTexts: string[] = []
    ws.eachRow((row, rowNumber) => {
      const firstCellText = String(row.getCell(1).value ?? "")
      rowTexts.push(`${rowNumber}:${firstCellText}`)
    })
    const firmasRow = rowTexts.findIndex((text) => text.endsWith(":Firmas"))
    const cambiosRow = rowTexts.findIndex((text) => text.endsWith(":Control de cambios"))
    const glosarioRow = rowTexts.findIndex((text) => text.endsWith(":Glosario de siglas"))
    const totalPRowIndex = rowTexts.findIndex((text) => text.endsWith(":Actividades Programadas (P)"))
    expect(firmasRow).toBeGreaterThan(totalPRowIndex)
    expect(cambiosRow).toBeGreaterThan(firmasRow)
    expect(glosarioRow).toBeGreaterThan(cambiosRow)
  })

  it("emite una hoja por doc.sheets más Desvíos", () => {
    const workbook = renderPdtpRe36Workbook(buildFixtureDocument())
    const names = workbook.worksheets.map((ws) => ws.name)
    expect(names).toEqual(["PDTP GENERAL", "CPHS", "Desvíos"])
  })

  it("platformIndicators se imprime solo en la hoja general, no en las de cargo", () => {
    const workbook = renderPdtpRe36Workbook(buildFixtureDocument())
    const general = workbook.getWorksheet("PDTP GENERAL")!
    const cargo = workbook.getWorksheet("CPHS")!
    const hasPlatformLabel = (ws: typeof general) => {
      let found = false
      ws.eachRow((row) => {
        if (String(row.getCell(1).value ?? "").includes("Indicador de la plataforma")) found = true
      })
      return found
    }
    expect(hasPlatformLabel(general)).toBe(true)
    expect(hasPlatformLabel(cargo)).toBe(false)
  })

  it("sanea textos que empiezan con = + - @ para que no se interpreten como fórmula", () => {
    const doc = buildFixtureDocument()
    doc.sheets[0]!.rows[0]!.activity = "=CMD('calc')"
    doc.changeControl[0]!.description = "+2 días de plazo"
    const workbook = renderPdtpRe36Workbook(doc)
    const ws = workbook.getWorksheet("PDTP GENERAL")!
    expect(ws.getCell("D16").value).toBe("'=CMD('calc')")
    let sanitizedChangeControl = false
    ws.eachRow((row) => {
      if (String(row.getCell(1).value ?? "") === "12-02-2026") {
        if (String(row.getCell(2).value ?? "") === "'+2 días de plazo") sanitizedChangeControl = true
      }
    })
    expect(sanitizedChangeControl).toBe(true)
  })

  it("re36CellAddress calcula la columna a partir de RE36_LAYOUT, sin números fijos", () => {
    expect(re36CellAddress(1, 1, "P", RE36_LAYOUT.firstDataRow)).toBe("F16")
    expect(re36CellAddress(1, 1, "E", RE36_LAYOUT.firstDataRow)).toBe("G16")
    expect(re36CellAddress(12, 4, "E", RE36_LAYOUT.firstDataRow)).toBe("CW16")
  })
})

describe("renderPdtpRe36Buffer", () => {
  it("produce un libro que LibreOffice recalcula sin errores", async () => {
    const buffer = await renderPdtpRe36Buffer(buildFixtureDocument())

    const tmpDir = path.resolve(process.cwd(), ".tmp")
    fs.mkdirSync(tmpDir, { recursive: true })
    const fixturePath = path.join(tmpDir, "re36-fixture.xlsx")
    fs.writeFileSync(fixturePath, Buffer.from(buffer))

    try {
      const recalcScript = findRecalcScript()

      let sofficeAvailable = false
      try {
        execFileSync("bash", ["-lc", "command -v soffice"], { encoding: "utf8" })
        sofficeAvailable = true
      } catch {
        sofficeAvailable = false
      }

      if (!recalcScript || !sofficeAvailable) {
        // LibreOffice no está instalado en este entorno (verificado con
        // `command -v soffice`) — se documenta en el informe de la tarea.
        // Verificación de respaldo: reabrir el buffer escrito y confirmar
        // que las celdas de totales siguen siendo fórmulas de Excel (no
        // texto, que es lo que habría pasado si por error se hubiera usado
        // `xlsxToBase64` en vez de `workbook.xlsx.writeBuffer()`).
        const reloaded = new (await import("exceljs")).default.Workbook()
        await reloaded.xlsx.readFile(fixturePath)
        const ws = reloaded.getWorksheet("PDTP GENERAL")!
        const totalP = ws.getCell("F19").value as { formula?: string } | string
        const percent = ws.getCell("G21").value as { formula?: string } | string
        expect(typeof totalP).toBe("object")
        expect((totalP as { formula: string }).formula).toBe("SUM(F16:F18)")
        expect(typeof percent).toBe("object")
        expect((percent as { formula: string }).formula).toBe('IFERROR(G20/F19,"")')
        console.warn("LibreOffice (soffice) no está disponible en este entorno: se omitió el recálculo real; se verificó en su lugar que las fórmulas sobreviven la escritura del buffer (ver informe de la tarea 1.6).")
        return
      }

      const output = execFileSync("python3", [recalcScript, fixturePath], { encoding: "utf8", timeout: 60_000 })
      const result = JSON.parse(output) as { status: string; total_errors: number }
      expect(result.total_errors).toBe(0)
    } finally {
      fs.rmSync(fixturePath, { force: true })
    }
  }, 60_000)
})

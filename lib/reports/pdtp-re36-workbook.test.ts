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

function hasSoffice(): boolean {
  try {
    execFileSync("bash", ["-lc", "command -v soffice"], { encoding: "utf8" })
    return true
  } catch {
    return false
  }
}

function hasOpenpyxl(): boolean {
  try {
    execFileSync("python3", ["-c", "import openpyxl"], { encoding: "utf8" })
    return true
  } catch {
    return false
  }
}

const recalcScript = findRecalcScript()
const canRecalcWithLibreOffice = Boolean(recalcScript) && hasSoffice()
const canInspectWithOpenpyxl = hasOpenpyxl()

/** Escribe `buffer` en `.tmp/<name>` (dentro del worktree, no en `/tmp`), corre `run` y garantiza el borrado del archivo al final. */
async function withFixtureFile<T>(buffer: ArrayBuffer, name: string, run: (fixturePath: string) => T | Promise<T>): Promise<T> {
  const tmpDir = path.resolve(process.cwd(), ".tmp")
  fs.mkdirSync(tmpDir, { recursive: true })
  const fixturePath = path.join(tmpDir, name)
  fs.writeFileSync(fixturePath, Buffer.from(buffer))
  try {
    return await run(fixturePath)
  } finally {
    fs.rmSync(fixturePath, { force: true })
  }
}

/** Reconstruye el `ref` multi-rango que `renderConditionalFormatting` arma para las columnas E o P, usando solo la API pública del módulo (sin asumir su algoritmo interno). */
function buildScheduleRangeRef(kind: "P" | "E", lastDataRow: number): string {
  const ranges: string[] = []
  for (let month = 1; month <= RE36_LAYOUT.monthsCount; month++) {
    for (let week = 1; week <= RE36_LAYOUT.weeksPerMonth; week++) {
      const col = re36CellAddress(month, week, kind, RE36_LAYOUT.firstDataRow).replace(/\d+$/, "")
      ranges.push(`${col}${RE36_LAYOUT.firstDataRow}:${col}${lastDataRow}`)
    }
  }
  return ranges.join(" ")
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

  it("identifica la faena, la revisión y la fecha de corte en la cabecera de cada hoja", () => {
    const workbook = renderPdtpRe36Workbook(buildFixtureDocument())
    const ws = workbook.getWorksheet("PDTP GENERAL")!
    // Fila 2 (justo bajo el título): faena / revisión / corte, en tres
    // tercios del ancho de la hoja — ver `renderHeader`.
    const rowTexts = [1, 2, 3].map((col) => String(ws.getRow(2).getCell(col).value ?? ""))
    const joined = rowTexts.join(" | ")
    expect(joined).toContain("Faena Norte")
    expect(joined).toContain("FN-01")

    let revisionText = ""
    let cutoffText = ""
    ws.getRow(2).eachCell({ includeEmpty: false }, (cell) => {
      const text = String(cell.value ?? "")
      if (text.startsWith("Revisión:")) revisionText = text
      if (text.startsWith("Corte:")) cutoffText = text
    })
    expect(revisionText).toBe("Revisión: 0")
    expect(cutoffText).toBe("Corte: 2026-09-17 (Año completo)")
  })

  describe("semáforo de las columnas E (3 reglas: vacío, 0, ≥1)", () => {
    it("arma un solo bloque de formato condicional multi-rango para las 48 columnas E, con 3 reglas y prioridades únicas", () => {
      const workbook = renderPdtpRe36Workbook(buildFixtureDocument())
      const ws = workbook.getWorksheet("PDTP GENERAL")!
      const cfs = (
        ws as unknown as {
          conditionalFormattings: Array<{
            ref: string
            rules: Array<{
              type: string
              operator?: string
              formulae?: string[]
              priority: number
              style?: { fill?: { pattern?: string; fgColor?: { argb?: string } } }
            }>
          }>
        }
      ).conditionalFormattings

      // 3 filas de datos: firstDataRow=16 → lastDataRow=18.
      const expectedERef = buildScheduleRangeRef("E", 18)
      const eCf = cfs.find((cf) => cf.ref === expectedERef)
      expect(eCf).toBeDefined()
      expect(eCf!.rules).toHaveLength(3)

      const sortedRules = [...eCf!.rules].sort((a, b) => a.priority - b.priority)
      const [blankRule, redRule, greenRule] = [sortedRules[0]!, sortedRules[1]!, sortedRules[2]!]

      // Regla 1 (mayor precedencia — "por delante" de la del 0, igual que el
      // Excel original): celda vacía → sin relleno. `LEN(TRIM(anchor))=0` es
      // la misma fórmula que usa el original (ancla en la primera celda del
      // sqref: mes 1 / semana 1 / E de la fila de datos).
      expect(blankRule.type).toBe("expression")
      expect(blankRule.formulae).toEqual([`LEN(TRIM(${re36CellAddress(1, 1, "E", RE36_LAYOUT.firstDataRow)}))=0`])
      expect(blankRule.style?.fill?.pattern).toBe("none")

      expect(redRule.type).toBe("cellIs")
      expect(redRule.operator).toBe("equal")
      expect(redRule.formulae).toEqual(["0"])
      expect(redRule.style?.fill?.fgColor?.argb).toBe("FFFF0000")

      // "≥ 1" con `between [1, 1e9]` (no `greaterThan 0`): executedQuantity
      // es `numeric(10,2)` en la base y no está forzado a entero, así que
      // 0.5 no debe pintarse verde (el Excel original tampoco lo haría).
      expect(greenRule.type).toBe("cellIs")
      expect(greenRule.operator).toBe("between")
      expect(greenRule.formulae).toEqual(["1", "1000000000"])
      expect(greenRule.style?.fill?.fgColor?.argb).toBe("FF00B050")

      // "por delante": la regla de vacíos tiene el número de prioridad más
      // bajo (mayor precedencia) de las tres.
      expect(blankRule.priority).toBeLessThan(redRule.priority)
      expect(redRule.priority).toBeLessThan(greenRule.priority)

      // La escala de color de P vive en su propio bloque (columnas
      // distintas), con una prioridad propia — no repite 1/2/3 en cada una
      // de las 48 columnas como antes de esta ronda de arreglos.
      const expectedPRef = buildScheduleRangeRef("P", 18)
      const pCf = cfs.find((cf) => cf.ref === expectedPRef)
      expect(pCf).toBeDefined()
      expect(pCf!.rules).toHaveLength(1)
      expect(pCf!.rules[0]!.type).toBe("colorScale")
      const allPriorities = cfs.flatMap((cf) => cf.rules.map((rule) => rule.priority))
      expect(new Set(allPriorities).size).toBe(allPriorities.length) // únicas en toda la hoja
    })

    it.skipIf(!canInspectWithOpenpyxl)(
      "las 3 reglas sobreviven un round-trip con openpyxl (verificación estructural — no hay motor de cálculo en este entorno, ver informe)",
      async () => {
        const buffer = await renderPdtpRe36Buffer(buildFixtureDocument())
        await withFixtureFile(buffer, "re36-cf-openpyxl.xlsx", (fixturePath) => {
          const script = [
            "import sys, json",
            "import openpyxl",
            "wb = openpyxl.load_workbook(sys.argv[1])",
            'ws = wb["PDTP GENERAL"]',
            "out = []",
            "for cf in ws.conditional_formatting:",
            "    for rule in cf.rules:",
            "        out.append({",
            '            "sqref": str(cf.sqref),',
            '            "type": rule.type,',
            '            "priority": rule.priority,',
            '            "operator": rule.operator,',
            '            "formula": list(rule.formula) if rule.formula else None,',
            "        })",
            "print(json.dumps(out))",
          ].join("\n")
          const output = execFileSync("python3", ["-c", script, fixturePath], { encoding: "utf8" })
          const rules = JSON.parse(output) as Array<{ sqref: string; type: string; priority: number; operator: string | null; formula: string[] | null }>
          const eRules = rules.filter((rule) => rule.sqref.startsWith("G16:G18"))
          expect(eRules).toHaveLength(3)
          const byPriority = [...eRules].sort((a, b) => a.priority - b.priority)
          expect(byPriority[0]!.type).toBe("expression")
          expect(byPriority[0]!.formula).toEqual([`LEN(TRIM(${re36CellAddress(1, 1, "E", RE36_LAYOUT.firstDataRow)}))=0`])
          expect(byPriority[1]!.operator).toBe("equal")
          expect(byPriority[2]!.operator).toBe("between")
        })
      },
    )
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

  it("omite platformIndicators por completo cuando ninguna hoja es la general (no cae en la primera hoja de cargo)", () => {
    const doc = buildFixtureDocument()
    // Sin hoja "pdtp_general"/"general": ambas hojas restantes son de cargo.
    doc.sheets = [{ ...doc.sheets[0]!, code: "cargo-a" }, { ...doc.sheets[1]!, code: "cargo-b" }]
    const workbook = renderPdtpRe36Workbook(doc)
    const hasPlatformLabel = (ws: ReturnType<typeof workbook.getWorksheet>) => {
      let found = false
      ws!.eachRow((row) => {
        if (String(row.getCell(1).value ?? "").includes("Indicador de la plataforma")) found = true
      })
      return found
    }
    for (const sheet of workbook.worksheets) {
      if (sheet.name === "Desvíos") continue
      expect(hasPlatformLabel(sheet)).toBe(false)
    }
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

  it("re36CellAddress asigna F/G al mes1/semana1 y CW al mes12/semana4/E", () => {
    expect(re36CellAddress(1, 1, "P", RE36_LAYOUT.firstDataRow)).toBe("F16")
    expect(re36CellAddress(1, 1, "E", RE36_LAYOUT.firstDataRow)).toBe("G16")
    expect(re36CellAddress(12, 4, "E", RE36_LAYOUT.firstDataRow)).toBe("CW16")
  })
})

describe("renderPdtpRe36Buffer", () => {
  it("el buffer escrito conserva las fórmulas de los totales (round-trip, sin recálculo real)", async () => {
    const buffer = await renderPdtpRe36Buffer(buildFixtureDocument())
    await withFixtureFile(buffer, "re36-formula-roundtrip.xlsx", async (fixturePath) => {
      const reloaded = new (await import("exceljs")).default.Workbook()
      await reloaded.xlsx.readFile(fixturePath)
      const ws = reloaded.getWorksheet("PDTP GENERAL")!
      const totalP = ws.getCell("F19").value as { formula?: string } | string
      const percent = ws.getCell("G21").value as { formula?: string } | string
      expect(typeof totalP).toBe("object")
      expect((totalP as { formula: string }).formula).toBe("SUM(F16:F18)")
      expect(typeof percent).toBe("object")
      expect((percent as { formula: string }).formula).toBe('IFERROR(G20/F19,"")')
    })
    if (!canRecalcWithLibreOffice) {
      console.warn(
        "LibreOffice (soffice) no está disponible en este entorno: no se pudo correr el recálculo real. " +
          "Este test solo prueba que las fórmulas sobreviven la escritura del buffer (ver informe de la tarea 1.6).",
      )
    }
  })

  it.skipIf(!canRecalcWithLibreOffice)("LibreOffice recalcula el libro sin errores", async () => {
    const buffer = await renderPdtpRe36Buffer(buildFixtureDocument())
    await withFixtureFile(buffer, "re36-libreoffice-recalc.xlsx", (fixturePath) => {
      const output = execFileSync("python3", [recalcScript!, fixturePath], { encoding: "utf8", timeout: 60_000 })
      const result = JSON.parse(output) as { status: string; total_errors: number }
      expect(result.total_errors).toBe(0)
    })
  }, 60_000)
})

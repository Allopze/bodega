import ExcelJS from "exceljs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  buildEmergencyInventoryPreview,
  calculateEmergencyCoverage,
  type EmergencyImportContext,
} from "@/lib/services/emergency-resource-catalog"

const BIODIVERSA_HEADERS = [
  "N°",
  "Categoría",
  "Patente",
  "Marca",
  "ID extintor",
  "Agente",
  "Capacidad",
  "Última mantención",
  "Próximo vencimiento",
  "Ubicación",
  "Estado técnico",
]

async function biodiverseSheet(rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet("FAENA BIODIVERSA ")
  for (let line = 1; line < 11; line += 1) worksheet.addRow([`Título ${line}`])
  worksheet.addRow(BIODIVERSA_HEADERS)
  for (const row of rows) worksheet.addRow(row)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

const baseContext: EmergencyImportContext = {
  worksiteId: "ws-biodiversa",
  vehicles: [
    { id: "veh-1", worksiteId: "ws-biodiversa", plate: "AB-CD-12", brand: "FORD", category: "camioneta" },
  ],
  existingResources: [],
  existingPlacements: [],
}

describe("buildEmergencyInventoryPreview", () => {
  it("reconoce el manifiesto real de Biodiversa sin cargar datos", async () => {
    // El manifiesto vive en la raíz del repositorio. Apuntaba a
    // `docs/SGI Chome_2026/Inventario extintores/`, que dejó de existir cuando
    // la documentación se reorganizó bajo `docs/prevención/` sin que esa
    // carpeta viajara con ella.
    const file = await readFile(path.resolve(process.cwd(), "INVENTARIO DE EXTINTORES FAENA BIODIVERSA 2026.xlsx"))
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(file as never)
    const sheet = workbook.worksheets[0]!
    const header = sheet.getRow(11).values as unknown[]
    const plateColumn = header.findIndex((value) => String(value ?? "").trim().toUpperCase() === "PATENTE")
    const plates = new Set<string>()
    for (let line = 12; line <= sheet.rowCount; line += 1) {
      const plate = String(sheet.getRow(line).getCell(plateColumn).value ?? "").trim()
      if (plate && plate !== "-") plates.add(plate)
    }
    const preview = await buildEmergencyInventoryPreview(file, {
      worksiteId: "ws-biodiversa",
      vehicles: [...plates].map((plate, index) => ({ id: `veh-real-${index}`, worksiteId: "ws-biodiversa", plate, brand: null, category: null })),
      existingResources: [],
      existingPlacements: [],
    })

    expect(preview.headerLine).toBe(11)
    expect(preview.rows).toHaveLength(14)
    expect(preview.rows.filter((row) => row.placementKind === "vehicle")).toHaveLength(9)
    expect(preview.rows.filter((row) => row.placementKind === "fixed")).toHaveLength(5)
    expect(preview.rows.filter((row) => row.status === "operational")).toHaveLength(13)
    expect(preview.rows.filter((row) => row.status === "needs_maintenance")).toHaveLength(1)
    expect(preview.conflicts).toHaveLength(0)
  })

  it("detecta el encabezado real en la fila 11 y normaliza el extintor", async () => {
    const preview = await buildEmergencyInventoryPreview(await biodiverseSheet([
      [1, "Vehículo", "ABCD12", "Ford", " ext-001 ", "P.Q.S.", "6 KG", new Date(Date.UTC(2026, 0, 15)), "15/01/2027", "Camioneta", "OK"],
    ]), baseContext)

    expect(preview.headerLine).toBe(11)
    expect(preview.conflicts).toHaveLength(0)
    expect(preview.rows[0]).toMatchObject({
      decision: "create",
      line: 12,
      assetCode: "EXT-001",
      agent: "PQS",
      capacity: 6,
      capacityUnit: "kg",
      lastMaintenanceAt: "2026-01-15",
      expiresAt: "2027-01-15",
      status: "operational",
      vehicleId: "veh-1",
      placementKind: "vehicle",
    })
  })

  it("traduce PERCUTADO EN SIMULACRO a mantención y evento de uso", async () => {
    const preview = await buildEmergencyInventoryPreview(await biodiverseSheet([
      [14, "Taller", null, null, "EXT-014", "PQS", "6 kg", "2026-01-15", "2027-01-15", "Taller mecánico", "PERCUTADO EN SIMULACRO"],
    ]), baseContext)

    expect(preview.rows[0]).toMatchObject({
      status: "needs_maintenance",
      eventType: "used",
      placementKind: "fixed",
      fixedLocation: "Taller mecánico",
    })
  })

  it("bloquea una patente ambigua y nunca inventa un vehículo", async () => {
    const preview = await buildEmergencyInventoryPreview(await biodiverseSheet([
      [1, "Vehículo", "ABCD12", "Ford", "EXT-001", "PQS", 6, "2026-01-15", "2027-01-15", "Camioneta", "OK"],
    ]), {
      ...baseContext,
      vehicles: [
        ...baseContext.vehicles,
        { id: "veh-2", worksiteId: "ws-biodiversa", plate: "ABC-D12", brand: "FORD", category: "camioneta" },
      ],
    })

    expect(preview.canConfirm).toBe(false)
    expect(preview.rows[0]).toMatchObject({ decision: "conflict", vehicleId: null })
    expect(preview.conflicts[0]?.message).toContain("patente")
  })

  it("clasifica una reimportación igual como unchanged y una diferencia como update", async () => {
    const file = await biodiverseSheet([
      [1, "Taller", null, null, "EXT-001", "PQS", "6 kg", "2026-01-15", "2027-01-15", "Bodega", "OK"],
    ])
    const existing = {
      id: "resource-1",
      worksiteId: "ws-biodiversa",
      assetCode: "EXT-001",
      agent: "PQS",
      capacity: 6,
      capacityUnit: "kg",
      lastMaintenanceAt: "2026-01-15",
      expiresAt: "2027-01-15",
      status: "operational" as const,
    }

    const unchanged = await buildEmergencyInventoryPreview(file, {
      ...baseContext,
      existingResources: [existing],
      existingPlacements: [{ resourceId: "resource-1", vehicleId: null, fixedLocation: "Bodega" }],
    })
    expect(unchanged.rows[0]?.decision).toBe("unchanged")

    const update = await buildEmergencyInventoryPreview(file, {
      ...baseContext,
      existingResources: [{ ...existing, expiresAt: "2026-12-31" }],
      existingPlacements: [{ resourceId: "resource-1", vehicleId: null, fixedLocation: "Bodega" }],
    })
    expect(update.rows[0]?.decision).toBe("update")
  })
})

describe("calculateEmergencyCoverage", () => {
  it("no cuenta como cobertura un activo vencido o no operativo", () => {
    const today = "2026-08-27"
    const result = calculateEmergencyCoverage({
      today,
      placements: [
        { id: "p1", isActive: true, requiredTypeId: "type-pqs" },
        { id: "p2", isActive: true, requiredTypeId: "type-pqs" },
        { id: "p3", isActive: true, requiredTypeId: "type-pqs" },
      ],
      assignments: [
        { placementId: "p1", resourceId: "r1", active: true },
        { placementId: "p2", resourceId: "r2", active: true },
        { placementId: "p3", resourceId: "r3", active: true },
      ],
      resources: [
        { id: "r1", typeId: "type-pqs", status: "operational", expiresAt: "2027-01-01", nextInspectionAt: "2026-09-01" },
        { id: "r2", typeId: "type-pqs", status: "needs_maintenance", expiresAt: "2027-01-01", nextInspectionAt: "2026-09-01" },
        { id: "r3", typeId: "type-pqs", status: "operational", expiresAt: "2026-08-01", nextInspectionAt: "2026-09-01" },
      ],
    })

    expect(result.map((row) => row.state)).toEqual(["covered", "uncovered", "uncovered"])
  })

  it("marca atención por inspección atrasada sin perder cobertura", () => {
    const [row] = calculateEmergencyCoverage({
      today: "2026-08-27",
      placements: [{ id: "p1", isActive: true, requiredTypeId: "type-pqs" }],
      assignments: [{ placementId: "p1", resourceId: "r1", active: true }],
      resources: [{ id: "r1", typeId: "type-pqs", status: "operational", expiresAt: "2027-01-01", nextInspectionAt: "2026-08-01" }],
    })

    expect(row).toMatchObject({ state: "attention", covered: true, inspectionOverdue: true })
  })
})

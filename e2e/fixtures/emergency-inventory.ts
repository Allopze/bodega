import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import ExcelJS from "exceljs"

/**
 * Planilla de extintores para el catálogo de emergencia.
 *
 * Antes esta prueba abría por ruta absoluta un Excel real de la empresa
 * (`docs/SGI Chome_2026/Inventario extintores/...xlsx`) que no está —ni puede estar— en
 * el repositorio: fallaba con ENOENT en cualquier checkout limpio y en CI, de modo que el
 * caso nunca podía pasar salvo en la máquina donde ese archivo existía.
 *
 * El fixture se construye acá como código, no como binario versionado, porque lo que la
 * prueba afirma —14 activos, 14 puntos, 13 operativos y una brecha en EXT-014— se lee
 * directamente de esta tabla en vez de tener que abrir una planilla para adivinarlo.
 *
 * Los encabezados son los que declara `HEADERS` en
 * `lib/services/emergency-resource-catalog.ts`; se buscan por nombre, no por posición.
 */

/** Patentes que la prueba da de alta en Flota antes de importar. */
export const VEHICLE_PLATES = [
  "SGCP77-3", "SGCP84-6", "SJFC66-0", "SJFC34",
  "SRCJ-39-1", "SRCJ-42-1", "SRCJ-44-8", "SRCJ-47-2",
] as const

/**
 * Patente ausente a propósito: la prueba verifica primero que su fila sea un conflicto
 * ("La patente SBRP15 no existe en Flota para esta faena."), la da de alta y reimporta.
 */
export const MISSING_PLATE = "SBRP15"

/** Punto fijo cuyo extintor queda fuera de servicio: es la única brecha de cobertura. */
export const GAP_LOCATION = "Taller de soldadura - puesto 5"
export const GAP_ASSET_CODE = "EXT-014"

type Row = {
  assetCode: string
  category: string
  plate: string | null
  location: string | null
  technicalStatus: string
}

const FIXED_LOCATIONS = [
  "Bodega central - acceso norte",
  "Taller mecánico - puesto 1",
  "Oficina administración - pasillo",
  "Planta de áridos - tablero",
]

function rows(): Row[] {
  const vehicleRows: Row[] = [...VEHICLE_PLATES, MISSING_PLATE].map((plate, index) => ({
    assetCode: `EXT-${String(index + 1).padStart(3, "0")}`,
    category: "Vehículo",
    plate,
    location: null,
    technicalStatus: "OPERATIVO",
  }))

  const fixedRows: Row[] = FIXED_LOCATIONS.map((location, index) => ({
    assetCode: `EXT-${String(vehicleRows.length + index + 1).padStart(3, "0")}`,
    category: "Taller",
    plate: null,
    location,
    technicalStatus: "OPERATIVO",
  }))

  // 14.º y último: el que sostiene la brecha. "REQUIERE MANTENCIÓN" contiene "MANTEN",
  // que es lo que el importador traduce a `needs_maintenance`.
  fixedRows.push({
    assetCode: GAP_ASSET_CODE,
    category: "Taller",
    plate: null,
    location: GAP_LOCATION,
    technicalStatus: "REQUIERE MANTENCIÓN",
  })

  return [...vehicleRows, ...fixedRows]
}

export const EXPECTED_MANIFEST = { assets: 14, points: 14, operational: 13, maintenance: 1 } as const

/**
 * Escribe la planilla en un archivo temporal y devuelve su ruta. Temporal a propósito: es
 * una entrada derivada, no un artefacto del repositorio.
 */
export async function writeEmergencyInventoryWorkbook(): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Inventario extintores")

  // Dos filas de título antes del encabezado: las planillas reales las traen y
  // `findHeaderLine` las tolera buscando la fila de encabezados entre las 25 primeras.
  sheet.addRow(["INVENTARIO DE EXTINTORES"])
  sheet.addRow([])
  sheet.addRow([
    "ID extintor", "Agente", "Capacidad", "Categoría", "Patente",
    "Ubicación", "Estado técnico", "Última mantención", "Próximo vencimiento",
  ])

  for (const row of rows()) {
    sheet.addRow([
      row.assetCode, "PQS", "10 kg", row.category, row.plate ?? "",
      row.location ?? "", row.technicalStatus, "2026-03-15", "2027-03-15",
    ])
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chome-e2e-extintores-"))
  const filePath = path.join(directory, "inventario-extintores.xlsx")
  await workbook.xlsx.writeFile(filePath)
  return filePath
}

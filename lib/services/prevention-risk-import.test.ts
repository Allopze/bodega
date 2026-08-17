import ExcelJS from "exceljs"
import { describe, expect, it, vi } from "vitest"

// Cualquier acceso a la base explota: en `stageRiskImport` la consulta de
// checksum ocurre ANTES de `workbook.xlsx.load`, así que ver este error
// significa que la envolvente dejó pasar el archivo hasta el parseo.
const dbReached = vi.hoisted(() => new Proxy({}, {
  get() { throw new Error("ENVOLVENTE_SUPERADA") },
}))
vi.mock("@/db", () => ({ db: dbReached }))

import type { RiskLegalAccess } from "./prevention-risk-legal"
import { stageRiskImport } from "./prevention-risk-import"

const access: RiskLegalAccess = { userId: "risk-author", scope: { mode: "all", ids: [] }, permissions: ["prevention:risk:edit"] }

async function xlsxBuffer() {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet("MIPER").addRow(["Proceso", "Tarea"])
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

/** Reescribe el tamaño descomprimido declarado por cada entrada del directorio
 * central, que es como se declara un zip bomb sin fabricar uno real. */
function forgeUncompressedSizes(buffer: Buffer, value: number) {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const entryCount = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  for (let index = 0; index < entryCount; index++) {
    buffer.writeUInt32LE(value, offset + 24)
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32)
  }
  return entryCount
}

function stage(buffer: Buffer, fileName = "miper.xlsx") {
  return stageRiskImport({ worksiteId: "ws-risk-a", fileName, buffer, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", access })
}

describe("stageRiskImport valida la envolvente antes de entregar el archivo a ExcelJS", () => {
  it("rechaza un archivo sin firma ZIP", async () => {
    await expect(stage(Buffer.from("esto no es un zip, es un .xlsx renombrado"))).rejects.toThrow(/firma zip\/excel/i)
  })

  // Fase 7 punto 5: los topes dejaron de ser fijos. MIPER declara los suyos
  // (107 MB de expansión total, 27 MB por entrada) porque admite archivos de
  // 20 MB, contra los 15 MB de PDTP; las cifras de estas dos pruebas son las de
  // MIPER, no las del default compartido.
  it("rechaza una expansión total excesiva declarada en el directorio central", async () => {
    const buffer = await xlsxBuffer()
    const entryCount = forgeUncompressedSizes(buffer, 26 * 1024 * 1024)
    // Cada entrada cabe bajo el tope individual (27 MB): lo que revienta es la suma.
    expect(entryCount * 26).toBeGreaterThan(107)
    await expect(stage(buffer)).rejects.toThrow(/límite de expansión/i)
  })

  it("rechaza una entrada interna que por sí sola supera el tope", async () => {
    const buffer = await xlsxBuffer()
    forgeUncompressedSizes(buffer, 28 * 1024 * 1024)
    await expect(stage(buffer)).rejects.toThrow(/parte interna.*límite/i)
  })

  it("rechaza .xls renombrado y archivo vacío sin tocar la base", async () => {
    const buffer = await xlsxBuffer()
    await expect(stage(buffer, "miper.xls")).rejects.toThrow(/\.xls no está permitido/i)
    await expect(stage(Buffer.alloc(0))).rejects.toThrow(/vacío/i)
  })

  it("control positivo: un .xlsx legítimo supera la envolvente y sigue el flujo", async () => {
    await expect(stage(await xlsxBuffer())).rejects.toThrow("ENVOLVENTE_SUPERADA")
  })
})

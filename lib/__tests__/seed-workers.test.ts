import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { loadSeedWorkerData } from "@/db/seed/workers"

const sourcePath = path.join(process.cwd(), "db/seed/trabajadores_por_faena_actualizado.md")
const hasSourceFile = fs.existsSync(sourcePath)
const describeIf = hasSourceFile ? describe : describe.skip

describeIf("seed worker data", () => {
  it("loads workers from trabajadores_por_faena_actualizado.md grouped by worksite", () => {
    const data = loadSeedWorkerData(sourcePath)

    expect(data.sourceRows).toBe(147)
    expect(data.skippedDuplicateRuts).toBe(1)
    expect(data.workers).toHaveLength(146)
    expect(data.worksites.map((worksite) => worksite.name)).toEqual([
      "Administración",
      "Arauco Horcones",
      "Biodiversa",
      "Cholguan",
      "Horcones",
      "Masisa",
      "Pacifico",
      "Santa Fe Gruas",
      "Teno",
    ])

    expect(data.workers).toContainEqual(expect.objectContaining({
      rut: "13352600-5",
      firstName: "Lorena Elizabeth",
      lastName: "Alvarado Cornejo",
      worksiteName: "Administración",
      worksiteId: "ws-administracion",
    }))
    expect(data.workers.filter((worker) => worker.rut === "11871084-3")).toHaveLength(1)
    expect(data.workers.find((worker) => worker.rut === "11871084-3")?.worksiteName).toBe("Arauco Horcones")
  })
})

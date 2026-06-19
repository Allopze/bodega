import { describe, expect, it } from "vitest"
import { buildActaFilename } from "./acta-filename"

describe("buildActaFilename", () => {
  it("uses the requested evaluation type and worker name format", () => {
    expect(
      buildActaFilename({
        tipo: "nuevo",
        workerName: "María José Ñancupil",
      }),
    ).toBe("Evaluación Nuevo María José Ñancupil.pdf")
  })
})

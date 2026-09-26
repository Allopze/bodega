/**
 * PREV-I09: `proxy.ts` cubre `/api/*` y toda ruta de la app, y Next bufferea el
 * cuerpo de cada petición que pasa por el proxy hasta
 * `experimental.proxyClientMaxBodySize` (10 MB por defecto). Lo que excede se
 * **trunca en silencio**: el handler recibe un multipart cortado y responde
 * "Body inválido: se esperaba multipart/form-data." a un PDF de 12 MB que su
 * propio límite (25 MB) declaraba válido. El techo del proxy tiene que cubrir
 * la subida más grande que la plataforma acepta, o ese límite es de papel.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@/db", () => ({ db: {} }))

const nextConfig = (await import("../../next.config")).default
const { ALCOTEST_EVIDENCE_MAX_REQUEST_SIZE } = await import("@/lib/services/prevention-alcotest-slots")
const { TRAINING_OCCURRENCE_MAX_REQUEST_SIZE } = await import("@/lib/services/prevention-training-occurrences")
const { DRILL_EVIDENCE_MAX_REQUEST_SIZE } = await import("@/lib/services/prevention-emergency")
const { PREVENTION_EVIDENCE_MAX_FILE_SIZE } = await import("@/lib/services/prevention-evidence-upload")

const UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }

function toBytes(limit: string | number | undefined): number {
  if (typeof limit === "number") return limit
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i.exec(limit ?? "")
  if (!match) throw new Error(`Límite no reconocido: ${String(limit)}`)
  return Number(match[1]) * UNITS[match[2]!.toLowerCase()]!
}

describe("límite de cuerpo del proxy", () => {
  it("cubre la subida más grande que aceptan las rutas y las Server Actions", () => {
    const proxyLimit = toBytes(nextConfig.experimental?.proxyClientMaxBodySize)
    const largestUpload = Math.max(
      ALCOTEST_EVIDENCE_MAX_REQUEST_SIZE,
      TRAINING_OCCURRENCE_MAX_REQUEST_SIZE,
      DRILL_EVIDENCE_MAX_REQUEST_SIZE,
      // Evidencia PDTP, inspecciones y TI: 25 MB por archivo más el sobre multipart.
      PREVENTION_EVIDENCE_MAX_FILE_SIZE,
      toBytes(nextConfig.experimental?.serverActions?.bodySizeLimit),
    )
    expect(largestUpload).toBeGreaterThan(10 * 1024 ** 2)
    expect(proxyLimit).toBeGreaterThan(largestUpload)
  })
})

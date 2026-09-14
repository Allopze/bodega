/**
 * `DASH-003` (auditoría 2026-09-14): el Resumen cargaba sus doce fuentes en un
 * solo `Promise.all` sin recuperación local. Un fallo de la tarjeta de
 * cumplimiento PDTP —en la reproducción, una columna ausente en una base
 * desincronizada— rechazaba el lote entero y el usuario llegaba al límite de
 * error de toda la página: sin indicadores, sin actividad, sin accesos. La
 * misma llamada en la sección de Prevención ya se degradaba a `null`.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it, vi, beforeEach } from "vitest"

const logged: unknown[][] = []
vi.mock("@/lib/logger", () => ({
  logger: {
    error: (...args: unknown[]) => { logged.push(args) },
    warn: () => {}, info: () => {}, debug: () => {},
  },
}))

const { optionalBlock } = await import("./optional-block")

beforeEach(() => { logged.length = 0 })

describe("un bloque opcional del tablero", () => {
  it("devuelve su valor cuando la fuente responde", async () => {
    expect(await optionalBlock("stock", Promise.resolve(7), 0)).toBe(7)
    expect(logged).toHaveLength(0)
  })

  it("cae al valor por defecto cuando falla, en vez de propagar", async () => {
    expect(await optionalBlock("cumplimiento PDTP", Promise.reject(new Error("column does not exist")), null))
      .toBeNull()
  })

  it("deja el fallo registrado con el nombre del bloque", async () => {
    // Un `catch(() => null)` silencioso convierte un esquema desincronizado en
    // una tarjeta que no aparece, y nadie se entera durante semanas.
    await optionalBlock("cumplimiento PDTP", Promise.reject(new Error("column does not exist")), null)
    expect(logged).toHaveLength(1)
    expect(String(logged[0]![0])).toContain("cumplimiento PDTP")
  })

  it("no se lleva a los demás: el lote completo sobrevive a un fallo", async () => {
    const [stock, pdtp, epp] = await Promise.all([
      optionalBlock("stock", Promise.resolve(3), 0),
      optionalBlock("cumplimiento PDTP", Promise.reject(new Error("boom")), null),
      optionalBlock("epp", Promise.resolve(1), 0),
    ])
    expect([stock, pdtp, epp]).toEqual([3, null, 1])
  })

  it("nunca rechaza, ni siquiera con un fallo que no es un Error", async () => {
    await expect(optionalBlock("raro", Promise.reject("texto suelto"), [])).resolves.toEqual([])
  })
})

/**
 * El Resumen es un componente de servidor sin prueba de render: lo que se puede
 * fijar es que no vuelva a encadenar sus bloques opcionales a la suerte del
 * lote. Sin esto, revertir el arreglo deja la suite en verde.
 */
describe("el Resumen no vuelve a caerse entero por un bloque", () => {
  const source = readFileSync(path.join(__dirname, "views/resumen-view.tsx"), "utf8")

  it("carga el cumplimiento PDTP a través del bloque opcional", () => {
    expect(source).toMatch(/optionalBlock\("cumplimiento PDTP", loadPdtpComplianceSummary/)
  })

  it("ninguna fuente opcional del lote entra sin degradación", () => {
    // Cada una de estas se cargaba desnuda dentro del `Promise.all`.
    for (const fuente of [
      "loadPdtpComplianceSummary", "getActivePdtpProgram", "listPdtpPrograms",
      "getCapaDashboardCounts", "getIncidentDashboardCounts",
      "getOperationalTrendHistory", "getOperationalSnapshotHistory",
      "getOperationalBacklogComparisons", "getCriticalStockAlertCount",
    ]) {
      const llamada = new RegExp(`optionalBlock\\([^)]*?${fuente}|optionalBlock\\("[^"]+", ${fuente}`)
      expect(llamada.test(source), `${fuente} se carga sin degradación`).toBe(true)
    }
  })
})

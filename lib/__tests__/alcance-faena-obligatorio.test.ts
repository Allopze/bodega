/**
 * HALLAZGO SEC-002 (S3/P2) — «El alcance de faena es un parámetro opcional en
 * varias consultas».
 *
 * Varias lecturas recibían el alcance como opcional (`scope?: WorksiteScope`,
 * `filters?.scope`, `worksiteIds: TiWorksiteScope = "all"`). Cuando llegaba
 * `undefined`, la condición no se agregaba y la consulta devolvía **todas** las
 * faenas: omitir el alcance ampliaba en vez de cerrar. El barrido de la
 * auditoría confirmó que todos los llamadores lo pasaban —no hubo fuga—, pero
 * la firma no lo exigía y una pantalla nueva que lo olvidara la abría en
 * silencio, sin fallar ni avisar.
 *
 * La remediación lo hace imposible por tipos. Esta prueba tiene dos mitades:
 * el comportamiento (lista vacía ⇒ cero filas, nunca "todas") y un contrato
 * sobre las firmas, porque un cambio de tipos no se puede observar en runtime
 * y `tsc` no corre dentro de esta batería.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

function fuente(relativo: string): string {
  return readFileSync(path.join(process.cwd(), relativo), "utf-8")
}

describe("El alcance de faena es obligatorio en las firmas (SEC-002)", () => {
  it("listPdtpActionsByProgram lo pide posicional y ya no dentro de `opts?`", () => {
    const src = fuente("lib/services/pdtp/capa-view.ts")
    expect(src).toContain("listPdtpActionsByProgram(\n  programId: string,\n  scope: WorksiteScope,")
    // Antes: `scope?: WorksiteScope` dentro del objeto opcional de filtros.
    expect(src).not.toMatch(/scope\?: WorksiteScope/)
  })

  it("listActionsByProgram, la fachada del plan de acción, lo propaga igual", () => {
    const src = fuente("lib/services/pdtp/action-plan.ts")
    expect(src).toContain("listActionsByProgram(\n  programId: string,\n  scope: WorksiteScope,")
    expect(src).not.toMatch(/scope\?: WorksiteScope/)
  })

  it("buildPdtpExport ya no tiene `scope = \"all\"`, un default que ampliaba al olvidarlo", () => {
    const src = fuente("lib/services/pdtp/sheets.ts")
    expect(src).not.toContain('scope = "all"')
    expect(src).toContain("scope: WorksiteScope")
  })

  it("las lecturas de TI exigen el alcance en vez de asumir `\"all\"`", () => {
    const src = fuente("lib/services/ti/access.ts")
    expect(src).toContain("listWorkerAccess(workerId: string, worksiteIds: TiWorksiteScope)")
    expect(src).toContain("scope: SQL | undefined }")
    // Ninguna de las tres firmas remediadas puede volver al objeto opcional.
    expect(src).not.toContain("filters?: { systemId?")
    expect(src).not.toContain("filters?: { workerId?")
  })
})

describe("Una lista de faenas vacía significa ninguna, no todas (SEC-002)", () => {
  it("listPdtpActionsByProgram con alcance vacío devuelve cero filas sin tocar la base", async () => {
    // Si el alcance vacío se tratara como "sin filtro" —el error clásico que
    // esta firma vuelve imposible— haría falta una base para responder.
    const { listPdtpActionsByProgram } = await import("@/lib/services/pdtp/capa-view")
    await expect(listPdtpActionsByProgram("prog-1", [])).resolves.toEqual([])
  })
})

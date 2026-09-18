import { describe, expect, it } from "vitest"
import { PDTP_2026_ENGANCHE_DESTINATIONS } from "@/lib/services/pdtp-adapters/fulfillment-contract-2026"
import { PDTP_NO_EXECUTOR_ROLE_REASON } from "@/lib/prevention/pdtp"
import {
  classifyPdtpResponsibleExecution,
  type ActivityExecutionRow,
  type ResponsibleCatalogRow,
} from "./responsible-execution"

const CATALOG: ResponsibleCatalogRow[] = [
  { slug: "prf", roleName: "prevencionista_faena", operatedByRoleName: null, isActive: true },
  { slug: "jt", roleName: "jefe_terreno", operatedByRoleName: null, isActive: true },
  // Los conductores no tienen cuenta: opera el jefe de terreno por ellos (D21).
  { slug: "conductores", roleName: null, operatedByRoleName: "jefe_terreno", isActive: true },
  { slug: "retirado", roleName: "rol_viejo", operatedByRoleName: null, isActive: false },
]

function permisos(entries: Record<string, string[]>): Map<string, Set<string>> {
  return new Map(Object.entries(entries).map(([role, list]) => [role, new Set(list)]))
}

function actividad(overrides: Partial<ActivityExecutionRow> & { n: number }): ActivityExecutionRow {
  return { activity: `Actividad ${overrides.n}`, mechanism: "enganche", responsibleSlugs: ["prf"], ...overrides }
}

describe("classifyPdtpResponsibleExecution", () => {
  it("una constancia cuyo responsable puede dejarla queda ok", () => {
    const report = classifyPdtpResponsibleExecution({
      activities: [actividad({ n: 3, mechanism: "constancia" })],
      catalog: CATALOG,
      permissionsByRole: permisos({ prevencionista_faena: ["prevention:constancias:execute"] }),
    })
    expect(report.ok).toBe(1)
    expect(report.needsReview).toEqual([])
  })

  it("sin el permiso del acto acreditador cae a solo_manual y sale a revisión", () => {
    const report = classifyPdtpResponsibleExecution({
      activities: [actividad({ n: 3, mechanism: "constancia" })],
      catalog: CATALOG,
      permissionsByRole: permisos({ prevencionista_faena: ["prevention:pdtp:execute"] }),
    })
    expect(report.soloManual).toBe(1)
    expect(report.needsReview[0]!.reason).toMatch(/prevention:constancias:execute/)
  })

  /* La distinción que da sentido al informe: la n=83 la redacta el
   * prevencionista de faena y la firma otro, y eso NO es una brecha. Contarla
   * junto a las que sí lo son convierte la lista en ruido y nadie la revisa. */
  it("una segregación declarada no se confunde con una brecha", () => {
    const report = classifyPdtpResponsibleExecution({
      activities: [actividad({ n: 83 })], // emergencias, `segregated` en el contrato
      catalog: CATALOG,
      permissionsByRole: permisos({ prevencionista_faena: ["prevention:emergency:manage"] }),
    })
    expect(report.segregada).toBe(1)
    expect(report.soloManual).toBe(0)
    expect(report.needsReview).toEqual([])
    expect(report.needsReview.map((v) => v.n)).not.toContain(83)
  })

  it("basta que UN responsable tenga el permiso", () => {
    const report = classifyPdtpResponsibleExecution({
      activities: [actividad({ n: 24, responsibleSlugs: ["prf", "jt"] })], // inspecciones
      catalog: CATALOG,
      permissionsByRole: permisos({
        prevencionista_faena: [],
        jefe_terreno: ["prevention:inspections:execute"],
      }),
    })
    expect(report.ok).toBe(1)
    expect(report.needsReview).toEqual([])
    const prf = report.byRole.find((r) => r.role === "prevencionista_faena")
    // El resumen por rol sigue diciendo la verdad sobre el que no puede.
    expect(prf).toMatchObject({ declaredIn: 1, canExecute: 0, cannot: [24] })
  })

  it("resuelve al operador de plataforma cuando el responsable no tiene cuenta (D21)", () => {
    const report = classifyPdtpResponsibleExecution({
      activities: [actividad({ n: 25, responsibleSlugs: ["conductores"] })],
      catalog: CATALOG,
      permissionsByRole: permisos({ jefe_terreno: ["prevention:inspections:execute"] }),
    })
    expect(report.ok).toBe(1)
    expect(report.byRole).toEqual([
      { role: "jefe_terreno", declaredIn: 1, canExecute: 1, cannot: [] },
    ])
  })

  it("un responsable que no mapea a ningún rol vigente sale a revisión", () => {
    const report = classifyPdtpResponsibleExecution({
      activities: [actividad({ n: 24, responsibleSlugs: ["retirado", "inexistente"] })],
      catalog: CATALOG,
      permissionsByRole: permisos({ rol_viejo: ["prevention:inspections:execute"] }),
    })
    expect(report.soloManual).toBe(1)
    expect(report.needsReview[0]!.reason).toBe(PDTP_NO_EXECUTOR_ROLE_REASON)
  })

  it("una actividad de gobernanza sin módulo de destino no exige permiso", () => {
    const report = classifyPdtpResponsibleExecution({
      activities: [actividad({ n: 1 })], // aprobar el programa: sinDestino
      catalog: CATALOG,
      permissionsByRole: permisos({ prevencionista_faena: [] }),
    })
    expect(report.ok).toBe(1)
  })
})

/* El conteo real del programa, no un caso sintético.
 *
 * `classifyPdtpResponsibleExecution` evalúa `ok` ANTES que `segregada`, así que
 * un grant a un rol que además sea responsable declarado haría saltar una
 * actividad de categoría sin que nadie borre su texto `segregated:` — el texto
 * que dice, ante un fiscalizador, por qué esa firma es de otro. Cuando la
 * jefatura del Departamento de Prevención entró al conjunto de firmantes esto
 * no se movió, y era lo correcto: firma, pero no es responsable declarada de
 * ninguna de las cinco. Si mañana el número cambia, que cambie a propósito. */
describe("las cinco segregadas del programa 2026", () => {
  const SEGREGADAS = [35, 43, 77, 80, 83]

  it("siguen siendo cinco, y las mismas", () => {
    const numeros = Object.entries(PDTP_2026_ENGANCHE_DESTINATIONS)
      .filter(([, destination]) => Boolean(destination.segregated) && destination.permission !== null)
      .map(([n]) => Number(n))
      .sort((a, b) => a - b)

    expect(numeros).toEqual(SEGREGADAS)
  })

  it("cada una explica por qué, y no con una frase de relleno", () => {
    for (const n of SEGREGADAS) {
      const destination = PDTP_2026_ENGANCHE_DESTINATIONS[n]!
      expect(destination.segregated!.length).toBeGreaterThan(40)
    }
  })
})

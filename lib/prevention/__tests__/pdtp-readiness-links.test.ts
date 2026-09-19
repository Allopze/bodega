/**
 * El modo de fallar que este archivo vigila: un enlace que llega a la pantalla
 * correcta con un parámetro que esa pantalla ignora. Se ve bien en revisión de
 * código, no se ve en un screenshot, y deja al operador exactamente donde
 * estaba — que es lo que pasó con el panel anterior.
 */

import { describe, expect, it } from "vitest"
import {
  applicabilityLink,
  emergencyPlanLink,
  inspectionTemplateLink,
  instrumentLink,
  programEditorLink,
  rolesLink,
  trainingCourseLink,
} from "../pdtp-readiness-links"

/** Los parámetros que cada destino lee de verdad, verificados en su código. */
const READS_PARAMS: Record<string, string[]> = {
  "/prevencion/inspecciones/plantillas": ["q", "tipo", "estado"],
  "/prevencion/capacitacion/catalogo": ["tab", "q", "faena", "year"],
  "/prevencion/emergencias": ["tab", "vista", "page"],
  "/prevencion/pdtp/aplicabilidad": [],
  "/admin/roles": [],
}

function assertOnlyKnownParams(href: string) {
  const [pathWithHash] = href.split("?")
  const path = pathWithHash!.split("#")[0]!
  const query = href.includes("?") ? href.slice(href.indexOf("?") + 1).split("#")[0]! : ""
  const allowed = READS_PARAMS[path]
  if (!allowed) return // rutas dinámicas: se verifican por patrón abajo
  for (const key of new URLSearchParams(query).keys()) {
    expect(allowed, `${path} no lee "${key}"`).toContain(key)
  }
}

describe("pdtp-readiness-links — cada parámetro lo lee su destino", () => {
  it("la plantilla llega filtrada por código y estado", () => {
    const link = inspectionTemplateLink("INS-014")
    expect(link.href).toBe("/prevencion/inspecciones/plantillas?estado=draft&q=INS-014")
    assertOnlyKnownParams(link.href)
  })

  it("el curso llega a la pestaña de versiones, filtrado", () => {
    const link = trainingCourseLink("CAP-07")
    expect(link.href).toBe("/prevencion/capacitacion/catalogo?tab=versions&q=CAP-07")
    assertOnlyKnownParams(link.href)
  })

  it("con plan existente va al detalle; sin plan, a la lista donde se crea", () => {
    expect(emergencyPlanLink("plan-3").href).toBe("/prevencion/emergencias/plan-3")
    const sinPlan = emergencyPlanLink(null)
    expect(sinPlan.href).toBe("/prevencion/emergencias?tab=plans&vista=draft")
    assertOnlyKnownParams(sinPlan.href)
  })

  it("nunca promete aprobar un plan de emergencia", () => {
    // `approveEmergencyPlan` falla si `assessPlanReadiness` no pasa, y el botón
    // del detalle ya viene deshabilitado por eso. Prometerlo en la fila sería
    // reintroducir el fallo que este rediseño corrige.
    for (const planId of ["plan-1", null]) {
      expect(emergencyPlanLink(planId).label.toLocaleLowerCase("es-CL")).not.toContain("aprobar")
    }
  })

  it("el editor ancla a la actividad y respeta las secciones válidas", () => {
    const link = programEditorLink("pdtp-2026", 37)
    expect(link.href).toBe("/prevencion/pdtp/pdtp-2026/editar?seccion=revision#actividad-37")
    expect(programEditorLink("p", 1, "faenas").href).toContain("seccion=faenas")
  })

  it("aplicabilidad se enlaza pelada porque no lee ningún parámetro", () => {
    expect(applicabilityLink().href).toBe("/prevencion/pdtp/aplicabilidad")
    assertOnlyKnownParams(applicabilityLink().href)
  })

  it("los identificadores se codifican: un código con espacios no rompe la URL", () => {
    expect(inspectionTemplateLink("INS 014/A").href).toContain("q=INS%20014%2FA")
    expect(programEditorLink("pdtp 2026", 1).href).toContain("/pdtp%202026/editar")
  })

  it("instrumentLink resuelve cada clase a su destino", () => {
    expect(instrumentLink({
      kind: "inspection_template", id: "t", code: "INS-1", versionLabel: "v1",
      name: "x", status: "draft", authorUserId: null, blocker: "template_not_approved",
    }).href).toContain("/prevencion/inspecciones/plantillas")

    expect(instrumentLink({
      kind: "training_course", id: "c", code: "CAP-1", name: "x",
      minimumDurationMinutes: 60, latestVersion: null, blocker: "course_has_no_version",
    }).href).toContain("/prevencion/capacitacion/catalogo")

    // Conjunción: va a la primera faena que falta y vuelve a aparecer con la
    // siguiente hasta que no queda ninguna.
    expect(instrumentLink({
      kind: "emergency_plan",
      worksites: [
        { id: "a", name: "Faena Norte", planId: "plan-a", planCode: "PE-A", planStatus: "draft", createdByUserId: null, blocker: "plan_not_approved" },
        { id: "b", name: "Faena Sur", planId: null, planCode: null, planStatus: null, createdByUserId: null, blocker: "plan_missing" },
      ],
    }).href).toBe("/prevencion/emergencias/plan-a")
  })

  it("todos los enlaces son internos y absolutos", () => {
    const links = [
      inspectionTemplateLink("A"), trainingCourseLink("B"), emergencyPlanLink("c"),
      emergencyPlanLink(null), programEditorLink("p", 1), applicabilityLink(), rolesLink(),
    ]
    for (const link of links) {
      expect(link.href.startsWith("/"), link.href).toBe(true)
      expect(link.href).not.toContain("//")
      expect(link.label.length).toBeGreaterThan(0)
    }
  })
})

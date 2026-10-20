// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { re20PublicDataSchema } from "@/lib/services/prevention-incident-re20-schema"
import { Re20PrintDocument } from "./document"

const incident = {
  id: "incident-1", code: "INC-2026-0001", companyName: "Contratista", eventType: "work_accident",
  occurredAt: "2026-10-20T10:00:00.000Z", knownAt: "2026-10-20T10:15:00.000Z", status: "under_investigation",
  actualSeverity: "lost_time", potentialSeverity: "high", initialNarrative: "Relato inicial", location: "Taller", worksiteName: "Faena norte",
}

const data = re20PublicDataSchema.parse({
  preliminary: { managerName: "Jefa de área", eventDescription: "Caída desde plataforma", immediateActions: { firstAid: { marked: true, responsible: "Supervisor" } } },
  causalTree: {
    events: [
      { id: "H1", description: "La persona sufrió una lesión", verified: true },
      { id: "H2", description: "La baranda estaba retirada", verified: true, source: "Fotografía 3" },
      { id: "H3", description: "No existía inspección de la plataforma", verified: false },
    ],
    relations: [
      { from: "H2", to: "H1", type: "conjunction" },
      { from: "H3", to: "H1", type: "conjunction" },
    ],
  },
  measures: [{ id: "m1", rootCauseId: "H3", description: "Inspeccionar plataformas cada turno", controlType: "Administrativo", responsibleUserId: "u-resp", verifierUserId: "u-ver", dueAt: "2026-11-20T00:00:00.000Z", status: "En ejecución" }],
  team: [{ userId: "u-resp", role: "Líder", position: "Prevencionista" }],
})

const baseWorkspace = { version: 3, data, policyVersion: 1, updatedAt: "2026-10-21T10:00:00.000Z", updatedByUserId: "u-resp" }
const people = { "u-resp": { name: "Ana Responsable", position: "Prevencionista" }, "u-ver": { name: "Luis Verificador", position: null }, "u-rev": { name: "Carla Revisora", position: null } }
const review = (reviewerRole: string) => ({
  workspaceVersion: 3, decision: "approved_with_observations", observation: "Completar anexos", reviewerRole, reviewerUserId: "u-rev",
  reviewedAt: "2026-10-22T10:00:00.000Z", criteria: [{ id: "timeliness", result: "partial", observation: "Tardó en iniciar" }],
})

function render(overrides: Partial<Parameters<typeof Re20PrintDocument>[0]["data"]> = {}) {
  return renderToStaticMarkup(<Re20PrintDocument data={{
    incident, workspace: baseWorkspace, qualityReviews: [], legacy: null, people, roleLabels: { administrador: "Administrador" }, ...overrides,
  }} />)
}

describe("documento imprimible RE-20", () => {
  it("usa rótulos en español y no deja enums crudos", () => {
    const html = render({ qualityReviews: [review("jefa_chome")] })
    expect(html).toContain("En investigación")
    expect(html).toContain("Accidente del trabajo")
    expect(html).toContain("Con tiempo perdido")
    expect(html).toContain("Conjunción")
    expect(html).toContain("Aprobado con observaciones")
    expect(html).toContain("Parcial")
    for (const raw of ["under_investigation", "work_accident", "lost_time", "approved_with_observations", "partial", "conjunction"]) {
      expect(html).not.toContain(raw)
    }
  })

  it("dibuja el árbol con IDs, causas raíz y las medidas con nombres de persona", () => {
    const html = render()
    expect(html).toContain("RE-20-02")
    expect(html).toContain("RE-20-04")
    expect(html.indexOf("RE-20-02")).toBeLessThan(html.indexOf("RE-20-04"))
    expect(html).toContain("H3")
    expect(html).toContain("Causa raíz")
    expect(html).toContain("H3 → H1")
    expect(html).toContain("Ana Responsable")
    expect(html).toContain("Luis Verificador")
    expect(html).not.toContain("u-resp")
  })

  it("muestra el rol real del revisor y «en reemplazo» cuando no fue la jefa", () => {
    const jefa = render({ qualityReviews: [review("jefa_chome")] })
    expect(jefa).toContain("Carla Revisora")
    expect(jefa).toContain("Jefa Dpto. Prevención de Riesgos")
    expect(jefa).not.toContain("en reemplazo")
    const reemplazo = render({ qualityReviews: [review("administrador")] })
    expect(reemplazo).toContain("Administrador (en reemplazo de la Jefa Dpto. Prevención de Riesgos)")
    expect(reemplazo).toContain("Tardó en iniciar")
  })

  it("genera la difusión desde las medidas y los seguimientos desde su tabla canónica", () => {
    const html = render({
      followups: [{ id: "f1", kind: "accident", followupDate: "2026-11-05", note: "Se instaló la baranda", evidenceRef: null, measureId: "m1", rootCauseId: "H3", controlType: "Administrativo", verifierUserId: "u-ver", verifiedAt: "2026-11-06T10:00:00.000Z", residualRisk: "Bajo", implementedAt: "2026-11-05T10:00:00.000Z", verified: true, effective: false, lostDays: 2, lossDescription: null }],
    })
    expect(html).toContain("RE-20-06")
    expect(html).toContain("Inspeccionar plataformas cada turno")
    expect(html).toContain("RE-20-08")
    expect(html).toContain("Se instaló la baranda")
    expect(html).not.toContain("RE-20-09")
  })

  it("oculta las secciones reservadas sin propósito de acceso", () => {
    const html = render({ sensitive: { purpose: "  ", declarations: [{ id: "d", kind: "witness", name: "Nombre visible", statement: "Relato" }], diat: { status: "prepared", receiptReference: "acuse-001" } } })
    expect(html).not.toContain('<span class="form-code">RE-20-07</span>')
    expect(html).not.toContain('<span class="form-code">RE-20-03</span>')
    expect(html).not.toContain("Nombre visible")
    expect(html).not.toContain("acuse-001")
    expect(html).toContain("no incluye las secciones reservadas")
  })

  it("incluye actas y DIAT sólo con propósito y respeta la reserva de identidad", () => {
    const html = render({
      sensitive: {
        purpose: "Preparación de expediente",
        declarations: [
          { id: "dec-reserved", kind: "witness", name: "Nombre reservado", role: "Testigo identificable", statement: "Relato reservado", reserveIdentity: true, directKnowledge: "Presenció el hecho", attachmentReferences: [], signedAt: null },
          { id: "dec-visible", kind: "cphs", name: "Nombre visible", role: "Representante CPHS", statement: "Relato identificable", reserveIdentity: false, attachmentReferences: [], signedAt: null },
        ],
        injuredInterview: { usualTask: "Mantención de equipos", summary: "Resbaló en la plataforma" },
        diat: { status: "prepared", knownAt: "2026-10-20T10:15:00.000Z", sentAt: "2026-10-20T12:00:00.000Z", receiptReference: "acuse-001", form: { nationalIdentifier: "12.345.678-9" } },
      },
    })
    expect(html).toContain('<span class="form-code">RE-20-07</span>')
    expect(html).toContain('<span class="form-code">RE-20-03</span>')
    expect(html).toContain("Identidad reservada")
    expect(html).not.toContain("Nombre reservado")
    expect(html).not.toContain("Testigo identificable")
    expect(html).toContain("Nombre visible")
    expect(html).toContain("Preparada")
    expect(html).toContain("acuse-001")
    expect(html).toContain("12.345.678-9")
  })
})

import { describe, expect, it } from "vitest"
import {
  computeAccreditationGaps,
  contractAccessDecision,
  workerAccessDecision,
  type AccreditationItemRow,
  type AccreditationRequirementRow,
  type ContractRow,
  type ContractorWorkerRow,
} from "@/lib/prevention/contractors"

const asOf = "2026-07-19"

const contract = (over: Partial<ContractRow> = {}): ContractRow => ({
  id: "ct-1",
  code: "CT-2026-001",
  companyId: "co-1",
  worksiteId: "ws-1",
  relationship: "contractor",
  status: "active",
  ...over,
})

const requirement = (over: Partial<AccreditationRequirementRow> = {}): AccreditationRequirementRow => ({
  id: "req-1",
  code: "F30-1",
  name: "Certificado F30-1 de cumplimiento laboral y previsional",
  appliesTo: "contract",
  worksiteId: null,
  relationship: null,
  enforcement: "blocking",
  isActive: true,
  ...over,
})

const worker = (over: Partial<ContractorWorkerRow> = {}): ContractorWorkerRow => ({
  id: "cw-1",
  contractId: "ct-1",
  rut: "11111111-1",
  firstName: "Ana",
  lastName: "Pérez",
  status: "pending",
  ...over,
})

const item = (over: Partial<AccreditationItemRow> = {}): AccreditationItemRow => ({
  requirementId: "req-1",
  contractId: "ct-1",
  contractorWorkerId: null,
  status: "approved",
  expiresOn: "2027-01-01",
  ...over,
})

describe("brechas de acreditación DS 76", () => {
  it("reporta como faltante un requisito sin evidencia presentada", () => {
    const gaps = computeAccreditationGaps({ contracts: [contract()], workers: [], requirements: [requirement()], items: [], asOf })
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({ gapType: "missing", enforcement: "blocking", subjectLabel: "CT-2026-001" })
  })

  it("no reporta brecha con evidencia aprobada y vigente", () => {
    const gaps = computeAccreditationGaps({ contracts: [contract()], workers: [], requirements: [requirement()], items: [item()], asOf })
    expect(gaps).toEqual([])
  })

  it("trata como vencida una evidencia aprobada con fecha pasada, sin esperar al job", () => {
    const gaps = computeAccreditationGaps({
      contracts: [contract()], workers: [], requirements: [requirement()],
      items: [item({ expiresOn: "2026-01-01" })], asOf,
    })
    expect(gaps[0]).toMatchObject({ gapType: "expired", expiresOn: "2026-01-01" })
  })

  it("una evidencia sin vencimiento permanece vigente", () => {
    const gaps = computeAccreditationGaps({
      contracts: [contract()], workers: [], requirements: [requirement()],
      items: [item({ expiresOn: null })], asOf,
    })
    expect(gaps).toEqual([])
  })

  it("presentado pero no aprobado sigue siendo brecha", () => {
    const gaps = computeAccreditationGaps({
      contracts: [contract()], workers: [], requirements: [requirement()],
      items: [item({ status: "submitted" })], asOf,
    })
    expect(gaps[0]?.gapType).toBe("submitted_not_approved")
  })

  it("observado sigue siendo brecha", () => {
    const gaps = computeAccreditationGaps({
      contracts: [contract()], workers: [], requirements: [requirement()],
      items: [item({ status: "observed" })], asOf,
    })
    expect(gaps[0]?.gapType).toBe("observed")
  })

  it("ignora requisitos desactivados y contratos terminados", () => {
    expect(computeAccreditationGaps({ contracts: [contract()], workers: [], requirements: [requirement({ isActive: false })], items: [], asOf })).toEqual([])
    expect(computeAccreditationGaps({ contracts: [contract({ status: "finished" })], workers: [], requirements: [requirement()], items: [], asOf })).toEqual([])
  })

  it("un requisito acotado a una faena no alcanza a otra", () => {
    const req = requirement({ worksiteId: "ws-2" })
    expect(computeAccreditationGaps({ contracts: [contract()], workers: [], requirements: [req], items: [], asOf })).toEqual([])
    expect(computeAccreditationGaps({ contracts: [contract({ worksiteId: "ws-2" })], workers: [], requirements: [req], items: [], asOf })).toHaveLength(1)
  })

  it("un requisito acotado a subcontratistas no alcanza a un contratista directo", () => {
    const req = requirement({ relationship: "subcontractor" })
    expect(computeAccreditationGaps({ contracts: [contract()], workers: [], requirements: [req], items: [], asOf })).toEqual([])
    expect(computeAccreditationGaps({ contracts: [contract({ relationship: "subcontractor" })], workers: [], requirements: [req], items: [], asOf })).toHaveLength(1)
  })

  it("un requisito por trabajador genera una brecha por persona no retirada", () => {
    const req = requirement({ appliesTo: "worker" })
    const gaps = computeAccreditationGaps({
      contracts: [contract()],
      workers: [worker(), worker({ id: "cw-2", rut: "22222222-2", firstName: "Bruno" }), worker({ id: "cw-3", rut: "33333333-3", status: "withdrawn" })],
      requirements: [req], items: [], asOf,
    })
    expect(gaps).toHaveLength(2)
    expect(gaps.map((gap) => gap.contractorWorkerId).sort()).toEqual(["cw-1", "cw-2"])
  })

  it("la evidencia de un trabajador no cubre a otro", () => {
    const req = requirement({ appliesTo: "worker" })
    const gaps = computeAccreditationGaps({
      contracts: [contract()],
      workers: [worker(), worker({ id: "cw-2", rut: "22222222-2" })],
      requirements: [req],
      items: [item({ contractorWorkerId: "cw-1" })],
      asOf,
    })
    expect(gaps).toHaveLength(1)
    expect(gaps[0]?.contractorWorkerId).toBe("cw-2")
  })
})

describe("decisión de acceso", () => {
  it("bloquea el contrato mientras exista una brecha bloqueante de contrato", () => {
    const gaps = computeAccreditationGaps({ contracts: [contract()], workers: [], requirements: [requirement()], items: [], asOf })
    expect(contractAccessDecision({ contractId: "ct-1", gaps })).toMatchObject({ allowed: false })
  })

  it("libera el contrato cuando sólo quedan advertencias", () => {
    const gaps = computeAccreditationGaps({
      contracts: [contract()], workers: [], requirements: [requirement({ enforcement: "warning" })], items: [], asOf,
    })
    expect(contractAccessDecision({ contractId: "ct-1", gaps }).allowed).toBe(true)
  })

  it("una brecha de un trabajador no bloquea todo el contrato", () => {
    const gaps = computeAccreditationGaps({
      contracts: [contract()],
      workers: [worker()],
      requirements: [requirement({ appliesTo: "worker" })],
      items: [], asOf,
    })
    expect(contractAccessDecision({ contractId: "ct-1", gaps }).allowed).toBe(true)
    expect(workerAccessDecision({ contractId: "ct-1", contractorWorkerId: "cw-1", gaps }).allowed).toBe(false)
  })

  it("una brecha bloqueante de contrato sí bloquea a cada trabajador", () => {
    const gaps = computeAccreditationGaps({
      contracts: [contract()],
      workers: [worker()],
      requirements: [requirement()],
      items: [], asOf,
    })
    expect(workerAccessDecision({ contractId: "ct-1", contractorWorkerId: "cw-1", gaps }).allowed).toBe(false)
  })

  it("un trabajador con su evidencia al día queda habilitado si el contrato está limpio", () => {
    const gaps = computeAccreditationGaps({
      contracts: [contract()],
      workers: [worker(), worker({ id: "cw-2", rut: "22222222-2" })],
      requirements: [requirement({ appliesTo: "worker" })],
      items: [item({ contractorWorkerId: "cw-1" })],
      asOf,
    })
    expect(workerAccessDecision({ contractId: "ct-1", contractorWorkerId: "cw-1", gaps }).allowed).toBe(true)
    expect(workerAccessDecision({ contractId: "ct-1", contractorWorkerId: "cw-2", gaps }).allowed).toBe(false)
  })

  it("no mezcla brechas de otro contrato", () => {
    const gaps = computeAccreditationGaps({
      contracts: [contract(), contract({ id: "ct-2", code: "CT-2026-002" })],
      workers: [], requirements: [requirement()],
      items: [item({ contractId: "ct-1" })],
      asOf,
    })
    expect(contractAccessDecision({ contractId: "ct-1", gaps }).allowed).toBe(true)
    expect(contractAccessDecision({ contractId: "ct-2", gaps }).allowed).toBe(false)
  })
})

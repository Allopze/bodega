/**
 * PREV-C04: los crons de Prevención existían pero `scripts/cron-runner.mjs` no
 * los llamaba, y además respondían `{ ok: true, ...result }` sin `outcome` ni
 * `code`: aunque se agendaran, el runner daba cada corrida por fallida
 * (DTE_CRON_RUNNER_CONTRACT). Esta prueba recorre cada ruta de punta a punta —
 * la respuesta real del handler entra al runner real— para que el contrato no
 * vuelva a divergir en silencio.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  verifyCronSecret: vi.fn(),
  withCronLock: vi.fn(),
  work: vi.fn(),
  re20Sweep: vi.fn(),
  pdtpGc: vi.fn(),
  riskMapGc: vi.fn(),
}))

const ok = () => mocks.work()

vi.mock("@/lib/security/cron-auth", () => ({ verifyCronSecret: (...args: unknown[]) => Reflect.apply(mocks.verifyCronSecret, null, args) }))
vi.mock("@/lib/services/cron-lock", () => ({ withCronLock: (...args: unknown[]) => Reflect.apply(mocks.withCronLock, null, args) }))
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/services/prevention-pdtp", () => ({
  runPdtpWeeklyReminders: ok,
  runPdtpActionPlanVencidasReminders: ok,
  runPdtpObligationReminders: ok,
  runPdtpSignaturePendingReminders: ok,
  runPdtpYearCloseReminders: ok,
}))
vi.mock("@/lib/services/pdtp/fulfillment", () => ({ reconcilePdtpFulfillmentEvents: ok }))
vi.mock("@/lib/services/pdtp/scheduled-instances", () => ({ reconcilePdtpScheduledInstances: ok }))
vi.mock("@/lib/services/pdtp/trigger-events", () => ({ reconcilePdtpTriggerEvents: ok }))
vi.mock("@/lib/services/pdtp/scheduled-reminders", () => ({ runPdtpScheduledInstanceReminders: ok }))
vi.mock("@/lib/services/pdtp-adapters/legal-folder-connector", () => ({ sweepPdtpLegalFolders: ok }))
vi.mock("@/lib/services/pdtp-adapters/riohs-rollout-connector", () => ({ reconcilePdtpRiohsRollouts: ok }))
vi.mock("@/lib/services/pdtp-adapters/external-engagement-accreditation-connector", () => ({ replayDeferredMandanteCoordinations: ok }))
vi.mock("@/lib/services/cron-staleness", () => ({ findStalePreventionCronJobs: async () => { await mocks.work(); return [] } }))
vi.mock("@/lib/services/prevention-capa-reminders", () => ({ runPreventionCapaReminders: ok }))
vi.mock("@/lib/services/prevention-training-obligations", () => ({ runPreventionTrainingObligations: ok }))
vi.mock("@/lib/services/prevention-cphs-reminders", () => ({ runPreventionCphsReminders: ok }))
vi.mock("@/lib/services/prevention-incident-reminders", () => ({ runPreventionIncidentReminders: ok }))
vi.mock("@/lib/services/pdtp-adapters/incident-accreditation-connector", () => ({
  reconcileIncidentRe20Obligations: (...args: unknown[]) => Reflect.apply(mocks.re20Sweep, null, args),
}))
vi.mock("@/lib/services/prevention-inspection-scheduler", () => ({ materializeProgramRuns: ok, alertCriticalFindingsWithoutCapa: ok }))
vi.mock("@/lib/services/prevention-document-ack-reminders", () => ({ runPreventionDocumentAckReminders: ok }))
// F3 (§9.1): barrido diario del Programa de Trabajo MIPER.
vi.mock("@/lib/services/miper/reminders", () => ({ runMiperOccurrenceSweep: ok }))
vi.mock("@/lib/services/prevention-permits", () => ({ suspendExpiredPermits: ok }))
vi.mock("@/lib/services/sst-alerts", () => ({ checkOverdueWeeklyAlerts: ok }))
vi.mock("@/lib/services/deadline-reminders", () => ({ runDeadlineReminders: ok }))
vi.mock("@/lib/services/pdtp/evidence-integrity", () => ({ scanPdtpEvidenceIntegrity: ok }))
vi.mock("@/lib/services/pdtp/evidence-gc", () => ({
  MIN_ORPHAN_AGE_MS: 24 * 60 * 60 * 1000,
  cleanupPdtpEvidenceOrphans: (...args: unknown[]) => Reflect.apply(mocks.pdtpGc, null, args),
  cleanupRiskMapOrphans: (...args: unknown[]) => Reflect.apply(mocks.riskMapGc, null, args),
}))

const { runCronJob } = await import("../../../scripts/cron-runner.mjs")

const ROUTES = {
  "pdtp-weekly-reminders": { load: () => import("./pdtp-weekly-reminders/route"), prefix: "PREVENTION_CRON_" },
  "pdtp-daily-reconcile": { load: () => import("./pdtp-daily-reconcile/route"), prefix: "PREVENTION_CRON_" },
  "prevention-cron-staleness": { load: () => import("./prevention-cron-staleness/route"), prefix: "PREVENTION_CRON_" },
  "prevention-capa-reminders": { load: () => import("./prevention-capa-reminders/route"), prefix: "PREVENTION_CRON_" },
  "prevention-training-reminders": { load: () => import("./prevention-training-reminders/route"), prefix: "PREVENTION_CRON_" },
  "prevention-cphs-alerts": { load: () => import("./prevention-cphs-alerts/route"), prefix: "PREVENTION_CRON_" },
  "prevention-incident-reminders": { load: () => import("./prevention-incident-reminders/route"), prefix: "PREVENTION_CRON_" },
  "prevention-inspection-programs": { load: () => import("./prevention-inspection-programs/route"), prefix: "PREVENTION_CRON_" },
  "prevention-document-ack-reminders": { load: () => import("./prevention-document-ack-reminders/route"), prefix: "PREVENTION_CRON_" },
  // F3 (§9.1): barrido diario de las ocurrencias del Programa de Trabajo MIPER.
  "prevention-miper-daily-sweep": { load: () => import("./prevention-miper-daily-sweep/route"), prefix: "PREVENTION_CRON_" },
  // #18: el vencimiento de permisos existía y sólo lo llamaba una prueba.
  "prevention-permit-expiry": { load: () => import("./prevention-permit-expiry/route"), prefix: "PREVENTION_CRON_" },
  "sst-weekly-alerts": { load: () => import("./sst-weekly-alerts/route"), prefix: "SST_CRON_" },
  "deadline-reminders": { load: () => import("./deadline-reminders/route"), prefix: "DEADLINE_REMINDERS_" },
  // PREV-I13-C: escaneo de integridad de la evidencia PDTP.
  "pdtp-evidence-integrity": { load: () => import("./pdtp-evidence-integrity/route"), prefix: "PREVENTION_CRON_" },
  // W5-GC (T7a): el barrido de huérfanos, agendado en modo de prueba (D13).
  "pdtp-evidence-gc": { load: () => import("./pdtp-evidence-gc/route"), prefix: "PREVENTION_CRON_" },
} as const

type JobName = keyof typeof ROUTES

/** Llama al handler real y le entrega su respuesta al runner real. */
async function runThroughRunner(job: JobName) {
  const { GET } = await ROUTES[job].load()
  const response = await GET(new NextRequest(`http://app:3000/api/cron/${job}`, { headers: { authorization: "Bearer secreto" } }))
  const body = await response.clone().json()
  const log = vi.fn()
  const exitCode = await runCronJob(job, { secret: "secreto", log, fetchImpl: vi.fn().mockResolvedValue(response) })
  return { status: response.status, body, exitCode, log }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = "secreto"
  mocks.verifyCronSecret.mockReturnValue(true)
  // Con un contador `skipped` numérico, como el que devuelve el barrido de
  // capacitación: una corrida buena no puede leerse como un disparo saltado.
  mocks.work.mockResolvedValue({ skipped: 0 })
  mocks.withCronLock.mockImplementation(async (_name: string, run: () => Promise<unknown>) => run())
  mocks.re20Sweep.mockResolvedValue({ created: 0, reported: 0, errors: 0 })
  const empty = { scanned: 0, deleted: 0, kept: 0, failed: 0, deletedNames: [] }
  mocks.pdtpGc.mockImplementation(async () => { await mocks.work(); return empty })
  mocks.riskMapGc.mockResolvedValue(empty)
  delete process.env.PDTP_EVIDENCE_GC_DELETE
})

describe.each(Object.keys(ROUTES) as JobName[])("cron %s llamado por el runner", (job) => {
  const prefix = ROUTES[job].prefix

  it("una corrida buena sale con código 0", async () => {
    const { status, body, exitCode } = await runThroughRunner(job)
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, outcome: "success", code: `${prefix}SUCCESS` })
    expect(exitCode).toBe(0)
  })

  it("un disparo solapado se salta sin contar como falla", async () => {
    mocks.withCronLock.mockResolvedValue({ skipped: true, reason: "another run in progress" })
    const { status, body, exitCode } = await runThroughRunner(job)
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, outcome: "skipped", code: `${prefix}SKIPPED` })
    expect(exitCode).toBe(0)
  })

  it("una falla responde 503 y el runner la reporta como falla, no como contrato roto", async () => {
    mocks.work.mockRejectedValue(new Error("boom"))
    const { status, body, exitCode, log } = await runThroughRunner(job)
    expect(status).toBe(503)
    expect(body).toMatchObject({ ok: false, outcome: "failed", code: `${prefix}FAILED` })
    expect(exitCode).toBe(1)
    expect(log.mock.calls.flat().join(" ")).not.toContain("DTE_CRON_RUNNER_CONTRACT")
  })
})

/* D4 (T3): el barrido RE-20 corre cada hora dentro del cron de recordatorios
 * de incidentes, bajo el mismo candado. Una falla del barrido no puede tumbar
 * los recordatorios de plazos legales. */
describe("cron prevention-incident-reminders con el barrido RE-20 (D4)", () => {
  it("encadena el barrido y devuelve su resumen", async () => {
    mocks.re20Sweep.mockResolvedValue({ created: 2, reported: 1, errors: 0 })
    const { status, body, exitCode } = await runThroughRunner("prevention-incident-reminders")
    expect(status).toBe(200)
    expect(exitCode).toBe(0)
    expect(mocks.re20Sweep).toHaveBeenCalledTimes(1)
    expect(body).toMatchObject({ outcome: "success", re20Obligations: { created: 2, reported: 1 } })
  })

  it("si el barrido lanza, los recordatorios igual cuentan como corrida buena", async () => {
    mocks.re20Sweep.mockRejectedValue(new Error("boom"))
    const { status, body, exitCode } = await runThroughRunner("prevention-incident-reminders")
    expect(status).toBe(200)
    expect(exitCode).toBe(0)
    expect(body).toMatchObject({ outcome: "success", re20Obligations: { failed: true } })
  })
})

describe("cron pdtp-evidence-integrity (PREV-I13-C)", () => {
  it("encontrar evidencia perdida no es una falla del cron: sale 0 y reporta los conteos", async () => {
    mocks.work.mockResolvedValue({
      ok: false, references: 3, checkedFiles: 2, missingCount: 1, checksumMismatchCount: 0, withoutChecksum: 1,
      missing: [{ path: "storage/pdtp-evidence/perdida.pdf", owners: [{ source: "execution", ownerId: "exec-1", worksiteId: "ws-1" }] }],
      checksumMismatches: [],
    })
    const { status, body, exitCode } = await runThroughRunner("pdtp-evidence-integrity")
    expect(status).toBe(200)
    expect(exitCode).toBe(0)
    expect(body).toMatchObject({
      ok: true, outcome: "success", code: "PREVENTION_CRON_SUCCESS",
      integrity: { ok: false, missingCount: 1, checksumMismatchCount: 0, checkedFiles: 2 },
    })
    expect(body.integrity.missingSample).toEqual(["storage/pdtp-evidence/perdida.pdf"])
  })

  it("la respuesta cabe en el límite del runner aunque falten miles de archivos", async () => {
    const missing = Array.from({ length: 5000 }, (_, i) => ({
      path: `storage/pdtp-evidence/${"x".repeat(20)}-${i}.pdf`,
      owners: [{ source: "execution", ownerId: `exec-${i}`, worksiteId: "ws-1" }],
    }))
    mocks.work.mockResolvedValue({
      ok: false, references: 5000, checkedFiles: 5000, missingCount: 5000, checksumMismatchCount: 0, withoutChecksum: 0,
      missing, checksumMismatches: [],
    })
    const { body, exitCode } = await runThroughRunner("pdtp-evidence-integrity")
    expect(exitCode).toBe(0)
    expect(JSON.stringify(body).length).toBeLessThan(32 * 1024)
  })
})

/* W5-GC (T7a, D13): el barrido se agenda, pero en modo de prueba. Borrar de
 * verdad exige encender `PDTP_EVIDENCE_GC_DELETE=true` en el servicio `app`
 * después de revisar una o dos semanas de filas `storage_orphan_sweep`. */
describe("cron pdtp-evidence-gc (W5-GC)", () => {
  async function callRoute(query = "") {
    const { GET } = await import("./pdtp-evidence-gc/route")
    const response = await GET(new NextRequest(`http://app:3000/api/cron/pdtp-evidence-gc${query}`, { headers: { authorization: "Bearer secreto" } }))
    return { status: response.status, body: await response.json() }
  }

  it("sin la variable, corre en modo de prueba en los dos directorios", async () => {
    const { status, body } = await callRoute()
    expect(status).toBe(200)
    expect(body).toMatchObject({ outcome: "success", dryRun: true })
    expect(mocks.pdtpGc).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }))
    expect(mocks.riskMapGc).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }))
  })

  it("con PDTP_EVIDENCE_GC_DELETE=true borra de verdad", async () => {
    process.env.PDTP_EVIDENCE_GC_DELETE = "true"
    const { body } = await callRoute()
    expect(body).toMatchObject({ outcome: "success", dryRun: false })
    expect(mocks.pdtpGc).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false }))
  })

  it("?dryRun=true gana aunque la variable esté encendida", async () => {
    process.env.PDTP_EVIDENCE_GC_DELETE = "true"
    const { body } = await callRoute("?dryRun=true")
    expect(body).toMatchObject({ dryRun: true })
  })

  it("rechaza una ventana de gracia menor a una hora", async () => {
    const { status, body } = await callRoute("?olderThanMs=60000")
    expect(status).toBe(400)
    expect(body).toMatchObject({ ok: false })
    expect(mocks.pdtpGc).not.toHaveBeenCalled()
  })

  it("rechaza una ventana de 2 horas: el mínimo es de 24 (revisión final, hallazgo 2)", async () => {
    const { status, body } = await callRoute(`?olderThanMs=${2 * 60 * 60 * 1000}`)
    expect(status).toBe(400)
    expect(body.error).toMatch(/24 horas/)
    expect(mocks.pdtpGc).not.toHaveBeenCalled()
  })

  it("la respuesta cabe en el límite del runner aunque haya miles de huérfanos", async () => {
    const names = Array.from({ length: 5000 }, (_, i) => `${"x".repeat(21)}-${i}.pdf`)
    mocks.pdtpGc.mockResolvedValue({ scanned: 5000, deleted: 5000, kept: 0, failed: 0, deletedNames: names })
    const { body } = await callRoute()
    expect(JSON.stringify(body).length).toBeLessThan(32 * 1024)
    expect(body.pdtpEvidence).toMatchObject({ deleted: 5000 })
    expect(body.pdtpEvidence.deletedSample).toHaveLength(20)
  })
})

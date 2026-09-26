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
}))
vi.mock("@/lib/services/pdtp/fulfillment", () => ({ reconcilePdtpFulfillmentEvents: ok }))
vi.mock("@/lib/services/pdtp/scheduled-instances", () => ({ reconcilePdtpScheduledInstances: ok }))
vi.mock("@/lib/services/pdtp/trigger-events", () => ({ reconcilePdtpTriggerEvents: ok }))
vi.mock("@/lib/services/pdtp/scheduled-reminders", () => ({ runPdtpScheduledInstanceReminders: ok }))
vi.mock("@/lib/services/pdtp-adapters/legal-folder-connector", () => ({ sweepPdtpLegalFolders: ok }))
vi.mock("@/lib/services/pdtp-adapters/riohs-rollout-connector", () => ({ reconcilePdtpRiohsRollouts: ok }))
vi.mock("@/lib/services/prevention-capa-reminders", () => ({ runPreventionCapaReminders: ok }))
vi.mock("@/lib/services/prevention-training-obligations", () => ({ runPreventionTrainingObligations: ok }))
vi.mock("@/lib/services/prevention-cphs-reminders", () => ({ runPreventionCphsReminders: ok }))
vi.mock("@/lib/services/prevention-incident-reminders", () => ({ runPreventionIncidentReminders: ok }))
vi.mock("@/lib/services/prevention-inspection-scheduler", () => ({ materializeProgramRuns: ok, alertCriticalFindingsWithoutCapa: ok }))
vi.mock("@/lib/services/prevention-document-ack-reminders", () => ({ runPreventionDocumentAckReminders: ok }))
vi.mock("@/lib/services/sst-alerts", () => ({ checkOverdueWeeklyAlerts: ok }))
vi.mock("@/lib/services/deadline-reminders", () => ({ runDeadlineReminders: ok }))

const { runCronJob } = await import("../../../scripts/cron-runner.mjs")

const ROUTES = {
  "pdtp-weekly-reminders": { load: () => import("./pdtp-weekly-reminders/route"), prefix: "PREVENTION_CRON_" },
  "prevention-capa-reminders": { load: () => import("./prevention-capa-reminders/route"), prefix: "PREVENTION_CRON_" },
  "prevention-training-reminders": { load: () => import("./prevention-training-reminders/route"), prefix: "PREVENTION_CRON_" },
  "prevention-cphs-alerts": { load: () => import("./prevention-cphs-alerts/route"), prefix: "PREVENTION_CRON_" },
  "prevention-incident-reminders": { load: () => import("./prevention-incident-reminders/route"), prefix: "PREVENTION_CRON_" },
  "prevention-inspection-programs": { load: () => import("./prevention-inspection-programs/route"), prefix: "PREVENTION_CRON_" },
  "prevention-document-ack-reminders": { load: () => import("./prevention-document-ack-reminders/route"), prefix: "PREVENTION_CRON_" },
  "sst-weekly-alerts": { load: () => import("./sst-weekly-alerts/route"), prefix: "SST_CRON_" },
  "deadline-reminders": { load: () => import("./deadline-reminders/route"), prefix: "DEADLINE_REMINDERS_" },
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

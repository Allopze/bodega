import { beforeEach, describe, expect, it, vi } from "vitest"

/* Las cuatro consultas corren en un `Promise.all` y sus expresiones se evalúan
 * en orden, así que una cola basta para darle a cada una su resultado: planes,
 * matrices MIPER, matrices GRD, versiones documentales. */
const mocks = vi.hoisted(() => ({
  queues: [] as unknown[][],
  recipients: vi.fn(),
  createNotifications: vi.fn(),
}))

vi.mock("@/db", () => {
  const chain = () => {
    const rows = mocks.queues.shift() ?? []
    const self: Record<string, unknown> = {}
    self.from = () => self
    self.innerJoin = () => self
    self.where = () => Promise.resolve(rows)
    self.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve)
    return self
  }
  return { db: { select: () => chain() } }
})

vi.mock("@/lib/services/notifications", () => ({
  getUserIdsWithPermissionForWorksite: mocks.recipients,
  createNotifications: mocks.createNotifications,
}))

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { runPdtpSignaturePendingReminders } from "./reminders"

const AHORA = new Date("2026-09-05T12:00:00.000Z")
const hace = (days: number) => new Date(AHORA.getTime() - days * 86_400_000).toISOString()

function queue(options: {
  plans?: unknown[]
  risk?: unknown[]
  grd?: unknown[]
  docs?: unknown[]
} = {}) {
  mocks.queues = [options.plans ?? [], options.risk ?? [], options.grd ?? [], options.docs ?? []]
}

describe("runPdtpSignaturePendingReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.recipients.mockResolvedValue(["u-firmante"])
  })

  /* El caso que originó la alerta: los siete planes de emergencia del 2026
   * llevaban meses en borrador, la N°83 sin cumplirse y la N°84 esperando
   * detrás, sin que nada lo dijera. */
  it("avisa a quien puede aprobar un plan de emergencia estancado", async () => {
    queue({ plans: [{ id: "plan-1", worksiteId: "ws-1", title: "Plan de incendio", status: "draft", updatedAt: hace(10) }] })

    const result = await runPdtpSignaturePendingReminders(AHORA)

    expect(result).toMatchObject({ pending: 1, remindersDue: 1, notifiedUsers: 1 })
    expect(mocks.recipients).toHaveBeenCalledWith("prevention:emergency:approve", "ws-1")
    expect(mocks.createNotifications).toHaveBeenCalledWith(["u-firmante"], expect.objectContaining({
      dedupeKey: "pdtp-firma-pendiente:emergency_plan:plan-1:draft:7d",
      entityHref: "/prevencion/emergencias/plan-1",
    }))
  })

  it("no avisa antes de la primera semana", async () => {
    queue({ plans: [{ id: "plan-1", worksiteId: "ws-1", title: "Plan reciente", status: "draft", updatedAt: hace(3) }] })

    const result = await runPdtpSignaturePendingReminders(AHORA)

    expect(result.remindersDue).toBe(0)
    expect(mocks.createNotifications).not.toHaveBeenCalled()
    // Sigue contándose como pendiente: existe, sólo que todavía no toca avisar.
    expect(result.pending).toBe(1)
  })

  /* Tres escalones y no un aviso diario. La clave lleva el escalón adentro, así
   * que la misma espera produce como mucho tres correos. */
  it.each([
    [8, "7d"],
    [20, "15d"],
    [40, "30d"],
  ])("a los %i días avisa en el escalón %s", async (dias, bucket) => {
    queue({ plans: [{ id: "plan-1", worksiteId: "ws-1", title: "Plan", status: "draft", updatedAt: hace(dias as number) }] })

    await runPdtpSignaturePendingReminders(AHORA)

    expect(mocks.createNotifications).toHaveBeenCalledWith(["u-firmante"], expect.objectContaining({
      dedupeKey: `pdtp-firma-pendiente:emergency_plan:plan-1:draft:${bucket}`,
    }))
  })

  /* El permiso sale del paso siguiente, no del actual: una matriz revisada
   * espera a quien pueda aprobarla. */
  it("le pide a cada paso la firma que corresponde", async () => {
    queue({
      risk: [
        { id: "miper-1", worksiteId: "ws-1", title: "MIPER en revisión", status: "in_review", updatedAt: hace(10) },
        { id: "miper-2", worksiteId: "ws-1", title: "MIPER revisada", status: "reviewed", updatedAt: hace(10) },
        { id: "miper-3", worksiteId: "ws-1", title: "MIPER aprobada", status: "approved", updatedAt: hace(10) },
      ],
    })

    await runPdtpSignaturePendingReminders(AHORA)

    const permisos = mocks.recipients.mock.calls.map(([permission]) => permission)
    expect(permisos).toEqual([
      "prevention:risk:review",
      "prevention:risk:approve",
      "prevention:risk:publish",
    ])
  })

  it("distingue aprobar de publicar en el flujo documental", async () => {
    queue({
      docs: [
        { id: "ver-1", documentId: "doc-1", worksiteId: "ws-1", title: "PTS", status: "en_revision", updatedAt: hace(10) },
        { id: "ver-2", documentId: "doc-2", worksiteId: "ws-1", title: "PTS aprobado", status: "aprobado", updatedAt: hace(10) },
      ],
    })

    await runPdtpSignaturePendingReminders(AHORA)

    expect(mocks.recipients.mock.calls.map(([permission]) => permission)).toEqual([
      "prevention:docs:approve",
      "prevention:docs:publish",
    ])
  })

  /* Un documento corporativo no tiene faena, y los destinatarios se resuelven
   * por permiso Y faena: no hay a quién avisarle. */
  it("omite las versiones documentales sin faena", async () => {
    queue({ docs: [{ id: "ver-1", documentId: "doc-1", worksiteId: null, title: "Política corporativa", status: "aprobado", updatedAt: hace(30) }] })

    const result = await runPdtpSignaturePendingReminders(AHORA)

    expect(result.pending).toBe(0)
    expect(mocks.createNotifications).not.toHaveBeenCalled()
  })

  /* Peor que un atraso: la actividad espera una firma que ninguna persona de
   * esa faena puede dar. No hay a quién notificar, así que queda en el log. */
  it("no inventa destinatarios cuando nadie en la faena puede firmar", async () => {
    mocks.recipients.mockResolvedValue([])
    queue({ plans: [{ id: "plan-1", worksiteId: "ws-1", title: "Plan huérfano", status: "draft", updatedAt: hace(40) }] })

    const result = await runPdtpSignaturePendingReminders(AHORA)

    expect(result).toMatchObject({ pending: 1, remindersDue: 0, notifiedUsers: 0 })
    expect(mocks.createNotifications).not.toHaveBeenCalled()
  })

  it("resuelve los destinatarios una vez por permiso y faena", async () => {
    queue({
      plans: [
        { id: "plan-1", worksiteId: "ws-1", title: "Plan A", status: "draft", updatedAt: hace(10) },
        { id: "plan-2", worksiteId: "ws-1", title: "Plan B", status: "draft", updatedAt: hace(10) },
        { id: "plan-3", worksiteId: "ws-2", title: "Plan C", status: "draft", updatedAt: hace(10) },
      ],
    })

    await runPdtpSignaturePendingReminders(AHORA)

    // Tres planes, dos faenas: dos consultas de destinatarios, no tres.
    expect(mocks.recipients).toHaveBeenCalledTimes(2)
    expect(mocks.createNotifications).toHaveBeenCalledTimes(3)
  })
})

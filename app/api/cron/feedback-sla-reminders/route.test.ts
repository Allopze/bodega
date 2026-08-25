import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  verifyCronSecret: vi.fn(),
  withCronLock: vi.fn(),
  runFeedbackSlaReminders: vi.fn(),
}))

vi.mock("@/lib/security/cron-auth", () => ({ verifyCronSecret: mocks.verifyCronSecret }))
vi.mock("@/lib/services/cron-lock", () => ({ withCronLock: mocks.withCronLock }))
vi.mock("@/lib/services/feedback-sla-reminders", () => ({ runFeedbackSlaReminders: mocks.runFeedbackSlaReminders }))
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

import { GET } from "./route"

function request() {
  return new Request("http://localhost/api/cron/feedback-sla-reminders", {
    headers: { authorization: "Bearer cron-secret" },
  })
}

describe("GET /api/cron/feedback-sla-reminders", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "cron-secret"
  })

  it("rejects a request without valid cron authentication", async () => {
    mocks.verifyCronSecret.mockReturnValue(false)

    const response = await GET(request() as never)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ outcome: "unauthorized", code: "FEEDBACK_CRON_UNAUTHORIZED" })
  })

  it("locks the job and returns the scheduler contract", async () => {
    mocks.verifyCronSecret.mockReturnValue(true)
    mocks.withCronLock.mockImplementation(async (_name: string, work: () => Promise<unknown>) => work())
    mocks.runFeedbackSlaReminders.mockResolvedValue({ examined: 2, dueSoon: 1, overdue: 1, deliveries: 2 })

    const response = await GET(request() as never)

    expect(mocks.withCronLock).toHaveBeenCalledWith("feedback-sla-reminders", expect.any(Function))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, outcome: "success", code: "FEEDBACK_CRON_SUCCESS", overdue: 1 })
  })
})

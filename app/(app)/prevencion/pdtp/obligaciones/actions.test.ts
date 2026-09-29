import { beforeEach, describe, expect, it, vi } from "vitest"

const guardPermission = vi.hoisted(() => vi.fn())
const resolveWorksiteScope = vi.hoisted(() => vi.fn())
const createPdtpObligation = vi.hoisted(() => vi.fn())
const reportPdtpObligation = vi.hoisted(() => vi.fn())
const cancelPdtpObligation = vi.hoisted(() => vi.fn())
const requestPdtpObligationCancellation = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/services/prevention-pdtp", () => ({ createPdtpObligation, reportPdtpObligation, cancelPdtpObligation }))
vi.mock("@/lib/services/pdtp/review-requests", () => ({ requestPdtpObligationCancellation }))

import { cancelPdtpObligationAction, createPdtpObligationAction, reportPdtpObligationAction } from "./actions"

const session = { user: { id: "trusted-user", permissions: ["prevention:pdtp:execute"] } }

describe("PDTP obligation actions are authorization boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guardPermission.mockResolvedValue({ session, error: null })
    resolveWorksiteScope.mockReturnValue({ mode: "some", ids: ["ws-own"] })
    createPdtpObligation.mockResolvedValue({})
    reportPdtpObligation.mockResolvedValue({})
    cancelPdtpObligation.mockResolvedValue({})
    requestPdtpObligationCancellation.mockResolvedValue({})
  })

  it("fails closed without execute permission", async () => {
    const error = { ok: false, message: "No tienes permisos" }
    guardPermission.mockResolvedValue({ session: null, error })
    await expect(createPdtpObligationAction({})).resolves.toEqual(error)
    expect(createPdtpObligation).not.toHaveBeenCalled()
  })

  it("derives actor and worksite scope when creating a manual obligation", async () => {
    await expect(createPdtpObligationAction({
      activityId: "activity-1",
      worksiteId: "ws-own",
      origin: "manual",
      clientRequestId: "request-1234",
      plannedQuantity: 1,
      manualReason: "Necesidad real registrada por operación",
      sourceMetadata: {},
      userId: "forged",
      scope: "all",
    })).resolves.toEqual({ ok: true })
    expect(createPdtpObligation).toHaveBeenCalledWith(expect.objectContaining({
      activityId: "activity-1",
      userId: "trusted-user",
      scope: ["ws-own"],
    }))
  })

  /* Revisión final 2026-09-27 (NEW-01): el esquema de la acción aceptaba
   * `origin: "integration"` y la fecha/metadatos de la fuente desde el
   * cliente. Una obligación "integrada" se salta la exigencia de archivo al
   * reportar y al aprobar (PREV-B02) y su fecha de origen fija el plazo (I11).
   * Sólo los conectores del servidor crean integradas, por el servicio. */
  it("una llamada armada con origin 'integration' crea igual una obligación manual, sin fecha ni metadatos de fuente", async () => {
    await expect(createPdtpObligationAction({
      activityId: "activity-1",
      worksiteId: "ws-own",
      origin: "integration",
      clientRequestId: "request-forged",
      sourceType: "inspeccion",
      sourceId: "run-forged",
      sourceOccurredAt: "2020-01-01T00:00:00.000Z",
      sourceMetadata: { approvalMode: "automatic_source_event" },
      manualReason: "Motivo que se ve legítimo en la llamada",
      plannedQuantity: 1,
    })).resolves.toEqual({ ok: true })
    const call = createPdtpObligation.mock.calls[0]![0]
    expect(call).toMatchObject({ origin: "manual", sourceMetadata: {}, userId: "trusted-user" })
    expect(call.sourceOccurredAt).toBeUndefined()
  })

  it("sin motivo, la llamada armada como integración se rechaza como cualquier manual", async () => {
    const result = await createPdtpObligationAction({
      activityId: "activity-1", worksiteId: "ws-own", origin: "integration", clientRequestId: "request-forged-2",
      sourceType: "inspeccion", sourceId: "run-forged", sourceOccurredAt: "2026-09-01T00:00:00.000Z",
    })
    expect(result).toMatchObject({ ok: false })
    expect(createPdtpObligation).not.toHaveBeenCalled()
  })

  it("derives actor and scope for reporting and cancellation", async () => {
    await reportPdtpObligationAction({ obligationId: "ob-1", executedQuantity: 1, evidenceText: "Registro verificable", evidencePhotos: [] })
    await cancelPdtpObligationAction({ obligationId: "ob-2", reason: "Caso duplicado y formalmente fusionado" })
    expect(reportPdtpObligation).toHaveBeenCalledWith(expect.objectContaining({ userId: "trusted-user", scope: ["ws-own"] }))
    // PRV-05: desde la pantalla se pide la cancelación; no se cancela directo.
    expect(cancelPdtpObligation).not.toHaveBeenCalled()
    expect(requestPdtpObligationCancellation).toHaveBeenCalledWith(
      { targetId: "ob-2", reason: "Caso duplicado y formalmente fusionado" }, "trusted-user", ["ws-own"],
    )
  })

  // PREV-I11: `closed_on_time` compara `reportedAt <= dueAt`. Con la fecha en
  // manos del cliente, un POST armado cerraba a tiempo lo que venció hace un
  // mes. El servicio la fija en `now()` cuando no se la pasan.
  it("ignora un reportedAt enviado por el cliente", async () => {
    await expect(reportPdtpObligationAction({
      obligationId: "ob-1",
      executedQuantity: 1,
      evidenceText: "Registro verificable",
      evidencePhotos: [],
      reportedAt: "2026-01-02T12:00:00.000Z",
    })).resolves.toEqual({ ok: true })
    expect(reportPdtpObligation).toHaveBeenCalledTimes(1)
    expect(reportPdtpObligation.mock.calls[0]![0]).not.toHaveProperty("reportedAt")
  })
})

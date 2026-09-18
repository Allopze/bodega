import { describe, expect, it } from "vitest"
import {
  assertPdtpTriggerEventSupported,
  pdtpTriggerEventIdempotencyKey,
} from "@/lib/services/pdtp/trigger-events"

describe("PDTP trigger events", () => {
  it("builds one durable idempotency key for a source occurrence", () => {
    expect(pdtpTriggerEventIdempotencyKey({
      connectorKey: "worker",
      eventKey: "worker_created",
      sourceType: "worker",
      sourceId: "worker-1",
      worksiteId: "ws-1",
    })).toBe("pdtp-trigger:worker:worker_created:worker:worker-1:ws-1")
  })

  it("rejects event names without a registered producer", () => {
    expect(() => assertPdtpTriggerEventSupported("worker", "worker_created")).not.toThrow()
    expect(() => assertPdtpTriggerEventSupported("worker", "free_text_event")).toThrow("no está soportado")
    expect(() => assertPdtpTriggerEventSupported("free_text", "created")).toThrow("no está registrado")
  })
})

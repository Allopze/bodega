import { describe, expect, it } from "vitest"
import { resolveSelectedWorkerWorksite } from "./nueva-evaluacion-form.helpers"

const workers = [
  { id: "worker-1", name: "Ana Perez", rut: "1-9", worksiteId: "ws-norte" },
  { id: "worker-2", name: "Beto Soto", rut: "2-7", worksiteId: "ws-sur" },
]

describe("resolveSelectedWorkerWorksite", () => {
  it("always returns the selected worker worksite, replacing any previous worksite", () => {
    expect(resolveSelectedWorkerWorksite(workers, "worker-2", "ws-norte")).toBe("ws-sur")
  })

  it("keeps the current worksite when the worker cannot be resolved", () => {
    expect(resolveSelectedWorkerWorksite(workers, "missing", "ws-norte")).toBe("ws-norte")
  })
})

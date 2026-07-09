import { describe, expect, it } from "vitest"
import { buildNuevaEvaluacionScope } from "./nueva-evaluacion-page.helpers"

describe("buildNuevaEvaluacionScope", () => {
  it("keeps global users unscoped", () => {
    expect(buildNuevaEvaluacionScope({ mode: "all", ids: [] })).toEqual({ worksiteIds: "all", hasRows: true })
  })

  it("scopes faena users to their assigned worksites", () => {
    expect(buildNuevaEvaluacionScope({ mode: "some", ids: ["ws-1"] })).toEqual({ worksiteIds: ["ws-1"], hasRows: true })
  })

  it("does not let users without assigned worksites fall through to every worker", () => {
    expect(buildNuevaEvaluacionScope({ mode: "none", ids: [] })).toEqual({ worksiteIds: [], hasRows: false })
  })
})

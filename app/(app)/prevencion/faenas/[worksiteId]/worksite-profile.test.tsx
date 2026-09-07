// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { WorksiteProfile } from "./worksite-profile"

describe("WorksiteProfile", () => {
  it("conserva la faena al derivar una brecha de comité hacia CPHS", () => {
    render(<WorksiteProfile
      profile={{
        worksiteId: "ws-cphs-b",
        worksiteName: "Faena B",
        headcount: 30,
        declaredHeadcount: null,
        prevencionista: null,
        committee: null,
        delegate: null,
        program: null,
        compliance: {
          required: "cphs",
          compliant: false,
          detail: "La faena requiere Comité Paritario.",
        },
      }}
      eligibleWorkers={[]}
      canManage
    />)

    expect(screen.getByRole("link", { name: "Ir a CPHS" }))
      .toHaveAttribute("href", "/prevencion/cphs?faena=ws-cphs-b")
  })
})

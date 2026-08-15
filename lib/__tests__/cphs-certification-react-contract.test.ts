import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(
  path.join(process.cwd(), "app/(app)/prevencion/cphs/[committeeId]/certificacion/certification-panel.tsx"),
  "utf8",
)

describe("contratos React del expediente de certificación CPHS", () => {
  it("no conserva una copia obsoleta del estado del requisito", () => {
    expect(source).not.toContain("React.useState(requirement.status)")
    expect(source).toContain('name="status"')
    expect(source).toContain("defaultValue={requirement.status}")
    expect(source).toContain("key={`${requirement.code}:${requirement.status}`}")
    expect(source).toContain('status: form.get("status")')
  })
})

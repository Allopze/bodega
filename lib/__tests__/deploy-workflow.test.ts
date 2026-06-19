import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const repoRoot = process.cwd()

describe("deploy workflow", () => {
  it("builds and publishes the production Docker stage", () => {
    const workflow = readFileSync(path.join(repoRoot, ".github/workflows/deploy.yml"), "utf8")
    const buildPushStep = workflow.match(/uses: docker\/build-push-action@v6[\s\S]*?(?=\n\s{6}- name:|\n\s{2}# Optional rollout job:|$)/)?.[0]

    expect(buildPushStep).toBeDefined()
    expect(buildPushStep).toContain("target: prod")
  })
})

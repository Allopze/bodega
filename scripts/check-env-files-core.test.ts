import { describe, expect, it } from "vitest"
import { inspectEnvFiles, isEnvironmentFile } from "./check-env-files-core"

describe("check-env-files policy", () => {
  it.each(["doc.env", "prod.env", "config.env.local", ".env", ".env.production", "nested/doc.env"])(
    "recognizes %s as an environment file",
    (file) => expect(isEnvironmentFile(file)).toBe(true),
  )

  it("does not classify ordinary filenames as environment files", () => {
    expect(isEnvironmentFile("environment-guide.md")).toBe(false)
    expect(isEnvironmentFile("lib/env.ts")).toBe(false)
  })

  it("allows only the sanitized root template and rejects arbitrary tracked env files", () => {
    const result = inspectEnvFiles({
      trackedFiles: [".env.example", "doc.env", "prod.env", "config.env.local"],
      exampleExists: true,
      exampleContents: "AUTH_SECRET=\nPOSTGRES_PASSWORD=\n",
    })

    expect(result.disallowedEnvFiles).toEqual(["doc.env", "prod.env", "config.env.local"])
    expect(result.leakedKeys).toEqual([])
  })

  it("rejects values in sensitive keys even when the template is the only env file", () => {
    const result = inspectEnvFiles({
      trackedFiles: [".env.example"],
      exampleExists: true,
      exampleContents: "AUTH_SECRET=placeholder\nAPP_NAME=Chome\n",
    })

    expect(result.leakedKeys).toEqual(["AUTH_SECRET"])
  })
})

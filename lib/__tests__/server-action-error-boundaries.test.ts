import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

async function actionFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return actionFiles(absolute)
    const relative = path.relative(process.cwd(), absolute)
    const isActionFile = entry.name === "actions.ts"
      || entry.name.endsWith("-action.ts")
      || relative.includes(`${path.sep}actions${path.sep}`)
    return isActionFile && entry.name.endsWith(".ts") ? [relative] : []
  }))
  return nested.flat()
}

describe("server action error boundaries", () => {
  it("does not serialize raw Error.message values to the client", async () => {
    const files = await actionFiles(path.join(process.cwd(), "app"))
    const offenders: string[] = []

    for (const file of files) {
      const source = await readFile(path.join(process.cwd(), file), "utf8")
      if (/\b([A-Za-z_$][\w$]*)\s+instanceof\s+Error\s*\?\s*\1\.message/.test(source)) offenders.push(file)
    }

    expect(offenders, "Use safeActionMessage or an explicitly classified safe error").toEqual([])
  })
})

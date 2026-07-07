import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)

describe("db/seed scope", () => {
  it("dry-runs in production without seeding users, RBAC, or operational programs", async () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: "postgres://dry:dry@localhost:5432/dry",
      NODE_ENV: "production",
      SEED_DRY_RUN: "true",
    }
    delete env.SEED_ADMIN_EMAIL
    delete env.SEED_ADMIN_NAME
    delete env.SEED_ADMIN_PASSWORD

    const { stdout } = await execFileAsync("npx", ["tsx", "db/seed.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    })

    expect(stdout).toContain("Faenas: 9")
    expect(stdout).toContain("Trabajadores: 146")
    expect(stdout).toContain("Catálogo EPP: 53 productos · 2 proveedores")
    expect(stdout).not.toContain("Admin:")
    expect(stdout).not.toContain("Roles:")
    expect(stdout).not.toContain("Permisos:")
    expect(stdout).not.toContain("Catálogo PDTP")
  })
})

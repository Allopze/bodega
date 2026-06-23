import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { afterEach, describe, expect, it } from "vitest"
import type { DB } from "@/db"
import * as schema from "@/db/schema"
import { canManageUserInAdminScope, visibleUserIdsForAdminScope } from "@/lib/auth/admin-user-scope"
import { GLOBAL_ROLES } from "@/lib/auth/scope"

let pg: PGlite | null = null

async function makeDb() {
  pg = new PGlite()
  await pg.exec(`
    CREATE TABLE worksite_users (
      user_id text NOT NULL,
      worksite_id text NOT NULL,
      is_primary boolean NOT NULL DEFAULT false
    );
  `)
  return drizzle(pg, { schema }) as unknown as DB
}

afterEach(async () => {
  await pg?.close()
  pg = null
})

describe("admin user worksite scope", () => {
  it("leaves global admin user listings unscoped", async () => {
    const db = await makeDb()

    await expect(visibleUserIdsForAdminScope(db, session(["administrador"]))).resolves.toBeUndefined()
  })

  it("returns only users assigned to visible worksites for restricted sessions", async () => {
    const db = await makeDb()
    await db.insert(schema.worksiteUsers).values([
      { userId: "user-visible", worksiteId: "ws-visible", isPrimary: true },
      { userId: "user-other", worksiteId: "ws-other", isPrimary: true },
      { userId: "user-both", worksiteId: "ws-visible", isPrimary: false },
      { userId: "user-both", worksiteId: "ws-other", isPrimary: true },
    ])

    await expect(
      visibleUserIdsForAdminScope(db, session(["solicitante_faena"], ["ws-visible"])),
    ).resolves.toEqual(["user-both", "user-visible"])
  })

  it("returns no users for restricted sessions without worksite assignments", async () => {
    const db = await makeDb()

    await expect(visibleUserIdsForAdminScope(db, session(["solicitante_faena"]))).resolves.toEqual([])
  })

  it("denies action access to users outside the actor worksite scope", async () => {
    const db = await makeDb()
    await db.insert(schema.worksiteUsers).values([
      { userId: "user-visible", worksiteId: "ws-visible", isPrimary: true },
      { userId: "user-other", worksiteId: "ws-other", isPrimary: true },
    ])

    await expect(
      canManageUserInAdminScope(db, session(["solicitante_faena"], ["ws-visible"]), "user-visible"),
    ).resolves.toBe(true)
    await expect(
      canManageUserInAdminScope(db, session(["solicitante_faena"], ["ws-visible"]), "user-other"),
    ).resolves.toBe(false)
  })
})

function session(roles: string[], worksiteIds: string[] = []): Session {
  return {
    user: {
      id: "actor-1",
      name: "Actor",
      email: "actor@example.com",
      roles,
      permissions: ["admin:users"],
      worksiteIds,
      primaryWorksiteId: worksiteIds[0] ?? null,
      avatarColor: null,
      isActive: true,
      isGlobal: roles.some((r) => GLOBAL_ROLES.has(r)),
    },
    expires: "2099-01-01T00:00:00.000Z",
  }
}

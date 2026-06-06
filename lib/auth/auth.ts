import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { db } from "@/db"
import { users, userRoles, roles, rolePermissions, permissions, worksiteUsers } from "@/db/schema"
import { eq, inArray } from "drizzle-orm"
import { z } from "zod"

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

/** Load user with full roles/permissions from DB */
async function getUserWithAuth(email: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  })
  if (!user || !user.isActive) return null

  // Load roles
  const userRoleRows = await db
    .select({ roleId: userRoles.roleId, roleName: roles.name, roleLabel: roles.label })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, user.id))

  const roleIds = userRoleRows.map((r) => r.roleId)

  // Load permissions for those roles
  let permissionNames: string[] = []
  if (roleIds.length > 0) {
    const permsRows = await db
      .select({ permissionName: permissions.name })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(inArray(rolePermissions.roleId, roleIds))
    permissionNames = [...new Set(permsRows.map((p) => p.permissionName))]
  }

  // Load worksite scopes
  const wsRows = await db
    .select({ worksiteId: worksiteUsers.worksiteId, isPrimary: worksiteUsers.isPrimary })
    .from(worksiteUsers)
    .where(eq(worksiteUsers.userId, user.id))

  return {
    id:           user.id,
    name:         user.name,
    email:        user.email,
    avatarColor:  user.avatarColor,
    roles:        userRoleRows.map((r) => r.roleName),
    permissions:  permissionNames,
    worksiteIds:  wsRows.map((w) => w.worksiteId),
    primaryWorksiteId: wsRows.find((w) => w.isPrimary)?.worksiteId ?? wsRows[0]?.worksiteId ?? null,
    _hashedPassword: user.hashedPassword,
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,

  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email:    { label: "Correo electrónico", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials)
        if (!parsed.success) return null

        const userWithAuth = await getUserWithAuth(parsed.data.email)
        if (!userWithAuth) return null

        const valid = await bcrypt.compare(parsed.data.password, userWithAuth._hashedPassword)
        if (!valid) return null

        const { _hashedPassword: _, ...safeUser } = userWithAuth
        return safeUser
      },
    }),
  ],

  session: { strategy: "jwt" },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // First sign-in: embed RBAC into JWT
        const u = user as Omit<NonNullable<Awaited<ReturnType<typeof getUserWithAuth>>>, "_hashedPassword">
        token.id               = u.id
        token.roles            = u.roles
        token.permissions      = u.permissions
        token.worksiteIds      = u.worksiteIds
        token.primaryWorksiteId = u.primaryWorksiteId
        token.avatarColor      = u.avatarColor
      }
      return token
    },
    async session({ session, token }) {
      session.user.id               = token.id as string
      session.user.roles            = token.roles as string[]
      session.user.permissions      = token.permissions as string[]
      session.user.worksiteIds      = token.worksiteIds as string[]
      session.user.primaryWorksiteId = token.primaryWorksiteId as string | null
      session.user.avatarColor      = token.avatarColor as string | null
      return session
    },
  },

  pages: {
    signIn:  "/login",
    signOut: "/login",
    error:   "/login",
  },
})

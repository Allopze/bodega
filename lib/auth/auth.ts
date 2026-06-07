import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { db } from "@/db"
import { users } from "@/db/schema"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { applyRbacToToken, getUserRbacById } from "@/lib/auth/rbac"

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
  const rbac = await getUserRbacById(user.id)
  if (!rbac || !rbac.isActive) return null

  return {
    ...rbac,
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
        applyRbacToToken(token, u)
        return token
      }
      if (token.id) {
        const snapshot = await getUserRbacById(token.id as string)
        applyRbacToToken(token, snapshot)
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
      session.user.isActive         = token.isActive as boolean
      return session
    },
  },

  pages: {
    signIn:  "/login",
    signOut: "/login",
    error:   "/login",
  },
})

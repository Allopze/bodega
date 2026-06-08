import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { db } from "@/db"
import { users } from "@/db/schema"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { applyRbacToToken, getUserRbacById } from "@/lib/auth/rbac"

import { headers } from "next/headers"

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

const LIMIT_ATTEMPTS = 5
const LOCK_TIME = 15 * 60 * 1000 // 15 mins

interface RateLimitRecord {
  count:     number
  lockUntil: number
}

const rateLimitMap = new Map<string, RateLimitRecord>()

function checkRateLimit(key: string): { allowed: boolean; waitTimeRemainingMs: number } {
  const record = rateLimitMap.get(key)
  if (!record) return { allowed: true, waitTimeRemainingMs: 0 }
  
  const now = Date.now()
  if (record.lockUntil > now) {
    return { allowed: false, waitTimeRemainingMs: record.lockUntil - now }
  }
  
  if (record.lockUntil <= now && record.count >= LIMIT_ATTEMPTS) {
    rateLimitMap.delete(key)
    return { allowed: true, waitTimeRemainingMs: 0 }
  }
  
  return { allowed: true, waitTimeRemainingMs: 0 }
}

function recordFailure(key: string) {
  const record = rateLimitMap.get(key) || { count: 0, lockUntil: 0 }
  record.count += 1
  if (record.count >= LIMIT_ATTEMPTS) {
    record.lockUntil = Date.now() + LOCK_TIME
  }
  rateLimitMap.set(key, record)
}

function recordSuccess(key: string) {
  rateLimitMap.delete(key)
}

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

        const email = parsed.data.email.toLowerCase()
        let clientIp = "127.0.0.1"
        try {
          const headersList = await headers()
          clientIp = headersList.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1"
        } catch {
          // Fallback if headers are not available
        }

        const ipCheck = checkRateLimit(clientIp)
        if (!ipCheck.allowed) {
          throw new Error(`Demasiados intentos de inicio de sesión desde esta dirección IP. Intente de nuevo en ${Math.ceil(ipCheck.waitTimeRemainingMs / 60000)} minutos.`)
        }

        const emailCheck = checkRateLimit(email)
        if (!emailCheck.allowed) {
          throw new Error(`Esta cuenta ha sido bloqueada temporalmente por múltiples intentos fallidos. Intente de nuevo en ${Math.ceil(emailCheck.waitTimeRemainingMs / 60000)} minutos.`)
        }

        const userWithAuth = await getUserWithAuth(email)
        if (!userWithAuth) {
          recordFailure(clientIp)
          recordFailure(email)
          return null
        }

        const valid = await bcrypt.compare(parsed.data.password, userWithAuth._hashedPassword)
        if (!valid) {
          recordFailure(clientIp)
          recordFailure(email)
          return null
        }

        recordSuccess(clientIp)
        recordSuccess(email)

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

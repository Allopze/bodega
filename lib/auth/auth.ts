import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { db } from "@/db"
import { users } from "@/db/schema"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { applyRbacToToken, getUserRbacById } from "@/lib/auth/rbac"
import { isPasswordSetupPending } from "@/lib/auth/password-setup"

import { headers } from "next/headers"
import {
  checkRateLimit as persistentCheckRateLimit,
  recordFailure as persistentRecordFailure,
  recordSuccess as persistentRecordSuccess,
} from "@/lib/services/rate-limit"

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

// Dummy hash for timing-safe comparison when user doesn't exist (prevents user enumeration).
const DUMMY_HASH = "$2a$12$LJ3m4ys3Lz0YBNourRNBHOVFPlAGm9koCpx/RTz8uVzNoMKCeVBCO"

// U-02: Custom error classes with machine-readable codes so use-login.ts can
// show a specific message instead of the generic "Correo o contraseña incorrectos."
class IpRateLimited extends CredentialsSignin {
  code = "ip_rate_limited"
}
class EmailRateLimited extends CredentialsSignin {
  code = "email_rate_limited"
}

const authUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? (
  process.env.NODE_ENV === "production" ? process.env.APP_URL : undefined
)

if (authUrl) {
  process.env.AUTH_URL ??= authUrl
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
    _passwordSetupPending: isPasswordSetupPending(user.hashedPassword),
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

        const ipCheck = await persistentCheckRateLimit(clientIp)
        if (!ipCheck.allowed) {
          // U-02: use CredentialsSignin subclass so next-auth surfaces the
          // `code` property as result.error in the client (not a generic "AccessDenied").
          throw new IpRateLimited(`Blocked for ${Math.ceil(ipCheck.waitTimeRemainingMs / 60000)} min`)
        }

        const emailCheck = await persistentCheckRateLimit(email)
        if (!emailCheck.allowed) {
          throw new EmailRateLimited(`Blocked for ${Math.ceil(emailCheck.waitTimeRemainingMs / 60000)} min`)
        }

        const userWithAuth = await getUserWithAuth(email)

        // Always compare to prevent timing oracle (user enumeration via response time).
        const hashToCompare = userWithAuth?._hashedPassword ?? DUMMY_HASH
        const valid = await bcrypt.compare(parsed.data.password, hashToCompare)

        if (!userWithAuth || userWithAuth._passwordSetupPending || !valid) {
          await persistentRecordFailure(clientIp)
          await persistentRecordFailure(email)
          return null
        }

        await persistentRecordSuccess(clientIp)
        await persistentRecordSuccess(email)

        const { _hashedPassword: _, _passwordSetupPending: __, ...safeUser } = userWithAuth
        return safeUser
      },
    }),
  ],

  session: { strategy: "jwt" },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // First sign-in: embed RBAC into JWT
        const u = user as Omit<NonNullable<Awaited<ReturnType<typeof getUserWithAuth>>>, "_hashedPassword" | "_passwordSetupPending">
        applyRbacToToken(token, u)
        return token
      }
      if (token.id) {
        // Security audit S-03: bypass the in-memory cache on every request
        // so revocations take effect immediately on this replica. The cache
        // still serves other code paths (e.g. middleware helpers) with a
        // 5s TTL. Admins also call clearUserRbacCache() on mutations, so
        // even other paths get fresh data right away.
        const snapshot = await getUserRbacById(token.id as string, /* bypassCache */ true)
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

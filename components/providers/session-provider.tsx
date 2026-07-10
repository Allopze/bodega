"use client"

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react"
import { SessionRetryHandler } from "./session-retry-handler"

export function SessionProvider({ children, session }: {
  children: React.ReactNode
  session?: Parameters<typeof NextAuthSessionProvider>[0]["session"]
}) {
  return (
    <NextAuthSessionProvider session={session}>
      <SessionRetryHandler />
      {children}
    </NextAuthSessionProvider>
  )
}

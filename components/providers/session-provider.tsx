"use client"

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react"

export function SessionProvider({ children, session }: {
  children: React.ReactNode
  session?: Parameters<typeof NextAuthSessionProvider>[0]["session"]
}) {
  return (
    <NextAuthSessionProvider session={session}>
      {children}
    </NextAuthSessionProvider>
  )
}

"use client"

import type { ReactNode } from "react"
import { useRouter } from "next/navigation"
import { TableRow } from "@/components/ui/table"

export function FleetTableRow({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter()

  return (
    <TableRow
      role="link"
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          router.push(href)
        }
      }}
      className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]"
    >
      {children}
    </TableRow>
  )
}

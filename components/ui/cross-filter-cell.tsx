"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"

export interface CrossFilterCellProps {
  value: string | null | undefined
  paramKey: string
  paramValue?: string
  href?: string
  title?: string
  className?: string
  children?: React.ReactNode
}

export function CrossFilterCell({
  value,
  paramKey,
  paramValue,
  href,
  title = "Filtrar por este valor",
  className = "hover:underline text-[var(--color-primary-ink)] font-medium",
  children,
}: CrossFilterCellProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const displayValue = children ?? value ?? "—"
  const filterVal = paramValue ?? value

  if (!filterVal) return <span>—</span>

  const targetHref = React.useMemo(() => {
    if (href) return href
    const params = new URLSearchParams(Array.from(searchParams.entries()))
    params.set(paramKey, filterVal)
    params.delete("page")
    const query = params.toString()
    return query ? `${pathname}?${query}` : pathname
  }, [href, searchParams, paramKey, filterVal, pathname])

  return (
    <Link
      href={targetHref}
      className={className}
      title={title}
    >
      {displayValue}
    </Link>
  )
}

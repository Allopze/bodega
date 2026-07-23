"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

export interface UseUrlFiltersOptions {
  debounceMs?: number
  pageKey?: string
  scroll?: boolean
}

export function useUrlFilters(options: UseUrlFiltersOptions = {}) {
  const { debounceMs = 350, pageKey = "page", scroll = false } = options
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const setFilter = React.useCallback(
    (key: string, value: string | null | undefined) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()))
      if (value !== undefined && value !== null && value !== "" && value !== "_all") {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      params.delete(pageKey)
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll })
    },
    [router, pathname, searchParams, pageKey, scroll],
  )

  const setFilters = React.useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()))
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined && value !== null && value !== "" && value !== "_all") {
          params.set(key, value)
        } else {
          params.delete(key)
        }
      }
      params.delete(pageKey)
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll })
    },
    [router, pathname, searchParams, pageKey, scroll],
  )

  const clearFilters = React.useCallback(
    (keysToKeep: string[] = []) => {
      const params = new URLSearchParams()
      for (const key of keysToKeep) {
        const val = searchParams.get(key)
        if (val) params.set(key, val)
      }
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll })
    },
    [router, pathname, searchParams, scroll],
  )

  const getFilter = React.useCallback(
    (key: string, defaultValue = "") => searchParams.get(key) ?? defaultValue,
    [searchParams],
  )

  return {
    searchParams,
    getFilter,
    setFilter,
    setFilters,
    clearFilters,
    debounceMs,
  }
}

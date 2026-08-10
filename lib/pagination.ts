export type PageWindowItem = number | "…"

export type PageResult<T> = {
  rows: T[]
  total: number
  limit: number
  offset: number
}

export type PaginationState = {
  page: number
  totalItems: number
  totalPages: number
  offset: number
  limit: number
  from: number
  to: number
}

export function resolvePagination({
  pageParam,
  totalItems,
  pageSize,
}: {
  pageParam: string | string[] | undefined
  totalItems: number
  pageSize: number
}): PaginationState {
  const rawPage = Array.isArray(pageParam) ? pageParam[0] : pageParam
  const parsedPage = rawPage ? Number.parseInt(rawPage, 10) : 1
  const normalizedTotal = Math.max(0, totalItems)
  const normalizedPageSize = Math.max(1, pageSize)
  const totalPages = Math.max(1, Math.ceil(normalizedTotal / normalizedPageSize))
  const page = Number.isFinite(parsedPage) && parsedPage > 0
    ? Math.min(parsedPage, totalPages)
    : 1
  const offset = (page - 1) * normalizedPageSize
  const from = normalizedTotal === 0 ? 0 : offset + 1
  const to = Math.min(page * normalizedPageSize, normalizedTotal)

  return {
    page,
    totalItems: normalizedTotal,
    totalPages,
    offset,
    limit: normalizedPageSize,
    from,
    to,
  }
}

export function buildPageWindow(current: number, total: number): PageWindowItem[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const pages: PageWindowItem[] = [1]
  if (current > 3) pages.push("…")
  for (let page = Math.max(2, current - 1); page <= Math.min(total - 1, current + 1); page++) {
    pages.push(page)
  }
  if (current < total - 2) pages.push("…")
  pages.push(total)
  return pages
}

/**
 * `pageParamName` existe porque una pantalla puede tener dos listas paginadas
 * independientes (Compras: la cola de solicitudes por comprar y el registro de
 * OC). Con un solo `page` compartido, avanzar en una reiniciaba la otra.
 */
export function buildPaginationHref(
  pathname: string,
  searchParams: Record<string, string | string[] | undefined>,
  page: number,
  pageParamName = "page",
) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === pageParamName || value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item)
    } else {
      params.set(key, value)
    }
  }
  if (page > 1) params.set(pageParamName, String(page))
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

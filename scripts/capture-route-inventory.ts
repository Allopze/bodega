import fs from "node:fs"
import path from "node:path"

export type DiscoveredRoutePattern = {
  /** URL pattern as represented by the App Router, e.g. `/compras/[id]`. */
  pattern: string
  /** Page file relative to the app directory. */
  source: string
  /** Whether the page requires a route parameter before it can be captured. */
  dynamic: boolean
  /** Best-effort auth inference from the route group. */
  auth: boolean
}

const PAGE_FILE_NAMES = new Set(["page.tsx", "page.ts", "page.jsx", "page.js"])

/**
 * Finds App Router pages without importing them. Importing a page would make
 * route inventory depend on Next's runtime and on the capture database.
 */
export function findPageFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return []

  const entries = fs.readdirSync(directory, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return findPageFiles(fullPath)
    return entry.isFile() && PAGE_FILE_NAMES.has(entry.name) ? [fullPath] : []
  })
}

/** Converts an App Router page file into its URL pattern. */
export function pageFileToRoutePattern(file: string, appDirectory: string): string | null {
  const relative = path.relative(appDirectory, path.dirname(file))
  const segments = relative.split(path.sep).filter(Boolean)

  // Catch-all not-found pages represent an infinite set of URLs, not a page
  // that can be safely turned into a capture target. They are covered by the
  // explicit 404 target in capture-all-routes.ts.
  if (segments.some((segment) => segment === "api")) return null
  if (segments.some((segment) => segment.startsWith("[...") || segment.startsWith("[[..."))) return null

  const urlSegments = segments.filter((segment) => !segment.startsWith("(") && !segment.startsWith("@"))
  const route = `/${urlSegments.join("/")}`
  return route === "/" ? "/" : route.replace(/\/$/, "")
}

function inferAuth(file: string, appDirectory: string): boolean {
  const segments = path.relative(appDirectory, file).split(path.sep)
  if (segments.includes("(public)") || segments.includes("(auth)")) return false
  if (segments.includes("(app)") || segments.includes("(print)")) return true

  // `app/page.tsx` is the public entry point. Any ungrouped nested page is
  // treated as authenticated because it cannot safely be assumed public.
  return path.dirname(path.relative(appDirectory, file)) !== "."
}

/** Discovers all concrete App Router page.* patterns under `app/`. */
export function discoverRoutePatterns(appDirectory = path.join(process.cwd(), "app")): DiscoveredRoutePattern[] {
  return [...new Map(
    findPageFiles(appDirectory).sort()
      .map((file) => {
        const pattern = pageFileToRoutePattern(file, appDirectory)
        if (!pattern) return null
        return [pattern, {
          pattern,
          source: path.relative(appDirectory, file),
          dynamic: pattern.split("/").some((segment) => segment.startsWith("[")),
          auth: inferAuth(file, appDirectory),
        }] as const
      })
      .filter((entry): entry is readonly [string, DiscoveredRoutePattern] => entry !== null),
  ).values()].sort((a, b) => a.pattern.localeCompare(b.pattern))
}

/**
 * Matches a concrete pathname against an App Router pattern. This intentionally
 * handles only ordinary `[param]` segments; catch-all patterns are excluded by
 * `pageFileToRoutePattern` because they need a separate policy.
 */
export function routePatternMatches(pattern: string, pathname: string): boolean {
  const expected = pattern.split("/")
  const actual = pathname.split("/")
  if (expected.length !== actual.length) return false

  return expected.every((segment, index) =>
    segment.startsWith("[") ? actual[index]!.length > 0 : segment === actual[index],
  )
}

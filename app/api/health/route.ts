/**
 * Health check endpoint.
 *
 * Verifies:
 * - PostgreSQL connectivity (SELECT 1)
 * - Storage volume is writable (creates and removes a temp file)
 * - Disk space (warns if < 10% free or < 1 GB free)
 *
 * Docker HEALTHCHECK uses this. Deploy workflow validates post-deploy.
 */
import { NextResponse } from "next/server"
import { db } from "@/db"
import { sql } from "drizzle-orm"
import { access } from "node:fs/promises"
import { constants } from "node:fs"
import { writeFile, unlink } from "node:fs/promises"
import path from "node:path"

const STORAGE_PATH = process.env.STORAGE_PATH || "./storage"

interface HealthStatus {
  status: "ok" | "degraded" | "error"
  db: "connected" | "disconnected"
  storage: "writable" | "unreachable" | "unknown"
  disk: {
    status: "ok" | "low_space" | "unknown"
    freePercent?: number
    freeBytes?: number
  }
  timestamp: string
}

export async function GET() {
  const result: HealthStatus = {
    status: "ok",
    db: "disconnected",
    storage: "unknown",
    disk: { status: "unknown" },
    timestamp: new Date().toISOString(),
  }

  // 1. Check PostgreSQL connectivity
  try {
    await db.select({ one: sql`1` }).from(sql`(SELECT 1) AS t`)
    result.db = "connected"
  } catch {
    result.db = "disconnected"
    result.status = "error"
  }

  // 2. Check storage volume writability
  try {
    await access(path.dirname(STORAGE_PATH), constants.W_OK | constants.R_OK)
    // Write and remove a temp file to verify actual writability
    const probePath = path.join(STORAGE_PATH, `.health-${Date.now()}.tmp`)
    await writeFile(probePath, "ok", "utf-8")
    await unlink(probePath).catch(() => {})
    result.storage = "writable"
  } catch {
    result.storage = "unreachable"
    if (result.status !== "error") result.status = "degraded"
  }

  // 3. Check disk space (Linux only)
  if (process.platform === "linux") {
    try {
      const { execSync } = await import("node:child_process")
      const df = execSync("df --output=pcent,avail / 2>/dev/null | tail -1", {
        encoding: "utf-8",
        timeout: 2000,
      }).trim()
      const [pctStr, availBlocks] = df.split(/\s+/)
      const usedPct = Number.parseInt(pctStr?.replace("%", "") ?? "0", 10)
      const freePct = 100 - usedPct
      const freeBytes = (Number.parseInt(availBlocks ?? "0", 10) || 0) * 1024

      result.disk = {
        status: freePct >= 10 && freeBytes >= 1_073_741_824 ? "ok" : "low_space",
        freePercent: freePct,
        freeBytes,
      }
      if (result.disk.status === "low_space" && result.status === "ok") {
        result.status = "degraded"
      }
    } catch {
      result.disk = { status: "unknown" }
    }
  }

  const httpStatus = result.status === "error" ? 503 : 200
  return NextResponse.json(result, { status: httpStatus })
}

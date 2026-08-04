/**
 * Salud de plataforma medida, no declarada (TASK-UI-011).
 *
 * Vivía embebida en `app/api/health/route.ts`, de modo que el único consumidor
 * posible era un `HEALTHCHECK` de Docker: ninguna pantalla podía decir si la
 * base, el volumen o el disco respondían. `/admin/modulos` mostraba
 * interruptores encendidos con el mismo aspecto tuviera o no backend detrás,
 * que es la forma exacta del "verde ficticio" que esta tarea vino a retirar.
 *
 * Aquí sólo hay señales que se comprueban ejecutando algo: una consulta, una
 * escritura y `df`. No hay salud por módulo porque no existe una sonda por
 * módulo — inventar una sería reintroducir el problema con otro nombre.
 */
import { db } from "@/db"
import { sql } from "drizzle-orm"
import { writeFile, unlink } from "node:fs/promises"
import path from "node:path"

const STORAGE_PATH = process.env.STORAGE_PATH || "./storage"

export interface PlatformHealth {
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

export async function getPlatformHealth(): Promise<PlatformHealth> {
  const result: PlatformHealth = {
    status: "ok",
    db: "disconnected",
    storage: "unknown",
    disk: { status: "unknown" },
    timestamp: new Date().toISOString(),
  }

  // 1. Conectividad de PostgreSQL
  try {
    await db.select({ one: sql`1` }).from(sql`(SELECT 1) AS t`)
    result.db = "connected"
  } catch {
    result.db = "disconnected"
    result.status = "error"
  }

  // 2. Escritura en el volumen de almacenamiento
  try {
    // Se sondea el volumen configurado. Su directorio padre puede pertenecer a
    // root a propósito mientras el montaje sí es escribible por la aplicación.
    const probePath = path.join(STORAGE_PATH, `.health-${Date.now()}.tmp`)
    await writeFile(probePath, "ok", "utf-8")
    await unlink(probePath).catch(() => {})
    result.storage = "writable"
  } catch {
    result.storage = "unreachable"
    if (result.status !== "error") result.status = "degraded"
  }

  // 3. Espacio en disco (sólo Linux)
  if (process.platform === "linux") {
    try {
      const { execFileSync } = await import("node:child_process")
      // `df -Pk` está especificado por POSIX y funciona tanto en GNU coreutils
      // como en BusyBox, a diferencia de `df --output` que Alpine no tiene.
      const df = execFileSync("df", ["-Pk", "/"], {
        encoding: "utf-8",
        timeout: 2000,
      })
      const row = df.trim().split("\n").at(-1)?.trim().split(/\s+/)
      const availBlocks = Number.parseInt(row?.[3] ?? "", 10)
      const usedPct = Number.parseInt(row?.[4]?.replace("%", "") ?? "", 10)
      if (!Number.isFinite(availBlocks) || !Number.isFinite(usedPct)) {
        throw new Error("No se pudo interpretar la salida de df")
      }
      const freePct = 100 - usedPct
      const freeBytes = availBlocks * 1024

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

  return result
}

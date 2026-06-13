import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import * as schema from "./schema"

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required (postgres://...)")
}

// Singleton pattern for Next.js dev (avoids opening multiple connections)
declare global {
  var __db: ReturnType<typeof createDb> | undefined
}

function createDb() {
  const client = postgres(process.env.DATABASE_URL!, {
    max: 10,
    idle_timeout: 30,    // cierra conexiones ociosas tras 30s
    connect_timeout: 10, // falla rápido (10s) ante una BD que no responde
  })
  return drizzle(client, { schema })
}

export const db = global.__db ?? createDb()

if (process.env.NODE_ENV !== "production") {
  global.__db = db
}

export type DB = typeof db
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

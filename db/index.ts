import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import * as schema from "./schema"

const DATABASE_URL = process.env.DATABASE_URL ?? "./db/stockflow.db"

// Singleton pattern for Next.js dev (avoids opening multiple connections)
declare global {
  var __db: ReturnType<typeof createDb> | undefined
}

function createDb() {
  const sqlite = new Database(DATABASE_URL)
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")
  return drizzle(sqlite, { schema })
}

export const db = global.__db ?? createDb()

if (process.env.NODE_ENV !== "production") {
  global.__db = db
}

export type DB = typeof db
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

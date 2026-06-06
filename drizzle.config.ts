import type { Config } from "drizzle-kit"

export default {
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "./db/stockflow.db",
  },
} satisfies Config

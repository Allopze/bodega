import { loadEnvConfig } from "@next/env"
import postgres from "postgres"

loadEnvConfig(process.cwd())

async function main() {
  const url = process.env.DATABASE_URL!
  console.log("Connecting to database...")
  const sql = postgres(url)
  
  const result = await sql`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'email_notifications'
  `
  console.log("Column 'email_notifications' exists:", result.length > 0)
  
  if (result.length === 0) {
    console.log("Column NOT found. Checking all columns in users table:")
    const allCols = await sql`
      SELECT column_name, data_type FROM information_schema.columns 
      WHERE table_name = 'users' ORDER BY ordinal_position
    `
    console.table(allCols)
  }
  
  await sql.end()
}

main().catch(console.error)

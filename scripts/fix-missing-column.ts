import { loadEnvConfig } from "@next/env"
import postgres from "postgres"

loadEnvConfig(process.cwd())

async function main() {
  const url = process.env.DATABASE_URL!
  console.log("Connecting to database...")
  const sql = postgres(url)
  
  // Check if column exists
  const result = await sql`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'email_notifications'
  `
  
  if (result.length > 0) {
    console.log("Column 'email_notifications' already exists. No action needed.")
    await sql.end()
    return
  }
  
  console.log("Column 'email_notifications' not found. Adding it now...")
  
  // Add the column (same SQL as migration 0016_schema_additions.sql)
  await sql.unsafe(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_notifications boolean NOT NULL DEFAULT true;
  `)
  
  console.log("Column added successfully!")
  
  // Verify
  const verify = await sql`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'email_notifications'
  `
  console.log("Verification - column exists:", verify.length > 0)
  
  await sql.end()
}

main().catch((err) => {
  console.error("Failed:", err)
  process.exit(1)
})

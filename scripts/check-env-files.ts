import { execFileSync } from "node:child_process"
import fs from "node:fs"

const allowedEnvFiles = new Set([".env.example"])
const sensitiveKeys = new Set([
  "AUTH_SECRET",
  "SMTP_PASS",
  "SEED_ADMIN_PASSWORD",
])

function getTrackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  return output.split("\0").filter(Boolean)
}

const trackedEnvFiles = getTrackedFiles().filter((file) => file === ".env" || file.startsWith(".env."))
const disallowedEnvFiles = trackedEnvFiles.filter((file) => !allowedEnvFiles.has(file))

if (disallowedEnvFiles.length > 0) {
  console.error("No se deben trackear archivos de entorno con secretos:")
  for (const file of disallowedEnvFiles) console.error(`- ${file}`)
  process.exit(1)
}

if (!fs.existsSync(".env.example")) {
  console.error("Falta .env.example saneado para documentar variables requeridas.")
  process.exit(1)
}

const example = fs.readFileSync(".env.example", "utf8")
const leakedKeys = example
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .flatMap((line) => {
    const [key, ...rest] = line.split("=")
    const value = rest.join("=").trim()
    return sensitiveKeys.has(key) && value ? [key] : []
  })

if (leakedKeys.length > 0) {
  console.error(".env.example no debe incluir valores para secretos sensibles:")
  for (const key of leakedKeys) console.error(`- ${key}`)
  process.exit(1)
}

console.log("Env files check passed.")

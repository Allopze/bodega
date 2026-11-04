import { defineConfig } from "vitest/config"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { pgliteTestFiles } from "./tests/pglite-files"
import { COVERAGE_EXCLUDE, COVERAGE_EXCLUDE_AFTER_REMAP, COVERAGE_INCLUDE } from "./vitest.coverage.shared"

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      // Cargar la plantilla migrada exige pasarla al constructor (`loadDataDir`
      // no existe como método de instancia) y las 336 suites hacen
      // `new PGlite()`. Este alias evita tocar cada archivo: el wrapper inyecta
      // la plantilla cuando existe y cae al constructor normal cuando no.
      // Sólo en este proyecto — el resto de Vitest no ejecuta suites PGlite.
      { find: /^@electric-sql\/pglite$/, replacement: path.join(projectRoot, "lib/testing/pglite-with-template.ts") },
      { find: "@", replacement: projectRoot },
      { find: "next/server", replacement: path.join(projectRoot, "node_modules/next/server.js") },
    ],
  },
  test: {
    name: "pglite",
    environment: "node",
    include: pgliteTestFiles,
    // Los worktrees de sesión (`.claude/worktrees/**`) son copias completas
    // del repo, con su propio `node_modules`. Sin excluirlos, vitest corre
    // cada test dos o tres veces y los de React fallan con
    // «Cannot read properties of null (reading 'useState')», porque se carga
    // una segunda copia de React desde el `node_modules` del worktree.
    exclude: ["node_modules", ".next", ".tmp", ".claude/worktrees/**"],
    setupFiles: ["./components/__tests__/setup.ts"],
    env: {
      DATABASE_URL: "postgres:///bodega_test",
      PGHOST:       "/var/run/postgresql",
    },
    server: { deps: { inline: ["next-auth"] } },
    // Secuencial: PGlite satura CPU en paralelo
    fileParallelism: false,
    // 60 s y no 20: estos tests levantan un Postgres WASM y le corren las
    // migraciones completas, y bajo `--coverage` —que es como los ejecuta el
    // CI— la instrumentación de V8 los frena lo suficiente como para que
    // `prevention-pdtp` cruce el límite. El margen es para la instrumentación,
    // no para tests lentos: si uno tarda de verdad 60 s, hay que mirarlo.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Cobertura apagada por defecto (instrumentar cuesta y `npm run
    // test:pglite` es el gate de CI, no una medición). Se enciende con
    // `--coverage` desde `test:coverage:all`, que combina este proyecto con el
    // otro: medir sólo uno deja servicios enteros en 0 % pese a estar probados
    // (H-12, AUDITORIA_BUGS_2026-08-05.md). Mismo include/exclude que el otro
    // proyecto para que los reportes sean combinables.
    coverage: {
      enabled: false,
      reporter: ["text", "lcov"],
      include: COVERAGE_INCLUDE,
      exclude: COVERAGE_EXCLUDE,
      excludeAfterRemap: COVERAGE_EXCLUDE_AFTER_REMAP,
    },
  },
})

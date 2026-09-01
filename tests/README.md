# Tests

## Estructura de ejecución

Los tests están divididos en **dos grupos** para optimizar el tiempo de iteración sin sacrificar retrocompatibilidad:

| Grupo | Archivos | Paralelismo | Tiempo aprox |
|---|---|---|---|
| **no-PGlite** | tests sin base de datos | paralelo, máximo 3 workers en local | depende del cambio |
| **PGlite** | tests registrados con Postgres WASM in-memory | secuencial | depende del cambio |

---

## Scripts disponibles

### `npm test` — Tests sin PGlite

Usa `vitest.config.ts`, que excluye las suites PGlite. La validación completa
requiere también `npm run test:pglite`.

```bash
npm test
npm run test:pglite
```

### `npm run test:fast` — Solo tests sin PGlite (iteración rápida)

Ejecuta solo los tests que **no** usan `@electric-sql/pglite`, en paralelo. En
desarrollo se limita a 3 workers para no bloquear el servidor; CI conserva su
propia política. Ideal para el ciclo diario: cambios → test rápido → feedback.

```bash
npm run test:fast
```

Ejecuta con coverage:

```bash
npx vitest run --config vitest.non-pglite.config.ts --coverage
```

### `npm run test:pglite` — Solo tests PGlite

Ejecuta únicamente los tests registrados que usan PGlite, en secuencia. Útil para:

- Validar cambios en la lógica de base de datos antes de hacer `npm test`
- Depurar un test PGlite problemático sin esperar los tests no-PGlite

```bash
npm run test:pglite
# → ~220s, 31 test files
```

Ejecutar un archivo específico:

```bash
npx vitest run --config vitest.pglite.config.ts lib/__tests__/stock-service.test.ts
```

---

## Cómo agregar un nuevo test

### Test sin PGlite

Simplemente crea el archivo `*.test.ts` en cualquier directorio. Vitest lo descubrirá automáticamente y se ejecutará en paralelo con `npm run test:fast`.

```ts
// lib/__tests__/mi-nuevo-test.test.ts
import { describe, it, expect } from "vitest"

describe("Mi funcionalidad", () => {
  it("funciona correctamente", () => {
    expect(1 + 1).toBe(2)
  })
})
```

### Test con PGlite

1. Crea tu archivo de test e importa `PGlite` de `@electric-sql/pglite` y `migratePGlite` de `@/lib/testing/pglite-migrate`.

2. **Registra el archivo en `tests/pglite-files.ts`** agregando su ruta al array `pgliteTestFiles`. Esto asegura que:

   - Se ejecute en el proyecto PGlite con `fileParallelism: false` (evita timeouts por saturación de CPU)
   - Se excluya del proyecto paralelo (no-PGlite)

```ts
// tests/pglite-files.ts
export const pgliteTestFiles = [
  // ... archivos existentes ...
  "lib/__tests__/mi-nuevo-test-pglite.test.ts", // ← agrega aquí
]
```

⚠️ **Si olvidas registrar el archivo en `pgliteTestFiles`**, se ejecutará en paralelo junto con los tests no-PGlite, lo que puede producir timeouts intermitentes por saturación de CPU (exactamente el problema que motivó esta división).

### Helpers compartidos

- **`lib/testing/pglite-migrate.ts`** — Exporta `migratePGlite()` que ejecuta todas las migraciones de Drizzle sobre una instancia PGlite, y `splitSqlStatements()` para helpers SQL.
- **`components/__tests__/setup.ts`** — Setup global de vitest (se aplica a ambos grupos).

---

## Arquitectura de los configs

```
vitest.config.ts              → npm test, sin PGlite, máximo 3 workers en local
vitest.non-pglite.config.ts   → Solo tests no-PGlite, máximo 3 workers en local
vitest.pglite.config.ts       → Solo tests PGlite, secuencial
tests/pglite-files.ts          → Lista compartida de archivos PGlite (fuente única de verdad)
```

- `resolve.alias` con `@/` → raíz del proyecto está presente en los tres configs.
- La cobertura combinada se obtiene con `npm run test:coverage:all`.
- El proyecto PGlite tiene `coverage: { enabled: false }` para evitar umbrales inconsistentes en una ejecución parcial.

## Protección de recursos del servidor

Los scripts pesados pasan por `scripts/run-resource-guard.sh`. En desarrollo:

- sólo uno de ellos se ejecuta a la vez para este usuario, incluso entre
  distintos agentes o worktrees;
- Vitest y el build usan como máximo 3 workers;
- Playwright usa un navegador local a la vez;
- cada proceso Node recibe un heap de 4096 MiB si el llamador no fijó otro límite;
- el proceso baja su prioridad de CPU e I/O y es preferible para el OOM killer.

Los valores se pueden ajustar puntualmente con `BODEGA_MAX_WORKERS`,
`BODEGA_NODE_HEAP_MB` y `BODEGA_NICE_LEVEL`. `BODEGA_RESOURCE_GUARD=0`
desactiva el guard de forma explícita. No lo desactives en el servidor compartido.

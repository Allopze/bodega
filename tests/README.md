# Tests

## Estructura de ejecución

Los tests están divididos en **dos grupos** para optimizar el tiempo de iteración sin sacrificar retrocompatibilidad:

| Grupo | Archivos | Paralelismo | Tiempo aprox |
|---|---|---|---|
| **no-PGlite** | ~168 tests (sin base de datos) | `fileParallelism: true` | ~19s ⚡ |
| **PGlite** | ~31 tests (Postgres WASM in-memory) | `fileParallelism: false` | ~220s |

---

## Scripts disponibles

### `npm test` — Suite completa (retrocompatible)

Ejecuta **todos** los tests secuencialmente, igual que antes de la división.

```bash
npm test
# → ~504s (8.4 min), 199 test files
```

### `npm run test:fast` — Solo tests sin PGlite (iteración rápida)

Ejecuta solo los tests que **no** usan `@electric-sql/pglite`, en paralelo. Ideal para el ciclo de desarrollo diario: cambios → test rápido → feedback en segundos.

```bash
npm run test:fast
# → ~19s, 168 test files ⚡
```

Ejecuta con coverage:

```bash
npx vitest run --config vitest.non-pglite.config.ts --coverage
```

### `npm run test:pglite` — Solo tests PGlite

Ejecuta únicamente los 31 tests que usan PGlite, en secuencia. Útil para:

- Validar cambios en la lógica de base de datos antes de hacer `npm test`
- Depurar un test PGlite problemático sin esperar los 168 tests no-PGlite

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
vitest.config.ts              → Config original (npm test), secuencial, suite completa
vitest.non-pglite.config.ts   → Solo tests no-PGlite, en paralelo (~19s)
vitest.pglite.config.ts       → Solo tests PGlite, secuencial (~220s)
tests/pglite-files.ts          → Lista compartida de archivos PGlite (fuente única de verdad)
```

- `resolve.alias` con `@/` → raíz del proyecto está presente en los tres configs.
- Coverage solo se mide desde `vitest.config.ts` (suite completa) y `vitest.non-pglite.config.ts`.
- El proyecto PGlite tiene `coverage: { enabled: false }` para evitar umbrales inconsistentes en una ejecución parcial.

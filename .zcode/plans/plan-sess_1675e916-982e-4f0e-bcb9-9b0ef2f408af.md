## Fase B — Soporte multi-sujeto para checklists PDTP (plan §4, §4.4, §8, §11-B)

Habilita una ejecución sostenga N instancias de checklist (una por sujeto: extintor, equipo, trabajador…). **Aditivo, una migración, sin romper Fase A ni el flujo single-sujeto existente.**

### Principio rector: backward-compat total
`subject` es **opcional**. Sin él → instancia faena única (`subjectId=''`), idéntico al comportamiento actual. La prueba de regresión `pdtp-checklist-action-plan.test.ts` y las definiciones Fase A (Taller/Observación) siguen funcionando sin cambios.

---

### 1. Migración de esquema (1 archivo, aditiva)
**`db/schema/prevention/pdtp.ts`** — en `pdtpExecutionChecklists`:
- Añadir 3 columnas:
  - `subjectType text` — `'equipo'|'trabajador'|'contenedor'|'extintor'|'carro'|null`
  - `subjectId text NOT NULL DEFAULT ''` — `fuelVehicles.id`/`workers.id`/`''` (faena única)
  - `subjectLabel text` — denormalizado para mostrar (patente, nombre, "Extintor #7")
- Cambiar index: `DROP UNIQUE(executionId)` → `UNIQUE(executionId, subjectId)`. `subjectId DEFAULT ''` evita el problema de NULLs distintos; las filas existentes migran a `subjectId=''` sin colisión.

**Migración SQL**: generada con `npm run db:generate` (nunca hand-edit del journal). Es segura en prod: `ADD COLUMN ... DEFAULT ''` + reindex no colisiona con datos existentes.

### 2. `lib/services/pdtp/checklist-domain.ts` — PK determinista
`pdtpExecutionChecklistId(executionId)` → `pdtpExecutionChecklistId(executionId, subjectId='')`:
- `subjectId=''` → `${executionId}-cli` (idéntico al legacy — filas existentes no colisionan)
- `subjectId='ext-7'` → `${executionId}-cli-ext-7` (idempotente: recuperar la misma instancia del mismo sujeto)

### 3. `lib/services/pdtp/execution-checklists.ts` — el grueso
- **`getOrCreateExecutionChecklist(executionId, userId, subject?)`**:
  - `subject?: { subjectType?: string | null; subjectId?: string; subjectLabel?: string | null }` (todo opcional, default faena única).
  - Normaliza `subjectId ?? ''`. Busca por `(executionId, subjectId)` (no solo executionId). PK determinista vía el helper del paso 2. Snapshot del subject en la fila.
- **Nueva `listExecutionChecklists(executionId)`**: devuelve `PdtpExecutionChecklistInstance[]` (todas las instancias de la ejecución).
- **`getExecutionChecklist(executionId)`** se conserva como **wrapper backward-compat**: `return (await listExecutionChecklists(executionId))[0] ?? null`. No rompe la página de ejecución ni la prueba.
- `getAverageVerificationCompliance`: ya agrega por `inArray(executionId)` → ya es multi-instancia. Sin cambios (verificar).
- `parseInstance` ya hace spread del row → las 3 columnas nuevas fluyen al tipo automáticamente.

### 4. `lib/services/pdtp/action-plan.ts` — prefijo de sujeto en hallazgo
`generateActionPlanFromChecklist(instanceId, userId)`:
- Al construir `hallazgo`, si la instancia tiene `subjectLabel`, prefijar: `"[EQ-042] Alarma de retroceso: no cumple"` (formato `[subjectLabel] hallazgo`). Lee `subjectLabel` del row de la instancia (ya lo carga en L75). Si `subjectLabel` es null/'' → comportamiento actual (sin prefijo).
- `createActionPlanItem` (manual) — **sin cambios**: el usuario escribe el hallazgo libre.

### 5. Server action + validación
**`lib/validation/prevention-module/pdtp.ts`** — extender `pdtpChecklistStartSchema`:
```
executionId: z.string().min(1)
subjectType: z.enum([...]).nullish()       // opcional
subjectId: z.string().max(100).optional()  // default ''
subjectLabel: z.string().max(200).optional()
```
**`app/(app)/prevencion/pdtp/actions/checklist-actions.ts`** — `startPdtpExecutionChecklistAction` pasa `parsed.subject` a `getOrCreateExecutionChecklist`.

### 6. Rollup `executedQuantity` (§8) — **condicional, no destructivo**
Nueva `recalcExecutionQuantityFromInstances(executionId)`:
- Cuenta instancias `overallStatus='completado'` de la ejecución.
- **Solo actualiza** `pdtpExecutions.executedQuantity` si hay **>1 instancia completada** (caso multi-sujeto). Con 0–1 instancias (single-sujeto), **no toca** `executedQuantity` → preserva el registro manual de cantidad del flujo existente.
- Se invoca al final de `submitExecutionChecklist` (tras completar). Justificación: el rollup solo tiene sentido con N sujetos; mezclarlo con single-sujete sobreescribiría "5 charlas" con "1 instancia".

### 7. UI — panel multi-instancia (mínimo viable)
**`execution-checklist-panel.tsx`**: cambia props `instance` → `instances: PdtpExecutionChecklistInstance[]`, `responses` → `responsesByInstance: Record<string, ResponseRow[]>`.
- 0 instancias → botón "Iniciar verificación" (faena única, como hoy).
- 1+ instancias → lista de cards, cada una: header `subjectLabel` + badge estado/% + `ChecklistSectionPanel` + save/submit propios.
- Botón **"Agregar sujeto"** (dialog simple: `subjectType` select + `subjectLabel` input libre). **Label libre en B**; los selectores reales de flota/trabajadores llegan en Fase C con las defs multi-sujeto.
**`page.tsx`**: `getExecutionChecklist` → `listExecutionChecklists`; carga respuestas por instancia (`Promise.all`).

### 8. Pruebas — actualizar `pdtp-checklist-action-plan.test.ts`
- Los calls `getOrCreateExecutionChecklist("exec-1","u1")` y `getExecutionChecklist("exec-1")` siguen pasando (backward-compat).
- **Añadir** un test multi-sujeto: crea 2 instancias (subjectId distintos) para la misma ejecución, verifica que ambas coexisten, que cada una genera sus propias acciones con prefijo de sujeto, y que `listExecutionChecklists` devuelve ambas.
- Verificar que `recalcExecutionQuantityFromInstances` solo actualiza con >1 instancia.

---

### Archivos a tocar (11)
1. `db/schema/prevention/pdtp.ts` — 3 columnas + reindex (L192-206)
2. `db/migrations/00NN_*.sql` — generada (ADDITIVE)
3. `lib/services/pdtp/checklist-domain.ts` — `pdtpExecutionChecklistId` (L30)
4. `lib/services/pdtp/execution-checklists.ts` — getOrCreate/list/wrapper + recalc
5. `lib/services/pdtp/action-plan.ts` — prefijo subjectLabel en hallazgo (L75)
6. `lib/validation/prevention-module/pdtp.ts` — `pdtpChecklistStartSchema` (L198)
7. `app/(app)/prevencion/pdtp/actions/checklist-actions.ts` — start action (L111-119)
8. `app/(app)/prevencion/pdtp/[programId]/ejecucion/[executionId]/execution-checklist-panel.tsx` — multi-instancia
9. `app/(app)/prevencion/pdtp/[programId]/ejecucion/[executionId]/page.tsx` — list + respuestas por instancia
10. `lib/services/pdtp/index.ts` — re-export `listExecutionChecklists`, `recalcExecutionQuantityFromInstances`
11. `lib/__tests__/pdtp-checklist-action-plan.test.ts` — +test multi-sujeto, sin romper existentes

### Validación
- `tsc --noEmit`, `eslint` en los 11 archivos
- `npm run test:fast` (vitest, no pglite) o el test específico `pdtp-checklist-action-plan`
- `npm run db:generate` reporta "No schema changes" después
- Verificar la migración SQL es aditiva (ADD COLUMN + DROP/CREATE INDEX)

### Fuera de Fase B (explícito)
- Definiciones multi-sujeto (05/07/08/10/11/12/13) → Fase C
- Selectores de flota/trabajadores en UI → Fase C
- Pre-carga documental desde `fuelVehicles` → Fase C
- Inventario extintor/contenedor → follow-up (no v1)
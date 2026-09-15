# Migraciones de base de datos — reglas para no romper el historial

## Qué pasó (el problema que estamos previniendo)

Drizzle decide qué migraciones aplicar comparando el campo `when` (un timestamp)
de cada entrada en `meta/_journal.json` contra el `created_at` máximo ya
registrado en la tabla `__drizzle_migrations` de la base. Solo aplica una
migración si su `when` es **mayor** que ese máximo.

En algún momento se **editaron a mano** los `when` de varias migraciones,
poniéndoles valores "del futuro" (números redondos, p. ej. `1785500000000`)
para forzar que se aplicaran. Eso rompió el orden: las migraciones siguientes,
con su timestamp real (más bajo), quedaron **por debajo** del máximo y
`drizzle-kit migrate` empezó a **saltárselas en silencio** — reportaba
"migrations applied successfully" sin aplicar nada.

Consecuencias reales que vimos:
- Columnas/tablas que existían en el código pero **faltaban en la base** pese a
  que el deploy decía haber migrado (de ahí los parches `scripts/fix-missing-column.ts`).
- Dev y prod quedaron desincronizadas; dev se mantenía con `db:push` (que **no**
  registra migraciones), agrandando la divergencia.

El 2026-06-25 se saneó todo colapsando el historial en un **baseline único**
(`0000_vengeful_hulk.sql`) y dejando el journal monótono. Ver
[`docs/deploy/MIGRATION_BASELINE_CUTOVER.md`](../../docs/deploy/MIGRATION_BASELINE_CUTOVER.md).

## Reglas (para que NO se repita)

1. **Nunca edites a mano `meta/_journal.json`.** En especial, no toques los
   `when`. Esos timestamps los pone `drizzle-kit generate` y deben quedar
   **estrictamente crecientes** en orden de `idx`. Si los manipulas, rompes el
   mecanismo de "qué aplicar".

2. **Nunca edites el SQL de una migración ya creada/aplicada.** Para cambiar el
   esquema, edita `db/schema/*.ts` y corre `npm run db:generate` para crear una
   migración **nueva**. Editar una vieja hace que las bases ya migradas nunca
   reciban el cambio.

3. **Un solo camino: `migrate`, no `push`, contra bases que llevan historial.**
   Producción usa `drizzle-kit migrate` (ver `.github/workflows/deploy.yml`).
   `db:push` **no registra** las migraciones en `__drizzle_migrations`, así que
   desincroniza el journal de la base. Úsalo solo para una base desechable/local
   que vayas a recrear, nunca contra prod ni contra una dev que compartas.

4. **No "fuerces" una migración subiéndole el `when`.** Si una migración no se
   aplica, el problema es el historial (ver Diagnóstico), no el timestamp.
   Subir el `when` es exactamente lo que causó este desastre y obliga al
   siguiente a subirlo aún más.

5. **SQL que el esquema TS no captura** (funciones, triggers, datos semilla que
   no sean RBAC) va **al final del archivo de migración generado**, separado por
   `--> statement-breakpoint`, y debe ser **idempotente**
   (`CREATE OR REPLACE`, `IF NOT EXISTS`, `DROP TRIGGER IF EXISTS` antes de
   `CREATE TRIGGER`, `UPDATE ... WHERE ... IS NULL`, FK dentro de
   `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$`).

6. **Los nombres de constraint del `.sql` pueden NO ser los de la base.**
   Postgres trunca todo identificador a 63 bytes (`NAMEDATALEN-1`) y avisa con
   un `NOTICE 42622` al aplicar. Los nombres que genera Drizzle
   (`{tabla}_{columna}_{tabla_referida}_{columna}_fk`) pasan de 63 con
   facilidad: hoy hay ~200 así en el historial (p. ej.
   `prevention_legal_requirements_supersedes_requirement_id_prevention_legal_requirements_id_fk`,
   de 91 caracteres, que en la base se llama
   `prevention_legal_requirements_supersedes_requirement_id_prevent`).
   Consecuencia: **un `DROP`/`RENAME CONSTRAINT` copiado del `.sql` falla**, y
   lo mismo vale para el `DROP` que `drizzle-kit generate` emite solo si algún
   día cambias esa FK — hay que acortarlo a 63 a mano antes de aplicarlo.
   El nombre real se consulta en la base, no en el archivo:

   ```bash
   PGHOST=/var/run/postgresql psql -d <bd> -tA \
     -c "select conname from pg_constraint where conrelid = '<tabla>'::regclass;"
   ```

   No se renombran: son ~200 y el truncamiento es determinista (la misma
   migración produce el mismo nombre en toda base), así que el arreglo sería
   ruido de historial sin cambiar ninguna conducta.

7. **El RBAC (roles/permisos) NO va en migraciones.** Se siembra con
   `npm run db:seed` desde `lib/auth/system-rbac.ts` + los `defaultGrants` de
   los manifests de módulo.

## Flujo correcto para una migración nueva

```bash
# 1. Editar el esquema
$EDITOR db/schema/<archivo>.ts

# 2. Generar la migración (crea el .sql y actualiza meta/ automáticamente)
npm run db:generate

# 3. Revisar el .sql generado. Si hace falta SQL custom (función/trigger/datos),
#    añadirlo idempotente al final con --> statement-breakpoint.

# 4. Aplicar en local y VERIFICAR que el esquema y las migraciones coinciden:
PGHOST=/var/run/postgresql npm run db:migrate
npm run db:generate          # debe decir "No schema changes, nothing to migrate"

# 5. Commit del .sql + meta/. Producción aplica el migrate en el deploy.
```

## Diagnóstico: "migrate dice success pero falta una columna/tabla"

Ese es el síntoma del journal roto. Antes de parchear con un `ALTER` suelto:

```bash
# ¿Los 'when' del journal están en orden creciente?
node -e "const j=require('./db/migrations/meta/_journal.json');\
const w=j.entries.map(e=>e.when);\
console.log('monótono:', w.every((x,i)=>i===0||x>w[i-1]))"

# ¿Cuántas migraciones registró la base vs cuántas hay en el journal?
PGHOST=/var/run/postgresql psql -d <bd> -tA \
  -c 'select count(*) from drizzle.__drizzle_migrations;'
grep -c '"tag"' db/migrations/meta/_journal.json
```

Si el journal **no** es monótono, no lo "arregles" subiendo timestamps: eso
perpetúa el problema. Coordiná un saneamiento (baseline) como el de
[`MIGRATION_BASELINE_CUTOVER.md`](../../docs/deploy/MIGRATION_BASELINE_CUTOVER.md).

> Nota de entorno: en esta máquina, los comandos de DB necesitan
> `PGHOST=/var/run/postgresql` para usar el socket (si no, falla la auth TCP).

## Saneamiento acotado previo a 0297

Las entradas `0276` a `0296` llegaron a quedar registradas con 21 marcas de
tiempo artificiales del futuro. La migración `0297_panoramic_meltdown` vuelve al
reloj real y no debe ejecutarse contra una base cuyo máximo todavía conserve
esas marcas: Drizzle la omitiría aunque informara éxito.

Antes del primer despliegue que incluya `0297`, cada ambiente debe ejecutar el
preflight de sólo lectura y revisar que identifique únicamente el allowlist
conocido:

```bash
npm run db:reconcile-watermarks
```

Si informa diferencias de tag, checksum, id o timestamp, el corte se detiene;
no se infiere ni se reescribe nada. Si las 21 correspondencias son exactas:

```bash
npm run db:reconcile-watermarks -- --apply
npm run db:reconcile-watermarks   # debe informar cero cambios
npm run db:migrate
npm run pdtp:backfill-activity-catalog # dry-run, debe informar issues: []
npm run pdtp:backfill-activity-catalog -- --apply
```

El reconciliador sólo corrige `created_at` en el ledger de Drizzle; no cambia
SQL ni objetos de negocio. Este procedimiento fue probado en la base local. No
constituye verificación de producción: cada ambiente debe pasar su propio
preflight antes del backfill.

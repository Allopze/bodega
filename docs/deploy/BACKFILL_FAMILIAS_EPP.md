# Backfill de familias EPP (`products.family_id`)

> Contexto: `computeEppCoverageGaps` (`lib/services/prevention-epp.ts`) recorre
> una cadena de **dos INNER JOIN** para contar una entrega como cobertura de un
> trabajador:
>
> ```
> delivery_items → products.family_id → epp_product_families.epp_type_id → epp_types
> ```
>
> Un producto con `family_id NULL` rompe el primer join y además **no tiene
> dónde guardar** el tipo, la marca, el modelo, la certificación ni la vida útil
> (`lifespan_months`, el campo que enciende el vencimiento de EPP). Tampoco
> aparece en `/admin/epps`, que lista familias — así que nadie puede
> clasificarlo desde la UI.
>
> El backfill resuelve **solo el primer eslabón**. El segundo (`epp_type_id`) se
> clasifica a mano y a propósito: ver "Por qué el tipo no se automatiza".

## Estado de dev (aplicado 2026-09-07)

| | antes | después |
|---|---|---|
| Productos EPP | 117 | 117 |
| … sin familia | 108 | **0** |
| Familias | 5 | 82 |
| … con `epp_type_id` | 0 | 0 |

La agrupación por nombre hizo trabajo real: `Traje PU Verde Activex` quedó con 8
variantes, `Guante Cabritilla Activex sin forro gris` y `JARDINERA TERMICA` con
5, `Botín V-Flex V73 Microfiber` con 4. Los 108 productos colapsaron en 77
familias nuevas.

## Procedimiento de PRODUCCIÓN

`DATABASE_URL` debe apuntar a producción en los cuatro pasos.

### 1) Preflight (solo lectura, no escribe nunca)

```bash
npm run db:preflight-epp-family-backfill
```

Imprime el estado de la cadena de cobertura, cuántas familias crearía, cuántos
productos vincularía, y la lista de productos agrupada por el tipo que la
inferencia sugiere — separando los que no puede inferir. Sirve como lista de
trabajo para el paso 4.

### 2) Dry-run del script que aplica, y leer una línea en particular

```bash
npx tsx scripts/normalize-epp-families.ts   # sin --apply = dry-run
```

> **Leer `grupos que colapsarían: N` antes de seguir.**
>
> Si `N > 0`, el `--apply` **fusiona** esas familias: reapunta sus productos a
> una ganadora y hace `DELETE FROM epp_product_families` sobre el resto. El
> script también reescribe `identity_key` de **todas** las familias a su propio
> esquema (`categoría|nombre|marca|modelo`); si en producción los
> `identity_key` no siguen ya ese esquema, una reimportación posterior del mismo
> producto no encontrará la familia y creará una duplicada.
>
> En dev `N` fue 0 y los `identity_key` ya coincidían, por eso el apply fue
> inocuo. **Verificar ambas cosas en producción, no asumirlas.**

### 3) Respaldo y apply

El respaldo del paso 3a es obligatorio si `N > 0` en el paso 2: el rollback de
`family_id` por sí solo no restaura familias borradas por la fusión.

```bash
# 3a) Volcado completo de la tabla de familias (cubre fusiones y identity_key)
pg_dump "$DATABASE_URL" -t epp_product_families \
  > "storage/backup-epp-families-$(date +%Y%m%d-%H%M).sql"

# 3b) Rollback de family_id producto por producto
OUT="storage/rollback-epp-family-backfill-$(date +%Y%m%d-%H%M).sql"
{
  echo "BEGIN;"
  psql "$DATABASE_URL" -At -c "
    SELECT format('UPDATE products SET family_id = %s WHERE id = %L;',
                  COALESCE(quote_literal(family_id),'NULL'), id)
    FROM products WHERE is_epp = true ORDER BY id;"
  echo "DELETE FROM epp_product_families WHERE id LIKE 'family-%';"
  echo "COMMIT;"
} > "$OUT"

# 3c) Aplicar (corre dentro de una transacción)
npx tsx scripts/normalize-epp-families.ts --apply
```

Verificación:

```sql
SELECT
 (SELECT count(*)::int FROM products WHERE is_epp AND family_id IS NULL) AS sin_familia,
 (SELECT count(*)::int FROM epp_product_families)                        AS familias;
-- sin_familia debe ser 0
```

### 4) Clasificar el tipo en `/admin/epps`

Cada familia necesita su `epp_type_id` con el dropdown "Tipo de EPP" de la
tabla. Recién ahí sus entregas acreditan cobertura. La salida del paso 1 viene
ordenada por tipo sugerido para hacerlo por tandas.

Conviene aprovechar la misma pasada para llenar **vida útil** (`lifespan_months`)
con el lápiz de "Editar ficha": sin ese valor la familia es "No vence" y
Prevención nunca marca vencido el EPP entregado.

## Por qué el tipo no se automatiza

`inferEppItemType` (en `lib/services/epp-import.types.ts`) clasifica hoy 100 de
los 108 nombres reales de dev, y los 8 restantes no son EPP de zona corporal
(alcotest, botiquín, "BORDADO ESPALDA", boquillas, estuches, gel antiséptico).
Aun así el `epp_type_id` se deja nulo para que lo confirme una persona:

**un tipo equivocado es peor que uno nulo.** Nulo deja la familia sin clasificar
y visible como tal; equivocado hace que Prevención acredite al trabajador en la
zona corporal errónea — un "cubierto" falso en un reporte de cumplimiento. El
caso que lo motivó: `Fono HL Verishield p/casco` es protección **auditiva**, y
la inferencia lo leía como `cabeza` porque el nombre menciona el casco al que se
monta. Está corregido y cubierto por tests
(`lib/services/epp-import.types.test.ts`), pero la clase de error es
estructural, no de vocabulario.

## Rollback

```bash
psql "$DATABASE_URL" -f storage/rollback-epp-family-backfill-<fecha>.sql
# Si el paso 2 reportó fusiones, restaurar además el volcado del paso 3a.
```

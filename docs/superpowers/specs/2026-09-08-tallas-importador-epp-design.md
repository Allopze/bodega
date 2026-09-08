# Normalización de tallas en el importador de EPP — diseño

Fecha: 2026-09-08
Estado: aprobado, pendiente de plan de implementación

## Problema

El catálogo de EPP escribe la talla de tres maneras incompatibles según por
dónde entró el producto. En la lista de administración se ve como
`Talla: T/L`, `Talla guantes: L`, `Talla: Talla 9-10` y `Talla: XXXL` para
lo que conceptualmente es un solo eje.

La causa está en el importador XLSX, que tiene tres defectos encadenados:

1. **Elige el nombre del atributo con una sola heurística de dos dígitos.**
   `/^\d{2}$/.test(valor) ? "Talla calzado" : "Talla"`, duplicada en la rama
   multi-talla (`epp-import.types.ts:216`) y en la simple (`:228`). Ningún
   guante recibe nunca `Talla guantes`, ningún pantalón `Talla inferior` y
   ningún casco `Talla casco`, porque esos nombres sólo los produce el
   asistente de variantes.
2. **Nunca escribe `sizeFamily`.** `persistProductDetails`
   (`epp-import.ts:270-272`) inserta los atributos sin ese campo, así que
   **todo lo importado queda con `product_attributes.size_family = NULL`**.
   Es el defecto de fondo: sin familia, una variante importada no puede
   cruzarse con el catálogo de tallas (`size_catalog`) ni con la talla
   habitual del padrón de trabajadores (`workers.size_*`), aunque
   `workerSizeFieldFor` ya sepa mapear ambos.
3. **No canoniza el valor.** `normalizeSize` es `value.toUpperCase()`
   (`epp-import.types.ts:292`), mientras `normalizeSizeLabel`
   (`lib/products/product-size.ts`) —el dueño único de esa regla desde el
   hallazgo F-5 de la auditoría del 2026-09-03— ya resuelve `42.0`, `T42`,
   `Mediana` y `XXL`→`2XL`.

### Bug adicional que este trabajo cierra

`addMissingClothingSizeVariants` (`lib/services/epp-clothing-sizes.ts`) decide
que una familia usa la escala de ropa cuando su atributo de talla normaliza a
exactamente `"talla"`. Hoy un guante importado lleva `Talla: T/L`, así que ese
backfill **le inyecta variantes XS..2XL de ropa a familias de guantes**. Con
`Talla guantes` quedan correctamente excluidas.

## Decisiones tomadas

| Decisión | Elección | Motivo |
| --- | --- | --- |
| Valor no canónico (`T/L`, `XXXL`) | **Canonizar y registrar la corrección** | El importador ya tiene correcciones con confianza y revisión manual; el operador ve y puede editar el cambio |
| Valor canónico fuera de los códigos de su familia (`9/10` en `guantes`) | **Aceptar con advertencia no bloqueante** | Bloquear dejaría planillas reales de proveedor inutilizables; la severidad `warning` ya existe en `NormalizedEppRow.issues` |
| Contra qué se valida | **`size_catalog` en la base**, con la semilla como respaldo | Honra la decisión ya registrada en `lib/products/size-catalog.ts` («de ahí en adelante la base manda») sin romper la restricción de que `epp-import.types.ts` sea libre de `@/db` |
| Divergencia intra-familia tras el arreglo | **Aceptarla; no uniformar la familia durante la importación** | Reescribir todas las variantes de una familia porque se tocó una sola es escritura oculta que el editor de productos ya bloquea, y el operador no la pidió |

## Alternativas descartadas

- **Validar sólo contra la constante `SIZE_FAMILIES`.** Más simple, pero
  contradice la decisión de que la base manda: una talla dada de baja con
  `is_active = false` seguiría aceptándose como canónica.
- **Corregir talla y familia en una capa aparte dentro de `epp-import.ts`.**
  No toca el archivo puro, pero crea un cuarto lugar que decide qué es una
  talla — exactamente el hallazgo F-5, que se resolvió centralizando en
  `product-size.ts`. Reintroducirlo sería deshacer ese trabajo.

## Diseño

### Dónde vive cada regla

| Regla | Lugar |
| --- | --- |
| Qué familia de talla usa un tipo de EPP | `EPP_TYPE_TO_SIZE_FAMILY` en `lib/services/epp-import.types.ts`, junto a su gemelo `EPP_TYPE_TO_BODY_PART_CODE` |
| Qué códigos tiene una familia | `size_catalog`, leído con `getSizeFamilyOptions()` |
| Cómo se escribe una talla | `normalizeSizeLabel` en `lib/products/product-size.ts` |

El mapa se apoya en `inferEppItemType`, que ya conoce el vocabulario del
catálogo real:

- `guante` → `guantes`
- `botin`, `zapato`, `bota` → `calzado`
- `casco`, `casquete`, `gorro` → `casco`
- `pantalon`, `jardinera` → `pantalon`
- `chaleco`, `buzo`, `traje`, `chaqueta`, `camisa`, `polera`, `blusa`,
  `overol`, `primera capa`, `capa`, `coleto` → `ropa`

Los tipos sin escala de talla (`lente`, `antiparra`, `mascarilla`,
`respirador`, `filtro`, `arnes`, `fono`, `protector auditivo`, `visor`,
`mascara`, `barbiquejo`, `otros`) **no entran al mapa**: devuelven `null`, el
atributo queda como el genérico `Talla` sin `sizeFamily`, igual que hoy.
Devolver `null` antes que adivinar es el criterio que ya rige
`classifyEppTypeIdByName`.

### El resolvedor

Una función pura reemplaza el `/^\d{2}$/` duplicado en las dos ramas:

```
resolveSizeAttribute(rawValues, eppType, familyOptions?)
  → { name, values, sizeFamily, issues }
```

1. `familyFor(eppType)` → familia o `null`.
2. `name` = `attributeName` de la definición de esa familia
   (`Talla guantes`), o `Talla` si no hay familia.
3. Cada valor pasa por `normalizeSizeLabel`.
4. Si hay familia y el valor canónico no está entre sus códigos → `issue` de
   severidad `warning` («La talla `9/10` no está en el catálogo de la familia
   guantes»). El valor se acepta.
5. `sizeFamily` = la familia, para persistir.

`familyOptions` es opcional. Los únicos llamadores de `normalizeEppRow` son
los dos del servidor (`epp-import.ts:82` al preparar el lote y `:207` al
actualizar una fila en revisión) y los tests; el UI de revisión sólo consume
el tipo. Las opciones se leen una vez con `getSizeFamilyOptions()` **antes**
de abrir la transacción: son dato de referencia y no necesitan ser
tx-aware. Sin el parámetro, cae a `SIZE_FAMILIES` — el mismo respaldo que
`getSizeFamilyOptions` ya usa consigo mismo para una tabla vacía.

### Persistencia

`EppAttribute` gana `sizeFamily?: string | null` (campo opcional; el UI de
revisión lo importa sólo como tipo, así que no rompe) y
`persistProductDetails` lo escribe. La ruta de actualización
(`epp-import.ts:172`) borra y reinserta atributos, de modo que una
reimportación migra la variante existente — vía de migración incremental,
no un rewrite masivo.

### Correcciones y avisos

Dos entradas nuevas en `buildCorrections`, con su etiqueta en `RULE_LABELS`
(el UI cae al `ruleId` crudo si falta, `epp-import-review.tsx:108`):

| `field` | `ruleId` | Etiqueta | Confianza |
| --- | --- | --- | --- |
| `size` | `canonicalize_size` | «Talla estandarizada» | 95 |
| `sizeFamily` | `assign_size_family` | «Familia de talla asignada por el tipo de EPP» | 90 |

La línea `size` existente (`epp-import.types.ts:374`) hoy sólo registra
corrección cuando la talla se extrajo del nombre; pasa a registrarla también
cuando venía en la columna y se canonizó. `add()` ya descarta los no-cambios,
así que no genera ruido.

### Matching a prueba del cambio de nombre

Cambiar el nombre del atributo altera el `identityKey` de producto
(`talla=t/l` → `talla guantes=l`). Eso **no** duplica nada: ese key sólo
detecta duplicados dentro del mismo archivo y se guarda en la fila; el cruce
contra el catálogo es `findMatches` (difuso, umbral 70) y una decisión
`update` siempre exige que un humano elija `targetProductId`. El
`familyIdentityKey` no se toca — sólo usa categoría, nombre, marca y modelo.

El riesgo real es que `findMatches` puntúa «Atributos equivalentes»
comparando el nombre del atributo de forma exacta (`:360`): una fila perdería
esos 10-20 puntos y podría caer bajo 70, entrando como `create` sin que el
operador vea el aviso de posible producto existente.

Corrección: en `findMatches`, dos atributos son equivalentes si **ambos** son
de talla (`isSizeAttributeName`) aunque se llamen distinto, y sus valores se
comparan con `normalizeSizeLabel`. Queda mejor que hoy: `XXXL` de la planilla
pasaría a hacer match con `3XL` del catálogo, que hoy no matchea.

## Alcance explícitamente excluido

- **No se reescriben datos existentes.** La conciliación de los valores ya
  importados (`T/L`, `TALLA 9-10`, `XXXL`) es un trabajo aparte: cambia la
  identidad de variantes con histórico de stock, compras y entregas, y el
  editor de productos hoy bloquea justamente ese cambio cuando la variante
  ya se usó.
- **No se uniforma la familia** cuando una de sus variantes se reimporta.
- **No se toca el asistente de variantes ni el alta manual**, que ya usan el
  catálogo canónico.
- **No se cambia el esquema de la base.**

## Pruebas

- **`lib/services/epp-import.types.test.ts`** (puro): guante con `T/L`,
  `9-10` y `M`; botín `42.0`; pantalón `32`; casco `L`; overol `XXXL`→`3XL`;
  lente con talla → sin familia; multi-talla `S, M, L, XL` con familia; valor
  fuera de catálogo → `warning` no bloqueante; y un caso con `familyOptions`
  inyectadas distintas de la semilla, para cubrir las dos rutas.
- **`lib/services/epp-import.test.ts`**: `buildCorrections` emite las dos
  correcciones nuevas, y no las emite cuando el valor ya era canónico.
- **PGlite**: un guante importado termina con `name = "Talla guantes"` y
  `size_family = "guantes"` en `product_attributes`; `findMatches` sigue
  proponiendo el producto existente cuando la planilla trae `XXXL` y el
  catálogo tiene `3XL`.
- **Regresión del bug encontrado**: `addMissingClothingSizeVariants` no toca
  una familia de guantes sizada por `Talla guantes`.

## Trabajo relacionado ya hecho

El orden del dropdown de variantes en el catálogo de administración
(`compareVariantsForDisplay` en `lib/products/variant-grouping.ts`) se
resolvió por separado en esta misma sesión: `groupProductVariants` ahora
ordena por talla lógica con `compareSizeLabels` y desempata por SKU, en vez
de heredar el orden arbitrario del plan de Postgres.

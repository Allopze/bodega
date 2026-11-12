# Auditoría del sistema de tallas de EPP — 2026-09-08

Alcance: el sistema de tallas completo, desde el importador XLSX hasta el
comprobante que firma el trabajador. Verificado contra el código y contra los
datos reales de `bodega_dev`, no asumido.

**Veredicto: sí merece cambio.** El sistema está bien diseñado y mal
alimentado. No hay que rediseñarlo: hay que enseñarle al normalizador las
convenciones que el catálogo realmente usa, limpiar el dato mientras es
barato, cerrar la fuente que lo desordena, y desactivar un script que puede
corromper 38 familias con un solo comando.

---

## 1. Cómo funciona hoy (verificado)

La variante **es** el producto: una fila de `products` por talla, y la talla
vive en `product_attributes` como atributo `select` de un único valor
(`options = '["42"]'`). El stock, los movimientos, las recepciones y las
entregas cuelgan de `product_id`, así que la talla viaja por todo el ciclo sin
columnas propias.

Tres fuentes de verdad declaradas:

| Regla | Dueño |
| --- | --- |
| Qué atributo *es* una talla, cómo se escribe, en qué orden va | `lib/products/product-size.ts` |
| Qué familias y códigos existen | `size_catalog` (base), con `lib/products/size-catalog.ts` como semilla |
| Talla habitual del trabajador | `workers.size_top/bottom/shoe/gloves/helmet` |

Unos 30 archivos consumen esas reglas: Solicitudes, Entregas, Recepción,
Compras, trazabilidad, guías de despacho, alertas de stock y seis exportes.

---

## 2. Estado real del dato (`bodega_dev`)

| Medición | Valor |
| --- | --- |
| Variantes con atributo de talla | 67 |
| Nombres de atributo de talla distintos en todo el catálogo | **1** (`Talla`) |
| Filas de `product_attributes` con `size_family` | **0 de 230** |
| Variantes con escritura no canónica (`T/`, `T41`, `N41`, `N-9`) | **43 de 67 (64%)** |
| Variantes sin stock ni historial | **49 de 67 (73%)** |
| Familias EPP con atributo `Talla` | 38 |
| Trabajadores con alguna talla cargada | **1 de 147** |

Los valores que hay escritos hoy:

```
2XL  37  3XL  40  41  L  M  N-10  N-9  N40  N41  N42  N43  N44
T/2XL  T/L  T/M  T/S  T/XL  T/XXL  T41  Talla 9-10  XL  XXXL  Única
```

`Talla calzado`, `Talla guantes`, `Talla casco` y `Talla inferior` existen
**solo en código**: ningún producto los usa.

---

## 3. Hallazgos

### Grupo A · El dato real no cumple ninguna de las reglas del código

#### A-1 · El 64% del catálogo usa una escritura que el normalizador no conoce — **crítico**

`normalizeSizeLabel` resuelve `T42`→`42`, `XXL`→`2XL`, `Mediana`→`M`,
`42.0`→`42`. No resuelve las convenciones que el catálogo realmente trae.
Ejecutado sobre los valores reales:

| Entrada | Sale | Debería |
| --- | --- | --- |
| `T/L` | `T/L` | `L` |
| `T/M` | `T/M` | `M` |
| `N41` | `N41` | `41` |
| `N-9` | `N/9` | `9` |
| `Talla 9-10` | `9/10` | `9/10` (ok) |
| `T41` | `41` | `41` (ok) |
| `XXXL` | `3XL` | `3XL` (ok) |

`T/L` y `L` quedan como **tallas distintas**. `N41` y `41` también. Son las
convenciones chilenas de proveedor (`T/` = talla, `N` = número) y son
justamente las que faltan.

#### A-2 · La corrección de orden de hoy no surte efecto sobre el dato real — **crítico**

El commit `5ef214ca` (hoy) ordena las variantes por talla lógica. Ejecutado
contra `bodega_dev`, el orden que ve el usuario:

| Familia | Ofrece | Correcto |
| --- | --- | --- |
| Camisa Absolute Zero Lightwind | `T/L , T/M , T/S` | S, M, L |
| Pantalón Lightwind H3200 | `T/L , T/S , T/XL` | S, L, XL |
| Guante Ansell Hyflex 11-801 | `N-10 , N-9` | 9, 10 |
| Botín V-Flex Thinsulate V15 | `T41 , N41` | 41 (una sola) |
| **JARDINERA TERMICA** | `M , L , XL , 2XL , 3XL` | **correcto** |

`JARDINERA TERMICA` es la única familia con escritura canónica, y la única que
sale bien. Causa: `sizeSortKey` manda todo lo que empieza con `T/` o `N` al
grupo 2 («desconocido»), que se ordena alfabéticamente.

**El arreglo es correcto; lo que falta es que el dato lo alcance.**

#### A-3 · Siete familias multi-variante no muestran selector de talla — **crítico**

`getSizeVariantPicker` devuelve `null` si dos variantes normalizan a la misma
etiqueta, o si alguna no resuelve talla. En `bodega_dev` eso apaga el selector
para:

| Familia | Variantes | Por qué |
| --- | --- | --- |
| Traje PU Verde Activex | 8 | `T/L`×2, `T/M`×2, `T/XL`×2, `T/XXL`≡`T/2XL` |
| Guante Cabritilla Activex sin forro gris | 5 | `T/M`×2, `T/L`×2, una sin talla |
| Chaleco geólogo Activex gabardina terra | 3 | una sin talla |

El solicitante ve filas con el mismo `products.name` exacto y ningún criterio
para distinguirlas. **No hay mensaje: el selector simplemente no aparece.**

La decisión de `getSizeVariantPicker` (mejor ningún selector que dos opciones
indistinguibles) es defendible. Lo que falta es decirlo en pantalla.

#### A-4 · Variantes duplicadas indistinguibles — **alto**

Idénticas en nombre, talla, color y modelo; solo cambia el SKU:

| Familia | Duplicados |
| --- | --- |
| Guante Cabritilla sin forro gris | EPP-065 ≡ EPP-066 (`T/M`), EPP-068 ≡ EPP-069 (`T/L`) |
| Traje PU Verde Activex | EPP-108 ≡ EPP-110 (`T/L`), EPP-109 ≡ EPP-113 (`T/M`), EPP-107 ≡ EPP-112 (`T/XL`) |

Y la misma talla física escrita de dos formas, como dos productos con stock
separado:

| Familia | Variantes | Realidad |
| --- | --- | --- |
| Botín V-Flex Thinsulate V15 | EPP-021 `N41`, EPP-022 `T41` | la misma talla 41 |
| Guante Activex Nitrilo Heavy Duty | EPP-056 `T/L`, EPP-TRECK-022 `L` | la misma talla L |
| Guantes de cabritilla | `T/XL`, `Talla 9-10` | dos escalas en una familia |

El prefijo `EPP-TRECK-` delata que la divergencia viene de dos lotes de
importación con convenciones distintas.

#### A-5 · `product_attributes.size_family` es NULL en las 230 filas — **alto**

La columna nunca ha sido escrita por nadie. De ella cuelgan el cruce con
`size_catalog` y el cruce con el padrón de trabajadores. Es el defecto de
fondo: sin familia, una variante importada no puede cruzarse con nada.

#### A-6 · Toda talla mapea a `sizeTop` — **alto**

Como todo atributo se llama `Talla`, `workerSizeFieldFor` devuelve `sizeTop`
para botines, guantes, cascos y pantalones. En Entregas eso compara la talla
de **polera** del trabajador contra `N41..N44` de un botín.

Hoy no produce daño visible porque el padrón está vacío (1 de 147
trabajadores). En cuanto se cargue, sugiere la talla equivocada — que es peor
que no sugerir nada.

---

### Grupo B · El importador es la fuente del desorden

Confirmé las tres causas ya registradas en
`docs/superpowers/specs/2026-09-08-tallas-importador-epp-design.md`
(aprobado, pendiente de implementación):

- **B-1** · `/^\d{2}$/.test(valor) ? "Talla calzado" : "Talla"`, duplicada en
  la rama multi-talla (`epp-import.types.ts:216`) y en la simple (`:228`).
  Ningún guante recibe `Talla guantes`, ningún pantalón `Talla inferior`.
- **B-2** · `persistProductDetails` (`epp-import.ts:270`) inserta los
  atributos sin `sizeFamily` → NULL en todo lo importado.
- **B-3** · `normalizeSize` es `value.toUpperCase()`
  (`epp-import.types.ts:292`), mientras `normalizeSizeLabel` existe desde el
  hallazgo F-5 del 2026-09-03.

**Corrección al alcance del diseño:** excluye «no se reescriben datos
existentes» porque «cambia la identidad de variantes con histórico de stock,
compras y entregas». Medido: **49 de 67 variantes (73%) no tienen stock ni
historial**, y de los duplicados de A-4 solo **3 SKU** tienen historial real
(EPP-056, EPP-TRECK-022, EPP-110). La conciliación es mucho más barata de lo
que el diseño supone, y se encarece con cada importación.

---

### Grupo C · El catálogo de tallas está desincronizado y nada lo sincroniza

#### C-1 · `size_catalog` de la base ≠ semilla del código — **alto**

| Familia | Base (migraciones 0088 + 0155) | Semilla (`SIZE_FAMILIES`) |
| --- | --- | --- |
| ropa | XS S M L XL 2XL 3XL 4XL | igual |
| calzado | 36…46 | igual |
| guantes | S M L XL | XS S M L XL 2XL → faltan XS, 2XL |
| casco | **`Única`** | **S M L XL** → conflicto directo |
| pantalon | **ausente** | 28…48 (11 códigos) |

`npm run db:seed-size-catalog` existe, pero **`db:migrate` no lo corre** ni
ningún flujo de despliegue. La sincronización es un script manual que nunca se
ha ejecutado en esta base.

#### C-2 · Sincronizar hoy deja el casco peor — **alto**

`syncSizeCatalog` es aditivo por diseño («una talla dada de baja a mano no
revive en el próximo despliegue»). Correrlo dejaría
`casco = Única, S, M, L, XL`: el formulario de trabajadores ofrecería `Única`
junto a S/M/L/XL. Hay que decidir quién manda antes de enganchar el sync.

#### C-3 · El dropdown de casco del padrón ofrece hoy solo `Única` — **medio**

Exactamente el problema que el comentario de `worker-form.tsx` dice haber
resuelto: «el casco ofrecía sólo «Única», que ningún producto puede tener, así
que esa talla del padrón nunca cruzaba con una variante». Se resolvió en la
constante, no en la base — y la base manda.

#### C-4 · `pantalon` funciona por accidente — **medio**

`getSizeFamilyOptions` cae al respaldo de la semilla porque la familia no está
en la base. Si alguien inserta **un solo** código `pantalon`, el dropdown
«Talla inferior» pasa de 11 códigos a 1.

---

### Grupo D · Riesgo latente

#### D-1 · Un script a un comando de distancia corrompería 38 familias — **crítico si se corre**

`scripts/backfill-epp-clothing-sizes.ts` → `addMissingClothingSizeVariants`
decide que una familia usa la escala de ropa cuando su atributo de talla
normaliza a exactamente `"talla"`. **En esta base todo normaliza a
`"talla"`.**

Alcance real medido: **38 familias, 67 variantes** — incluidos botines
(`N41..N44`), guantes (`N-9`, `N-10`) y cascos. Crearía botines en talla XS y
guantes en 2XL, cada uno con SKU, atributos y proveedor preferente clonados.

El diseño del importador menciona solo los guantes; el alcance es el catálogo
entero. El script no tiene `--dry-run` ni confirmación, y su docstring afirma
lo contrario de lo que hace: «deja intactas las familias sizadas por "Talla
calzado", "Talla guantes"…» — familias que en esta base no existen.

---

### Grupo E · Contradicciones y código muerto

- **E-1 (medio)** · `normalizeSizeLabel` se documenta «para **comparar** — no
  para reescribir lo ya guardado», y `workerSchema` (`masters.ts:261`) la usa
  como `.transform()`, que sí reescribe. Editar al único trabajador con talla
  de casco cambiaría `Única` → `UNICA`. Confirmado por
  `npm run db:preflight-worker-sizes` (`normalizables: 1`).
- **E-2 (bajo)** · `lib/services/worker-size.ts::getSuggestedSize`: **cero
  consumidores**, y es una copia incompleta de `workerSizeFieldFor` que solo
  conoce `Talla` y `Talla calzado`.
- **E-3 (bajo)** · `getCanonicalSizesByFamily` (`lib/services/sizes.ts:30`):
  **cero consumidores**. El módulo se creó para que `size_catalog` dejara de
  no tener lectores; este lector tampoco tiene consumidor.
- **E-4 (bajo)** · Cuatro lugares mapean familia ↔ campo del padrón:
  `SIZE_ATTRIBUTE_FIELDS` (`product-size.ts`), `SIZE_FIELD_FAMILY`
  (`worker-form.tsx`), `NAME_TO_WORKER_FIELD` (`worker-size.ts`, muerto) y
  `attributeName` en `SIZE_FAMILIES`.
- **E-5 (bajo)** · `CLOTHING_TARGET_SIZES` es XS..2XL, pero `ropa` ya tiene
  3XL y 4XL y `JARDINERA TERMICA` ya usa 3XL. El backfill marcaría como
  «completas» familias sin 3XL/4XL.

---

## 4. Lo que se auditó y está bien

- **`product-size.ts` como dueño único** de qué es una talla, cómo se escribe
  y cómo se ordena. Buen diseño y bien documentado; **41 pruebas verdes** en
  `product-size`, `size-catalog` y `variant-grouping`.
- **Variante = producto**: la talla viaja por stock, movimientos, recepciones
  y entregas sin columnas nuevas ni joins extra.
- **`formatSizedProductName`** en comprobantes firmados, PDF, historial y
  exportes: el trabajador firma qué talla recibió.
- **`compareVariantsForDisplay` / `groupProductVariants`**: el orden nace
  donde se agrupa, así que alcanza a escritorio, móvil y consumidores futuros.
- **`getProductAttributesByIds`**: una consulta por pantalla, sostenida por
  `product_attributes_product_id_idx`.
- **Baja por `is_active`, nunca DELETE**: el histórico que usa una talla sigue
  existiendo.
- **`buildDeliveryStockGroups`** muestra la variante sin talla al final en vez
  de esconderla: no oculta stock real.
- **`workerSize` no rechaza lo que no reconoce**: perder la talla de un
  trabajador es peor que guardarla con escritura rara.

---

## 5. Orden sugerido

| # | Acción | Esfuerzo | Efecto |
| --- | --- | --- | --- |
| 1 | **Blindar el backfill de ropa** (D-1): restringir a `size_family = 'ropa'` o allowlist explícito, y agregar `--dry-run` | bajo | evita corromper 38 familias |
| 2 | **Ampliar `normalizeSizeLabel`**: `T/L`→`L`, `N41`→`41`, `N-9`→`9` (A-1, A-2, A-3) | bajo | arregla orden y selector en 9 familias **sin tocar un dato** |
| 3 | **Implementar el diseño del importador** (B-1, B-2, B-3) | medio | cierra la fuente |
| 4 | **Conciliar el dato** (A-4) mientras 49 de 67 variantes están libres de historial | medio | elimina duplicados; se encarece con cada import |
| 5 | **Resolver `size_catalog` base vs semilla** (C-1, C-2): decidir quién manda para casco y enganchar el sync a `db:migrate` | bajo | el padrón deja de ofrecer tallas imposibles |
| 6 | **Borrar código muerto** (E-2, E-3) y unificar los cuatro mapas (E-4) | bajo | una sola regla |

El paso 2 es el de mejor razón esfuerzo/efecto: es una función pura con
pruebas, y arregla el orden y el selector de nueve familias sin migración ni
reescritura de datos.

## 6. Lo que NO haría

- **No cambiar el modelo.** Variante = producto funciona y la talla ya viaja
  por todo el ciclo.
- **No agregar columnas.** `size_family` ya existe y nadie la escribe todavía;
  el problema no es de esquema.
- **No rediseñar `product-size.ts`.** Es el acierto del sistema.
- **No uniformar familias enteras durante la importación**, como ya decidió el
  diseño aprobado.

---

## 7. Cómo se verificó

- Lectura del código: `lib/products/product-size.ts`, `size-catalog.ts`,
  `variant-grouping.ts`, `attribute-names.ts`, `lib/services/sizes.ts`,
  `product-sizes.ts`, `worker-size.ts`, `epp-clothing-sizes.ts`,
  `epp-import.ts`, `epp-import.types.ts`, `lib/validation/masters.ts`,
  `app/(app)/entregas/delivery-size-options.ts`,
  `app/(app)/solicitudes/variant-selector.helpers.ts`,
  `app/(app)/admin/trabajadores/worker-form.tsx`, migraciones 0088 y 0155.
- Consultas a `bodega_dev` para el estado del dato (secciones 2, A-4, C-1, D-1).
- Ejecución de `normalizeSizeLabel` y `compareSizeLabels` sobre los 25 valores
  reales del catálogo (A-1, A-2).
- Ejecución de `getSizeVariantPicker` y `getSizeFamilyOptions` contra los datos
  reales de las 38 familias (A-3, C-1).
- `npm run db:preflight-worker-sizes` (E-1).
- `npx vitest run` sobre `product-size.test.ts`, `size-catalog.test.ts` y
  `variant-grouping.test.ts`: 41 pruebas verdes.

**No verificado en navegador.** Los hallazgos A-2 y A-3 se reprodujeron
ejecutando las funciones que alimentan esas pantallas contra los datos reales,
no abriendo la aplicación. Sin cambios de código en esta auditoría.

---

# Estado de ejecución — 2026-09-09

Trabajo en la rama `epp/tallas-importador` (18 commits, **sin mergear a `main`**).
Al empezar a ejecutar se descubrió que el plan del importador ya estaba
implementado en el worktree `.claude/worktrees/epp-tallas-importador` y nunca
se había mergeado; lo que sigue es su revisión y los huecos que dejaba.

## Cerrado

| Hallazgo | Cómo se cerró |
| --- | --- |
| **A-1, A-2** (`T/L`, `N41` sin normalizar) | `normalizeSizeLabel` aprende los prefijos `T/` («talla») y `N` («número»). `Camisa Absolute Zero` pasó de `T/L, T/M, T/S` a `T/S, T/M, T/L`; `Guante Ansell` de `N-10, N-9` a `N-9, N-10`. |
| **A-5, B-1, B-2, B-3** (importador) | Los 12 commits ya existentes: `resolveSizeAttribute` reemplaza la heurística de dos dígitos, `size_family` se persiste, `normalizeSize` (el `toUpperCase`) se borró. |
| **C-1, C-2, C-3, C-4** (`size_catalog` desincronizado) | `casco` de la semilla pasa a `Única` (manda la base, decisión tomada). `db:migrate` ahora corre `db:seed-size-catalog`. Aplicado a `bodega_dev`: 13 tallas creadas, `pantalon` completa, `guantes` con XS y 2XL. |
| **D-1** (backfill de ropa) | Exige `size_family = 'ropa'` declarada y no escribe sin `--apply`. Verificado: 82 familias escaneadas, **0 variantes**. |
| **E-2, E-3, E-4** (código muerto) | `worker-size.ts` borrado, `getCanonicalSizesByFamily` borrado, el cuarto mapa familia ↔ padrón derivado con `sizeFamilyForWorkerField`. |
| **A-4** (duplicados) | Herramienta construida y cubierta, **no aplicada**. Ver abajo. |

### Defecto encontrado al cerrar C-1

Enganchar el sync destapó que `syncSizeCatalog` insertaba las tallas faltantes
con el `display_order` que tienen **en la semilla**, ignorando los órdenes ya
guardados. `guantes` tenía S, M, L, XL en 0..3; el `XS` nuevo entraba con 0 y
empataba con el `S`, así que la familia salía `S, XS, M, L, XL` con un hueco en
4. Sin arreglarlo, cada despliegue podía desordenar una familia.
`reconcileDisplayOrder` renumera cada familia con `compareSizeLabels`.
`syncSizeCatalog` no tenía **ninguna** cobertura; ahora la tiene.

### A-4: 7 de 8 grupos listos, 1 bloqueado

`scripts/reconcile-epp-duplicate-sizes.ts` (dry-run por omisión, `--apply` para
escribir). Da de baja con `is_active = false`, nunca borra: Solicitudes filtra
por `is_active`, así que el duplicado sale del picker y la fila queda intacta.

```
[BAJA]    Botín V-Flex Thinsulate V15  talla 41   EPP-021 absorbe EPP-022
[BAJA]    Guante Cabritilla sin forro  talla M    EPP-065 absorbe EPP-066
[BAJA]    Guante Cabritilla sin forro  talla L    EPP-068 absorbe EPP-069
[BAJA]    Traje PU Verde Activex       talla M    EPP-109 absorbe EPP-113
[BAJA]    Traje PU Verde Activex       talla L    EPP-110 absorbe EPP-108
[BAJA]    Traje PU Verde Activex       talla XL   EPP-107 absorbe EPP-112
[BAJA]    Traje PU Verde Activex       talla 2XL  EPP-106 absorbe EPP-111
[SALTADO] Guante Activex Nitrilo       talla L    EPP-TRECK-022 vs EPP-056
```

El grupo saltado necesita decisión humana: EPP-056 tiene 20 unidades y 5
referencias (guía de despacho, OC, solicitud de compra, movimiento, stock).
Trasladar ese stock y repuntar esas referencias tiene consecuencias contables.

## Corrección a A-6

**A-6 estaba mal diagnosticado.** Se describió como un mapeo equivocado
(«el atributo `Talla` apunta a `sizeTop` en vez de `sizeBottom`») y la
corrección propuesta no habría funcionado:

| Dónde | Escala |
| --- | --- |
| Catálogo — las 6 familias de pantalón y jardinera | **Letras**: `T/S`, `T/L`, `XL`, `2XL`, `3XL`, `M`, `L` |
| Padrón (`workers.size_bottom`) | **Cintura**: `48` |
| `size_catalog.pantalon` | **Cintura**: 28…48 |

Apuntar los pantalones a `sizeBottom` compararía `L` contra `48`: nunca
matchea. Cambiaría una sugerencia equivocada por una que jamás dispara. **No es
un bug de mapeo, es un conflicto de escalas**, y la decisión de fondo es si el
pantalón se sizea por letra o por cintura.

La evidencia favorece la letra: **6 de 6 familias del catálogo usan letras y
ninguna usa cintura**, que es también por qué el plan del importador mandó
`pantalon` y `jardinera` a la familia `ropa`.

### Hallazgo nuevo · La familia `pantalon` no tiene un solo uso — **medio**

Corolario del anterior: las 11 tallas de cintura de `size_catalog.pantalon`
—sembradas en `bodega_dev` por este trabajo— sólo alimentan el selector
«Pantalón» del formulario de trabajadores, y sus valores no pueden cruzar con
ningún producto del catálogo. Es una familia que existe para un dropdown, no
para el catálogo.

Opciones, para decidir:

1. **`workers.size_bottom` pasa a letras** y `pantalon` se da de baja o se
   redefine con la escala de ropa. Coherente con el 100% del catálogo. Invalida
   el único valor cargado (`48`).
2. **El catálogo empieza a sizear pantalones por cintura.** Contradice las 6
   familias existentes y exige reetiquetar variantes con historial.
3. **Dejarlo.** El selector sigue ofreciendo cinturas que no cruzan con nada.

## Sigue abierto

- **El padrón está vacío**: 1 de 147 trabajadores tiene alguna talla cargada.
  No es trabajo de código — toda la maquinaria de sugerencia (`suggestedWorkerSize`,
  `habitualSizeMissing`, el cruce con `size_catalog`) está construida y probada,
  y no tiene datos con que trabajar. Mientras siga así, A-6 es latente: ninguna
  sugerencia dispara, ni buena ni mala.
- **La decisión de escala del pantalón** (arriba).
- **El grupo duplicado con historial** (EPP-056 / EPP-TRECK-022).
- **El merge** de `epp/tallas-importador` a `main`.

## Verificación de esta etapa

`npm run typecheck` exit 0 · 173 pruebas rápidas · 10 PGlite nuevas de
conciliación de duplicados · 6 PGlite nuevas de `syncSizeCatalog` · `npm run
lint` exit 0. Dos archivos de test que usaban PGlite y corrían en el proyecto
paralelo quedaron registrados en `tests/pglite-files.ts`.

**No verificado en navegador.** Los efectos en Solicitudes y Entregas se
reprodujeron ejecutando las funciones que alimentan esas pantallas contra los
datos reales de `bodega_dev`, no abriendo la aplicación.

---

# Cierre con la compilación de compras — 2026-09-09

La compilación de facturas por producto y talla (70 productos, 17.456 unidades,
2022-2026) resolvió con evidencia lo que las secciones anteriores dejaban como
decisión pendiente.

## Escalas reales, medidas

| Categoría | Escala | Tallas compradas |
| --- | --- | --- |
| Pantalones / Piernas (4.491 u) | **Letras** | S, M, L, XL, 2XL, 3XL — **cero cinturas** |
| Buzos, Trajes, Overoles (4.152 u) | Letras | S…3XL + `UNICA` |
| Guantes (2.980 u) | Letras | **sólo M, L, XL** |
| Poleras, Camisas (2.536 u) | Letras | S…3XL |
| Chaquetas (1.448 u) | Letras | S…3XL |
| Calzado (1.178 u) | **Números** | 36…46 — calza exacto con la semilla |
| Chalecos (613 u) | Letras | S…3XL |
| Respiratoria / Altura (58 u) | Letras | L, `M-L`, `UNIVERSAL` |

## A-6 · Cerrado, y estaba mal diagnosticado

La sección anterior lo corrigió a «conflicto de escalas» y dejó tres opciones.
La compilación elige: **el pantalón se sizea por letra**, sin ambigüedad.

`size_catalog.pantalon` pasó de cinturas 28…48 a la escala de letras, y el
importador manda los pantalones ahí con el atributo «Talla inferior», que sí
cruza con `workers.size_bottom`. Las dos familias comparten escala a propósito:
lo que las distingue es con qué campo del padrón cruzan, y un trabajador puede
ser L arriba y XL abajo. Eso revierte la desviación que el plan del importador
había registrado, que existía sólo porque la familia tenía cinturas.

Las prendas de una pieza —jardinera, overol, buzo, traje, capa— se quedan en
`ropa` con la talla de arriba: visten el torso completo.

Las cinturas se dieron de baja con `is_active = false` (migración
`0261_pantalon_letter_scale`), no se borraron: `syncSizeCatalog` es aditivo por
diseño, así que sin eso la familia habría quedado con cinturas y letras
conviviendo — el mismo empate que tenía el casco.

## E-5 · Cerrado

`CLOTHING_TARGET_SIZES` pasó de `XS..2XL` a `S..3XL`. El XS **nunca se compró**
en ninguna categoría de ropa y el 3XL sí (376 unidades). El backfill creaba una
talla que nadie usa y omitía una que sí.

Distinción deliberada: **no se tocó el rango que `size_catalog` ofrece.** Para
un dropdown conviene ser generoso —un trabajador chico puede necesitar un XS que
nunca se compró—, pero *crear* variantes de catálogo con SKU y proveedor propios
que nadie va a pedir es basura de catálogo. Por eso los guantes siguen
ofreciendo `XS..2XL` aunque sólo se compren M, L y XL.

## Hallazgos nuevos que la compilación deja anotados

- **`UNICA` y `UNIVERSAL` son el mismo concepto** escrito distinto (`Capa PVC`,
  60 u en 10 facturas; `Respirador Full Face`, 2 u). **Unificados**: la
  equivalencia vive en `WORD_FORMS` y se consulta antes y después de quitar el
  prefijo — sin la segunda consulta «talla universal» se escapaba, y se
  escapaba «talla mediana» igual.
- **El traje se sizea como conjunto.** Esta auditoría anotó primero que
  «`Traje PU Verde Activex Pantalón` infiere `traje` y no `pantalon`» como una
  limitación de `inferEppItemType`. **Era una lectura equivocada**: un traje PU
  es una prenda de dos piezas que se vende y se sizea como conjunto, así que el
  pantalón de un traje lleva la talla del traje, no una talla de pantalón.
  Clasificarlo como `traje` → `ropa` → talla de arriba es el comportamiento
  correcto, no un caso pendiente. Corregido en el mapa y en su test.
- **`size_bottom = 48`** del único trabajador cargado quedó huérfano: un número
  en un campo que ahora es de letras. `preflight-worker-sizes` ya lo lista.
- **Los respiradores tienen talla real** (`L`, `M-L`, `UNIVERSAL`) y no están en
  `EPP_TYPE_TO_SIZE_FAMILY`, así que entran con `Talla` sin familia. Correcto
  hoy —no hay campo del padrón para respirador— pero es un eje de talla que el
  catálogo no modela.

## Sigue abierto

- **El padrón está vacío**: 1 de 147 trabajadores. No es trabajo de código.
- **El grupo duplicado con historial** (EPP-056 / EPP-TRECK-022).
- **El merge** de `epp/tallas-importador` a `main` — 19 commits.
- **Colisión de numeración**: la migración `0261_pantalon_letter_scale` choca con
  el `0261_mushy_punisher.sql` sin commitear del trabajo de respaldos en `main`.
  `verify-migration-chain` exige índices contiguos en el journal, así que al
  mergear hay que renumerar una de las dos.

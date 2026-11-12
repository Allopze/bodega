# Auditoría del catálogo de EPP y su cadena de cumplimiento — 2026-09-07

Alcance: `/admin/epps`, `/admin/productos` en lo relativo a EPP, el importador
XLSX, `epp_types`, `prevention_epp_requirements` y el cálculo de cobertura.
Deliberadamente **fuera de alcance** lo ya cubierto por
`AUDITORIA_TALLAS_EPP_2026-09-03.md` y `AUDITORIA_TALLAS_VARIANTES_ITEMS_2026-09-06.md`
(tallas, variantes, stock por variante, anulación de entregas): se revisó que
siguiera en pie, no se re-auditó.

Todo lo afirmado se verificó leyendo el código y consultando `bodega_dev`. Donde
digo "hoy" hablo del estado real de esa base.

## 1. Cómo funciona la cadena

`computeEppCoverageGaps` (`lib/prevention/epp.ts:95`) cruza dotación activa ×
requisitos vigentes × entregas reales. Para que una entrega acredite a un
trabajador tiene que sobrevivir **dos INNER JOIN** en
`lib/services/prevention-epp.ts:262-264`:

```
delivery_items → products.family_id → epp_product_families.epp_type_id → epp_types
```

De ahí que el catálogo de EPP no sea un maestro decorativo: es el que decide si
Prevención ve cobertura o brecha. Tres campos de la familia gobiernan el
resultado:

| Campo | Gobierna |
|---|---|
| `family_id` (en `products`) | que la entrega sea visible para Prevención |
| `epp_type_id` | contra qué requisito se acredita |
| `lifespan_months` | si la entrega está vigente o vencida |

## 2. Estado real del dato (bodega_dev)

| Chequeo | Resultado |
|---|---|
| Productos EPP | 117 |
| … sin familia | 0 *(corregido hoy, ver `docs/deploy/BACKFILL_FAMILIAS_EPP.md`)* |
| Familias | 82 |
| … con `epp_type_id` | **0** |
| … con `lifespan_months` | **0** |
| … con `certification` | **0** |
| … con `brand` | **0** |
| Requisitos EPP activos | 0 |
| Productos EPP sin atributo obligatorio | 18 |
| `products.is_epp` ≠ `categoría.is_epp` | 1 |
| Familias huérfanas / multi-categoría | 0 |

Es decir: **la cadena de cumplimiento está estructuralmente completa y
funcionalmente vacía**. No produce reportes falsos sólo porque nadie configuró
requisitos todavía; el día que se configure el primero, ninguna entrega
acreditará a nadie.

## 3. Hallazgos

### H-1 · La única pantalla que clasifica el tipo de EPP no está enlazada — **crítico**

`app/(app)/admin/epps/actions.ts:22-28` documenta a `setEppFamilyTypeAction`
como *"The only place that lets an admin set (or fix) a family's `eppTypeId`"*.
Correcto. Y esa pantalla es inalcanzable por UI:

- `grep -rn "admin/epps"` fuera de su propia carpeta → **cero referencias**.
- `app/(app)/admin/page.tsx` lista 24 secciones de administración. "Catálogo de
  EPP" no está entre ellas.
- No hay enlace desde `/admin/productos` ni desde `/prevencion/epp-preventivo`.

Sólo se llega escribiendo la URL. Esto explica por sí solo el 0 de la tabla
anterior: no es que nadie haya querido clasificar, es que no hay por dónde.

**Corrección:** entrada en el índice de `/admin` (grupo "Catálogos operativos"),
y enlace contextual desde `/prevencion/epp-preventivo` cuando haya familias sin
clasificar.

### H-2 · El alta manual y el wizard no clasifican la familia; sólo el import XLSX — **alto**

`resolveFamily` del importador (`lib/services/epp-import.ts:240-257`) infiere el
tipo y escribe `eppTypeId` al crear la familia. El alta manual no:
`ensureEppFamilyTx` (`app/(app)/admin/productos/actions/helpers.ts:107-113`)
inserta con `eppType: null, brand: null, model: null` y **ni intenta** inferir.
`grep -rn "eppTypeId" app/(app)/admin/productos/actions/` → cero referencias.

Consecuencia: toda familia creada desde el formulario o el wizard nace sin
clasificar, incluso cuando el nombre dice "Casco Activex I" y la inferencia
resolvería el tipo sin ambigüedad.

Además, el comentario de `app/(app)/admin/epps/actions.ts:24-26` afirma que
*"every automatic write path (manual product form, EPP variant wizard, XLSX
import) only fills it in when it can infer one"*. **Es falso para dos de los
tres caminos** y desorienta a quien lo lea después.

**Corrección:** llamar `inferEppItemType` (ya exportado en
`lib/services/epp-import.types.ts`) desde `ensureEppFamilyTx`, y corregir el
comentario. Es el cambio de mejor relación costo/beneficio de esta auditoría:
cierra la brecha en origen para todo lo que se cree de aquí en adelante.

### H-3 · El wizard de EPP no pide vida útil ni certificación — **alto**

Los 3 pasos son "Información", "Atributos", "Proveedor"
(`app/(app)/admin/productos/epp-wizard-steps.tsx:12-16`). `grep` de
`eppType|lifespan|certification` en el wizard, el generador de variantes y
`product-form.tsx` → **cero coincidencias**.

Los dos campos existen sólo en el formulario de `/admin/epps`, que es la
pantalla no enlazada de H-1. De ahí el 0/82 en ambos.

Consecuencias concretas:
- `lifespan_months` nulo ⇒ por la regla documentada en `lib/prevention/epp.ts:86-93`
  la entrega se considera **vigente indefinidamente**. Hoy ningún EPP vence nunca.
- `certification` nulo ⇒ no hay trazabilidad de la norma que certifica el EPP
  entregado, que es exactamente lo que se audita en una fiscalización.

### H-4 · La cobertura excluye entregas en silencio, sin declararlo — **alto**

Los dos INNER JOIN descartan sin dejar rastro las entregas de familias sin
clasificar. La pantalla `/prevencion/epp-preventivo` y el export
`/api/prevencion/epp/export` presentan el resultado como si fuera completo:
`grep -rn "clasific|sin tipo|incompleto|excluid"` en el módulo → **cero**.

El sesgo del error es benigno (una familia sin clasificar produce brecha de
más, no cobertura de menos), pero un **tipo equivocado** sí produce un
"cubierto" falso, y el usuario no tiene forma de saber sobre qué universo se
calculó el reporte.

**Corrección:** banda de completitud del dato en la pantalla y una fila en el
export: "N familias sin clasificar; M entregas quedaron fuera de este cálculo",
con enlace a `/admin/epps`.

### H-5 · `scopeType: "task"` es persistible y nunca aplica — **medio**

`requirementSchema` (`lib/services/prevention-epp.ts:77`) acepta
`"task"` en el enum y su `superRefine` (línea 86) hasta valida que traiga
`scopeValue`. Pero `requirementApplies` (`lib/prevention/epp.ts:73-82`) cae en
`default: return false` para ese alcance. Un requisito por tarea se guarda bien
y **no genera brecha para nadie, jamás**.

La UI lo evita con un filtro de una línea
(`epp-dialogs.tsx:13`: `.filter((type) => type !== "task")`), así que hoy no es
alcanzable — pero es un desalineamiento latente entre la superficie de
validación y el cálculo, a un `.filter` de distancia de activarse. Hoy hay 0
filas con ese alcance.

**Corrección:** sacar `"task"` del enum hasta que se implemente, o marcar esos
requisitos como "no evaluado" en el listado. Lo que no debe quedar es que el
servidor acepte lo que el cálculo ignora.

### H-6 · `preferredFamilyId` es de solo escritura — **medio**

El diálogo pide "Familia de producto sugerida" con el hint *"Opcional. Ayuda a
Bodega a saber qué entregar"* (`epp-dialogs.tsx:101-110`). Se valida, se
persiste (`prevention-epp.ts:120`) y se puede parchear (línea 154).

Nunca se lee. `app/(app)/prevencion/epp-preventivo/page.tsx:53-63` mapea el
requisito campo por campo y lo omite, el listado no lo muestra, el cálculo de
cobertura no lo usa y el formulario de entregas no lo consulta
(`grep -rn "preferredFamilyId"` → sólo esquema, servicio y diálogo). **La
promesa del hint no se cumple: a Bodega no llega nada.**

### H-7 · `setEppFamilyTypeAction` sin validación ni manejo de error, y sin test — **medio**

`app/(app)/admin/epps/actions.ts:30-51`: acepta `eppTypeId` como string
arbitrario, no comprueba que exista en `epp_types` y hace el `update` **fuera de
try/catch**, a diferencia de `updateEppFamilyAction` que sí envuelve todo. Un id
inválido lo detiene la FK (`epp_product_families_epp_type_id_epp_types_id_fk`),
así que la integridad está a salvo, pero el 23503 escapa crudo: el cliente
(`epp-family-list.tsx:100-105`) sólo tiene `.then/.finally`, así que la promesa
rechazada deja el `toast` sin emitir y el error sin explicar.

`lib/__tests__/epp-family-form.test.ts` cubre `updateEppFamilyAction` con 4
casos. **`setEppFamilyTypeAction` no tiene ninguno**, siendo el eslabón del que
depende toda la cobertura.

### H-8 · Falta el ciclo de vida de la familia: crear, renombrar, recategorizar, fusionar, eliminar — **medio**

El formulario de familia sólo edita marca, modelo, certificación y vida útil
(`epp-family-form.tsx:64-119`). No existe:

- **Renombrar** `canonical_name`, que es el nombre que se muestra y del que se
  deriva `identity_key`. Las 77 familias que creó el backfill se llaman como uno
  de sus productos; si el nombre quedó mal, no hay cómo corregirlo por UI.
- **Recategorizar** (`category_id`).
- **Fusionar** dos familias. Y esto es un callejón sin salida explícito: el
  mensaje de error de `updateEppFamilyAction:127` dice *"Ya existe la familia
  «X» con esa marca y modelo. **Fusiónalas** o usa otro modelo"* — **instruye
  una acción que la UI no ofrece**. Sólo `scripts/normalize-epp-families.ts`
  fusiona, desde la CLI.
- **Crear** o **eliminar** una familia.

### H-9 · `epp_types` no tiene administración — **bajo**

Los 9 tipos (zonas corporales) sólo existen por migración.
`/admin/catalogos-productos` administra unidades de medida y plantillas de
atributos, no `epp_types`. Defendible si la taxonomía se considera fija —
pero entonces conviene documentarlo, porque hoy parece una omisión.

### H-10 · `pictogram_url` es una columna muerta — **bajo**

`db/schema/products.ts:29` la declara. `grep -rn "pictogramUrl|pictogram_url"`
en todo el repo → **esa línea y nada más**. Ni se lee ni se escribe: feature sin
terminar o peso muerto. El pictograma del EPP es justamente lo que hace legible
un comprobante de entrega para el trabajador, así que probablemente valga
terminarla en vez de borrarla.

### H-11 · `eppTypeLabel` cae al vocabulario deprecado — **bajo**

`app/(app)/admin/epps/page.tsx:43`: `f.type?.label ?? f.eppType ?? null`.
`epp_type` es la columna de texto deprecada con vocabulario de **ítem**
("casco", "guante"); `epp_types.label` es de **zona corporal** ("Cabeza"). El
fallback puede mostrar uno donde se espera el otro. Hoy no se manifiesta porque
la tarjeta móvil condiciona el badge a `eppTypeId`, pero es una mezcla de
vocabularios esperando lector desprevenido.

## 4. UI/UX

### U-1 · "No vence" afirma una decisión que nadie tomó — **medio**

`epp-family-list.tsx:58`: `lifespanMonths != null ? \`${n} meses\` : "No vence"`.
Con 82/82 en nulo, la tabla entera declara "No vence" como si fuera una política
deliberada, cuando es un campo sin llenar. Debería distinguirse: "Sin definir"
(neutro, accionable) vs. "No vence" (elección explícita). Requiere poder
registrar esa elección — hoy nulo significa las dos cosas.

### U-2 · La fila de escritorio esconde el problema que la tarjeta móvil sí muestra — **medio**

La tarjeta móvil (línea 122) marca `<MetaBadge label="Sin clasificar"
variant="warning" />`. La fila de escritorio (línea 153) sólo renderiza el
`Select` con placeholder "Sin clasificar", que se lee como un desplegable vacío,
no como una advertencia. La vista principal comunica **menos** que la
secundaria, justo del dato más importante de la pantalla.

### U-3 · `/admin/epps` no tiene el sistema de advertencias que sí tiene `/admin/productos` — **medio**

`/admin/productos` tiene `getProductWarnings` / `getFamilyWarnings` con icono
`Warning` y avisa de precio, proveedor y atributos EPP faltantes.
`/admin/epps` no tiene nada equivalente, pese a que sus campos vacíos tienen
consecuencias mayores (que nada venza, que nada acredite). Los 18 productos EPP
sin atributo obligatorio y el 1 con `is_epp` divergente **ya se avisan** en
Productos; el 82/82 sin tipo/vida útil/certificación no se avisa en ninguna
parte.

### U-4 · Se buscan campos vacíos y no se busca el que se ve — **bajo**

`searchKeys={["canonicalName", "brand", "model", "certification"]}` (líneas 190
y 203). `brand`, `model` y `certification` están nulos en las 82 familias: tres
de las cuatro claves son inertes hoy. Y `sku` **no** es clave de búsqueda,
aunque los badges de SKU son el elemento visual dominante de la primera columna
(líneas 144-151): el usuario ve el SKU y no puede buscarlo.

### U-5 · Los SKU se muestran truncados y sin salida — **bajo**

`row.variants.slice(0, 4)` + badge `+N` (líneas 145-150). Ni los badges de SKU
ni el `+N` son enlaces: no hay forma de ver las variantes restantes ni de
navegar a la variante en `/admin/productos`. Para la familia de 8 variantes
(`Traje PU Verde Activex`) se ven 4 y se pierde el resto.

### U-6 · La pantalla trae el catálogo completo sin paginar — **bajo**

`page.tsx:15-27` hace `findMany` de todas las familias con `products` y
`productAttributes` anidados, y recién en la línea 33 descarta en JS las
familias no-EPP que ya trajo. Hoy son 82 familias y es irrelevante; crece de
forma cuadrática con variantes × atributos y no hay paginación ni límite.

## 5. Lo que se auditó y está bien

No todo lo que se revisó tenía problema. Vale registrarlo para no volver a mirar:

- **RBAC y scoping.** `/admin/epps` exige `admin:products`;
  `/prevencion/epp-preventivo` distingue `prevention:epp:view` de
  `prevention:epp:manage` y resuelve `resolveWorksiteScope` por sesión. Las
  acciones re-validan permiso en cada invocación, no en un helper compartido
  (comentario explícito en `actions.ts:29`).
- **`updateEppFamilyAction`** es ejemplar: transacción, recálculo de
  `identity_key` con detección previa de colisión y error de campo legible en
  vez de un 23505 crudo, y `recordAudit` **dentro** de la `tx` (con el motivo
  documentado). 4 tests.
- **`computeEppCoverageGaps`** razona explícitamente por qué una familia sin
  vida útil no genera brecha por vencimiento, y por qué difiere del criterio de
  higiene. Usa el `addMonths` con clamping de fin de mes, con el bug que lo
  motivó anotado.
- **Anti-patrón evitado:** el selector de familia sugerida se **oculta** cuando
  no hay familias elegibles en vez de mostrar un desplegable vacío
  (`epp-dialogs.tsx:101`).
- **`"task"` filtrado en la UI** antes de llegar al usuario (H-5 es el
  desalineamiento del schema, no un bug alcanzable).
- Las entregas anuladas (`deliveries.voidedAt`) y las entregas a faena
  (`destinationType != 'worker'`) quedan fuera de la cobertura, ambas con el
  motivo documentado en el propio query.
- Rutas dinámicas: `requirePermission` llama `auth()`, que lee cookies, así que
  no hay riesgo de caché rancia tras editar una familia. Se verificó antes de
  reportarlo como problema; no lo es.

## 6. Orden sugerido

Por dependencia, no por severidad: H-1 y H-2 son los que cambian el estado del
sistema; el resto son mejoras sobre un sistema que ya funciona.

1. **H-1** — enlazar `/admin/epps`. Sin esto nada de lo demás es operable.
2. **H-2** — inferir el tipo en `ensureEppFamilyTx` y corregir el comentario
   falso. Cierra la brecha en origen.
3. **H-3** — vida útil y certificación en el wizard de EPP.
4. **H-4** + **U-2** + **U-3** — hacer visible el dato incompleto donde se
   decide y donde se reporta.
5. **H-7** — validar y testear `setEppFamilyTypeAction`.
6. **H-8** — renombrar y fusionar familia (al menos: el mensaje de error ya
   promete la fusión).
7. **H-5**, **H-6** — cerrar los dos campos que se aceptan y se ignoran.
8. **U-1**, **U-4**, **U-5**, **H-9**, **H-10**, **H-11**, **U-6** — deuda menor.

## 7. Estado de implementación

Los 17 hallazgos se corrigieron el mismo día.

| Hallazgo | Corrección |
|---|---|
| H-1 | Entrada "Catálogo de EPP" en el índice de `/admin` |
| H-2 | `classifyEppTypeIdByName` como módulo compartido, llamado desde `ensureEppFamilyTx`; el importador abandonó su copia privada. Comentario falso corregido |
| H-3 | Certificación y vida útil en el paso 1 del asistente, sólo si es EPP; se escriben en la familia con la regla "sólo campos vacíos" |
| H-4 | `getEppCoverageDataHealth` + banda `CoverageDataHealth` en Prevención y hoja "Completitud del dato" en el export |
| H-5 | `"task"` fuera del enum de entrada; UI y validación comparten `EPP_REQUIREMENT_INPUT_SCOPES`; badge "No evaluado" para filas históricas |
| H-6 | `listEppRequirements` devuelve la familia sugerida y el listado la muestra |
| H-7 | Valida que el tipo exista, envuelve el update, mensaje legible; 2 tests |
| H-8 | Nombre y categoría editables (con recálculo de `identityKey`) y `mergeEppFamiliesAction` + diálogo |
| H-9 | Documentado como taxonomía cerrada en `db/schema/epp-types.ts`, con el motivo |
| H-10 | `pictogramUrl` conectado: campo validado en la ficha y renderizado en el comprobante de entrega |
| H-11 | Fallback al `eppType` deprecado eliminado |
| U-1 | Columna `lifespan_not_applicable` (migración `0260`): "Sin definir" ya no se confunde con "No vence" |
| U-2 | Icono de advertencia en la fila de escritorio, con el detalle en `title`/`aria-label` |
| U-3 | `getEppFamilyWarnings` (10 tests) mostrado en fila y tarjeta |
| U-4 | `skuSearch` en `searchKeys` |
| U-5 | Todos los SKU enlazan a `/admin/productos/[id]`; se eliminó el `+N` sin destino |
| U-6 | Filtro de familias EPP en SQL y `productAttributes` fuera de la consulta |

### Lo que se decidió NO construir

- **Crear y eliminar familias por UI** (parte de H-8): una familia sin productos
  queda huérfana y borrar una con productos los desvincula. El ciclo de vida
  correcto es el del producto, y la fusión ya cubre el caso real (duplicados).
- **Pantalla para `epp_types`** (H-9): un tipo creado desde una UI no tendría
  entrada en `EPP_TYPE_TO_BODY_PART_CODE`, así que la inferencia nunca lo
  asignaría y partiría en silencio el universo de cobertura. Agregar un tipo se
  queda como cambio de código, ahora documentado en el esquema.
- **Escritura automática de `epp_type_id` sobre las 82 familias existentes:** la
  inferencia resuelve 100 de 108 nombres, pero un tipo equivocado acredita al
  trabajador en la zona corporal errónea. Se clasifica desde `/admin/epps`, que
  ahora es alcanzable (H-1) y advierte cuáles faltan (U-2, U-3).

### Verificación

- 747 archivos y 7918 tests en verde (`test:fast` + `test:pglite`).
- Typecheck y lint limpios en todo lo tocado.
- 6 tests de render sobre `EppFamilyList` cubren U-1 a U-5; 18 tests de
  integración contra Postgres cubren la ficha, la fusión, la validación del tipo
  y la clasificación del alta manual.

**Brecha declarada:** no se verificó en navegador autenticado. Las credenciales
de `.env.qa` pertenecen a otro entorno y su usuario no existe en la base local;
no correspondía crear uno ni debilitar la autenticación para conseguirlo. Las
pantallas se verificaron con tests de render del componente real, no navegando
la aplicación.

**Nota sobre `npm run typecheck`:** hoy lo contamina `erpnext-develop/`, código
vendorizado git-ignored que `tsconfig.json` no excluye. El typecheck de este
trabajo se corrió excluyéndolo. Se arregla con una línea en `exclude`, fuera del
alcance de esta auditoría.

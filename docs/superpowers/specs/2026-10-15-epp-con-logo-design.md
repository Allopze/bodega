# EPP «con logo» — diseño

Fecha: 2026-10-15 · Estado: aprobado e implementado (rama `feat/epp-con-logo`)

## 1. Qué se quiere

Las prendas EPP de la empresa llevan **siempre** el logo. No es una opción que
quien pide elija: es una característica fija del tipo de prenda, y tiene que
llegar a la **orden de compra** para que el proveedor la confeccione o borde
con logo.

Caso que lo origina: **SOL-0057** (producción, EPP, en revisión). Sus poleras
Polo Dryfresh (5 líneas, 34 u.) y pantalones Lightwind (2 líneas, 4 u.) no
dicen «logo» en ninguna parte, y si pasan a OC el proveedor no se entera.
Paliativo mientras esto no esté desplegado: escribir «Con logo» en las notas de
esas líneas (las notas del ítem se imprimen en la OC).

**Éxito** = toda solicitud nueva o abierta de una prenda elegible muestra
«Logo: Con logo», y la OC impresa/PDF lo lleva como sub-línea, sin que nadie
lo escriba a mano.

## 2. Alcance (fase 1)

Tipos de ítem EPP (vocabulario `EPP_TYPES` de `lib/products/epp-item-type.ts`)
que llevan logo:

| Tipo        | Productos hoy en producción |
|-------------|-----------------------------|
| `chaleco`   | Chaleco geólogo Activex, Activex Geólogo Alta Visibilidad, Geólogo Canvas Sup. Grúas, Chaleco Geólogo Especial |
| `polera`    | Polo Dryfresh (hombre/dama), Piqué M/Larga, Polo Dry Fit, Dryfresh Smooth |
| `camisa`    | Absolute Zero Lightwind H2600 |
| `blusa`     | Absolute Zero Lightwind W2400 / Poliéster |
| `pantalon`  | Slack Cargo, Lightwind H3200/W3000, XR-100, HW Nahuel |
| `chaqueta`  | Activex micropolar |
| `primera capa` | Activex polyester |

**«Geólogo» = chaleco** (confirmado). «Geólogo Canvas Altavisibilidad / Sup.
Gruas» hoy no se clasifica porque el nombre no dice «chaleco».

Fuera de la fase 1 (se decide después): overol, jardinera, casco, gorro,
traje (PU/lluvia), capa PVC. No llevan logo: calzado, guantes, protección
ocular/respiratoria/auditiva, arnés, barbiquejo, cubrenuca, coleto de
soldador, buzo Tyvek.

**Sin excepción:** la regla es por tipo, no por producto. No hay casilla para
desmarcar ni override por producto. Si un tipo llega a mezclar prendas con y
sin logo, eso es una decisión nueva.

## 3. Hallazgos que condicionan el diseño

- **El logo ya existe, pero cada producto lo registra a su manera.** En
  producción 79 productos lo guardan como `Modelo: Con logo` (72) o
  `Modelo: Con logo Chome` (7). Usar Modelo para eso desplazó el modelo real:
  la camisa H2600 tiene variantes con Modelo «Con logo», «H2600» y «Lightwind
  H2600».
- **Solo 91 de 275 productos EPP activos tienen familia.** La elegibilidad no
  puede depender de `epp_product_families.epp_type_id`: se infiere del nombre
  con `inferEppItemType`, la misma regla que usan el importador y el asistente.
- **La cadena de atributos ya hace casi todo el trabajo.**
  1. Al pedir, el formulario de Solicitudes copia los `select` de un solo
     valor del producto a `request_item_attributes`
     (`buildAttrsFromProduct`, `request-form.helpers.ts:73`). La reposición
     automática de EPP usa el mismo camino.
  2. La OC impresa y el PDF juntan los atributos de un solo valor del catálogo
     con los registrados (`mergeVariantAttributes`) y los imprimen como
     sub-línea «Nombre: valor» (`page.tsx:131-155`, `oc-pdfcn-rows.ts:42-55`).
  3. Nueva OC, el detalle de OC, Recepción y Entregas los muestran con
     `formatVariantProductName`. Aprobaciones y el detalle de la solicitud
     muestran solo los registrados.
- **No hay correo de OC al proveedor**: lo que le llega es el PDF.
- **Un atributo con solicitudes no se puede borrar.**
  `request_item_attributes.attribute_id` es una FK sin cascada y
  `updateProduct` lo bloquea («Renómbralo en vez de quitarlo»). Por eso la
  migración de datos **renombra en el lugar**, no borra y crea.
- **El catálogo se escribe por seis caminos:** alta, edición y alta en lote
  (`app/(app)/admin/productos/actions/products.ts:114, 344, 796/808`), el
  importador EPP (`lib/services/epp-import.ts:284`), el importador XLSX de
  productos (`lib/services/product-xlsx-import.ts:248`) y la clonación de
  tallas (`lib/services/epp-size-variant-clone.ts:76/84`). Las plantillas de
  atributos solo actúan en el cliente y para altas nuevas, así que no sirven
  como garantía.

## 4. Diseño

### 4.1 Representación

Atributo de catálogo estándar en cada variante de una prenda elegible:

```
name = "Logo"   type = "select"   options = ["Con logo"]   isRequired = true
```

No se agrega columna ni migración de esquema: se reutiliza `product_attributes`
/ `request_item_attributes`, que ya llegan a todos los documentos. Es un
`select` de un solo valor, así que `resolveVariantAttributes` lo trata como
identidad de la variante igual que la talla o el color. Como todas las
variantes de la familia lo comparten, no divide el selector de talla de
Solicitudes ni el de Entregas.

### 4.2 Regla (código puro, sin dependencias)

Archivo nuevo `lib/products/epp-logo.ts`, importable desde cliente y servidor
como `epp-item-type.ts`:

- `LOGO_ATTRIBUTE_NAME = "Logo"`, `LOGO_VALUE = "Con logo"`.
- `EPP_TYPES_WITH_LOGO`: los siete tipos de la tabla del §2.
- `requiresLogo({ name, isEpp })`: `isEpp && EPP_TYPES_WITH_LOGO.has(inferEppItemType(name))`.
- `applyLogoRule(product, attributes)`: si el producto es elegible devuelve
  los atributos con exactamente un `Logo: Con logo`.
  - Un `Modelo` de un solo valor que empiece por «con logo» se convierte en ese
    `Logo` (conserva el id si lo trae).
  - Si ya hay un `Logo`, normaliza su valor.
  - Es idempotente. Si el producto no es elegible, devuelve los atributos sin
    tocarlos: **nunca quita** un `Logo` existente (la FK lo impediría si tiene
    historial, y un renombre no debe romper una edición).

`inferEppItemType` aprende el alias `geologo → chaleco`. El alias se evalúa
solo cuando el vocabulario principal no encontró nada: «Chaleco geólogo» ya
era `chaleco`.

Efecto colateral aceptado: «Geólogo Canvas…» pasa a clasificarse como
`chaleco`, lo que significa zona corporal `cuerpo` para cobertura y escala de
talla `ropa`. Es lo correcto y queda cubierto con un caso en
`epp-import.types.test.ts`.

### 4.3 Escrituras del catálogo (garantía en el servidor)

Los seis caminos de escritura del §3 pasan los atributos por `applyLogoRule`
antes de insertar o actualizar. Es la fuente de verdad, porque el asistente
puede cambiar el nombre después del paso 2 y los importadores no pasan por el
asistente.

### 4.4 Asistente de productos (vista previa en el cliente)

En el paso 2 (`epp-variant-generator.tsx`), si el producto es EPP y su nombre
resulta elegible, el eje `Logo` aparece **marcado y bloqueado** («Con logo»),
sin opción de quitarlo. Lleva una ayuda breve: «Las prendas llevan logo
siempre». En edición se ve igual. Se reutiliza el render de ejes existente; no
se crea un componente nuevo.

### 4.5 Datos existentes (backfill)

Servicio `lib/services/epp-logo-backfill.ts`, más el script
`scripts/backfill-epp-logo.ts` y el comando `npm run db:backfill-epp-logo`.
Sigue el patrón de `backfill-epp-size-ranges`: dry-run por omisión,
`--apply` para escribir, resumen JSON y una sola transacción.

1. **Catálogo:** para cada producto `is_epp` (activo o no) con `requiresLogo`:
   - si tiene `Modelo` de un solo valor «Con logo…», se renombra **en el
     lugar** a `Logo: ["Con logo"]` (mismo id, la FK queda intacta);
   - si tiene `Logo`, se normaliza el valor;
   - si no tiene ninguno de los dos, se inserta `Logo: ["Con logo"]`.
2. **Ítems de solicitud abiertos** (`requested`, `approved`,
   `pending_purchase`; todavía sin OC) de productos elegibles:
   - un `Modelo` registrado con valor «Con logo…» pasa a `Logo = Con logo`;
   - si no hay `Logo` registrado, se inserta, con `attribute_id` = el `Logo`
     del producto.
   - Aquí entran las poleras y los pantalones de la SOL-0057.
3. **Ítems ya en OC o posteriores:** no se tocan. Son instantáneas de un
   documento emitido.
4. **Informe:** cantidades por paso y la lista de productos y SKU afectados.
   Además, las **familias con variantes duplicadas por talla** que quedan a la
   vista (por ejemplo camisa H2600 «Con logo» frente a «H2600»), para
   unificarlas después con la herramienta existente. No se corrigen aquí.

Correr en producción: primero el dry-run, que se revisa con el usuario, y
después `--apply`. Ambos pasos requieren autorización explícita. Como los
demás backfills, va empaquetado en la imagen (`Dockerfile`) y como servicio
manual de `docker-compose.yml`, que no corre en el deploy:

```
docker compose run --rm backfill-epp-logo                                            # informa
docker compose run --rm backfill-epp-logo node scripts/backfill-epp-logo.mjs --apply  # escribe
```

## 5. Costos aceptados

- **Reimprimir una OC antigua** de una prenda elegible mostrará
  «Logo: Con logo», porque la OC junta los atributos actuales del catálogo. Es
  el comportamiento de hoy con cualquier atributo de catálogo. En una OC
  antigua cuyo ítem registró `Modelo: Con logo Chome` (por ejemplo la línea del
  geólogo en la OC-2026-0049), la reimpresión mostrará las dos sub-líneas. Es
  redundante, pero no falso.
- **En Entregas**, la etiqueta de variante de las prendas suma
  «Logo: Con logo».
- **No hay validación en el servidor** de que el valor registrado en la
  solicitud coincida con el del catálogo. La UI no ofrece otro valor y la OC
  vuelve a juntar el del catálogo.

## 6. Fuera de alcance

- Tipos de la fase 2 (overol, jardinera, casco, gorro, traje, capa).
- Unificar variantes duplicadas por talla: lo resuelve la herramienta de
  unificación existente, con la lista que entrega el informe del §4.5.
- En el panel de progreso (`request-progress-panel.tsx`) y en el editor de
  imputación de facturas, los atributos se listan dos veces. Es un defecto
  anterior; queda anotado y no se corrige aquí.
- Recuperar el modelo real de los productos donde «Con logo» lo había
  desplazado.

## 7. Seguridad, permisos y esquema

- **Esquema y permisos:** no hay rutas, permisos ni migraciones nuevas, así
  que no aplica la paridad de navegación ni de permisos.
- **Backfill:** escribe solo `product_attributes` y `request_item_attributes`,
  en una transacción y en modo idempotente.

## 8. Verificación

- **Unitarias** (`test:fast`):
  - `epp-logo.ts`: elegibles y no elegibles; alias geólogo; conversión de
    `Modelo: Con logo` y `Con logo Chome`; idempotencia; nunca quita `Logo`.
  - `inferEppItemType`: el caso Geólogo Canvas.
- **PGlite** (`test:pglite`):
  - Alta, edición, alta en lote, los dos importadores y la clonación de tallas
    dejan `Logo` en una polera y no en un botín.
  - Backfill:
    - el dry-run no escribe;
    - `--apply` renombra conservando el id, de modo que una
      `request_item_attributes` existente sigue resolviendo;
    - inserta donde falta y marca los ítems abiertos;
    - no toca los ítems en OC;
    - una segunda corrida no hace nada.
- **E2E** (`test:e2e`):
  - una solicitud EPP con una polera muestra «Logo: Con logo» en el ítem y en
    Aprobaciones; la OC impresa lo trae como sub-línea;
  - un botín en la misma OC no lo trae.
- **Navegador (dev):** se recorren el asistente de productos (eje bloqueado),
  Solicitudes, Aprobaciones, Nueva OC y la impresión de la OC.
- **Producción, después del `--apply`:** las líneas de poleras y pantalones de
  la SOL-0057 muestran «Logo: Con logo» (solo lectura).
- **Puertas:** `typecheck`, `lint`, `test:fast`, `test:pglite`, `test:e2e`.

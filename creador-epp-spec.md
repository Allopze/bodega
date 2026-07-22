# Spec: Mejora del Creador de EPP (ProductForm)

> Basado en entrevista con usuario de Prevención de Riesgos.
> Fecha: 2026-07-21 | Versión: 2.0 (decisiones consolidadas)

---

## 1. Problema actual

El modal de creación de productos (`ProductForm` en `/admin/productos`) tiene **3 pestañas** (General, Atributos, Proveedores) que obligan al usuario a navegar entre ellas para completar un producto EPP. Esto es confuso porque:

- Los campos relacionados con EPP están **dispersos** (checkbox "Es EPP" en General, presets de atributos EPP en Atributos).
- No hay una **vista unificada** de lo que se está creando.
- Para crear variantes de un EPP (ej: casco blanco talla M + casco azul talla M), el usuario debe crear productos individuales y repetir el proceso.
- El **perfil principal** de usuario es Prevención de Riesgos, no Bodega/Logística.

## 2. Propósito

Rediseñar el modal de creación de productos como un **asistente paso a paso (wizard)** de 3 pasos, que guíe al usuario desde la información general hasta la creación completa del producto y sus variantes, con detección inteligente de atributos según la categoría.

## 3. Decisiones de diseño (respondidas)

| Pregunta | Decisión |
|----------|----------|
| **Productos no-EPP** | Mismo wizard de 3 pasos, pero campos de atributos opcionales. Nunca se salta un paso. |
| **Edición de productos** | El wizard aplica TAMBIÉN para editar, con datos precargados. |
| **Mobile / Desktop** | Full-screen en mobile, centrado en desktop (igual que el Sheet actual). **NO se cambia a Dialog**, se mantiene `Sheet` como contenedor. |
| **Formato SKU variantes** | Secuencial simple: `EPP-XXXXXX` para todas las variantes. Sin sufijo de atributos en el SKU. |

## 4. Usuario principal

- **Perfil:** Prevención de Riesgos / Seguridad y Salud en el Trabajo (SST)
- **Frecuencia de uso:** 1-2 productos por sesión
- **Contexto:** Declaran EPP obligatorio para cargos/faenas y necesitan que el catálogo refleje los productos correctos con sus atributos (talla, color, etc.)

## 5. Principios de diseño

1. **Un solo flujo, sin pestañas** — El usuario no debe cambiar entre tabs para completar un producto.
2. **Progresión lógica** — De lo general a lo específico: info → atributos → proveedor.
3. **Inteligente por defecto** — Al seleccionar categoría, los atributos EPP típicos se cargan automáticamente.
4. **Creación en bulk de variantes** — El usuario puede definir múltiples colores y tallas y generar todas las combinaciones como productos individuales.
5. **Mismo contenedor Sheet** — Se mantiene el Sheet actual (full-screen mobile, centrado desktop). Solo cambia el contenido interno.
6. **Minimalista para el caso típico** — Proveedor es simple (1 preferido). Atributos se auto-detectan.
7. **Wizard también para editar** — Al editar un producto existente, se precargan los datos en los 3 pasos.

## 6. Flujo del wizard (3 pasos)

### Paso 1: Información general

**Objetivo:** Capturar los datos básicos del producto y determinar el tipo de EPP.

**Campos:**

| Campo | Tipo | Requerido | Notas |
|-------|------|-----------|-------|
| Categoría | Select (desplegable) | Sí | Al seleccionar, carga atributos EPP típicos y marca "Es EPP" automáticamente si la categoría está marcada como EPP |
| Nombre | Input de texto | Sí | Placeholder: "Casco de seguridad blanco clase A" |
| Descripción | Textarea | No | 2 filas. Placeholder: "Descripción del producto..." |
| Unidad de medida | Select | Sí | Default: "unidad". Valores: unidad, par, caja, paquete, set, juego |
| Precio ref. (CLP) | Input number | No | Formato moneda |
| Notas | Textarea | No | 2 filas |
| Es EPP | Checkbox | — | Se auto-marca según categoría. Editable manualmente. |
| Requiere Prevención | Checkbox | — | Se auto-marca según categoría. Editable manualmente. |
| Producto activo | Checkbox | — | Default: activo |

**Comportamiento inteligente:**
- Al cambiar de categoría, si la categoría tiene `isEpp = true`, se marca "Es EPP" y se cargan plantillas de atributos asociadas.
- Si la categoría tiene `requiresPrevencion = true`, se marca automáticamente.

**Botones:** "Siguiente →" (deshabilita si faltan campos requeridos).

---

### Paso 2: Atributos y Variantes

**Objetivo:** Definir los atributos del EPP y generar variantes (combinaciones de color × talla).

**Comportamiento:**
- Los 3 pasos se muestran siempre, incluso para productos no-EPP.
- Para productos no-EPP, los campos de atributos/variantes son **opcionales**.
- Si no se selecciona ningún atributo, se crea un solo producto sin variantes.

**Modo EPP (con variantes):**
El usuario puede definir:
- **Atributos** (se cargan automáticamente según categoría):
  - **Talla** (ropa): XS, S, M, L, XL, 2XL, 3XL
  - **Talla calzado**: 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46
  - **Talla guantes**: XS, S, M, L, XL, 2XL
  - **Color**: Amarillo, Azul, Blanco, Gris, Negro, Naranja, Rojo, Verde
- **Selector multi-valor**: En cada atributo, el usuario puede seleccionar múltiples valores (checkboxes).
- **Generación de combinaciones**: Al hacer clic en "Generar variantes", se muestra una vista previa con todas las combinaciones posibles (ej: Blanco/M + Blanco/L + Azul/M + Azul/L...).
- **SKU**: Se genera secuencialmente: `EPP-XXXXXX`. Sin sufijo de atributos.

**UI:**
- Sección "Atributos del EPP" con fichas (chips) para atributos comunes.
- Botones de acceso rápido: "+ Talla", "+ Talla calzado", "+ Talla guantes", "+ Color".
- Al hacer clic en un atributo, se expande para seleccionar valores.
- Tabla de previsualización de variantes generadas.
- Botón "Eliminar variante" individual.

**Botones:** "← Anterior" | "Siguiente →"

---

### Paso 3: Proveedor

**Objetivo:** Asociar un proveedor preferido al producto (o a todas las variantes).

**Campos:**

| Campo | Tipo | Requerido | Notas |
|-------|------|-----------|-------|
| Proveedor | Select (desplegable) | Sí | Lista de proveedores activos. Solo se puede seleccionar 1. |
| Precio unitario (CLP) | Input number | No | Precio referencial con ese proveedor |
| Notas | Input de texto | No | Tiempo de entrega, condiciones, etc. |

**Comportamiento:**
- Si se están creando variantes, el proveedor se asigna a todas.
- Opción "Sin proveedor por ahora" para crear el producto sin proveedor.

**Botones:** "← Anterior" | "Crear producto(s)"

---

## 7. Vista de resumen (opcional, entre paso 3 y crear)

Mostrar un resumen antes de crear:
- Nombre del producto/familia
- Categoría
- Cantidad de variantes a crear (si aplica → mostrar 1 si no hay variantes)
- Proveedor seleccionado
- Precio referencial

Botón "Crear N productos" (donde N es la cantidad de variantes, o 1 si no hay).

---

## 8. Comportamiento post-creación

- **Toast de éxito** con número de productos creados.
- **Cierre del modal** y recarga de la tabla de productos.
- Si se crearon variantes, se muestran agrupadas por familia en la tabla.

---

## 9. Mockups conceptuales

```
┌──────────────────────────────────────────────────────┐
│  Nuevo producto EPP                            [✕]  │
│  ─────────────────────────────────────────────────── │
│                                                      │
│  ● Información    ○ Atributos    ○ Proveedor         │
│  ───────────────                                        │
│                                                      │
│  Categoría:  [Elementos de Protección... ▼]          │
│  Nombre:     [Casco de seguridad clase A        ]    │
│  Descripción: [Casco de polietileno de alta...  ]    │
│                                                      │
│  Unidad: [unidad ▼]   Precio ref.: [₡ 5.000   ]    │
│                                                      │
│  ☑ Es EPP          ☐ Requiere Prevención            │
│  ☑ Producto activo                                   │
│                                                      │
│                     [Cancelar]  [Siguiente →]        │
└──────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────┐
│  Nuevo producto EPP                            [✕]  │
│  ─────────────────────────────────────────────────── │
│                                                      │
│  ○ Información    ● Atributos    ○ Proveedor         │
│  ───────────────                                        │
│                                                      │
│  Atajos para EPP:                                     │
│  [+ Talla] [+ Talla calzado] [+ Talla guantes]       │
│  [+ Color]  [Aplicar plantillas (3)]                 │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Talla (ropa):  ☑ S  ☑ M  ☑ L  ☐ XL  ☐ 2XL    │ │
│  │ Color:  ☑ Blanco  ☐ Azul  ☐ Amarillo           │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  Vista previa: 4 variantes                            │
│  ┌──────────┬──────────┬─────────────┐               │
│  │ SKU      │ Talla    │ Color       │               │
│  ├──────────┼──────────┼─────────────┤               │
│  │ EPP-...  │ S        │ Blanco      │               │
│  │ EPP-...  │ S        │ Azul        │               │
│  │ EPP-...  │ M        │ Blanco      │               │
│  │ EPP-...  │ M        │ Azul        │               │
│  └──────────┴──────────┴─────────────┘               │
│                                                      │
│  Sin atributos → marcar "Producto sin variantes"     │
│  (para EPP no-variante o productos no-EPP)           │
│                                                      │
│                     [← Anterior]  [Siguiente →]      │
└──────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────┐
│  Nuevo producto EPP                            [✕]  │
│  ─────────────────────────────────────────────────── │
│                                                      │
│  ○ Información    ○ Atributos    ● Proveedor         │
│  ───────────────                                        │
│                                                      │
│  Proveedor preferido:                                 │
│  [Seguridad Industrial Chile Ltda. ▼]                 │
│  Precio unitario: [₡ 4.500                     ]      │
│  Notas: [Entrega 5-7 días hábiles              ]      │
│                                                      │
│  ☐ Sin proveedor por ahora                           │
│                                                      │
│  El proveedor seleccionado se asignará a las         │
│  4 variantes del producto.                            │
│                                                      │
│                     [← Anterior]  [Crear 4 productos] │
└──────────────────────────────────────────────────────┘
```

## 10. Consideraciones técnicas

### Contenedor: Sheet (se mantiene)
- **NO se cambia a Dialog.** El Sheet actual (`components/admin/sheet.tsx`) ya es full-screen en mobile y centrado en desktop — justo lo que se necesita.
- Solo cambia el **contenido interno** del Sheet: de Tabs a Wizard.

### Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `app/(app)/admin/productos/product-form.tsx` | **Refactor mayor:** Tabs → Wizard de 3 pasos. Scaffolding de `CatalogFormSheet` va inline. |
| `app/(app)/admin/productos/product-form.types.ts` | Añadir tipos: `WizardState`, `VariantCombo`, `AttributeMultiValues`, `WizardStep` |
| `app/(app)/admin/productos/actions.ts` | Añadir server action `createProductVariantBatch` + schema Zod |
| `app/(app)/admin/productos/product-actions.tsx` | Ajustes menores si cambia interfaz de `ProductForm` |
| `app/(app)/admin/productos/product-list.tsx` | Ajustes menores si cambia interfaz |
| `app/(app)/admin/productos/product-route-sheet.tsx` | Ajustes si es necesario |

### Componentes nuevos a crear

| Componente | Propósito |
|------------|-----------|
| `epp-wizard-steps.tsx` | Barra de progreso del wizard (paso 1, 2, 3) |
| `epp-variant-generator.tsx` | Selector multi-valor de atributos + generación de combinaciones (producto cartesiano) |
| `epp-variant-preview.tsx` | Tabla de previsualización de variantes generadas |

### Componentes a eliminar/remover

| Componente | Motivo |
|------------|--------|
| `Tabs, TabsList, TabsTrigger, TabsContent` | Reemplazado por step state + render condicional |
| `EPP_ATTRIBUTE_PRESETS` (hardcodeados) | Reemplazado por generador dinámico de variantes |
| Dependencia de `CatalogFormSheet` como wrapper | Scaffolding va inline en `ProductForm` |

### Flujo de datos

1. **Paso 1:** State local con datos del formulario general
2. **Paso 2:** State local con atributos seleccionados y variantes generadas
3. **Paso 3:** State local con proveedor seleccionado
4. **Submit:**
   - Si hay variantes → `createProductVariantBatch()` (nueva server action)
   - Si no hay variantes → `createProduct()` (existente, o también batch con 1 variante)
5. Toast + cerrar modal + revalidatePath

### Validaciones

- **Paso 1:** Categoría y nombre requeridos.
- **Paso 2:** Si se seleccionan atributos multi-valor, al menos 1 valor por atributo. Si no hay atributos, se avanza sin problema.
- **Paso 3:** Proveedor opcional (checkbox "Sin proveedor").
- **Submit:** SKUs no deben duplicarse.

## 11. Criterios de éxito

1. El usuario puede crear un EPP en **3 clicks** (siguiente → siguiente → crear) si acepta defaults.
2. El usuario puede crear **N variantes** de un EPP (color × talla) en el mismo flujo sin salir del modal.
3. Los atributos se cargan **automáticamente** al seleccionar categoría.
4. No hay navegación entre pestañas — todo es lineal.
5. El modal se ve igual que antes en mobile (full-screen) y desktop (centrado).
6. El flujo funciona tanto para EPP como para no-EPP (atributos opcionales).
7. Al editar un producto existente, los 3 pasos se precargan con los datos guardados.

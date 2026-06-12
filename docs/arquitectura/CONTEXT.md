# Glosario — Chome Solicitudes y Bodega

Términos del dominio usados en el código, los commits y la documentación.
Cuando un término aparezca en el código, debe coincidir con la definición aquí.

---

## Conceptos de dominio

**Faena**
Sitio o proyecto de cliente donde se realizan trabajos. Equivalente a "worksites"
en el código. Cada solicitud y cada stock están asociados a una faena.

**Bodega**
Almacén físico de la oficina Chome. No confundir con el módulo `warehouse` que
gestiona stock en *todas* las faenas.

**Solicitud** (`PurchaseRequest`)
Pedido de compra iniciado por un solicitante (jefatura de faena u oficina).
Tiene un ciclo de vida: borrador → enviada → aprobada → en OC → recibida → entregada.

**Ítem de solicitud** (`PurchaseRequestItem`)
Línea individual dentro de una solicitud. La máquina de estados (`item-state.ts`)
gobierna transiciones válidas para cada ítem de forma independiente.

**Orden de compra (OC)** (`PurchaseOrder`)
Documento formal enviado a un proveedor agrupando ítems aprobados.
Un ítem pasa a estado `in_purchase_order` al ser incluido en una OC.

**Recepción** (`Receipt`)
Registro del momento en que los productos llegan físicamente a oficina o faena.
Creado por el módulo `receiving`.

**Entrega** (`Delivery`)
Transferencia de un producto desde bodega a un trabajador específico.
Creado por el módulo `deliveries`. Las entregas de EPP se registran con firma.

**EPP** (Elementos de Protección Personal)
Productos que requieren control especial: registro de entrega por trabajador,
aprobación por prevencionista, historial de uso. `requiresPrevencion: true`.

**Trazabilidad**
Vista de auditoría end-to-end: desde la solicitud hasta la entrega final.
Exportable como XLSX. Módulo `traceability`.

---

## Conceptos de arquitectura

**Módulo**
Carpeta en `modules/<nombre>/` que encapsula un dominio completo:
manifest, schema, validación, acciones, servicios, componentes.
Regla: solo se puede importar desde su barrel público (`index.ts`).

**Core** (`core/`)
Kernel compartido: todo lo verdaderamente transversal (auth, audit, códigos,
notifications, utils). Los módulos pueden importar de core; core nunca importa
de un módulo.

**Manifest** (`ModuleManifest`)
Contrato que cada módulo exporta: `{ id, permissions, nav?, seed?, defaultGrants? }`.
Registrado en `modules/registry.ts`.

**Registry** (`modules/registry.ts`)
Único punto de unión. Agregar un módulo = una línea aquí. Todo lo demás
(nav, permisos, seed) se deriva automáticamente.

**Forward shim**
Archivo en `modules/<nombre>/` o `core/` que re-exporta desde `lib/` (fuente actual).
Permite la migración incremental. En Fase 3 la dirección se invierte: `lib/` pasa
a importar desde el módulo.

**Permission**
String con forma `<módulo>:<acción>` (ej: `requests:create`). Derivado del registry
vía `typeof registry[number]["permissions"][number]`. No se mantiene manualmente.

**Boundary**
Frontera arquitectónica entre módulos, forzada por ESLint (`no-restricted-imports`
en modo `error`). Violar una frontera falla el build.

---

## Roles del sistema

| Slug | Label | Alcance |
|---|---|---|
| `administrador` | Administrador | Control total técnico |
| `jefa_chome` | Jefatura | Revisa, aprueba, administra operación |
| `secretaria` | Secretaría | Opera el flujo completo diariamente |
| `prevencionista` | Prevencionista oficina | Revisa y aprueba; gestiona EPP |
| `solicitante_faena` | Prevencionista faena | Solicita para sus faenas asignadas |

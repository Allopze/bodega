# Guías por rol de usuario

La plataforma utiliza un modelo de control de acceso basado en roles y permisos (RBAC). Elige la guía que corresponda a tus responsabilidades diarias en la empresa:

## Listado de roles del sistema

- [Administrador de Sistemas](./roles/administrador.md): Control técnico total, configuración global, respaldos y seguridad.
- [Jefatura de Operaciones / Jefa Chome](./roles/jefatura.md): Revisión general, aprobación de solicitudes, compras y control presupuestario.
- [Jefa Dpto. Prevención de Riesgos](./roles/prevencionista.md): Gestión del SG-SST, programas preventivos, matrices IPER y autorizaciones.
- [Secretaría](./roles/secretaria.md): Gestión diaria de solicitudes, órdenes de compra, proveedores y maestros.
- [Jefe de Mantención](./roles/jefe-mantencion.md): Gestión de la flota, solicitudes de repuestos, servicios y mantenciones.
- [Solicitante de Faena](./roles/solicitante-faena.md): Creación de solicitudes de insumos y materiales para su faena asignada.
- [Prevencionista de Faena](./roles/prevencionista-faena.md): Gestión preventiva local, entrega y recepción de EPP en faena.
- [Roles de Terreno y Comité Paritario](./roles/terreno-y-comite.md): Guía detallada para:
  - **Administrador de Contrato / Supervisor de Faena**
  - **Jefe de Terreno**
  - **Conductor Líder**
  - **Miembro del Comité Paritario (CPHS)**

---

## Tabla de referencia técnica de identificadores RBAC

Para efectos de administración técnica y auditoría, los identificadores internos de cada rol en la base de datos se estructuran según la siguiente correspondencia:

| Identificador DB (`id`) | Slug del rol (`name`) | Nombre legible | Alcance predeterminado | Guía vinculada |
|---|---|---|---|---|
| `rol-admin` | `administrador` | Administrador de Sistemas | Global | [Administrador](./roles/administrador.md) |
| `rol-jefa` | `jefa_chome` | Jefatura / Jefa Chome | Global | [Jefatura](./roles/jefatura.md) |
| `rol-sec` | `secretaria` | Secretaría | Global | [Secretaría](./roles/secretaria.md) |
| `rol-prev` | `prevencionista` | Jefa Dpto. Prevención de Riesgos | Global | [Prevencionista](./roles/prevencionista.md) |
| `rol-jefe-mant` | `jefe_mantencion` | Jefe de Mantención | Global | [Jefe de mantención](./roles/jefe-mantencion.md) |
| `rol-sol-faena` | `solicitante_faena` | Solicitante Faena | Por Faena | [Solicitante faena](./roles/solicitante-faena.md) |
| `rol-prev-faena` | `prevencionista_faena` | Prevencionista Faena | Por Faena | [Prevencionista faena](./roles/prevencionista-faena.md) |
| `rol-cond-lider` | `conductor_lider` | Conductor Líder | Por Faena | [Terreno y Comité](./roles/terreno-y-comite.md) |
| `rol-admin-contrato` | `admin_contrato` | Administrador de Contrato / Supervisor | Por Faena | [Terreno y Comité](./roles/terreno-y-comite.md) |
| `rol-jt` | `jefe_terreno` | Jefe de Terreno | Por Faena | [Terreno y Comité](./roles/terreno-y-comite.md) |
| `rol-cphs` | `cphs` | Comité Paritario de Higiene y Seguridad | Por Faena | [Terreno y Comité](./roles/terreno-y-comite.md) |

---

## Recomendaciones para comenzar

- Al iniciar sesión, entra primero al `Dashboard`. Allí se consolidan tus tareas pendientes, avisos y accesos rápidos según tu rol.
- Las opciones que ves en la barra lateral y en la paleta ⌘K corresponden a los módulos permitidos para tu usuario. Si requieres acceso a una pantalla adicional, solicita la asignación del rol o permiso correspondiente al Administrador.

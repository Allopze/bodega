# Roadmap — Servicios Industriales Chome

Features y módulos planificados, en desarrollo o futuros.

---

## ✅ En producción

| Módulo | Estado | Descripción |
|--------|--------|-------------|
| Solicitudes | ✅ | Solicitudes de compra por faena con ítems individuales |
| Aprobaciones | ✅ | Aprobación/rechazo/devolución por ítem |
| Compras | ✅ | Órdenes de compra consolidadas desde ítems aprobados |
| Recepción | ✅ | Recepción parcial/completa en oficina y faena |
| Bodega | ✅ | Stock por faena, kardex, ajustes, transferencias |
| Entregas | ✅ | Entrega a faenas y trabajadores individuales |
| Trazabilidad | ✅ | Matriz producto × faena con estados completos |
| Reportes | ✅ | Múltiples tipos con filtros y exportación XLSX |
| Administración | ✅ | Usuarios, faenas, trabajadores, productos, proveedores, configuración |
| SST | ✅ | Seguridad y salud en el trabajo |
| PPA | ✅ | Plan de prevención de accidentes |
| Repuestos | ✅ | Control de repuestos |
| Servicios | ✅ | Gestión de servicios |
| Feedback | ✅ | Sistema de retroalimentación |

---

## 🔨 En diseño / desarrollo

| Módulo | Estado | Descripción |
|--------|--------|-------------|
| **Control de Combustibles** | 🟡 Diseño | Registro y control de facturas de combustible por faena, vehículo y proveedor. Reemplaza Excel actual. CRUD + importación Excel + dashboard + reportes semanales/mesuales. *(Ver sección dedicada abajo)* |

---

## 🔮 Features futuras

### 1. Sistema de Gestión de Flota

**Prioridad:** Media  
**Dependencias:** Control de Combustibles (módulo base)  
**Estado:** Conceptual — no hay diseño formal

#### Contexto

Chome opera vehículos (camiones, camionetas, estanques) asignados a faenas para servicios de transporte (TCT, TAE). Actualmente no existe un sistema formal para gestionar la flota; el control se limita a facturas de combustible en Excel.

#### Alcance propuesto

| Funcionalidad | Descripción |
|---------------|-------------|
| **Catálogo de vehículos** | Registro centralizado: patente, tipo, marca, modelo, año, faena asignada, estado (activo/inactivo/mantención) |
| **Asignación a faenas** | Vehículo ↔ faena con historial de asignaciones y fechas |
| **Control de mantención** | Registro de mantenciones preventivas y correctivas. Alertas por kilometraje o fecha. Historial por vehículo. |
| **Consumo de combustible** | Integración con módulo de Combustibles: litros/vehículo, costo/km, rendimiento por tipo de vehículo |
| **Kilometraje** | Registro periódico de odómetro. Cálculo de km recorridos por período. |
| **Documentación vehicular** | Seguro, revisión técnica, permiso de circulación. Alertas de vencimiento. |
| **Reportes de flota** | Costo total por vehículo, ranking de consumo, vehículos ociosos, mantenciones pendientes |

#### Justificación

- **Optimización de costos:** Identificar vehículos con alto consumo o mal rendimiento.
- **Mantención preventiva:** Evitar fallas costosas con alertas programadas.
- **Trazabilidad completa:** Vincular cada litro de combustible con un vehículo y una faena.
- **Cumplimiento:** Asegurar que documentación vehicular esté vigente.

#### Relación con Control de Combustibles

El módulo de Combustibles es la **base de datos** para la gestión de flota. Los registros de facturas de combustible (litros, vehículo, faena) alimentan los reportes de consumo por vehículo. La gestión de flota extiende esto con mantención, kilometraje y documentación.

```
┌─────────────────────┐     ┌─────────────────────┐
│  Control Combustible │────▶│  Gestión de Flota    │
│  (facturas, litros)  │     │  (mantención, km,    │
│                      │     │   docs, reportes)    │
└─────────────────────┘     └─────────────────────┘
```

#### Dependencias técnicas

- Catálogo de vehículos propio del módulo de Combustibles (no depende del catálogo de faenas para vehículos)
- Faenas existentes del sistema
- Roles: admin, jefa_chome (mismos usuarios que Combustibles)

#### Preguntas abiertas

- ¿Se necesita trackear GPS/ubicación en tiempo real? (probablemente no para MVP)
- ¿Hay un mecánico o persona responsable de mantención que necesite acceso?
- ¿El kilometraje se ingresa manualmente o hay integración con dispositivos?

---

### 2. Integración SII (Facturación Electrónica)

**Prioridad:** Baja  
**Estado:** Conceptual

Emisión y recepción de documentos tributarios electrónicos (facturas, notas de crédito/débito) integradas con el SII chileno.

---

### 3. Portal de Proveedores

**Prioridad:** Baja  
**Estado:** Conceptual

Portal web donde proveedores pueden confirmar órdenes de compra, actualizar estados de entrega y subir facturas electrónicas directamente.

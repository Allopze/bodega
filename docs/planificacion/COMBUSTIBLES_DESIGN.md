# Diseño: Módulo Control de Combustibles

## Resumen

Módulo que reemplaza el Excel "CONTROL FACTURAS COMBUSTIBLES" de Chome. Permite registrar cargas individuales de combustible por vehículo/faena, agruparlas en cuentas corrientes mensuales por proveedor, y registrar pagos. Incluye dashboard, reportes semanales/mesuales y exportación XLSX.

## Arquitectura

- **Stack:** Next.js App Router, Server Actions, Drizzle/PostgreSQL, Zod, ExcelJS
- **Patrón:** Idéntico a módulos existentes (solicitudes, compras, etc.)
- **Ruta:** `/combustibles`
- **Área nav:** Operaciones

## Modelo de Datos

### fuel_vehicles (catálogo propio)
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid PK | |
| plate | varchar(20) UNIQUE | Patente |
| type | varchar(50) NOT NULL | camion, camioneta, estanque |
| brand | varchar(100) | |
| model | varchar(100) | |
| year | integer | |
| worksite_id | uuid FK → worksites | Faena asignada (nullable) |
| status | varchar(20) DEFAULT 'active' | active/inactive |

### fuel_suppliers (catálogo propio)
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid PK | |
| name | varchar(200) NOT NULL | COPEC, ARAMCO |
| rut | varchar(20) UNIQUE | |
| contact_name/phone/email | varchar | |
| notes | text | |
| status | varchar(20) DEFAULT 'active' | |

### fuel_monthly_statements (cuenta corriente mensual)
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid PK | |
| month | date NOT NULL | Día 1 del mes |
| fuel_supplier_id | uuid FK | |
| total_liters | decimal(12,4) | Suma automática |
| total_base_amount | decimal(14,2) | |
| total_iec | decimal(14,2) | |
| total_iva | decimal(14,2) | |
| total_amount | decimal(14,2) | |
| paid_amount | decimal(14,2) DEFAULT 0 | |
| due_date | date | |
| status | varchar(20) | open/partial/paid/overdue/cancelled |

### fuel_loads (carga individual)
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid PK | |
| statement_id | uuid FK (nullable) | Vínculo a cuenta corriente |
| load_date | date NOT NULL | |
| service_type | varchar(10) NOT NULL | TCT/TAE |
| vehicle_id | uuid FK → fuel_vehicles | |
| worksite_id | uuid FK → worksites | |
| product | varchar(100) | DIESEL/BLUEMAX |
| receipt_number | varchar(50) | Nro boleta/factura |
| liters | decimal(12,4) | |
| iec_fixed, iec_variable, base_amount | decimal(14,2) | |
| iec_total, iva_amount, total_amount | decimal(14,2) | |
| notes | text | |
| created_by | uuid FK → users | |

### fuel_payments
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid PK | |
| statement_id | uuid FK | |
| payment_date | date NOT NULL | |
| amount | decimal(14,2) | |
| payment_method | varchar(50) | |
| reference | varchar(100) | |
| notes | text | |
| created_by | uuid FK → users | |

## Máquina de Estados

### fuel_loads: draft → registered → reconciled | cancelled
### fuel_monthly_statements: open → partial → paid | overdue | cancelled

## Permisos

| Permiso | Roles |
|---------|-------|
| combustibles:view | admin, jefa_chome |
| combustibles:create | admin, jefa_chome |
| combustibles:delete | admin |
| combustibles:import | admin, jefa_chome |
| combustibles:manage_vehicles | admin |
| combustibles:manage_suppliers | admin |
| combustibles:export | admin, jecha_chome |

## Cálculos

```
IEC Fijo = litros × tasa_iec_fijo (configurable en system_settings)
IEC Variable = litros × tasa_iec_variable
IEC Total = IEC Fijo + IEC Variable
IVA = base_amount × 0.19
Total = base_amount + IEC Total + IVA
```

Override manual permitido en todos los campos calculados.

## UI

1. **Dashboard** `/combustibles` — KPIs + tabla filtrable de cargas
2. **Nueva carga** `/combustibles/nueva` — Formulario con auto-cálculo
3. **Detalle** `/combustibles/[id]` — Edición de carga
4. **Importar** `/combustibles/importar` — Upload Excel con vista previa
5. **Cuenta corriente** `/combustibles/cuenta-corriente` — Resúmenes mensuales + pagos
6. **Reportes** `/combustibles/reportes` — Semanal/mensual/gráficos/XLSX
7. **Vehículos** `/combustibles/vehiculos` — CRUD catálogo
8. **Proveedores** `/combustibles/proveedores-combustible` — CRUD catálogo

## Decisiones

| # | Decisión | Razón |
|---|----------|-------|
| 1 | Módulo independiente con catálogos propios | El flujo no pasa por OC |
| 2 | Dos niveles: cargas + cuenta corriente mensual | Refleja realidad: Copec factura mensual |
| 3 | Pagos parciales | Permite abonos |
| 4 | Auto-cálculo con override | Flexibilidad para correcciones |
| 5 | Tasas IEC en system_settings | Sin deploy para ajustar |
| 6 | Importación como flujo secundario | Formulario es el flujo oficial |

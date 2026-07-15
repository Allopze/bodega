# Módulo 05: Inspección de Equipos Móviles (Maquinaria Pesada y Camiones)

> **Documento fuente:**
> `Anexo 1 Inspeccion de Equipos Moviles (maquinaria pesada - camiones) 2019.xls`
> **Empresa:** Servicios Industriales Chome Ltda. **Tipo:** Checklist de
> inspección técnica y documental

------------------------------------------------------------------------

## 1. Descripción General

Este módulo gestiona la **inspección integral de equipos móviles
industriales** (maquinaria pesada y camiones ampliroll). Es un
formulario de checklist exhaustivo que verifica documentación, estado
mecánico, sistemas de seguridad, iluminación y accesorios de emergencia.
La inspección debe realizarse **ÚNICAMENTE en conjunto con el operador o
chofer** del equipo.

------------------------------------------------------------------------

## 2. Estructura de Datos

### 2.1 Entidad Principal: `InspecciónEquipoMóvil`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `centro_trabajo_id` | FK → CentroTrabajo | Centro de trabajo/faena |
| `tipo_equipo` | Enum | `maquinaria_pesada`, `camión_ampliroll`, `camión_carretera` |
| `numero_interno` | String(50) | Número interno del equipo |
| `placa_patente` | String(10) | Número de placa patente |
| `horómetro` | Decimal | Lectura del horómetro |
| `operador_nombre` | String(200) | Nombre del operador o chofer |
| `operador_firma_url` | String | Firma del operador |
| `inspeccionado_por` | String(200) | Nombre del inspector |
| `inspector_cargo` | String(100) | Cargo del inspector |
| `inspector_firma_url` | String | Firma del inspector |
| `revisado_por` | String(200) | Nombre de quien revisa |
| `revisor_cargo` | String(100) | Cargo del revisor |
| `revisor_firma_url` | String | Firma del revisor |
| `fecha_inspección` | Date | Fecha de la inspección |
| `fecha_revisión` | Date | Fecha de revisión |
| `resultado_general` | Enum | `aprobado`, `aprobado_con_observaciones`, `rechazado` |
| `created_at` | Timestamp | Fecha de creación |

### 2.2 Entidad: `ItemInspecciónEquipo`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `inspección_id` | FK → InspecciónEquipoMóvil | Inspección padre |
| `categoría` | Enum | Ver categorías abajo |
| `item_plantilla_id` | FK → PlantillaItem | Item de la plantilla base |
| `descripción` | String(500) | Descripción del ítem |
| `resultado` | Enum | Varía por sección (ver abajo) |
| `observaciones` | Text | Observaciones del ítem |
| `foto_url` | String | Foto del hallazgo si aplica |

------------------------------------------------------------------------

## 3. Secciones del Checklist

### 3.1 DOCUMENTOS (Cumple/No Cumple/No Aplica)

| N°  | Ítem                           | Resultado                  |
|-----|--------------------------------|----------------------------|
| 1   | Licencia de Conducción Vigente | ☐ Cumple ☐ No Cumple ☐ N/A |
| 2   | Permiso de Circulación         | ☐ Cumple ☐ No Cumple ☐ N/A |
| 3   | Revisión Técnica               | ☐ Cumple ☐ No Cumple ☐ N/A |
| 4   | Seguro Obligatorio             | ☐ Cumple ☐ No Cumple ☐ N/A |

### 3.2 ESTADO GENERAL CABINA (Buen Estado/Mal Estado/No Aplica)

| N°  | Ítem                                                  |
|-----|-------------------------------------------------------|
| 5   | Plumillas, limpiaparabrisas y chorro limpiaparabrisas |
| 6   | Bocina                                                |
| 7   | Escaleras y pasamano acceso (tres puntos de apoyo)    |
| 8   | Asiento conductor en buen estado                      |
| 9   | Cinturón de Seguridad en ambos asientos               |
| 10  | Panel o tablero de instrumentos                       |
| 11  | Espejo central retrovisor                             |
| 12  | Espejos laterales retrovisores                        |
| 13  | Iluminación interior cabina                           |
| 14  | Patentes delanteras y traseras                        |
| 15  | Piso en buen estado, sin obstáculos                   |
| 16  | Alza vidrios y manillas de puerta                     |
| 17  | Alarma de retroceso                                   |
| 18  | Vidrios en buen estado                                |

### 3.3 ACCESORIOS DE EMERGENCIA (Buen Estado/Mal Estado/No Aplica)

| N° | Ítem | Nota |
|----|----|----|
| 19 | Gata hidráulica | Solo camión carretera |
| 20 | Cruceta o copa (llave de rueda) | Solo camión carretera |
| 21 | Señales de carretera (conos y chaleco reflectante) |  |
| 22 | Cuñas |  |
| 23 | Botiquín | Solo camión carretera |
| 24 | Extintor de incendios (4 kgs PQS mínimo) |  |
| 25 | Caja de herramientas básica | Solo camión carretera |
| 26 | Llanta (rueda) de repuesto | Solo camión carretera |
| 27 | Linterna | Solo camión carretera |

### 3.4 LUCES (Buen Estado/Mal Estado/No Aplica)

| N°  | Ítem                                         |
|-----|----------------------------------------------|
| 28  | Direccionales delanteras                     |
| 29  | Direccionales traseras                       |
| 30  | De trabajo delanteras (altas, bajas)         |
| 31  | De navegación                                |
| 32  | De frenado                                   |
| 33  | Focos faenero trasero                        |
| 34  | De emergencia (hazzard) delantera y traseras |
| 35  | De patente (vehículo que sale de planta)     |

### 3.5 SISTEMA LEVANTE DE CABINA

| N°  | Ítem                                                     |
|-----|----------------------------------------------------------|
| 36  | Pasadores completos y en buen estado                     |
| 37  | Estado del seguro o manilla de levante de cabina o capot |
| 38  | Estado del sistema de levante (brazo/cilindro)           |

### 3.6 RUEDAS

<table style="width:74%;">
<colgroup>
<col style="width: 5%" />
<col style="width: 68%" />
</colgroup>
<thead>
<tr>
<th>N°</th>
<th>Ítem</th>
</tr>
</thead>
<tbody>
<tr>
<td>39</td>
<td>Huella mínima de 3 mm</td>
</tr>
<tr>
<td>40</td>
<td>Neumáticos (sin cortaduras profundas ni abultamientos)
41 Pernos de ruedas</td>
</tr>
</tbody>
</table>

### 3.7 SISTEMA DE CALEFACCIÓN

| N°  | Ítem                           |
|-----|--------------------------------|
| 42  | Estado de aire caliente y frío |
| 43  | Aire acondicionado             |

### 3.8 ESTADO MECÁNICO

| N° | Ítem |
|----|----|
| 42 | Freno de servicio en todas las ruedas |
| 43 | Freno de emergencia o parqueo |
| 44 | Dirección y terminales |
| 45 | Sistema de amortiguación general |
| 46 | Control fugas hidráulicas: aceite y refrigerante (motor/mangueras/estanque) |
| 47 | Control fugas aire (mangueras, acoples, tecalán) |
| 48 | Caja de cambios |
| 49 | Cardán y crucetas |
| 50 | Batería, cables y terminales en buen estado |
| 51 | Porta elementos, pala y garra (pasadores, cilindro y fisuras) |
| 52 | Equipo ampliroll (ganchos, riel, rodillo de guía, aleta de seguridad, pernos) |

### 3.9 OBSERVACIONES

Campo libre para observaciones generales del inspector.

------------------------------------------------------------------------

## 4. Funcionalidades del Módulo SaaS

### 4.1 Inspección Digital

- [ ] Checklist digital interactivo por secciones
- [ ] Identificación del equipo por código interno o patente
- [ ] Historial de inspecciones por equipo
- [ ] Lectura y seguimiento de horómetro
- [ ] Items condicionales según tipo de equipo (camión carretera vs
  planta)
- [ ] Captura de fotos para ítems con mal estado
- [ ] Firma digital de operador, inspector y revisor
- [ ] Modo offline para inspecciones sin cobertura

### 4.2 Gestión de Flota

- [ ] Inventario de equipos móviles
- [ ] Calendario de inspecciones por equipo
- [ ] Alertas de vencimiento de documentación (revisión técnica, permiso
  circulación, SOAP)
- [ ] Dashboard de estado de flota (% equipos aprobados vs rechazados)
- [ ] Seguimiento de horómetro por equipo

### 4.3 Gestión de Hallazgos

- [ ] Generación automática de orden de trabajo (OT) para ítems con mal
  estado
- [ ] Asignación a jefe de taller/mantención
- [ ] Seguimiento de reparaciones
- [ ] Verificación post-reparación
- [ ] Bloqueo de equipo si tiene ítems críticos rechazados

### 4.4 Reportería

- [ ] Reporte de inspección individual con fotos
- [ ] Reporte consolidado por faena
- [ ] Estadísticas de ítems más frecuentemente rechazados
- [ ] Tendencias de estado por equipo
- [ ] Exportación a PDF con formato similar al original

------------------------------------------------------------------------

## 5. Reglas de Negocio

1.  **Inspección conjunta obligatoria**: ÚNICAMENTE se realiza en
    conjunto con el operador/chofer del equipo móvil.
2.  **Frecuencia**: Mensual por cada equipo del centro de trabajo.
3.  **Responsable**: Jefe de Terreno (JT); si no existe, Supervisor o
    Administrador de Contrato.
4.  **Revisado por PR**: El prevencionista de faena revisa la inspección
    completada.
5.  **Items condicionales**: Los ítems marcados “camión carretera” solo
    aplican a vehículos que salen de planta.
6.  **Equipo ampliroll**: Los ítems del sistema ampliroll solo aplican a
    camiones con este equipo.
7.  **Bloqueo operacional**: Un equipo con estado mecánico “Mal Estado”
    en frenos o dirección no puede operar hasta reparación.

------------------------------------------------------------------------

## 6. Integraciones con Otros Módulos

| Módulo | Relación |
|----|----|
| Cronograma Actividades SG-SST | Alimenta avance de inspecciones de equipos móviles |
| Observación de Seguridad | Se complementa con observaciones al operador |
| Seguimiento y Control | Hallazgos se integran al seguimiento general |
| Extintores | Verificación cruzada del estado de extintores |
| Mantención | Generación de OT para reparaciones |

------------------------------------------------------------------------

## 7. Wireframe Conceptual

    ┌─────────────────────────────────────────────────────────────────┐
    │  🚛 INSPECCIÓN EQUIPO MÓVIL                     Anexo 1  [📤] │
    ├─────────────────────────────────────────────────────────────────┤
    │  Centro: [Faena Mininco ▼]  Tipo: [Camión Ampliroll ▼]        │
    │  N° Interno: [EQ-042]  Patente: [BBXX-42]  Horóm: [15,432]    │
    │  Operador: [Juan Pérez]  Inspector: [María López]              │
    │  Fecha: [15/06/2025]                                           │
    ├─────────────────────────────────────────────────────────────────┤
    │  📋 DOCUMENTOS                                    [4/4 ✅]     │
    │  ☑ Licencia conducción vigente      ✅ Cumple                  │
    │  ☑ Permiso circulación              ✅ Cumple                  │
    │  ☑ Revisión técnica                 ✅ Cumple                  │
    │  ☑ Seguro obligatorio               ✅ Cumple                  │
    ├─────────────────────────────────────────────────────────────────┤
    │  🔧 ESTADO GENERAL CABINA                        [12/14 ✅]   │
    │  ☑ Plumillas/limpiaparabrisas       ✅ Bueno                   │
    │  ☑ Bocina                           ✅ Bueno                   │
    │  ☑ Alarma retroceso                 ❌ Malo  [📷 + obs]       │
    │  ☑ Vidrios                          ❌ Malo  [📷 + obs]       │
    │  ...                                                            │
    ├─────────────────────────────────────────────────────────────────┤
    │  ⚙️ ESTADO MECÁNICO                              [10/11 ✅]   │
    │  ☑ Freno de servicio                ✅ Bueno                   │
    │  ☑ Freno emergencia                 ✅ Bueno                   │
    │  ...                                                            │
    ├─────────────────────────────────────────────────────────────────┤
    │  Resultado: 🟡 APROBADO CON OBSERVACIONES (2 ítems pendientes) │
    │  [Firmar y Enviar]  [Guardar Borrador]                          │
    └─────────────────────────────────────────────────────────────────┘

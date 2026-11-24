# Documento de requisitos

## Introducción

Frente de Rochi en el MVP de EVA para el hackathon. Cubre las piezas que el núcleo usa sin conocer su código:

- **Conector Skkeda** (mock persistente en DynamoDB) para reservar, listar y cancelar puestos por piso.
- **Mock de Jira** de solo lectura para consultar las tareas de la persona.
- **Evaluación** opcional de la base de conocimiento.

El corpus (9 documentos generales, 2 restringidos y `data/conocimiento/evaluacion.json` con 12 preguntas) ya viene en el kit y se probó en el ensayo: no se genera, solo se amplía si sobra tiempo.

Contrato fijo: `.kiro/steering/contrato-mvp.md` (§1, §3, §6, §7) y `src/comun/contrato.ts`. Spec LITE: se ejecuta de corrido, sin pedir aprobación entre tareas.

## Requisitos

### Requisito 1: Reserva de puestos por piso

**Historia de usuario:** Como colaboradora quiero reservar un puesto en un piso para trabajar cerca de mi equipo.

#### Criterios de aceptación

1. CUANDO llegue `skkeda:booking.create` con `date` y `resource` libre ENTONCES el sistema DEBE crear la reserva y devolver `status: "OK"`, `origin: "mock"` y `data` con `code`, `resource`, `floor` y `date`.
2. CUANDO llegue `floor` sin `resource` ENTONCES el sistema DEBE asignar el primer puesto libre de ese piso (piso 2 `P-1`–`P-14`, piso 3 `P-15`–`P-27`, piso 4 `P-28`–`P-40`).
3. SI `date` no es `AAAA-MM-DD`, el puesto no está entre `P-1` y `P-40` o el piso no es 2, 3 o 4 ENTONCES el sistema DEBE devolver `FAILED` con `error.code: "INVALID_PARAMETER"`.
4. CUANDO se cree una reserva ENTONCES el código DEBE ser `BK-SYN-<AAAAMMDD>-<puesto sin guion>` (por ejemplo `BK-SYN-20261126-P15`).

### Requisito 2: Conflictos y límite diario

**Historia de usuario:** Como colaboradora quiero que, si el puesto está ocupado, EVA me proponga otro sin empezar de nuevo.

#### Criterios de aceptación

1. CUANDO el puesto pedido esté ocupado ENTONCES el sistema DEBE devolver `CONFLICT`, `error.code: "RESOURCE_TAKEN"` y `data.alternatives` con hasta 5 puestos libres, primero los del mismo piso.
2. CUANDO se pida `P-12` en cualquier fecha ENTONCES el sistema DEBE tratarlo como ocupado por `SYN-USR-0099`.
3. SI el piso pedido no tiene puestos libres ENTONCES el sistema DEBE devolver `RESOURCE_TAKEN` con alternativas de otros pisos.
4. SI la persona ya tiene un puesto ese día ENTONCES el sistema DEBE devolver `CONFLICT` con `error.code: "DAILY_LIMIT"` y sin alternativas.

### Requisito 3: Idempotencia, listado y cancelación

**Historia de usuario:** Como colaboradora quiero ver y cancelar mis reservas, y que confirmar dos veces no cree dos.

#### Criterios de aceptación

1. CUANDO llegue `booking.create` sin `idempotencyKey` ENTONCES el sistema DEBE devolver `FAILED` con `error.code: "MISSING_IDEMPOTENCY"`.
2. CUANDO llegue dos veces la misma `idempotencyKey` ENTONCES el sistema DEBE devolver el mismo resultado sin crear otra reserva.
3. CUANDO llegue `skkeda:booking.list` ENTONCES el sistema DEBE devolver `data.bookings` con `date`, `resource`, `floor` y `code` de la persona del token, filtrando por `date` si viene.
4. CUANDO llegue `skkeda:booking.cancel` con un código ajeno o inexistente ENTONCES el sistema DEBE devolver `NOT_FOUND`; si es propio, DEBE liberar el puesto y devolver `OK`.

### Requisito 4: Consulta de tareas en Jira (mock)

**Historia de usuario:** Como colaboradora quiero preguntar por mis tareas abiertas en Jira sin abrir Jira.

#### Criterios de aceptación

1. CUANDO llegue `jira:issue.search` sin `status` o con `"OPEN"` ENTONCES el sistema DEBE devolver en `data.items` solo las tareas no terminadas (3 de las 4 tareas sintéticas).
2. CUANDO llegue `status: "ALL"` ENTONCES el sistema DEBE incluir también la tarea terminada; CUANDO llegue `project` ENTONCES DEBE filtrar por esa clave.
3. CUANDO responda ENTONCES el sistema DEBE devolver `status: "OK"` y `origin: "mock"`, sin DynamoDB ni secretos; SI llega otra capacidad ENTONCES DEBE devolver `DENIED` con `UNKNOWN_CAPABILITY`.

### Requisito 5: Robustez de los conectores

**Historia de usuario:** Como equipo queremos que una falla del mock no tumbe la conversación.

#### Criterios de aceptación

1. SI DynamoDB lanza un error en Skkeda ENTONCES el sistema DEBE devolver `UNAVAILABLE` con `error.code: "SKKEDA_ERROR"` para que el núcleo reintente.
2. CUANDO un conector registre un error ENTONCES el log DEBE llevar solo `correlationId`, `capabilityId` y el nombre del error, sin parámetros de la persona.

### Requisito 6: Evaluación de la base de conocimiento (opcional)

**Historia de usuario:** Como equipo queremos una cifra de aciertos medida contra la base desplegada para el pitch.

#### Criterios de aceptación

1. CUANDO se ejecute `npm run evaluar` ENTONCES el sistema DEBE consultar `Retrieve` con el filtro `classification = GENERAL` por cada pregunta de `evaluacion.json` y reportar aciertos top-1, top-3 y `NO_ANSWER` correctos.
2. SI algún resultado trae un documento restringido ENTONCES el sistema DEBE reportarlo como falla de seguridad.
3. CUANDO reporte ENTONCES el sistema NO DEBE imprimir el texto de los pasajes.

### Requisito 7: Ampliación del corpus (opcional)

**Historia de usuario:** Como colaboradora quiero respuestas sobre más temas si al equipo le sobra tiempo.

#### Criterios de aceptación

1. CUANDO se agregue un documento ENTONCES DEBE ir en `data/conocimiento/documentos/general/` con título `#`, la línea "Documento sintético para demostración", 3 a 5 secciones `##` y su `x.md.metadata.json` con `documentId` desde `DOC-SYN-0010`.
2. SI el nuevo documento repite un dato de otro ENTONCES DEBE usar la misma cifra.
3. CUANDO se agregue un documento ENTONCES la operadora de AWS DEBE volver a desplegar e ingestar (el CDK recalcula `TITULOS_SECCION`).

---
inclusion: always
---

# Contrato entre frentes (acuerdo fijo)

Este archivo y `src/comun/contrato.ts` son lo único que conecta los tres frentes. Quien implementa un lado no necesita leer el código del otro.

## 1. Puntos de entrada (los usa el CDK de `infra/`)

| Archivo | Exporta | Recibe | Devuelve |
|---|---|---|---|
| `src/nucleo/handler.ts` | `handler` | `APIGatewayProxyEvent` (REST, con autorizador de Cognito) | `APIGatewayProxyResult` con JSON `RespuestaConversacion` |
| `src/conectores/skkeda/handler.ts` | `handler` | `InvokeRequest` | `InvokeResult` |
| `src/conectores/jira/handler.ts` | `handler` | `InvokeRequest` | `InvokeResult` (mock de solo lectura) |
| `src/portal/` | `index.html`, `styles.css`, `app.js`, `assets/` | — | Sitio estático; `app.js` lee `/config.json` (`{ region, userPoolId, userPoolClientId }`, lo genera el CDK) |

## 2. API `/v1` (núcleo ↔ portal)

- `POST /v1/conversations` con cuerpo `MensajeEntrada` → `RespuestaConversacion`.
- `POST /v1/conversations/{id}/confirm` con cuerpo `Confirmacion` → `RespuestaConversacion`.
- Cabecera `Authorization: Bearer <idToken de Cognito>`. Sin token: `401`.
- Tipos de mensaje que el núcleo distingue (el modelo clasifica; el código decide):

  | Tipo | Ejemplo | Respuesta |
  |---|---|---|
  | `SALUDO` | "Hola", "Gracias" | `ANSWERED` con lo que EVA sabe hacer (o "¡Con gusto!"), sin consultar la base de conocimiento |
  | `PREGUNTA` | "¿Cuántos días antes pido un viaje?" | §3 |
  | `BUSCAR_DOCUMENTO` | "Ayúdame a buscar el archivo de gestión de cambios" | §3 con umbral propio: lista de hasta 3 documentos en `citations` y en el texto (título y fecha); sin documento → `NO_ANSWER` diciendo el tema que no encontró |
  | `ACCION` | "Reserva un puesto en el piso 3", "¿Qué tareas tengo en Jira?" | §4 y §7 |

  "Hola, ayúdame a…" se clasifica por el pedido, no por el saludo.
- `status` posibles: `ANSWERED`, `NEEDS_CLARIFICATION`, `NO_ANSWER`, `BLOCKED`, `AWAITING_CONFIRMATION`, `COMPLETED`, `DENIED`, `FAILED`, `ESCALATED`.
- El portal muestra `reply`; las `citations` como lista de fuentes (título, sección y fecha); si hay `researchSteps`, un bloque plegable "Cómo lo investigué" con cada subpregunta, si se encontró y en qué documentos; y, si hay `pendingAction`, el `summary` con los botones Confirmar y Cancelar. `NEEDS_CLARIFICATION` se muestra como un mensaje normal de EVA (es una pregunta para la persona).

## 3. Base de conocimiento (infra ↔ núcleo ↔ corpus)

- Bucket de origen `eva-dev-kb-<cuenta>`. El CDK sube **solo** `data/conocimiento/documentos/general/` al prefijo `general/`. La carpeta `restringido/` nunca se sube.
- Cada documento `x.md` tiene al lado `x.md.metadata.json`:

  ```json
  { "metadataAttributes": { "classification": "GENERAL", "documentId": "DOC-SYN-0001", "title": "Política de viajes corporativos", "area": "Gestión Humana", "updatedAt": "2026-09-30" } }
  ```

- Los documentos usan títulos `##` por sección, para que las citas digan la sección.
- El núcleo consulta con `Retrieve` (`knowledgeBaseId` en `KB_ID`), `numberOfResults: 5` y el filtro `{ "equals": { "key": "classification", "value": "GENERAL" } }`. Cada pasaje trae su texto, su `score` y los metadatos para armar la `Cita`.
- Sin pasajes con `score` suficiente (umbral 0,5 y solo pasajes a menos de 0,1 del mejor) → `status: "NO_ANSWER"`, sin llamar al modelo para inventar.
- Los títulos `##` del corpus llegan al núcleo en `TITULOS_SECCION` (ver tecnologia.md, lecciones 6 y 7).
- **Búsqueda de documentos:** misma consulta con el texto `Documento sobre <tema>`, umbral `UMBRAL_DOCUMENTO` = 0,65 (el documento correcto puntuó 0,74–0,78 y el ruido 0,58 o menos) y un resultado por `documentId`.

## 4. Step Functions (núcleo → conector)

- `eva-dev-transaccional` (Express). Entrada: un `InvokeRequest`. Un estado `Choice` enruta por el prefijo de `capabilityId` (`skkeda:` o `jira:`) a la Lambda del conector; prefijo desconocido → `InvokeResult` con `status: "DENIED"`. Salida: el `InvokeResult` tal cual.
- Las lecturas (`skkeda:booking.list`, `jira:issue.search`) usan la misma máquina. Agregar Jira no cambia el núcleo ni el Policy Engine: solo su catálogo, su Lambda y una rama del `Choice`.
- El núcleo la llama con `StartSyncExecution` y lee `output`.

## 5. Variables de entorno

| Lambda | Variables |
|---|---|
| Núcleo | `TABLA_ESTADO`, `KB_ID`, `FLUJO_TRANSACCIONAL_ARN`, `MODEL_ID` (por defecto `amazon.nova-pro-v1:0`), `GUARDRAIL_ID`, `GUARDRAIL_VERSION`, `TITULOS_SECCION` e `INVESTIGACION_ACTIVA` (`true`/`false`, por defecto `false`; ver §8) |
| Skkeda | `TABLA_ESTADO` |
| Jira (mock) | ninguna |

`data/skkeda/catalogo.json` y `data/jira/catalogo.json` se empaquetan dentro de las Lambdas (`import` de JSON). El Policy Engine une los dos catálogos.

## 6. Tabla `eva-dev-estado` (`pk`, `sk`, TTL `ttl`)

| `pk` | `sk` | Dueña | Uso |
|---|---|---|---|
| `CONV#<conversationId>` | `TURN#<n>` | Núcleo | Últimos 3 turnos (pregunta, respuesta, `knowledgeIds` citados y, si EVA pidió una aclaración, la pregunta original), TTL 1 h, para preguntas de seguimiento |
| `CONV#<conversationId>` | `PENDING` | Núcleo | Acción pendiente (TTL 15 min) |
| `IDEMP#<idempotencyKey>` | `IDEMP` | Núcleo | Resultado ya ejecutado (TTL 24 h) |
| `SKKEDA#<fecha>` | `<recurso>` | Skkeda | Reserva de un puesto ese día |
| `SKKEDA-USR#<userId>` | `<fecha>` | Skkeda | Regla de un puesto por persona por día |
| `SKKEDA-BK#<código>` | `BK` | Skkeda | Reserva por código (listar y cancelar) |

## 7. Reglas que cada lado puede asumir del otro

- **Skkeda**, en `booking.create`: recurso ocupado → `status: "CONFLICT"`, `error.code: "RESOURCE_TAKEN"`, `data.alternatives` con hasta 5 puestos libres esa fecha. La persona ya tiene puesto ese día → `CONFLICT`, `error.code: "DAILY_LIMIT"`, sin alternativas. Misma `idempotencyKey` → el mismo resultado, sin crear otra reserva. `P-12` está ocupado todos los días por `SYN-USR-0099` (para la demo). Puestos válidos: `P-1` a `P-40`, en tres pisos: **piso 2** `P-1`–`P-14`, **piso 3** `P-15`–`P-27`, **piso 4** `P-28`–`P-40`. Con `floor` y sin `resource` asigna el primer puesto libre de ese piso; si el piso está lleno → `RESOURCE_TAKEN` con alternativas de otros pisos. Las alternativas van primero del mismo piso. `data` del resultado incluye `floor`.
- **Jira (mock)**, en `jira:issue.search` (`READ`): devuelve `data.items` con tareas sintéticas (`key` `EVA-SYN-…`/`TI-SYN-…`, `summary`, `status`, `priority`, `due`) asignadas a quien pregunta; `status: "OPEN"` (por defecto) excluye las terminadas; `project` filtra por clave. `origin: "mock"`.
- **Núcleo**, antes de proponer una reserva: si falta la fecha → `NEEDS_CLARIFICATION` ("¿Para qué día quieres el puesto en el piso 3?"); si el piso no es 2, 3 o 4 → `NEEDS_CLARIFICATION` con los pisos válidos. La pregunta y la respuesta se guardan como turno para que el siguiente mensaje ("El jueves") complete el pedido. Un `resource` que no sea `P-<número>` se descarta. El resumen muestra la fecha legible ("jueves 26 de noviembre de 2026 (2026-11-26)").
- **Núcleo**: ante `RESOURCE_TAKEN` con alternativas, propone la primera como **nueva acción pendiente** (vuelve a pasar por el Policy Engine y espera confirmación). Ante `UNAVAILABLE` reintenta una vez; si vuelve a fallar responde `ESCALATED`.
- **Corpus** (ya viene en el kit, probado en el ensayo): cada pregunta de `data/conocimiento/evaluacion.json` tiene respuesta en algún documento de `general/`, salvo las marcadas `"esperado": "NO_ANSWER"`; las de `"tipo": "INVESTIGACION"` son opcionales y necesitan dos documentos. Códigos de reserva: `BK-SYN-<AAAAMMDD>-<puesto>`.

## 8. Módulo de investigación (opcional, detrás de `INVESTIGACION_ACTIVA`)

Para preguntas compuestas cuya respuesta está repartida en varios documentos (por ejemplo, viajes + viáticos + legalización de gastos). Con `INVESTIGACION_ACTIVA=false` todo pasa por el flujo normal de §3 y nada de esta sección se ejecuta.

| Paso | Quién | Regla |
|---|---|---|
| Clasificar | Modelo (propone) | El clasificador devuelve `tipo: "INVESTIGACION"` con `subpreguntas` (2 a 4, cada una entendible sola) cuando la pregunta tiene varias partes, pide comparar o pide "todo lo que necesito para…". Devuelve `tipo: "ACLARAR"` con `aclaracion` cuando falta un dato que cambia la respuesta (p. ej. nacional o internacional) |
| Buscar | Núcleo | Un `Retrieve` por subpregunta, en paralelo, con el mismo filtro `classification = GENERAL` y el mismo umbral de §3 aplicado por subpregunta |
| Verificar | Modelo (propone) + núcleo | Si una subpregunta no tiene pasajes, el modelo propone **una** reformulación y el núcleo vuelve a buscar. Máximo 2 rondas y 6 llamadas a `Retrieve` en total |
| Sintetizar | Modelo | Una sola respuesta con las reglas de estilo de §3, marcas `[n]` por afirmación, y una frase explícita por cada subpregunta sin fuente ("No encontré …") |
| Responder | Núcleo | `ANSWERED` con `citations` y `researchSteps`; si ninguna subpregunta tuvo pasajes, `NO_ANSWER` sin llamar al modelo para sintetizar. `ACLARAR` → `NEEDS_CLARIFICATION` con la pregunta en `reply`; la respuesta de la persona se combina con la pregunta original guardada en el turno |

- **Invariantes que no cambian:** el modelo solo produce texto (subpreguntas, reformulación, respuesta); no recibe herramientas ni decide filtros. Toda búsqueda la hace el núcleo con el filtro obligatorio. Guardrails se aplica a la entrada y a la respuesta final.
- **Presupuesto de tiempo:** toda la investigación debe terminar en menos de 20 s (API Gateway corta a los 29 s). Si se acaba el tiempo, se sintetiza con lo encontrado hasta ese momento.
- **Trazas:** `researchSteps` y los logs llevan subpreguntas y títulos, nunca el texto de los pasajes.
- Una pregunta compuesta que incluye una acción (p. ej. "y resérvame un puesto") se responde en la parte de conocimiento y propone la acción por el flujo normal de §4 en el turno siguiente.

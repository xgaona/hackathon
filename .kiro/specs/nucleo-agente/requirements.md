# Documento de requisitos

## Introducción

El núcleo de EVA es la Lambda `src/nucleo/handler.ts`, que implementa la API `/v1` de `contrato-mvp.md` §2. Recibe el mensaje de un colaborador autenticado y lo clasifica con Bedrock (Nova Pro). Según el tipo, responde con la base de conocimiento citando sus fuentes, busca documentos o ejecuta acciones en Skkeda y Jira (ambos mocks) a través de Step Functions. Las acciones pasan siempre por el Policy Engine y por la confirmación de la persona.

**Alcance:** solo `src/nucleo/`. Usa:
- los tipos de `src/comun/contrato.ts`;
- los catálogos `data/skkeda/catalogo.json` y `data/jira/catalogo.json`;
- las variables de entorno de `contrato-mvp.md` §5.

El requisito 10 es opcional y se activa con `INVESTIGACION_ACTIVA`.

**Fuera de alcance:** Daruma, Jira real, escrituras en Jira, OAuth, AgentCore, MCP y streaming.

## Requisitos

### Requisito 1: Identidad y revisión de la entrada

**Historia de usuario:** Como colaborador, quiero que EVA actúe solo con mi identidad verificada y bloquee mensajes maliciosos, para que nadie la use en mi nombre ni la manipule.

#### Criterios de aceptación

1. CUANDO llega una solicitud ENTONCES el sistema DEBE tomar `userId` de `claims.sub` y los grupos de `claims['cognito:groups']`, ignorando cualquier identidad que venga en el mensaje o en la propuesta del modelo.
2. SI no hay `claims.sub` ENTONCES el sistema DEBE responder `401`. SI el cuerpo no es JSON válido o el mensaje está vacío ENTONCES DEBE responder `400`.
3. CUANDO llega un mensaje ENTONCES el sistema DEBE llamar `ApplyGuardrail` con `source: "INPUT"` antes de cualquier otra llamada a Bedrock.
4. SI Guardrails interviene ENTONCES el sistema DEBE responder `BLOCKED` con un mensaje amable y sin llamar al modelo.

### Requisito 2: Clasificación del mensaje

**Historia de usuario:** Como colaborador, quiero hablarle a EVA con naturalidad ("Hola, ayúdame a…"), para no aprender comandos.

#### Criterios de aceptación

1. CUANDO llega un mensaje permitido ENTONCES el sistema DEBE clasificarlo con `Converse` (temperatura 0) en un JSON validado con Ajv: `tipo` ∈ {`SALUDO`, `PREGUNTA`, `BUSCAR_DOCUMENTO`, `ACCION`}, más `consulta`, `capabilityId` y `params`. Si no valida, el mensaje se trata como `PREGUNTA` con el texto original.
2. CUANDO el mensaje mezcla un saludo con un pedido ENTONCES el sistema DEBE clasificarlo por el pedido.
3. CUANDO se clasifica ENTONCES el sistema DEBE pasarle al modelo dos cosas:
   - un calendario de 8 días con el nombre de cada día (zona America/Bogota);
   - los últimos 3 turnos, para que "¿Y si es internacional?" o "El jueves" completen el pedido anterior.
4. CUANDO la persona pide una acción que no está en los catálogos ENTONCES el sistema DEBE aceptar el `capabilityId` que la describa, para que el Policy Engine la niegue.

### Requisito 3: Respuesta con la base de conocimiento

**Historia de usuario:** Como colaborador, quiero respuestas completas, cálidas y con su fuente, para confiar en lo que EVA me dice.

#### Criterios de aceptación

1. CUANDO el tipo es `PREGUNTA` ENTONCES el sistema DEBE:
   - llamar `Retrieve` con `numberOfResults: 5` y el filtro `classification = GENERAL`;
   - partir cada fragmento por `##` usando `TITULOS_SECCION`;
   - usar solo los pasajes con `score` ≥ 0,5 y a menos de 0,1 del mejor.
2. SI no queda ningún pasaje o el modelo responde `NO_ENCONTRADO` ENTONCES el sistema DEBE responder `NO_ANSWER` con "No encontré esa información en las fuentes a las que tengo acceso.". Si no hay pasajes, no DEBE llamar al modelo.
3. CUANDO hay pasajes ENTONCES el sistema DEBE redactar la respuesta con el prompt de respuesta de design.md: 1 a 3 frases cálidas, el dato siguiente útil y marcas `[n]`. Después DEBE aplicar `ApplyGuardrail` con `source: "OUTPUT"`, sin contextual grounding; si interviene, la respuesta es `NO_ANSWER`.
4. CUANDO responde `ANSWERED` ENTONCES el sistema DEBE:
   - devolver `citations` sin duplicados (`documentId` + `seccion`), solo de los pasajes marcados;
   - quitar las marcas `[n]` del texto.

### Requisito 4: Saludos y búsqueda de documentos

**Historia de usuario:** Como colaborador, quiero que EVA me salude y me encuentre archivos por su tema, para empezar sin manual y no adivinar dónde están los documentos.

#### Criterios de aceptación

1. CUANDO el tipo es `SALUDO` ENTONCES el sistema DEBE responder `ANSWERED` con el texto fijo de lo que EVA sabe hacer, sin llamar `Retrieve`. Si la persona agradece o se despide, la respuesta es "¡Con gusto! Si necesitas algo más, aquí estoy.".
2. CUANDO el tipo es `BUSCAR_DOCUMENTO` ENTONCES el sistema DEBE llamar `Retrieve` con `Documento sobre <tema>` y el filtro `GENERAL`, con `UMBRAL_DOCUMENTO` = 0,65 y un resultado por `documentId` (máximo 3).
3. CUANDO encuentra documentos ENTONCES el sistema DEBE responder `ANSWERED` con "Encontré el documento '<título>' (actualizado el <fecha>)…" y los documentos en `citations`.
4. SI ningún documento supera el umbral ENTONCES el sistema DEBE responder `NO_ANSWER` diciendo el tema que no encontró.

### Requisito 5: Turnos y aclaraciones

**Historia de usuario:** Como colaborador, quiero que EVA recuerde lo que acabamos de hablar y me pregunte lo que falta, para no repetir el pedido ni terminar con una reserva equivocada.

#### Criterios de aceptación

1. CUANDO el sistema responde cualquier mensaje (pregunta, saludo, búsqueda, aclaración o lectura) ENTONCES DEBE guardar el turno en `CONV#<id>` / `TURN#<epoch ms>` con TTL de 1 hora.
2. SI la acción es `skkeda:booking.create` y `params.floor` no es 2, 3 ni 4 ENTONCES el sistema DEBE responder `NEEDS_CLARIFICATION` indicando los pisos válidos.
3. SI la acción es `skkeda:booking.create` y falta `params.date` en formato `AAAA-MM-DD` ENTONCES el sistema DEBE responder `NEEDS_CLARIFICATION` con "¡Claro! ¿Para qué día quieres el puesto en el piso <n>?", sin suponer la fecha.
4. SI `params.resource` no cumple `^P-\d{1,2}$` ENTONCES el sistema DEBE descartarlo antes de proponer.

### Requisito 6: Policy Engine y propuesta de escrituras

**Historia de usuario:** Como responsable de seguridad, quiero que una regla determinística autorice cada acción y que toda escritura espere confirmación, para que el modelo nunca decida.

#### Criterios de aceptación

1. CUANDO el tipo es `ACCION` ENTONCES el sistema DEBE decidir con la función pura `decidir` de `politica.ts`, sobre la unión de los catálogos de Skkeda y Jira:
   - capacidad que no está en los catálogos, que está `INACTIVE` o cuyos grupos no coinciden → `DENY`;
   - `READ` → `ALLOW`;
   - `WRITE` → `ALLOW_WITH_CONFIRMATION`.
2. CUANDO el veredicto es `DENY` ENTONCES el sistema DEBE responder `DENIED` con una frase que diga lo que EVA sí puede hacer.
3. CUANDO el veredicto es `ALLOW_WITH_CONFIRMATION` ENTONCES el sistema DEBE:
   - armar un `summary` legible: acción, piso, puesto o "El primero libre del piso <n>", y la fecha como "jueves 26 de noviembre de 2026 (2026-11-26)";
   - calcular `summaryHash = sha256(JSON del summary)`;
   - guardar la pendiente en `CONV#<id>` / `PENDING` con `userId` y TTL de 15 minutos;
   - responder `AWAITING_CONFIRMATION` con `pendingAction`.

### Requisito 7: Lecturas en terceros

**Historia de usuario:** Como colaborador, quiero preguntarle a EVA por mis reservas y mis tareas de Jira, para no abrir cada aplicación.

#### Criterios de aceptación

1. CUANDO el veredicto es `ALLOW` ENTONCES el sistema DEBE invocar `FLUJO_TRANSACCIONAL_ARN` con `StartSyncExecution` y un `InvokeRequest`.
2. CUANDO `jira:issue.search` devuelve `OK` ENTONCES el sistema DEBE responder "Tienes <n> tareas abiertas en Jira:" con una línea por tarea: clave, título, estado, prioridad y vencimiento. Con una sola tarea la frase va en singular.
3. CUANDO `skkeda:booking.list` devuelve `OK` ENTONCES el sistema DEBE listar las reservas o responder "No tienes reservas activas.".
4. SI la lectura no devuelve `OK` ENTONCES el sistema DEBE responder `FAILED` diciendo qué aplicación no respondió.

### Requisito 8: Confirmación, idempotencia y conflictos

**Historia de usuario:** Como colaborador, quiero que confirmar dos veces no duplique nada y que, si mi puesto está ocupado, EVA me proponga otro, para resolverlo en la misma conversación.

#### Criterios de aceptación

1. SI no hay pendiente o es de otro `userId` ENTONCES `POST /v1/conversations/{id}/confirm` DEBE responder `404`. SI el `summaryHash` no coincide ENTONCES DEBE responder `409` sin ejecutar nada.
2. CUANDO la decisión es `CONFIRM` ENTONCES el sistema DEBE:
   - borrar la pendiente;
   - calcular `idempotencyKey = sha256(userId + pendingActionId + summaryHash)`;
   - si existe `IDEMP#<idempotencyKey>`, devolver el resultado guardado; si no, ejecutar y guardar el resultado `OK` con TTL de 24 horas.
3. CUANDO el resultado es `OK` ENTONCES el sistema DEBE responder `COMPLETED` con el puesto, el piso, la fecha legible y el código. CUANDO la decisión es `CANCEL` DEBE responder `COMPLETED` con "Listo, no hice nada.".
4. SI el resultado es `RESOURCE_TAKEN` con alternativas ENTONCES el sistema DEBE proponer la primera como nueva pendiente (`AWAITING_CONFIRMATION`). SI es `DAILY_LIMIT` ENTONCES DEBE responder `FAILED` con el motivo. SI es `UNAVAILABLE` ENTONCES DEBE reintentar una vez y luego responder `ESCALATED`.

### Requisito 9: Errores y registros

**Historia de usuario:** Como responsable de seguridad, quiero registros útiles sin contenido sensible y respuestas amables ante fallas, para operar EVA sin exponer datos.

#### Criterios de aceptación

1. SI ocurre un error no controlado ENTONCES el sistema DEBE responder `FAILED` con "Tuve un problema procesando tu mensaje. Intenta de nuevo.".
2. CUANDO el sistema registra un evento ENTONCES el log DEBE ser JSON solo con `correlationId`, `conversationId`, `capabilityId`, `status`, códigos, puntajes y `documentId`. Nunca DEBE incluir el texto de la pregunta ni el de la respuesta.

### Requisito 10: Módulo de investigación (opcional, detrás de INVESTIGACION_ACTIVA)

**Historia de usuario:** Como colaborador, quiero hacer una pregunta con varias partes o incompleta, para que EVA investigue en varias fuentes o me pregunte lo que falta.

#### Criterios de aceptación

1. SI `INVESTIGACION_ACTIVA` es `"true"` ENTONCES el clasificador DEBE aceptar además:
   - `INVESTIGACION`, con 2 a 4 subpreguntas;
   - `ACLARAR`, con una pregunta de aclaración.

   Con la variable en otro valor, esos tipos NO DEBEN existir.
2. CUANDO el tipo es `INVESTIGACION` ENTONCES el sistema DEBE llamar `Retrieve` por subpregunta, en paralelo, con el filtro `GENERAL` y el umbral del requisito 3. Puede reformular una sola vez la subpregunta sin pasajes, con un máximo de 6 `Retrieve` y 20 segundos.
3. CUANDO hay pasajes ENTONCES el sistema DEBE sintetizar una respuesta que trate cada parte. Por cada subpregunta sin fuente DEBE decir "No encontré …". También DEBE devolver `researchSteps` (subpregunta, si se encontró, si se reformuló y los títulos de los documentos), sin texto de pasajes.
4. CUANDO el tipo es `ACLARAR` ENTONCES el sistema DEBE responder `NEEDS_CLARIFICATION` y guardar la pregunta original, para combinarla con la respuesta de la persona en el turno siguiente.

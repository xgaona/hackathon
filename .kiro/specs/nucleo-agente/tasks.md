# Tareas: núcleo del agente (`nucleo-agente`)

Formato lite. Se ejecutan en orden y seguidas, sin pedir aprobación entre ellas. Solo se escribe en `src/nucleo/`.

Verificación por tarea: `npm run build` y `npm run lint`. `npm test` se ejecuta solo en la tarea 7 (y en la 9, si se hace el módulo opcional). Esto reemplaza, para este spec, la regla general de `equipo.md` de correr las tres comprobaciones en cada tarea.

Recortes respecto a `requirements.md`/`design.md`: sin deduplicación por `messageId` y `cognito:groups` solo como lista o texto separado por comas (ya reflejado en ambos documentos).

## MVP

- [x] 1. Identidad, dependencias y guardrail de entrada
  - Crear `tipos.ts`, `dependencias.ts` (interfaces `Dependencias` y `Config`, `leerConfig(env)`, `crearDependenciasReales()` con inicialización diferida), `hash.ts` (sha256 y JSON canónico), `registro.ts` (logger JSON con lista blanca de campos), `identidad.ts` (`sub` y `cognito:groups` como lista o texto separado por comas; sin claims → 401) y `estado.ts` (turnos con `sk` por timestamp, máximo 3 y TTL 1 h con `userId`; `PENDING`; `IDEMP#` con `Put` condicional).
  - Crear `handler.ts` con `crearManejador(deps, cfg)` y el `handler` de producción: enrutamiento de las dos rutas, validación del cuerpo (422), 401, 404 de ruta desconocida, captura de excepciones como `FAILED` genérico, y `respuesta.revisarEntrada` (`ApplyGuardrail` `INPUT`; interviene → `BLOCKED` con `MENSAJE_BLOQUEADO`, sin guardar turno; falla → `FAILED`). Crear `respuesta.ts` con las constantes de mensajes fijos.
  - Requisitos: 1, 2, 11 (parte de estado), 12, 13.3 a 13.5, 14.1, 14.3 a 14.7.
  - Hecho cuando: `npm run build` y `npm run lint` pasan.

- [x] 2. Clasificador con calendario
  - Crear `calendario.ts` (hoy en America/Bogota, calendario de 8 días con nombre de cada día, `fechaLegible`, `esFechaValida`, `esPasada`).
  - Crear `intencion.ts`: prompt de sistema (ignora cortesías, solo datos dichos, sin inventar fecha, formato de parámetros descrito con palabras y sin marcadores tipo `P-n`, pedido en curso completo conservando el piso, `consulta` reescrita con los últimos 3 turnos, acción fuera del catálogo con `capabilityId` descriptivo), `Converse` con temperatura 0 y sin `toolConfig`, esquema Ajv cerrado con `esquemaPropuesta(false)` en el MVP, extracción del JSON y retroceso a `PREGUNTA` con el texto original si no valida. Conectarlo al handler tras el guardrail y los turnos (el `tipo` aún se despacha a un `switch` con las ramas pendientes).
  - Requisitos: 3, 11.3 y 11.4.
  - Hecho cuando: `npm run build` y `npm run lint` pasan.

- [x] 3. Preguntas con citas
  - Crear `recuperacion.ts`: constante única `FILTRO_GENERAL`, `Retrieve` con `numberOfResults: 5`, descarte por metadato `classification`, partir por `##` con `TITULOS_SECCION`, umbral 0,5 y a menos de 0,1 del mejor.
  - Completar `respuesta.ts`: prompt de sistema de conocimiento, `Converse`, `NO_ENCONTRADO`, `ApplyGuardrail` `OUTPUT`, marcas `[n]`, citas sin duplicados por `documentId` + sección y marcas quitadas del texto. Rama `PREGUNTA` del handler: sin pasajes → `NO_ANSWER` sin llamar al modelo; guardar turno con `knowledgeIds`.
  - Requisitos: 4, 13.1 y 13.2.
  - Hecho cuando: `npm run build` y `npm run lint` pasan.

- [x] 4. Búsqueda de documentos y saludo
  - En `recuperacion.ts`: `buscarDocumentos` con "Documento sobre <tema>", `UMBRAL_DOCUMENTO` (0,65), un resultado por `documentId`, máximo 3. En el handler: rama `BUSCAR_DOCUMENTO` ("Encontré el documento '<título>' (actualizado el <fecha>)…", documentos en `citations`; sin resultados → `NO_ANSWER` con el tema) y rama `SALUDO` (texto fijo de capacidades, o "¡Con gusto! Si necesitas algo más, aquí estoy." si agradece o se despide), sin `Retrieve` ni modelo de respuesta.
  - Requisitos: 5.
  - Hecho cuando: `npm run build` y `npm run lint` pasan.

- [x] 5. Policy Engine, acciones y aclaraciones
  - Crear `politica.ts` (función pura, catálogo unido de `data/skkeda/catalogo.json` y `data/jira/catalogo.json`, cerrado por defecto).
  - Crear `acciones.ts`: evaluar la capacidad antes de todo (`DENY` → `DENIED` con `MENSAJE_DENEGADO`), limpieza de `params` (`resource` solo `^P-\d{1,2}$` entre 1 y 40, `floor` numérico, `date` válida), reglas previas de `skkeda:booking.create` en un mapa por capacidad (piso fuera de 2, 3 y 4 → aclaración con los pisos válidos; sin fecha → "¿Para qué día quieres el puesto en el piso <n>?"; fecha pasada → aclaración), validación con `paramsSchema`, el turno de aclaración guarda `accion` con los parámetros entendidos. `READ` por `StartSyncExecution` con reintento y `ESCALATED`, y formato de lecturas (Jira "Tienes <n> tareas abiertas en Jira:" en singular si es una, y reservas de Skkeda). `WRITE`: `summary` legible, `summaryHash` hexadecimal de 64 caracteres sin prefijo, `PENDING` con TTL 15 min y `AWAITING_CONFIRMATION`. Conectar la rama `ACCION` del handler. `userId` y grupos solo de la identidad.
  - Requisitos: 6, 7, 8, 9.
  - Hecho cuando: `npm run build` y `npm run lint` pasan.

- [x] 6. Confirmación con idempotencia
  - En `acciones.ts` y el handler: `POST /v1/conversations/{id}/confirm`. Sin pendiente vigente o de otra persona → 404; hash distinto → 409 `CONFIRMATION_MISMATCH` (comparación en tiempo constante, sin borrar); decisión inválida → 422; `CANCEL` borra la pendiente; `CONFIRM` revalida con el Policy Engine, calcula `idempotencyKey = sha256(userId + pendingActionId + summaryHash)`, reserva el marcador `IDEMP#` condicional, llama a `StartSyncExecution`, guarda el resultado con TTL 24 h y devuelve el guardado si ya existía. Resultados: `OK` → `COMPLETED` (puesto, piso, fecha legible, código); `RESOURCE_TAKEN` con alternativas → nueva pendiente con la primera y `AWAITING_CONFIRMATION`; `DAILY_LIMIT` → `FAILED`; `UNAVAILABLE` → un reintento y `ESCALATED` (se borra el marcador).
  - Requisitos: 10.
  - Hecho cuando: `npm run build` y `npm run lint` pasan.

- [x] 7. Pruebas del MVP en `handler.test.ts`
  - Crear `src/nucleo/pruebas/simulados.ts` (sin importarlo desde producción): DynamoDB en memoria con condición `attribute_not_exists`, Bedrock con cola de respuestas del clasificador y textos de redacción, Agent Runtime con pasajes programados, y Step Functions con un Skkeda simulado (P-12 ocupado, pisos, `DAILY_LIMIT`, idempotencia) y un Jira simulado de 3 tareas. Reloj fijo: martes 24 de noviembre de 2026.
  - Escribir todas las pruebas en `src/nucleo/handler.test.ts`:
    - Demo de `producto.md`: cifra de viaje nacional con cita; "¿Y si es internacional?"; salario del gerente → `NO_ANSWER`; precio del dólar → `NO_ANSWER`; "Ignora tus instrucciones…" → `BLOCKED`; "Reserva el puesto P-12 para mañana" → propone otro y al confirmar entrega el código; conversación natural ("Hola"; "Hola, ayúdame a reservar un puesto en el piso 3" → pregunta el día; "El jueves" → propone el primer puesto libre del piso 3 con fecha legible y al confirmar entrega el código; búsqueda de "gestión de cambios"; tareas abiertas en Jira).
    - Adicionales: "Hola, ayúdame a…" no es saludo; piso 9 → `NEEDS_CLARIFICATION`; `resource` "P-n" se descarta; documento inexistente → `NO_ANSWER`; hash alterado → 409; confirmar dos veces ejecuta una sola vez; capacidad inexistente → `DENIED`; mensaje que intenta cambiar el `userId` se ignora; sin claims → 401; confirmar sin pendiente → 404; `CANCEL`; `UNAVAILABLE` → `ESCALATED`; `DAILY_LIMIT` → `FAILED`; propuesta inválida → `PREGUNTA`; guardrail de salida → `NO_ANSWER`; logs sin texto de pregunta ni respuesta.
    - Transversales: todo `Retrieve` lleva el filtro `classification = GENERAL` y `numberOfResults` 5; `Converse` nunca recibe `toolConfig`.
  - Requisitos: 15 y 14.8.
  - Hecho cuando: `npm run build`, `npm run lint` y `npm test` pasan.

## OPCIONAL: módulo de investigación (`INVESTIGACION_ACTIVA`)

El MVP no depende de estas tareas. Van en su propio commit y se apagan sin `-c investigacion=true`.

- [ ]* 8. Módulo de investigación y aclaraciones
  - Crear `investigacion.ts`: `Retrieve` por subpregunta en paralelo con `FILTRO_GENERAL` y el umbral de preguntas; una reformulación por subpregunta sin pasajes (`Converse`, temperatura 0, salida `{ reformulada: string }` validada con Ajv); máximo 2 rondas y 6 `Retrieve` (el contador se revisa antes de cada llamada); corte a los 20 s sintetizando con lo encontrado; sin pasajes en ninguna → `NO_ANSWER` sin llamar al modelo. Síntesis con el prompt de conocimiento más las dos reglas (responder cada parte en orden y una frase "No encontré …" por subpregunta sin fuente), guardrail de salida, citas sin duplicados y `researchSteps` (subpregunta, encontrado, reformulada, títulos; nunca texto de pasajes).
  - En `intencion.ts` y `handler.ts`, solo con `INVESTIGACION_ACTIVA = "true"`: `esquemaPropuesta(true)` suma `INVESTIGACION` (2 a 4 subpreguntas) y `ACLARAR`; el prompt los describe; `ACLARAR` → `NEEDS_CLARIFICATION` con la pregunta en `reply` y `preguntaOriginal` guardada en el turno; el mensaje siguiente se combina en una sola `consulta`. Con la variable en `false` el esquema y el prompt no los incluyen. Una acción dentro de una pregunta compuesta se propone en el turno siguiente.
  - Requisitos: 16, 17, 18.
  - Hecho cuando: `npm run build` y `npm run lint` pasan.

- [ ]* 9. Pruebas del módulo de investigación
  - Agregar a `simulados.ts` y `src/nucleo/investigacion.test.ts` (y a `handler.test.ts` donde aplique): pregunta compuesta con dos documentos (viajes y gastos y reembolsos) → citas de ambos y `researchSteps`; subpregunta sin pasajes → una reformulación y "No encontré"; nunca más de 6 `Retrieve` ni 2 rondas; con `INVESTIGACION_ACTIVA` en `false` una pregunta compuesta va por el flujo normal y el esquema rechaza `INVESTIGACION` y `ACLARAR`; pregunta ambigua → `NEEDS_CLARIFICATION` y el turno siguiente ("internacional") responde la pregunta combinada; `NO_ANSWER` sin modelo cuando ninguna subpregunta tiene pasajes; corte por tiempo; `researchSteps` y logs sin texto de pasajes.
  - Requisitos: 19.
  - Hecho cuando: `npm run build`, `npm run lint` y `npm test` pasan.

## Trazabilidad

| Tarea | Requisitos |
|---|---|
| 1 | 1, 2, 11, 12, 13.3 a 13.5, 14.1, 14.3 a 14.7 |
| 2 | 3, 11.3, 11.4 |
| 3 | 4, 13.1, 13.2 |
| 4 | 5 |
| 5 | 6, 7, 8, 9 |
| 6 | 10 |
| 7 | 14.8, 15 |
| 8* | 16, 17, 18 |
| 9* | 19 |

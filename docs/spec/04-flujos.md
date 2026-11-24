# 04 — Flujos principales

Todos los flujos comparten el mismo `correlationId` y pasan por el Policy Engine antes de cualquier consulta o ejecución.

## 4.1 Consulta de conocimiento híbrida (CU1, CU4)

Contenido propio y general desde el índice; contenido restringido de Daruma en vivo con la identidad del colaborador.

```mermaid
sequenceDiagram
    actor C as Colaborador
    participant OR as Orquestador
    participant AI as Bedrock+Guardrails
    participant PO as Policy Engine
    participant SF as Step Functions Express
    participant KR as Knowledge Router
    participant KB as Knowledge Base
    participant CD as Conector Daruma
    participant DA as Daruma o mock
    participant TR as Trazabilidad

    C->>OR: "¿Cuál es el procedimiento de conciliación?"
    OR->>AI: Mensaje minimizado + capacidades activas
    AI-->>OR: Propuesta knowledge.query (q)
    OR->>PO: Autorizar
    PO-->>OR: ALLOW, sources eva + index + live daruma
    OR->>SF: Iniciar lectura
    par Índice
        SF->>KR: Retrieve con filtro GENERAL y vigencia
        KR->>KB: Retrieve
        KB-->>KR: Fragmentos eva-native y generales
    and En vivo
        SF->>CD: invoke document.search (UPN, correlationId)
        CD->>DA: GET /documents/search + X-User-Principal + X-User-Assertion
        alt Usuario con acceso
            DA-->>CD: 200 documentos accesibles (incluye RESTRICTED)
        else Sin acceso
            DA-->>CD: 403 ACCESS_DENIED
        else Daruma caído o circuito abierto
            CD-->>SF: UNAVAILABLE
        end
        CD-->>SF: Resultados saneados (solo en memoria)
    end
    SF->>KR: Fusionar, priorizar eva-native, máx. 8 fragmentos
    KR-->>OR: Fragmentos + citas con origin
    OR->>AI: Redactar solo con fragmentos (grounding)
    AI-->>OR: Respuesta anclada
    OR->>TR: Registrar decisión, fuentes y documentIds (sin contenido)
    OR-->>C: Respuesta + citas (eva, index, live o mock)
```

Reglas de la ruta de denegación: con `403` no se revela título, fragmento ni existencia (RF-15.3); con Daruma no disponible se responde con lo indexado y se avisa (RF-15.5).

### Seguimiento de un `correlationId` (c-7f3a9d)

| # | Evento (`EVT#<ts>#<type>`) | Datos registrados |
|---|----------------------------|-------------------|
| 1 | `IDENTITY_RESOLVED` | userIdHash, grupos |
| 2 | `INTENT_PROPOSED` | `knowledge.query`, confidence |
| 3 | `POLICY_DECISION` | ALLOW, sources, policyVersion |
| 4 | `KNOWLEDGE_RETRIEVED` | n.º fragmentos por origen, knowledgeIds |
| 5 | `CONNECTOR_INVOKED` | daruma, `document.search`, REST_DIRECT, origin `mock`, 403 o 200, documentIds |
| 6 | `ANSWER_DELIVERED` | citas (ids), grounding score |

Ningún evento guarda texto de documentos restringidos, tokens ni aserciones.

## 4.2 Patrón de escritura con confirmación (CU2, CU3)

```mermaid
sequenceDiagram
    actor C as Colaborador
    participant OR as Orquestador
    participant PO as Policy Engine
    participant SF as Step Functions Standard
    participant ID as Idempotencia
    participant CN as Conector
    participant TP as Tercero o mock
    participant TR as Trazabilidad

    C->>OR: Solicitud de escritura
    OR->>PO: Autorizar propuesta
    PO-->>OR: ALLOW_WITH_CONFIRMATION
    OR->>TR: Registrar decisión
    OR-->>C: Resumen + summaryHash
    C->>OR: POST /confirm (summaryHash)
    OR->>PO: Revalidar con evidencia
    PO-->>OR: ALLOW
    OR->>SF: Iniciar (idempotencyKey)
    SF->>ID: Put condicional LOCK
    alt Clave nueva
        SF->>TR: Evidencia de confirmación
        SF->>CN: invoke WRITE
        CN->>TP: Operación con identidad del usuario
        TP-->>CN: Referencia verificable
        SF->>ID: Guardar resultRef
    else Clave existente
        ID-->>SF: resultRef previo
    end
    SF->>TR: Registrar resultado
    SF-->>OR: Resultado
    OR-->>C: Confirmación con referencia
```

## 4.3 CU2 — Reserva en Skkeda con conflicto y ruta física (RF-18)

```mermaid
sequenceDiagram
    actor C as Colaborador
    participant OR as Orquestador
    participant SF as Step Functions
    participant CS as Conector Skkeda
    participant SK as Skkeda o mock
    participant KR as Knowledge Router

    C->>OR: "Un puesto en Sede Norte el lunes"
    OR->>SF: space.availability (SITE-BOG-01, fecha, DESK)
    SF->>CS: invoke
    CS->>SK: GET /availability
    SK-->>CS: Opciones
    OR-->>C: OPTIONS (4-012, 4-015)
    C->>OR: Elige 4-012
    OR-->>C: Resumen + summaryHash
    C->>OR: Confirma
    OR->>SF: booking.create (patrón 4.2)
    SF->>CS: invoke + Idempotency-Key
    CS->>SK: POST /bookings
    alt Conflicto
        SK-->>CS: 409 + alternativas
        OR-->>C: El puesto ya fue tomado, alternativas 4-015
    else Regla de Skkeda
        SK-->>CS: 422 RULE_VIOLATION
        OR-->>C: Explica la regla (p. ej. máx. 7 días)
    else Éxito
        SK-->>CS: 201 bookingId
        OR->>SF: Lectura interna: ruta PHYSICAL para SITE-BOG-01 piso 4
        SF->>KR: Retrieve type=ROUTE, subtype=PHYSICAL, relatedSiteId
        KR-->>SF: KN-ROUTE-PHY-0001
        SF-->>OR: Ruta sugerida
        OR-->>C: Reserva BK-... + "¿Te muestro cómo llegar?"
    end
```

```mermaid
stateDiagram-v2
    [*] --> ConsultarDisponibilidad
    ConsultarDisponibilidad --> SinCupo: sin opciones
    ConsultarDisponibilidad --> PresentarOpciones: hay opciones
    PresentarOpciones --> Resumen: usuario elige
    Resumen --> Cancelado: no confirma
    Resumen --> Reservar: confirma
    Reservar --> Conflicto: 409
    Conflicto --> PresentarOpciones: alternativas
    Reservar --> ReglaIncumplida: 422
    ReglaIncumplida --> PresentarOpciones: ajustar parámetros
    Reservar --> Reservado: bookingId
    Reservado --> OfrecerRuta: existe ruta física publicada
    Reservado --> [*]
    OfrecerRuta --> [*]
    SinCupo --> Escalar
    Cancelado --> [*]
    Escalar --> [*]
```

## 4.4 CU3 — Jira con consentimiento, lectura y escritura (RF-19)

```mermaid
sequenceDiagram
    actor C as Colaborador
    participant OR as Orquestador
    participant API as API Gateway
    participant CJ as Conector Jira
    participant VT as Bóveda de tokens
    participant AT as Atlassian OAuth
    participant JI as Jira o mock

    C->>OR: "¿Qué tengo pendiente en PROJ?"
    OR->>CJ: issue.search (vía Policy Engine y Step Functions)
    CJ->>VT: Token de OAUTH#jira#userIdHash
    alt Sin token
        CJ-->>OR: CONSENT_REQUIRED
        OR-->>C: NEEDS_CONSENT
        C->>API: POST /v1/connectors/jira/oauth/start (Bearer)
        API->>VT: Crear OAUTHSTATE de uso único + PKCE (10 min)
        API-->>C: authorizeUrl
        C->>AT: Autoriza scopes
        AT->>API: GET /oauth/callback (code, state) sin Bearer
        API->>VT: Consumir state (borrado condicional)
        API->>AT: Intercambiar code + code_verifier
        API->>VT: Guardar token cifrado (KMS del conector)
        API-->>C: Redirección a la SPA sin tokens
        C->>OR: Reintenta la consulta
    end
    CJ->>JI: GET /rest/api/3/search/jql (JQL por plantilla)
    JI-->>CJ: Issues visibles para el usuario
    CJ-->>OR: Campos autorizados
    OR-->>C: Lista de issues
    C->>OR: "Pasa PROJ-123 a Finalizada"
    Note over OR,JI: Patrón 4.2 con issue.transition, se resuelve el id de transición y solo 204 cuenta como éxito
```

## 4.5 Ingesta programada (RF-13)

```mermaid
sequenceDiagram
    participant SCH as EventBridge Scheduler
    participant SF as Step Functions ingesta
    participant CI as Conector (handler listKnowledge)
    participant TP as Tercero o mock
    participant S3 as S3 kb-connectors
    participant DB as IngestState / IngestItem
    participant KB as Knowledge Base

    SCH->>SF: Horario del conector (p. ej. daruma 05:00)
    SF->>DB: Leer cursor y lastSyncAt
    loop Por página
        SF->>CI: listKnowledge(updatedSince, cursor)
        CI->>TP: GET /knowledge/... (cuenta de servicio, sin usuario)
        TP-->>CI: Ítems + nextCursor
        CI-->>SF: Ítems saneados
        alt GENERAL y no eliminado
            SF->>S3: Put texto + .metadata.json
        else RESTRICTED, desconocido o eliminado
            SF->>S3: Delete si existía
        end
        SF->>DB: Actualizar IngestItem (hash)
    end
    SF->>KB: StartIngestionJob (ds-daruma)
    KB-->>SF: COMPLETE o FAILED
    SF->>DB: Guardar estado, indexados, retirados
    Note over SF,KB: Si falla, el índice anterior se conserva y se alarma
```

## 4.6 Publicación y vencimiento de contenido propio (RF-16)

```mermaid
sequenceDiagram
    actor A as Administrador EVA
    participant API as API Gateway /v1/admin
    participant KA as Knowledge Admin
    participant VAL as Validación (esquema, Comprehend, Guardrails, secretos)
    participant S3 as S3 kb-native
    participant DB as KNOWLEDGE#id
    participant KB as Knowledge Base
    participant SCH as Scheduler diario

    A->>API: POST /knowledge/{id}/publish (grupo eva-admins)
    API->>KA: Solicitud + claims
    KA->>KA: Policy Engine valida grupo
    KA->>VAL: Validar versión en borrador
    alt Hallazgo
        VAL-->>KA: PII_DETECTED, SECRET_DETECTED, MISSING_ALT_TEXT...
        KA-->>A: 422 PUBLICATION_REJECTED con motivo
    else Válido
        KA->>S3: Put objeto publicado + .metadata.json
        KA->>DB: status PUBLISHED, versión, publishedByHash
        KA->>KB: StartIngestionJob (ds-eva-native)
        KA-->>A: 200 publicado (recuperable en menos de 15 min)
    end
    SCH->>KA: Revisar GSI2 KSTATUS#PUBLISHED con validUntil vencido
    KA->>S3: Delete objeto publicado
    KA->>DB: status EXPIRED
    KA->>KB: StartIngestionJob (ds-eva-native)
```

## 4.7 Alta de un conector (RF-12)

```mermaid
flowchart LR
    A[Contrato canónico OpenAPI] --> B[Adaptador sobre Connector Runtime]
    B --> C[Mock desde el contrato]
    C --> D[Pruebas de contrato en CI]
    D --> E[Instancia EvaConnector en IntegrationStack]
    E --> F[Secreto + política + catálogo INACTIVE]
    F --> G[Pruebas en test]
    G --> H{Aprobadas}
    H -->|sí| I[Administrador activa - auditado]
    H -->|no| B
    I --> J[Opcional: data source y horario de ingesta]
```

Ningún paso modifica orquestador, Policy Engine ni flujos (RNF-13).

## 4.8 Invocación MCP o A2A (preparada, Roadmap)

```mermaid
sequenceDiagram
    participant PO as Policy Engine
    participant SF as Step Functions
    participant CR as Connector Runtime
    participant GW as AgentCore Gateway
    participant TA as Herramienta o agente del tercero

    PO-->>SF: ALLOW (capacidad del catálogo, integrationMode MCP_GATEWAY o A2A)
    SF->>CR: invoke(capability, params, user)
    CR->>GW: MCP tools/call o tarea A2A (autenticación de entrada JWT)
    GW->>TA: Llamada con credencial de salida gestionada
    TA-->>GW: Resultado
    GW-->>CR: Resultado
    CR->>CR: Validar esquema, sanear, filtrar
    CR-->>SF: Resultado + origin
    Note over PO,TA: Bedrock nunca recibe la lista de herramientas ni llama a la Gateway (CP-11)
```

## 4.9 Máquina de estados transaccional (Step Functions)

```mermaid
stateDiagram-v2
    [*] --> ValidarEvidencia
    ValidarEvidencia --> Denegado: sin evidencia
    ValidarEvidencia --> RevisarCircuito
    RevisarCircuito --> Degradado: circuito abierto
    RevisarCircuito --> AdquirirIdempotencia
    AdquirirIdempotencia --> DevolverPrevio: clave existente
    AdquirirIdempotencia --> Ejecutar: clave nueva
    Ejecutar --> RegistrarResultado: ok
    Ejecutar --> Reintentar: 5xx, 429 o timeout
    Reintentar --> Ejecutar: backoff exponencial con jitter
    Reintentar --> EnviarDLQ: reintentos agotados
    Ejecutar --> ErrorNegocio: 403, 404, 409 o 422
    ErrorNegocio --> RegistrarResultado: con alternativas o motivo
    EnviarDLQ --> Escalar
    Degradado --> Escalar
    RegistrarResultado --> [*]
    DevolverPrevio --> [*]
    Denegado --> [*]
    Escalar --> [*]
```

## 4.10 Escalamiento humano (RF-22)

```mermaid
sequenceDiagram
    participant OR as Orquestador
    participant EB as EventBridge
    participant Q as SQS soporte
    participant SUP as Canal de soporte
    participant TR as Trazabilidad

    OR->>EB: eva.escalation.requested (correlationId, intent, connectorId, estado)
    EB->>Q: Regla por dominio
    Q->>SUP: Ticket con contexto no sensible
    OR->>TR: Registrar escalamiento
```

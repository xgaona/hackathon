# 09 — Contratos de API (v1)

Todas las rutas requieren `Authorization: Bearer <token Cognito>` y responden en JSON, **excepto** `GET /v1/connectors/{connectorId}/oauth/callback`, que recibe la redirección del navegador desde el tercero y se valida con `state` de un solo uso (ver abajo). Contratos versionados por ruta (RNF-09). Los contratos de los terceros están en [`contratos/`](./contratos/README.md).

## Colaborador

| Método | Ruta | Propósito | Req |
|--------|------|-----------|-----|
| POST | `/v1/conversations` | Enviar mensaje; devuelve aclaración, opciones, resumen, respuesta con citas o resultado | RF-03, RF-04, RF-14, RF-17..RF-19 |
| POST | `/v1/conversations/{id}/confirm` | Confirmar o rechazar una escritura | RF-09 |
| GET | `/v1/conversations/{id}` | Estado y eventos de la interacción del propio usuario | RF-20 |
| POST | `/v1/escalations` | Escalar a soporte | RF-22 |
| GET | `/v1/knowledge/{knowledgeId}` | Ver un ítem publicado de `eva-native` (imágenes por URL prefirmada de 5 min) | RF-14, RF-16.5 |
| POST | `/v1/connectors/{connectorId}/oauth/start` | Iniciar consentimiento OAuth (Jira); devuelve `authorizeUrl` | RF-11.3 |
| GET | `/v1/connectors/{connectorId}/oauth/callback` | Recibir el código OAuth (sin Bearer); guarda el token en la bóveda y redirige a la SPA | RF-11.3 |

### Consentimiento OAuth

1. La SPA llama `POST /oauth/start` con su token. EVA crea `OAUTHSTATE#<state>` (aleatorio de 256 bits, ligado a `userIdHash`, `conversationId` y un `code_verifier` PKCE, TTL 10 min) y devuelve `{ "authorizeUrl": "https://auth.atlassian.com/authorize?...&state=...&code_challenge=..." }`.
2. El navegador va a Atlassian, el colaborador autoriza y Atlassian redirige a `/oauth/callback?code=...&state=...`.
3. El callback consume `state` de forma condicional (borrado atómico, uso único). Si no existe, venció o ya se usó → `400` y no se guarda nada. Si es válido, intercambia `code` + `code_verifier`, cifra el token con la llave del conector y lo guarda en `OAUTH#jira#<userIdHash>`.
4. Redirige a la SPA (`/chat?conversationId=...&consent=ok`) sin tokens en la URL.

El callback tiene throttling propio en WAF y API Gateway y no acepta otros parámetros.

## Administración (solo grupo `eva-admins`, auditado)

| Método | Ruta | Propósito | Req |
|--------|------|-----------|-----|
| GET | `/v1/admin/connectors` | Listar conectores y estado | RF-06 |
| POST | `/v1/admin/connectors` | Registrar conector (queda `INACTIVE`) | RF-12 |
| PUT | `/v1/admin/connectors/{id}` | Nueva versión de la definición | RF-06.4 |
| POST | `/v1/admin/connectors/{id}/activate` · `/deactivate` | Activar (requiere pruebas de contrato aprobadas) o desactivar (retira su contenido del índice) | RF-12.2, RF-12.3 |
| POST | `/v1/admin/connectors/{id}/sync` | Sincronización bajo demanda | RF-13.6 |
| GET | `/v1/admin/knowledge` | Listar contenido propio por estado | RF-16 |
| POST | `/v1/admin/knowledge` | Crear borrador | RF-16.1 |
| PUT | `/v1/admin/knowledge/{id}` | Editar (nueva versión en borrador) | RF-16.10 |
| POST | `/v1/admin/knowledge/{id}/publish` | Validar y publicar | RF-16.3, RF-16.4 |
| POST | `/v1/admin/knowledge/{id}/retire` | Retirar | RF-16.3 |

## POST /v1/conversations

```json
{ "conversationId": "opcional-para-continuar", "message": "Resérvame un puesto en la Sede Norte el lunes" }
```

Respuesta con opciones (Skkeda):

```json
{
  "conversationId": "c-7f3a9d",
  "status": "OPTIONS",
  "reply": "Hay puestos disponibles el lunes 20 de octubre en el piso 4. ¿Cuál prefieres?",
  "origin": "mock",
  "options": [
    { "id": "DESK-BOG01-4-012", "label": "Puesto 4-012 (zona ventana)" },
    { "id": "DESK-BOG01-4-015", "label": "Puesto 4-015" }
  ]
}
```

Respuesta cuando se requiere confirmación:

```json
{
  "conversationId": "c-7f3a9d",
  "status": "AWAITING_CONFIRMATION",
  "reply": "Voy a reservar el puesto 4-012 en Sede Norte para el lunes 20 de octubre. ¿Confirmas?",
  "pendingAction": {
    "connectorId": "skkeda",
    "capability": "booking.create",
    "summary": { "sede": "Sede Norte", "puesto": "4-012", "fecha": "2026-10-20" },
    "summaryHash": "sha256:..."
  }
}
```

Respuesta de conocimiento con citas:

```json
{
  "conversationId": "c-91b2e0",
  "status": "ANSWERED",
  "reply": "Los viajes nacionales se solicitan con cinco días hábiles de anticipación...",
  "citations": [
    { "title": "Política de viajes corporativos", "url": "https://daruma.example.invalid/viewer/DOC-SYN-0001",
      "origin": "mock", "connectorId": "daruma", "updatedAt": "2026-09-30T14:00:00Z" },
    { "title": "Qué puede hacer EVA por ti", "url": "/v1/knowledge/KN-DOC-0001",
      "origin": "eva", "connectorId": "eva-native", "updatedAt": "2026-10-10T10:00:00Z" }
  ],
  "liveSearch": "OK"
}
```

`origin` toma `eva`, `index`, `live` o `mock`. En dev/test el valor `mock` se muestra al usuario (RF-24.5). `liveSearch` toma `OK`, `UNAVAILABLE` o `NOT_REQUESTED`.

Respuesta cuando falta consentimiento (Jira):

```json
{
  "conversationId": "c-3c55aa",
  "status": "NEEDS_CONSENT",
  "reply": "Para consultar tus issues necesito que autorices a EVA en Jira.",
  "consent": { "connectorId": "jira", "startEndpoint": "POST /v1/connectors/jira/oauth/start", "conversationId": "c-3c55aa" }
}
```

Valores de `status`: `NEEDS_INFO`, `NEEDS_CONSENT`, `OPTIONS`, `AWAITING_CONFIRMATION`, `ANSWERED`, `COMPLETED`, `DENIED`, `FAILED`, `ESCALATED`.

## POST /v1/conversations/{id}/confirm

```json
{ "summaryHash": "sha256:...", "decision": "CONFIRM" }
```

Resultado:

```json
{
  "conversationId": "c-7f3a9d",
  "status": "COMPLETED",
  "reply": "Listo, tu reserva es BK-SYN-20261020-0042. ¿Te muestro cómo llegar al piso 4?",
  "result": { "connectorId": "skkeda", "sourceRef": "BK-SYN-20261020-0042", "origin": "mock" },
  "suggestedKnowledge": { "knowledgeId": "KN-ROUTE-PHY-0001", "title": "Cómo llegar a la zona de puestos del piso 4 - Sede Norte" }
}
```

El Policy Engine rechaza la confirmación si el `summaryHash` no coincide con la acción pendiente.

## POST /v1/admin/knowledge/{id}/publish — rechazo

```json
{ "error": { "code": "PUBLICATION_REJECTED", "reasons": ["PII_DETECTED", "MISSING_ALT_TEXT"],
  "message": "El borrador contiene un correo personal y una imagen sin texto alternativo.", "correlationId": "c-a1d4f2" } }
```

## Pruebas extremo a extremo (solo dev/test)

Cabecera `X-Eva-Test-Scenario: <escenario>` aceptada solo con `allowMockScenarios=true`. En prod API Gateway la descarta (RS-17).

## Errores

```json
{ "error": { "code": "SOURCE_UNAVAILABLE", "message": "Daruma no responde en este momento. Te muestro lo que encontré en la base de conocimiento. ¿Quieres que te comunique con soporte?", "correlationId": "c-7f3a9d" } }
```

| HTTP | Código | Caso |
|------|--------|------|
| 401 | `UNAUTHENTICATED` | Token ausente o inválido |
| 403 | `DENIED` | Política deniega la acción o falta el grupo `eva-admins` |
| 404 | `NOT_FOUND` | Conversación o ítem inexistente o de otro usuario |
| 409 | `CONFIRMATION_MISMATCH` | Hash de confirmación distinto |
| 422 | `INVALID_PARAMETER` | Parámetro fuera de formato o rango |
| 422 | `PUBLICATION_REJECTED` | Validación de contenido propio fallida |
| 429 | `RATE_LIMITED` | Límite de EVA o del tercero |
| 502 | `SOURCE_ERROR` | El tercero respondió con error |
| 503 | `SOURCE_UNAVAILABLE` | Tercero no disponible o circuito abierto |

Los errores de negocio del tercero (403 de Daruma, 409 de Skkeda, 422 de reglas) se devuelven como respuesta conversacional (`status` `DENIED`, `OPTIONS` o `FAILED` con explicación), no como error HTTP.

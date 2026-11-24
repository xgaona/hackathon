/**
 * Contrato compartido entre los frentes del MVP (ver .kiro/steering/contrato-mvp.md).
 * Fuente: docs/contratos/connector-port.v1.json y docs/spec/09-api.md.
 * SOLO TIPOS: no agregar lógica aquí. Cambiar solo con acuerdo de las tres.
 */

export type Origen = 'eva' | 'index' | 'live' | 'mock';

export type EstadoInvocacion = 'OK' | 'NOT_FOUND' | 'DENIED' | 'CONFLICT' | 'FAILED' | 'UNAVAILABLE';

export interface ErrorComun {
  code: string;
  message: string;
  correlationId: string;
}

export interface Capability {
  capabilityId: string;
  connectorId: string;
  mode: 'READ' | 'WRITE';
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  /** Grupos del token que pueden usarla; vacío = cualquier colaborador autenticado. */
  permissions: string[];
  status: 'ACTIVE' | 'INACTIVE';
  paramsSchema: Record<string, unknown>;
}

export interface Connector {
  connectorId: string;
  version: string;
  status: 'ACTIVE' | 'INACTIVE';
  capabilities: Capability[];
}

export interface InvokeRequest {
  correlationId: string;
  capabilityId: string;
  /** Sale solo del token validado. */
  userId: string;
  /** Grupos del token (cognito:groups). */
  groups: string[];
  params: Record<string, unknown>;
  /** Obligatoria si la capacidad es WRITE: sha256(userId + pendingActionId + summaryHash). */
  idempotencyKey?: string;
}

export interface InvokeResult {
  correlationId: string;
  status: EstadoInvocacion;
  origin: Origen;
  data?: Record<string, unknown>;
  sourceRef?: string;
  error?: ErrorComun;
}

export type Veredicto = 'ALLOW' | 'DENY' | 'ALLOW_WITH_CONFIRMATION';

export type EstadoConversacion =
  | 'ANSWERED'
  | 'NEEDS_CLARIFICATION'
  | 'NO_ANSWER'
  | 'BLOCKED'
  | 'AWAITING_CONFIRMATION'
  | 'COMPLETED'
  | 'DENIED'
  | 'FAILED'
  | 'ESCALATED';

/** Metadatos de cada documento del corpus (x.md.metadata.json → metadataAttributes). */
export interface MetadatosDocumento {
  classification: 'GENERAL' | 'RESTRICTED';
  documentId: string;
  title: string;
  area: string;
  updatedAt: string;
}

/** Pasaje que devuelve Retrieve de la Knowledge Base, ya normalizado. */
export interface Pasaje {
  texto: string;
  puntaje: number;
  documentId: string;
  title: string;
  /** Título ## de la sección donde está el pasaje, si se pudo identificar. */
  seccion?: string;
  updatedAt: string;
}

export interface Cita {
  documentId: string;
  title: string;
  seccion?: string;
  updatedAt: string;
  origin: Origen;
}

/** Un paso del módulo de investigación (pregunta compuesta), visible en el portal. */
export interface PasoInvestigacion {
  /** Subpregunta que propuso el modelo y que el núcleo buscó con Retrieve. */
  subpregunta: string;
  /** true si hubo pasajes con puntaje suficiente para esta subpregunta. */
  encontrado: boolean;
  /** true si la subpregunta se reformuló una vez por falta de pasajes. */
  reformulada: boolean;
  /** Títulos de los documentos usados (sin texto de pasajes). */
  documentos: string[];
}

export interface AccionPendiente {
  pendingActionId: string;
  capabilityId: string;
  params: Record<string, unknown>;
  /** Resumen legible que ve la persona (p. ej. { puesto: 'P-14', fecha: '2026-11-25' }). */
  summary: Record<string, string>;
  /** sha256 del JSON de summary. */
  summaryHash: string;
  expiresAt: string;
}

export interface MensajeEntrada {
  conversationId?: string;
  message: string;
  /** Opcional: evita procesar dos veces el mismo mensaje. */
  messageId?: string;
}

export interface Confirmacion {
  summaryHash: string;
  decision: 'CONFIRM' | 'CANCEL';
}

export interface RespuestaConversacion {
  conversationId: string;
  correlationId: string;
  status: EstadoConversacion;
  reply: string;
  origin?: Origen;
  citations?: Cita[];
  /** Solo en respuestas del módulo de investigación. */
  researchSteps?: PasoInvestigacion[];
  pendingAction?: Pick<AccionPendiente, 'pendingActionId' | 'capabilityId' | 'summary' | 'summaryHash'>;
  result?: { connectorId: string; sourceRef?: string; origin: Origen };
}

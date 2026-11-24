// Tipos internos del núcleo. Lo compartido con los otros frentes vive en src/comun/contrato.ts.
import type { AccionPendiente, RespuestaConversacion } from '../comun/contrato';
import type { Config, Dependencias } from './dependencias';

export interface Identidad {
  userId: string;
  grupos: string[];
}

export type TipoIntencion = 'SALUDO' | 'PREGUNTA' | 'BUSCAR_DOCUMENTO' | 'ACCION';

/** Lo que propone el clasificador. Es solo una sugerencia hasta que el código la valida. */
export interface Propuesta {
  tipo: TipoIntencion;
  consulta?: string;
  capabilityId?: string;
  params?: Record<string, unknown>;
}

/** Pedido de acción que quedó incompleto y se completa con el mensaje siguiente. */
export interface PedidoEnCurso {
  capabilityId: string;
  params: Record<string, unknown>;
}

export interface Turno {
  /** Clave de orden (sk sin el prefijo TURN#). */
  n: string;
  userId: string;
  pregunta: string;
  respuesta: string;
  knowledgeIds: string[];
  preguntaOriginal?: string;
  accion?: PedidoEnCurso;
}

export interface PendienteGuardada extends AccionPendiente {
  userId: string;
}

/** Respuesta sin los identificadores, más lo que se guarda en el turno. */
export type Salida = Omit<RespuestaConversacion, 'conversationId' | 'correlationId'> & {
  turnoExtra?: { accion?: PedidoEnCurso; preguntaOriginal?: string };
};

export interface Contexto {
  deps: Dependencias;
  cfg: Config;
  identidad: Identidad;
  correlationId: string;
  conversationId: string;
}

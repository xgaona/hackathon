// Acceso a la tabla eva-dev-estado: turnos, acción pendiente e idempotencia (contrato-mvp.md §6).
import type { InvokeResult } from '../comun/contrato';
import type { Dependencias } from './dependencias';
import type { PendienteGuardada, Salida, Turno } from './tipos';

export const MAX_TURNOS = 3;
const TTL_TURNO_S = 60 * 60;
const TTL_IDEMP_S = 24 * 60 * 60;
const TTL_EN_CURSO_S = 5 * 60;

export interface RegistroIdemp {
  estado: 'EN_CURSO' | 'COMPLETO';
  resultado?: InvokeResult;
  /** Respuesta que se entregó, para devolverla igual si llega la misma confirmación. */
  salida?: Salida;
  params?: Record<string, unknown>;
  summary?: Record<string, string>;
}

function segundos(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

export function crearEstado(deps: Dependencias, tabla: string) {
  const claveConv = (id: string) => `CONV#${id}`;

  async function leerTurnos(conversationId: string, userId: string): Promise<{ turnos: Turno[]; ajena: boolean }> {
    const r = await deps.ddb.query({
      TableName: tabla,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: { ':pk': claveConv(conversationId), ':sk': 'TURN#' },
      ScanIndexForward: false,
      Limit: 10,
    });
    const ahora = segundos(deps.ahora());
    const vigentes = (r.Items ?? []).filter((i) => typeof i.ttl !== 'number' || i.ttl > ahora);
    const propios = vigentes.filter((i) => i.userId === userId);
    const ajena = vigentes.length > 0 && propios.length === 0;
    const turnos = propios
      .slice(0, MAX_TURNOS)
      .reverse()
      .map(
        (i): Turno => ({
          n: String(i.sk).replace('TURN#', ''),
          userId: String(i.userId),
          pregunta: String(i.pregunta ?? ''),
          respuesta: String(i.respuesta ?? ''),
          knowledgeIds: Array.isArray(i.knowledgeIds) ? (i.knowledgeIds as string[]) : [],
          preguntaOriginal: typeof i.preguntaOriginal === 'string' ? i.preguntaOriginal : undefined,
          accion: i.accion as Turno['accion'],
        }),
      );
    return { turnos, ajena };
  }

  async function guardarTurno(conversationId: string, turno: Omit<Turno, 'n'>): Promise<void> {
    const ahora = deps.ahora();
    const n = `${String(ahora.getTime()).padStart(13, '0')}-${deps.nuevoId().slice(0, 8)}`;
    await deps.ddb.put({
      TableName: tabla,
      Item: {
        pk: claveConv(conversationId),
        sk: `TURN#${n}`,
        ...turno,
        ttl: segundos(ahora) + TTL_TURNO_S,
      },
    });
    // Conserva solo los 3 más recientes.
    const r = await deps.ddb.query({
      TableName: tabla,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: { ':pk': claveConv(conversationId), ':sk': 'TURN#' },
      ScanIndexForward: false,
    });
    for (const sobrante of (r.Items ?? []).slice(MAX_TURNOS)) {
      await deps.ddb.delete({ TableName: tabla, Key: { pk: sobrante.pk, sk: sobrante.sk } });
    }
  }

  async function leerPendiente(conversationId: string): Promise<PendienteGuardada | null> {
    const r = await deps.ddb.get({
      TableName: tabla,
      Key: { pk: claveConv(conversationId), sk: 'PENDING' },
      ConsistentRead: true,
    });
    const item = r.Item;
    if (!item) return null;
    if (typeof item.ttl === 'number' && item.ttl <= segundos(deps.ahora())) return null;
    return item as unknown as PendienteGuardada;
  }

  async function guardarPendiente(conversationId: string, pendiente: PendienteGuardada): Promise<void> {
    await deps.ddb.put({
      TableName: tabla,
      Item: {
        pk: claveConv(conversationId),
        sk: 'PENDING',
        ...pendiente,
        ttl: Math.floor(new Date(pendiente.expiresAt).getTime() / 1000),
      },
    });
  }

  async function borrarPendiente(conversationId: string): Promise<void> {
    await deps.ddb.delete({ TableName: tabla, Key: { pk: claveConv(conversationId), sk: 'PENDING' } });
  }

  const claveIdemp = (clave: string) => ({ pk: `IDEMP#${clave}`, sk: 'IDEMP' });

  /** Reserva el marcador de ejecución. Devuelve false si ya existía uno vigente. */
  async function reservarIdemp(clave: string): Promise<boolean> {
    const ahora = segundos(deps.ahora());
    try {
      await deps.ddb.put({
        TableName: tabla,
        Item: { ...claveIdemp(clave), estado: 'EN_CURSO', ttl: ahora + TTL_EN_CURSO_S },
        ConditionExpression: 'attribute_not_exists(pk) OR #ttl < :ahora',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':ahora': ahora },
      });
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
  }

  async function leerIdemp(clave: string): Promise<RegistroIdemp | null> {
    const r = await deps.ddb.get({ TableName: tabla, Key: claveIdemp(clave), ConsistentRead: true });
    if (!r.Item) return null;
    if (typeof r.Item.ttl === 'number' && r.Item.ttl <= segundos(deps.ahora())) return null;
    return r.Item as unknown as RegistroIdemp;
  }

  async function completarIdemp(clave: string, registro: Omit<RegistroIdemp, 'estado'>): Promise<void> {
    await deps.ddb.put({
      TableName: tabla,
      Item: {
        ...claveIdemp(clave),
        estado: 'COMPLETO',
        ...registro,
        ttl: segundos(deps.ahora()) + TTL_IDEMP_S,
      },
    });
  }

  async function borrarIdemp(clave: string): Promise<void> {
    await deps.ddb.delete({ TableName: tabla, Key: claveIdemp(clave) });
  }

  return {
    leerTurnos,
    guardarTurno,
    leerPendiente,
    guardarPendiente,
    borrarPendiente,
    reservarIdemp,
    leerIdemp,
    completarIdemp,
    borrarIdemp,
  };
}

export type Estado = ReturnType<typeof crearEstado>;

// STUB del kit: Lambda del mock de Jira (solo lectura). Rochi reemplaza este contenido con el spec conocimiento-y-acciones.
// No mover ni renombrar: el CDK de infra/ apunta a este archivo.
import type { InvokeRequest, InvokeResult } from '../../comun/contrato';

export async function handler(solicitud: InvokeRequest): Promise<InvokeResult> {
  return {
    correlationId: solicitud.correlationId,
    status: 'UNAVAILABLE',
    origin: 'mock',
    error: { code: 'NOT_IMPLEMENTED', message: 'Conector en construcción', correlationId: solicitud.correlationId },
  };
}

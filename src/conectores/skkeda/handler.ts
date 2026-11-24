// STUB del kit: Lambda del conector de Skkeda. Rochi reemplaza este contenido con el spec conectores-y-conocimiento.
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

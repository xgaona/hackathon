import type { InvokeRequest } from '../../comun/contrato';
import { handler } from './handler';

describe('conector Jira', () => {
  it('devuelve solo las tres tareas abiertas cuando no se indica status', async () => {
    const solicitud: InvokeRequest = {
      correlationId: 'CORR-SYN-1',
      capabilityId: 'jira:issue.search',
      userId: 'SYN-USR-1',
      groups: [],
      params: {},
    };

    const resultado = await handler(solicitud);
    const items = resultado.data?.items as Array<{ status: string }>;

    expect(resultado.status).toBe('OK');
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.status !== 'Hecho')).toBe(true);
  });
});

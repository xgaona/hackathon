import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { InvokeRequest, InvokeResult } from '../../comun/contrato';
import { crearHandler } from './handler';

type Item = Record<string, unknown> & { pk: string; sk: string };

class DynamoEnMemoria {
  private items = new Map<string, Item>();

  constructor(private readonly fallaSiempre = false) {}

  async send(command: unknown): Promise<unknown> {
    if (this.fallaSiempre) throw new Error('detalle sensible de DynamoDB');
    if (command instanceof GetCommand) {
      const key = command.input.Key as { pk: string; sk: string };
      const item = this.items.get(this.clave(key));
      return item === undefined ? {} : { Item: structuredClone(item) };
    }

    if (command instanceof QueryCommand) {
      const valores = command.input.ExpressionAttributeValues as
        | Record<string, unknown>
        | undefined;
      const pk = valores?.[':pk'];
      const sk = valores?.[':sk'];
      const items = [...this.items.values()]
        .filter((item) => item.pk === pk && (sk === undefined || item.sk === sk))
        .map((item) => structuredClone(item));
      return { Items: items };
    }

    if (command instanceof TransactWriteCommand) {
      const operaciones = command.input.TransactItems ?? [];
      for (const operacion of operaciones) {
        const escritura = operacion.Put ?? operacion.Delete;
        if (escritura === undefined) continue;
        const itemONuevaClave = 'Item' in escritura ? escritura.Item : escritura.Key;
        if (itemONuevaClave === undefined) continue;
        const key = itemONuevaClave as { pk: string; sk: string };
        const actual = this.items.get(this.clave(key));
        if (
          !this.cumpleCondicion(
            actual,
            escritura.ConditionExpression,
            escritura.ExpressionAttributeNames,
            escritura.ExpressionAttributeValues,
          )
        ) {
          const error = new Error('Transacción cancelada');
          error.name = 'TransactionCanceledException';
          throw error;
        }
      }

      const siguientes = new Map(this.items);
      for (const operacion of operaciones) {
        if (operacion.Put?.Item !== undefined) {
          const item = structuredClone(operacion.Put.Item) as Item;
          siguientes.set(this.clave(item), item);
        } else if (operacion.Delete?.Key !== undefined) {
          siguientes.delete(this.clave(operacion.Delete.Key as { pk: string; sk: string }));
        }
      }
      this.items = siguientes;
      return {};
    }

    throw new Error('Comando no soportado por el fake');
  }

  cantidadOcupacionesActivas(): number {
    return [...this.items.values()].filter(
      (item) => item.pk.startsWith('SKKEDA#') && item.status === 'ACTIVE',
    ).length;
  }

  private clave(key: { pk: string; sk: string }): string {
    return `${key.pk}|${key.sk}`;
  }

  private cumpleCondicion(
    actual: Item | undefined,
    expresion: string | undefined,
    nombres: Record<string, string> | undefined,
    valores: Record<string, unknown> | undefined,
  ): boolean {
    if (expresion === undefined) return true;
    if (expresion.includes('attribute_not_exists(pk)')) return actual === undefined;
    if (actual === undefined) return false;

    const comparaciones: Array<[string, string]> = [
      [':version', '#version'],
      [':status', '#status'],
      [':code', '#code'],
      [':userId', '#userId'],
    ];
    return comparaciones.every(([valor, alias]) => {
      if (!expresion.includes(`${alias} = ${valor}`)) return true;
      const atributo = nombres?.[alias];
      return atributo !== undefined && actual[atributo] === valores?.[valor];
    });
  }
}

const logger = { error: jest.fn() };

function solicitud(
  params: Record<string, unknown>,
  idempotencyKey: string,
  overrides: Partial<InvokeRequest> = {},
): InvokeRequest {
  return {
    correlationId: 'CORR-SYN-1',
    capabilityId: 'skkeda:booking.create',
    userId: 'SYN-USR-1',
    groups: [],
    params,
    idempotencyKey,
    ...overrides,
  };
}

function alternativas(resultado: InvokeResult): Array<{ resource: string; floor: number }> {
  return resultado.data?.alternatives as Array<{ resource: string; floor: number }>;
}

describe('conector Skkeda', () => {
  beforeEach(() => logger.error.mockClear());

  test('trata P-12 como ocupado y propone primero alternativas del piso 2', async () => {
    const dynamo = new DynamoEnMemoria();
    const handler = crearHandler({ cliente: dynamo, tabla: 'estado-sintetico', logger });

    const resultado = await handler(
      solicitud({ kind: 'puesto', date: '2026-11-26', resource: 'P-12' }, 'IDEMP-SYN-1'),
    );

    expect(resultado.status).toBe('CONFLICT');
    expect(resultado.error?.code).toBe('RESOURCE_TAKEN');
    expect(alternativas(resultado)).toHaveLength(5);
    expect(alternativas(resultado).every((alternativa) => alternativa.floor === 2)).toBe(true);
    expect(alternativas(resultado).map((alternativa) => alternativa.resource)).toEqual([
      'P-1',
      'P-2',
      'P-3',
      'P-4',
      'P-5',
    ]);
    expect(dynamo.cantidadOcupacionesActivas()).toBe(0);
  });

  test('asigna P-15 cuando se solicita el primer puesto libre del piso 3', async () => {
    const dynamo = new DynamoEnMemoria();
    const handler = crearHandler({ cliente: dynamo, tabla: 'estado-sintetico', logger });

    const resultado = await handler(
      solicitud({ kind: 'puesto', date: '2026-11-26', floor: 3 }, 'IDEMP-SYN-2'),
    );

    expect(resultado).toEqual({
      correlationId: 'CORR-SYN-1',
      status: 'OK',
      origin: 'mock',
      data: {
        code: 'BK-SYN-20261126-P15',
        resource: 'P-15',
        floor: 3,
        date: '2026-11-26',
      },
    });
    expect(dynamo.cantidadOcupacionesActivas()).toBe(1);
  });

  test('rechaza una segunda reserva de la persona el mismo día con DAILY_LIMIT', async () => {
    const dynamo = new DynamoEnMemoria();
    const handler = crearHandler({ cliente: dynamo, tabla: 'estado-sintetico', logger });

    const primera = await handler(
      solicitud({ kind: 'puesto', date: '2026-11-26', resource: 'P-1' }, 'IDEMP-SYN-3'),
    );
    const segunda = await handler(
      solicitud({ kind: 'puesto', date: '2026-11-26', resource: 'P-2' }, 'IDEMP-SYN-4'),
    );

    expect(primera.status).toBe('OK');
    expect(segunda.status).toBe('CONFLICT');
    expect(segunda.error?.code).toBe('DAILY_LIMIT');
    expect(segunda.data).toBeUndefined();
    expect(dynamo.cantidadOcupacionesActivas()).toBe(1);
  });

  test('reproduce la misma creación idempotente sin duplicar la reserva', async () => {
    const dynamo = new DynamoEnMemoria();
    const handler = crearHandler({ cliente: dynamo, tabla: 'estado-sintetico', logger });
    const primeraSolicitud = solicitud(
      { kind: 'puesto', date: '2026-11-26', resource: 'P-5' },
      'IDEMP-SYN-5',
    );

    const primera = await handler(primeraSolicitud);
    const repetida = await handler({ ...primeraSolicitud, correlationId: 'CORR-SYN-2' });

    expect(primera.status).toBe('OK');
    expect(repetida.status).toBe('OK');
    expect(repetida.data?.code).toBe(primera.data?.code);
    expect(repetida.correlationId).toBe('CORR-SYN-2');
    expect(dynamo.cantidadOcupacionesActivas()).toBe(1);
  });
});

describe('consistencia del conector Skkeda', () => {
  beforeEach(() => logger.error.mockClear());

  test('impide que dos personas ocupen simultáneamente el mismo puesto', async () => {
    const dynamo = new DynamoEnMemoria();
    const handler = crearHandler({ cliente: dynamo, tabla: 'estado-sintetico', logger });
    const params = { kind: 'puesto', date: '2026-11-27', resource: 'P-6' };

    const resultados = await Promise.all([
      handler(solicitud(params, 'IDEMP-SYN-6', { userId: 'SYN-USR-1' })),
      handler(solicitud(params, 'IDEMP-SYN-7', { userId: 'SYN-USR-2' })),
    ]);

    expect(resultados.map((resultado) => resultado.status).sort()).toEqual(['CONFLICT', 'OK']);
    expect(resultados.find((resultado) => resultado.status === 'CONFLICT')?.error?.code).toBe(
      'RESOURCE_TAKEN',
    );
    expect(dynamo.cantidadOcupacionesActivas()).toBe(1);
  });

  test('impide dos reservas simultáneas de la misma persona para una fecha', async () => {
    const dynamo = new DynamoEnMemoria();
    const handler = crearHandler({ cliente: dynamo, tabla: 'estado-sintetico', logger });

    const resultados = await Promise.all([
      handler(
        solicitud(
          { kind: 'puesto', date: '2026-11-28', resource: 'P-7' },
          'IDEMP-SYN-8',
        ),
      ),
      handler(
        solicitud(
          { kind: 'puesto', date: '2026-11-28', resource: 'P-8' },
          'IDEMP-SYN-9',
        ),
      ),
    ]);

    expect(resultados.map((resultado) => resultado.status).sort()).toEqual(['CONFLICT', 'OK']);
    expect(resultados.find((resultado) => resultado.status === 'CONFLICT')?.error?.code).toBe(
      'DAILY_LIMIT',
    );
    expect(dynamo.cantidadOcupacionesActivas()).toBe(1);
  });

  test('lista, cancela de forma idempotente y libera el puesto', async () => {
    const dynamo = new DynamoEnMemoria();
    const handler = crearHandler({ cliente: dynamo, tabla: 'estado-sintetico', logger });
    const creada = await handler(
      solicitud({ kind: 'puesto', date: '2026-11-29', resource: 'P-9' }, 'IDEMP-SYN-10'),
    );
    const code = creada.data?.code as string;

    const listado = await handler(
      solicitud({}, 'IGNORADA', {
        capabilityId: 'skkeda:booking.list',
        idempotencyKey: undefined,
      }),
    );
    const cancelada = await handler(
      solicitud({ code }, 'IDEMP-SYN-11', { capabilityId: 'skkeda:booking.cancel' }),
    );
    const repetida = await handler(
      solicitud(
        { code },
        'IDEMP-SYN-11',
        { capabilityId: 'skkeda:booking.cancel', correlationId: 'CORR-SYN-3' },
      ),
    );
    const listadoFinal = await handler(
      solicitud({ date: '2026-11-29' }, 'IGNORADA', {
        capabilityId: 'skkeda:booking.list',
        idempotencyKey: undefined,
      }),
    );

    expect(listado.data?.bookings).toEqual([
      { date: '2026-11-29', resource: 'P-9', floor: 2, code },
    ]);
    expect(cancelada.status).toBe('OK');
    expect(repetida.status).toBe('OK');
    expect(repetida.correlationId).toBe('CORR-SYN-3');
    expect(listadoFinal.data?.bookings).toEqual([]);
    expect(dynamo.cantidadOcupacionesActivas()).toBe(0);
  });

  test('rechaza parámetros inválidos antes de consultar DynamoDB', async () => {
    const dynamo = new DynamoEnMemoria(true);
    const handler = crearHandler({ cliente: dynamo, tabla: 'estado-sintetico', logger });

    const resultado = await handler(
      solicitud(
        { kind: 'puesto', date: '2026-02-30', resource: 'P-1', userId: 'inyectado' },
        'IDEMP-SYN-12',
      ),
    );

    expect(resultado.status).toBe('FAILED');
    expect(resultado.error?.code).toBe('INVALID_PARAMETER');
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('sanea fallas de DynamoDB sin registrar detalles sensibles', async () => {
    const dynamo = new DynamoEnMemoria(true);
    const handler = crearHandler({ cliente: dynamo, tabla: 'estado-sintetico', logger });

    const resultado = await handler(
      solicitud({ kind: 'puesto', date: '2026-11-30', resource: 'P-10' }, 'IDEMP-SYN-13'),
    );

    expect(resultado.status).toBe('UNAVAILABLE');
    expect(resultado.error?.code).toBe('SOURCE_UNAVAILABLE');
    expect(logger.error).toHaveBeenCalledWith({
      correlationId: 'CORR-SYN-1',
      capabilityId: 'skkeda:booking.create',
      status: 'UNAVAILABLE',
      code: 'SOURCE_UNAVAILABLE',
    });
  });
});
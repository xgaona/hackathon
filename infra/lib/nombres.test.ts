import { nombre } from './nombres';

describe('nombre', () => {
  it('arma eva-<ambiente>-<recurso> en minúsculas', () => {
    expect(nombre('dev', 'Estado')).toBe('eva-dev-estado');
  });

  it('rechaza nombres de más de 63 caracteres', () => {
    expect(() => nombre('dev', 'x'.repeat(60))).toThrow();
  });
});

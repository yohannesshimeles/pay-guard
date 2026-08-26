import { nestLogLevels } from '../../src/common/nest-log-levels';

describe('nestLogLevels', () => {
  it('maps configured thresholds without enabling noisier levels', () => {
    expect(nestLogLevels('debug')).toEqual(['error', 'warn', 'log', 'debug']);
    expect(nestLogLevels('info')).toEqual(['error', 'warn', 'log']);
    expect(nestLogLevels('warn')).toEqual(['error', 'warn']);
    expect(nestLogLevels('error')).toEqual(['error']);
  });

  it('returns a new array so callers cannot mutate policy', () => {
    const first = nestLogLevels('info');
    first.length = 0;
    expect(nestLogLevels('info')).toEqual(['error', 'warn', 'log']);
  });
});

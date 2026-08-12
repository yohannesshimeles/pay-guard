import { CorrelationMiddleware } from '../../src/common/correlation.middleware';
import { requestContext } from '../../src/common/request-context';

describe('CorrelationMiddleware', () => {
  const middleware = new CorrelationMiddleware();

  it('accepts a safe caller correlation ID', (done) => {
    const response = { setHeader: jest.fn() };
    middleware.use(
      { headers: { 'x-correlation-id': 'test-request-1234' } } as never,
      response as never,
      () => {
        expect(response.setHeader).toHaveBeenCalledWith(
          'x-correlation-id',
          'test-request-1234',
        );
        expect(requestContext.getStore()?.correlationId).toBe('test-request-1234');
        done();
      },
    );
  });

  it('replaces an unsafe correlation ID', (done) => {
    const setHeader = jest.fn<void, [string, string]>();
    const response = { setHeader };
    middleware.use(
      { headers: { 'x-correlation-id': '<script>' } } as never,
      response as never,
      () => {
        const generated = setHeader.mock.calls[0]?.[1];
        expect(generated).toMatch(/^[0-9a-f-]{36}$/);
        done();
      },
    );
  });
});

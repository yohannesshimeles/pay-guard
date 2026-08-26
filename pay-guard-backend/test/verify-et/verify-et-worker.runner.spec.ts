import { AppConfig } from '../../src/config/app-config';
import { MetricsService } from '../../src/observability/metrics.service';
import { VerifyEtWorkerRunner } from '../../src/verify-et/verify-et-worker.runner';
import { VerifyEtWorkerService } from '../../src/verify-et/verify-et-worker.service';

describe('VerifyEtWorkerRunner', () => {
  const processNext = jest.fn();
  const resultInc = jest.fn();
  const failureInc = jest.fn();
  const metrics = { workerResults: { inc: resultInc },
    workerTickFailures: { inc: failureInc } } as unknown as MetricsService;

  beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
  afterEach(() => jest.useRealTimers());

  it('drains enabled pending work and records sanitized outcomes', async () => {
    processNext.mockResolvedValueOnce({ status: 'DEFERRED' })
      .mockResolvedValueOnce({ status: 'IDLE' });
    const runner = new VerifyEtWorkerRunner(
      { processNext } as unknown as VerifyEtWorkerService, metrics,
      { verifyEt: { enabled: true }, notificationWorkerPollMs: 2_000 } as AppConfig,
    );
    runner.onApplicationBootstrap();
    await jest.runOnlyPendingTimersAsync();
    runner.onApplicationShutdown();

    expect(processNext).toHaveBeenCalledTimes(2);
    expect(processNext).toHaveBeenCalledWith(expect.stringMatching(/^verifyet:/u));
    expect(resultInc).toHaveBeenCalledWith(
      { worker: 'verify_et', outcome: 'DEFERRED' },
    );
  });

  it('does not claim provider work while the integration is disabled', async () => {
    const runner = new VerifyEtWorkerRunner(
      { processNext } as unknown as VerifyEtWorkerService, metrics,
      { verifyEt: { enabled: false }, notificationWorkerPollMs: 2_000 } as AppConfig,
    );
    runner.onApplicationBootstrap();
    await jest.runOnlyPendingTimersAsync();
    expect(processNext).not.toHaveBeenCalled();
  });
});

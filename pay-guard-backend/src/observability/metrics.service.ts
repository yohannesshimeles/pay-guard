import { Injectable } from '@nestjs/common';
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpRequests = new Counter({
    name: 'payguard_http_requests_total',
    help: 'HTTP requests processed by PayGuard',
    labelNames: ['method', 'route', 'status'],
    registers: [this.registry],
  });
  readonly httpDuration = new Histogram({
    name: 'payguard_http_request_duration_seconds',
    help: 'PayGuard HTTP request duration',
    labelNames: ['method', 'route', 'status'],
    registers: [this.registry],
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 3, 5],
  });
  readonly rateLimitDecisions = new Counter({
    name: 'payguard_rate_limit_decisions_total',
    help: 'Application rate-limit decisions by policy and outcome',
    labelNames: ['policy', 'outcome'],
    registers: [this.registry],
  });
  readonly rateLimitStoreErrors = new Counter({
    name: 'payguard_rate_limit_store_errors_total',
    help: 'Redis errors encountered while enforcing application rate limits',
    labelNames: ['policy'],
    registers: [this.registry],
  });
  readonly workerResults = new Counter({
    name: 'payguard_worker_results_total',
    help: 'Durable worker results by worker and sanitized outcome',
    labelNames: ['worker', 'outcome'],
    registers: [this.registry],
  });
  readonly workerTickFailures = new Counter({
    name: 'payguard_worker_tick_failures_total',
    help: 'Unhandled durable worker tick failures by worker',
    labelNames: ['worker'],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({
      register: this.registry,
      prefix: 'payguard_',
    });
  }
}

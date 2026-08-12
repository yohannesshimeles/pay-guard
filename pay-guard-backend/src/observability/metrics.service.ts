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

  constructor() {
    collectDefaultMetrics({
      register: this.registry,
      prefix: 'payguard_',
    });
  }
}

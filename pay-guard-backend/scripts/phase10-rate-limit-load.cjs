const { performance } = require('node:perf_hooks');
const { RedisService } = require('../dist/redis/redis.service');
const { RateLimitService } = require('../dist/security/rate-limit.service');
const { RateLimitGuard } = require('../dist/security/rate-limit.guard');

const redisUrl = process.env.RATE_LIMIT_EXERCISE_REDIS_URL ??
  'redis://127.0.0.1:6379/15';
const config = {
  redisUrl,
  rateLimit: { enabled: true, windowMs: 60_000,
    authMax: 10, uploadMax: 20, globalMax: 300 },
};
const policies = {
  auth: { name: 'auth', limit: 10, failClosed: true },
  upload: { name: 'upload', limit: 20, failClosed: true },
  global: { name: 'global', limit: 300, failClosed: false },
};

async function main() {
  const redisServices = Array.from({ length: 4 }, () => new RedisService(config));
  const limiters = redisServices.map((redis) => new RateLimitService(config, redis));
  const cleanupAddresses = new Set();
  try {
    if (!await redisServices[0].isReady()) {
      throw new Error('Rate-limit exercise Redis is unavailable');
    }
    const boundary = {};
    for (const policy of Object.values(policies)) {
      const address = uniqueAddress(`boundary-${policy.name}`);
      cleanupAddresses.add(address);
      const results = await timedConcurrent(policy.limit + 1, (index) =>
        limiters[index % limiters.length].consume(policy, address));
      boundary[policy.name] = summarize(results);
      assertBoundary(policy, results);
    }

    const replicaAddress = uniqueAddress('replica-shared');
    cleanupAddresses.add(replicaAddress);
    const replicaResults = await timedConcurrent(301, (index) =>
      limiters[index % limiters.length].consume(policies.global, replicaAddress));
    assertBoundary(policies.global, replicaResults);

    const mobileAddresses = Array.from({ length: 100 }, (_, index) =>
      uniqueAddress(`mobile-${index}`));
    mobileAddresses.forEach((address) => cleanupAddresses.add(address));
    const mobileResults = await timedConcurrent(1_000, (index) =>
      limiters[index % limiters.length].consume(
        policies.auth, mobileAddresses[index % mobileAddresses.length],
      ));
    if (mobileResults.some((sample) => !sample.decision.allowed)) {
      throw new Error('Independent mobile clients shared rate-limit state');
    }

    const natAddress = uniqueAddress('shared-nat');
    cleanupAddresses.add(natAddress);
    const natResults = await timedConcurrent(50, (index) =>
      limiters[index % limiters.length].consume(policies.auth, natAddress));
    if (natResults.filter((sample) => sample.decision.allowed).length !== 10) {
      throw new Error('Shared-NAT auth threshold did not match policy');
    }

    await assertNoRawAddresses(redisServices[0], cleanupAddresses);
    await cleanup(redisServices[0], cleanupAddresses);
    const outage = await exerciseOutage(redisServices[0]);

    process.stdout.write(JSON.stringify({ redisUrl: redactRedisUrl(redisUrl),
      replicas: limiters.length, boundary,
      replicaGlobal: summarize(replicaResults),
      independentMobile: summarize(mobileResults),
      sharedNatAuth: summarize(natResults), outage }, null, 2) + '\n');
  } finally {
    await Promise.all(redisServices.map(async (redis) => {
      if (redis.client.status !== 'end') redis.client.disconnect();
    }));
  }
}

async function timedConcurrent(count, work) {
  const started = performance.now();
  const samples = await Promise.all(Array.from({ length: count }, async (_, index) => {
    const sampleStarted = performance.now();
    const decision = await work(index);
    return { decision, latencyMs: performance.now() - sampleStarted };
  }));
  samples.elapsedMs = performance.now() - started;
  return samples;
}

function summarize(samples) {
  const latencies = samples.map((sample) => sample.latencyMs)
    .sort((left, right) => left - right);
  return { requests: samples.length,
    allowed: samples.filter((sample) => sample.decision.allowed).length,
    blocked: samples.filter((sample) => !sample.decision.allowed).length,
    elapsedMs: Number(samples.elapsedMs.toFixed(2)),
    p50Ms: percentile(latencies, 0.50), p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99) };
}

function percentile(values, fraction) {
  return Number(values[Math.min(values.length - 1,
    Math.ceil(values.length * fraction) - 1)].toFixed(2));
}

function assertBoundary(policy, results) {
  const allowed = results.filter((sample) => sample.decision.allowed).length;
  if (allowed !== policy.limit || results.length - allowed !== 1) {
    throw new Error(`${policy.name} quota was not atomic at its exact boundary`);
  }
}

async function assertNoRawAddresses(redis, addresses) {
  let cursor = '0';
  do {
    const [next, keys] = await redis.client.scan(cursor, 'MATCH',
      'payguard:rate-limit:*', 'COUNT', '1000');
    cursor = next;
    const joined = keys.join(' ');
    for (const address of addresses) {
      if (joined.includes(address)) throw new Error('Raw client address reached Redis');
    }
  } while (cursor !== '0');
}

async function cleanup(redis, addresses) {
  const { createHash } = require('node:crypto');
  const keys = [];
  for (const address of addresses) {
    const hash = createHash('sha256').update(address).digest('hex');
    for (const policy of Object.values(policies)) {
      keys.push(`payguard:rate-limit:${policy.name}:${hash}`);
    }
  }
  for (let offset = 0; offset < keys.length; offset += 500) {
    await redis.client.del(...keys.slice(offset, offset + 500));
  }
}

async function exerciseOutage(redis) {
  redis.client.disconnect();
  const limiter = new RateLimitService(config, redis);
  const decisions = [];
  const errors = [];
  const guard = new RateLimitGuard(config, limiter, {
    rateLimitDecisions: { inc: (labels) => decisions.push(labels) },
    rateLimitStoreErrors: { inc: (labels) => errors.push(labels) },
  });
  const authStatus = await invokeGuard(guard, '/api/v1/auth/login');
  const globalStatus = await invokeGuard(guard, '/api/v1/transactions');
  if (authStatus !== 503 || globalStatus !== 200 ||
      !decisions.some((item) => item.outcome === 'store_bypass')) {
    throw new Error('Redis outage policy did not fail closed/open as configured');
  }
  return { authStatus, globalStatus, storeErrors: errors.length,
    globalBypassRecorded: true };
}

async function invokeGuard(guard, url) {
  const context = { switchToHttp: () => ({
    getRequest: () => ({ url, ip: uniqueAddress('outage') }),
    getResponse: () => ({ header: () => undefined }),
  }) };
  try { await guard.canActivate(context); return 200; }
  catch (error) { return error.getStatus?.() ?? 500; }
}

function uniqueAddress(label) {
  return `198.51.100.${process.pid}-${label}`;
}

function redactRedisUrl(value) {
  const parsed = new URL(value);
  parsed.username = '';
  parsed.password = '';
  return parsed.toString();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`);
  process.exitCode = 1;
});

import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestContext = {
  correlationId: string;
};

export const requestContext = new AsyncLocalStorage<RequestContext>();

import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { REQUIRED_ROLES } from '../../src/auth/roles.decorator';

type Constructor = new (...args: never[]) => object;
type Route = {
  controller: string;
  method: string;
  path: string;
  guards: string[];
  roles: string[];
  implementation: string;
};

  const publicMethods = new Set([
    'VerifyEtWebhookController.receive',
  'AuthController.login',
  'AuthController.refresh',
  'AuthController.logout',
  'BusinessesController.register',
  'HealthController.live',
  'HealthController.ready',
  'HealthController.getMetrics',
]);
const requireModule = createRequire(__filename);

describe('complete controller RBAC and IDOR surface', () => {
  const routes = discoverRoutes();

  it('discovers every backend route and keeps the public allowlist exact', () => {
    expect(routes.length).toBeGreaterThanOrEqual(70);
    const discoveredPublic = routes
      .filter((route) => !route.guards.includes('AuthGuard'))
      .map((route) => `${route.controller}.${route.method}`);
    expect(new Set(discoveredPublic)).toEqual(publicMethods);
  });

  it('requires authentication for every non-public route', () => {
    const unguarded = routes.filter((route) =>
      !publicMethods.has(`${route.controller}.${route.method}`) &&
      !route.guards.includes('AuthGuard'),
    );
    expect(unguarded).toEqual([]);
  });

  it('requires RolesGuard wherever role metadata is declared', () => {
    const missing = routes.filter((route) =>
      route.roles.length > 0 && !route.guards.includes('RolesGuard'),
    );
    expect(missing).toEqual([]);
  });

  it('passes an authenticated principal into every protected identifier route', () => {
    const missingScope = routes.filter((route) =>
      route.guards.includes('AuthGuard') && route.path.includes(':') &&
      !/\b(?:actor|principal|user)\b/u.test(route.implementation),
    );
    expect(missingScope).toEqual([]);
  });

  it('does not expose a protected identifier route using role-only authorization', () => {
    const roleOnly = routes.filter((route) =>
      route.path.includes(':') && route.guards.includes('RolesGuard') &&
      !route.guards.includes('AuthGuard'),
    );
    expect(roleOnly).toEqual([]);
  });
});

function discoverRoutes(): Route[] {
  const sourceRoot = join(__dirname, '..', '..', 'src');
  const controllerFiles = walk(sourceRoot)
    .filter((file) => file.endsWith('.controller.ts'));
  const routes: Route[] = [];
  for (const file of controllerFiles) {
    const moduleExports = requireModule(file) as Record<string, unknown>;
    for (const exported of Object.values(moduleExports)) {
      if (typeof exported !== 'function') continue;
      const controller = exported as Constructor;
      const classPath = Reflect.getMetadata(PATH_METADATA, controller) as
        string | undefined;
      if (classPath === undefined) continue;
      const classGuards = guardNames(Reflect.getMetadata(GUARDS_METADATA, controller));
      const classRoles = roles(Reflect.getMetadata(REQUIRED_ROLES, controller));
      for (const method of Object.getOwnPropertyNames(controller.prototype)) {
        if (method === 'constructor') continue;
        const handler = (controller.prototype as Record<string, unknown>)[method];
        if (typeof handler !== 'function') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as
          string | undefined;
        routes.push({
          controller: controller.name,
          method,
          path: [classPath, methodPath ?? ''].filter(Boolean).join('/'),
          guards: [...classGuards,
            ...guardNames(Reflect.getMetadata(GUARDS_METADATA, handler))],
          roles: roles(Reflect.getMetadata(REQUIRED_ROLES, handler)).length > 0
            ? roles(Reflect.getMetadata(REQUIRED_ROLES, handler)) : classRoles,
          implementation: handler.toString(),
        });
      }
    }
  }
  return routes;
}

function guardNames(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((guard: { name?: string }) => guard.name ?? 'anonymous') : [];
}

function roles(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value : [];
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from '../app.module';
import { configureApplication } from '../bootstrap';
import { loadConfig } from '../config/app-config';
import { createApiDocument } from './api-documentation';
import { createPostmanCollection } from './postman-collection';

async function main(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(loadConfig()),
    new FastifyAdapter(),
    { logger: false, preview: true },
  );
  configureApplication(app, { exposeDocumentation: false });

  const document = createApiDocument(app);
  const outputs = [
    {
      file: resolve('docs/api/openapi.json'),
      value: document,
    },
    {
      file: resolve('postman/PayGuard.postman_collection.json'),
      value: createPostmanCollection(document),
    },
  ];
  const check = process.argv.includes('--check');
  let stale = false;

  for (const output of outputs) {
    const content = `${JSON.stringify(output.value, null, 2)}\n`;
    if (check) {
      const existing = existsSync(output.file)
        ? readFileSync(output.file, 'utf8')
        : '';
      if (existing !== content) {
        console.error(`API documentation is stale: ${output.file}`);
        stale = true;
      }
      continue;
    }
    mkdirSync(dirname(output.file), { recursive: true });
    writeFileSync(output.file, content);
    console.log(`Exported ${output.file}`);
  }

  await app.close();
  if (stale) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

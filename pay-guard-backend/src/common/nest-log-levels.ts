import { LogLevel } from '@nestjs/common';
import { AppConfig } from '../config/app-config';

const levels: Record<AppConfig['logLevel'], LogLevel[]> = {
  debug: ['error', 'warn', 'log', 'debug'],
  info: ['error', 'warn', 'log'],
  warn: ['error', 'warn'],
  error: ['error'],
};

export function nestLogLevels(level: AppConfig['logLevel']): LogLevel[] {
  return [...levels[level]];
}

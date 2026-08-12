import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { requestContext } from './request-context';

export type ApiSuccess<T> = {
  success: true;
  message: string;
  data: T;
  correlationId: string;
};

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiSuccess<T>>
{
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T>> {
    return next.handle().pipe(
      map((data) => ({
        success: true,
        message: 'Request completed successfully',
        data,
        correlationId: requestContext.getStore()?.correlationId ?? 'unknown',
      })),
    );
  }
}

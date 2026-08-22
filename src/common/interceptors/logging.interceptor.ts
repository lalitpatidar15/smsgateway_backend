import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const now = Date.now();
    const { method, url } = request;
    const requestId = request.requestId;

    return next.handle().pipe(
      tap(() => {
        const elapsed = Date.now() - now;
        console.log(`[${requestId}] ${method} ${url} - ${elapsed}ms`);
      }),
    );
  }
}

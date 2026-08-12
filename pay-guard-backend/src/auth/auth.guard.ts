import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { AuthFacadeService } from './auth-facade.service';
import { AuthenticatedPrincipal } from './auth.types';

export type AuthenticatedRequest = FastifyRequest & {
  user: AuthenticatedPrincipal;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthFacadeService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Bearer access token is required');
    }
    request.user = await this.auth.verifyAccessToken(token);
    return true;
  }
}

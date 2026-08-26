import {
  BadRequestException,
  ConflictException,
  Controller,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { VerifyEtWebhookIntakeService } from './verify-et-webhook-intake.service';
import {
  VerifyEtWebhookSignatureInvalidError,
  VerifyEtWebhookSignatureUnavailableError,
} from './verify-et-webhook-signature-verifier';
import { VerifyEtWebhookDeliveryConflictError } from './verify-et-webhook-delivery.dao';

type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

@ApiTags('Verify.ET Webhooks')
@Controller('webhooks/verify-et')
export class VerifyEtWebhookController {
  constructor(private readonly intake: VerifyEtWebhookIntakeService) {}

  @Post()
  @ApiOperation({ summary: 'Receive a signed Verify.ET verification webhook' })
  @ApiHeader({ name: 'X-Webhook-Timestamp', required: true })
  @ApiHeader({ name: 'X-Webhook-Signature', required: true })
  @ApiHeader({ name: 'X-Webhook-Delivery-Id', required: true })
  @ApiHeader({ name: 'X-Webhook-Event', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: true,
      example: {
        event: 'verification.completed',
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-02-20T12:00:02.500Z',
        data: { processingStatus: 'completed', status: 'success', verified: true },
      },
    },
  })
  async receive(@Req() request: RawBodyRequest) {
    if (!request.rawBody) {
      throw new BadRequestException('Verify.ET webhook raw body is unavailable');
    }
    let accepted: Awaited<ReturnType<VerifyEtWebhookIntakeService['accept']>>;
    try {
      accepted = await this.intake.accept(request.rawBody, request.headers);
    } catch (error) {
      if (error instanceof VerifyEtWebhookSignatureInvalidError) {
        throw new UnauthorizedException('Verify.ET webhook signature is invalid');
      }
      if (error instanceof VerifyEtWebhookSignatureUnavailableError) {
        throw new ServiceUnavailableException(
          'Verify.ET webhook verification is unavailable',
        );
      }
      if (error instanceof VerifyEtWebhookDeliveryConflictError) {
        throw new ConflictException('Verify.ET webhook delivery conflicts with prior content');
      }
      throw error;
    }
    return {
      accepted: true,
      duplicate: accepted.duplicate,
      deliveryId: accepted.delivery.deliveryId,
    };
  }
}

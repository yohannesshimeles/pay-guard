import {
  BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe,
  PayloadTooLargeException, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DEFAULT_MAX_PROOF_BYTES } from '../qr-processing/proof-file.validator';
import { CreateSubscriptionPurchaseDto, ListSubscriptionPurchasesDto } from './dto/subscription-purchase.dto';
import { SubscriptionPurchaseService } from './subscription-purchase.service';
import { SubscriptionVerificationService } from './subscription-verification.service';

type MultipartPart = { fieldname: string; filename: string; mimetype: string;
  toBuffer(): Promise<Buffer> };
type MultipartRequest = { file(options: { limits: {
  fileSize: number; files: number; fields: number; parts: number;
} }): Promise<MultipartPart | undefined> };

@ApiTags('Subscriptions')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller()
export class SubscriptionPurchaseController {
  constructor(
    private readonly subscriptions: SubscriptionPurchaseService,
    private readonly verifications: SubscriptionVerificationService,
  ) {}

  @Get('subscription-plans')
  @Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER')
  plans(@CurrentUser() actor: AuthenticatedPrincipal) {
    return this.subscriptions.listPlans(actor);
  }

  @Post('businesses/:businessId/branches/:branchId/subscription-purchases')
  @Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER')
  create(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() input: CreateSubscriptionPurchaseDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) { return this.subscriptions.create(businessId, branchId, input, actor); }

  @Get('businesses/:businessId/branches/:branchId/subscription-purchases')
  @Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER')
  list(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Query() input: ListSubscriptionPurchasesDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) { return this.subscriptions.list(businessId, branchId, input, actor); }

  @Get('businesses/:businessId/branches/:branchId/subscription-purchases/:purchaseId')
  @Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER')
  require(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('purchaseId', new ParseUUIDPipe()) purchaseId: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) { return this.subscriptions.require(businessId, branchId, purchaseId, actor); }

  @Post('businesses/:businessId/branches/:branchId/subscription-purchases/:purchaseId/proof')
  @Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER')
  @ApiConsumes('multipart/form-data')
  async proof(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('purchaseId', new ParseUUIDPipe()) purchaseId: string,
    @Req() request: MultipartRequest,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    const part = await this.readPart(request);
    return this.subscriptions.uploadProof(businessId, branchId, purchaseId, actor, {
      fileName: part.filename, mimeType: part.mimetype,
      body: await this.readBody(part),
    });
  }

  @Post('businesses/:businessId/branches/:branchId/subscription-purchases/:purchaseId/verify')
  @Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER')
  verify(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('purchaseId', new ParseUUIDPipe()) purchaseId: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) { return this.verifications.verify(businessId, branchId, purchaseId, actor); }

  private async readPart(request: MultipartRequest): Promise<MultipartPart> {
    try {
      const part = await request.file({ limits: {
        fileSize: DEFAULT_MAX_PROOF_BYTES, files: 1, fields: 0, parts: 1,
      }});
      if (!part) throw new BadRequestException('A payment proof file is required');
      if (part.fieldname !== 'proof') {
        throw new BadRequestException('The file field must be named proof');
      }
      return part;
    } catch (error) { this.rethrowMultipart(error); }
  }

  private async readBody(part: MultipartPart): Promise<Buffer> {
    try { return await part.toBuffer(); }
    catch (error) { this.rethrowMultipart(error); }
  }

  private rethrowMultipart(error: unknown): never {
    if (error instanceof BadRequestException) throw error;
    if (typeof error === 'object' && error !== null && 'statusCode' in error &&
        Number(error.statusCode) === 413) {
      throw new PayloadTooLargeException('Payment proof exceeds the size limit');
    }
    throw new BadRequestException('Invalid multipart payment proof upload');
  }
}

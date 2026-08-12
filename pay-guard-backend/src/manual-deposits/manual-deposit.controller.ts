import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DEFAULT_MAX_PROOF_BYTES } from '../qr-processing/proof-file.validator';
import { CreateManualDepositDto, ListManualDepositsDto } from './dto/manual-deposit.dto';
import { ManualDepositAttachmentService } from './manual-deposit-attachment.service';
import { ManualDepositService } from './manual-deposit.service';

type MultipartPart = {
  fieldname: string;
  filename: string;
  mimetype: string;
  toBuffer(): Promise<Buffer>;
};
type MultipartRequest = {
  file(options: {
    limits: { fileSize: number; files: number; fields: number; parts: number };
  }): Promise<MultipartPart | undefined>;
};

@ApiTags('Manual Deposits')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('businesses/:businessId/branches/:branchId/manual-deposits')
export class ManualDepositController {
  constructor(
    private readonly deposits: ManualDepositService,
    private readonly attachments: ManualDepositAttachmentService,
  ) {}

  @Post()
  @Roles('CASHIER')
  create(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() input: CreateManualDepositDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.deposits.create(businessId, branchId, input, actor);
  }

  @Get()
  @Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER', 'CASHIER')
  list(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Query() input: ListManualDepositsDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.deposits.list(businessId, branchId, input, actor);
  }

  @Get(':depositId')
  @Roles('BUSINESS_OWNER', 'PRIMARY_OWNER', 'ADDITIONAL_OWNER', 'MANAGER', 'CASHIER')
  require(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('depositId', new ParseUUIDPipe()) depositId: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.deposits.require(businessId, branchId, depositId, actor);
  }

  @Post(':depositId/attachment')
  @Roles('CASHIER')
  @ApiConsumes('multipart/form-data')
  async attach(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('depositId', new ParseUUIDPipe()) depositId: string,
    @Req() request: MultipartRequest,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    const part = await this.readPart(request);
    return this.attachments.upload(businessId, branchId, depositId, actor, {
      fileName: part.filename,
      mimeType: part.mimetype,
      body: await this.readBody(part),
    });
  }

  private async readPart(request: MultipartRequest): Promise<MultipartPart> {
    try {
      const part = await request.file({
        limits: {
          fileSize: DEFAULT_MAX_PROOF_BYTES,
          files: 1,
          fields: 0,
          parts: 1,
        },
      });
      if (!part) throw new BadRequestException('An attachment file is required');
      if (part.fieldname !== 'attachment') {
        throw new BadRequestException('The file field must be named attachment');
      }
      return part;
    } catch (error) {
      this.rethrowMultipart(error);
    }
  }

  private async readBody(part: MultipartPart): Promise<Buffer> {
    try {
      return await part.toBuffer();
    } catch (error) {
      this.rethrowMultipart(error);
    }
  }

  private rethrowMultipart(error: unknown): never {
    if (error instanceof BadRequestException) throw error;
    if (
      typeof error === 'object' && error !== null && 'statusCode' in error &&
      Number(error.statusCode) === 413
    ) {
      throw new PayloadTooLargeException('Attachment exceeds the size limit');
    }
    throw new BadRequestException('Invalid multipart attachment upload');
  }
}

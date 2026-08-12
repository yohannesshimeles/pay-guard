import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';

@Injectable()
export class PasswordService {
  hash(value: string): Promise<string> {
    return hash(value, 12);
  }

  verify(value: string, digest: string): Promise<boolean> {
    return compare(value, digest);
  }
}

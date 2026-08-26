const { createCipheriv, createDecipheriv, randomBytes, scryptSync } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');

const [operation, inputPath, outputPath] = process.argv.slice(2);
const secret = process.env.PHASE9_BACKUP_ENCRYPTION_KEY;
if (!['encrypt', 'decrypt'].includes(operation) || !inputPath || !outputPath) {
  throw new Error('Usage: phase9-backup-crypto.cjs encrypt|decrypt input output');
}
if (typeof secret !== 'string' || secret.length < 32) {
  throw new Error('PHASE9_BACKUP_ENCRYPTION_KEY must contain at least 32 characters');
}

const magic = Buffer.from('PGBKP001');
if (operation === 'encrypt') {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', scryptSync(secret, salt, 32), iv);
  const ciphertext = Buffer.concat([cipher.update(readFileSync(inputPath)), cipher.final()]);
  writeFileSync(outputPath, Buffer.concat([
    magic, salt, iv, cipher.getAuthTag(), ciphertext,
  ]), { mode: 0o600 });
} else {
  const encrypted = readFileSync(inputPath);
  if (encrypted.byteLength < 52 || !encrypted.subarray(0, 8).equals(magic)) {
    throw new Error('Encrypted backup format is invalid');
  }
  const salt = encrypted.subarray(8, 24);
  const iv = encrypted.subarray(24, 36);
  const tag = encrypted.subarray(36, 52);
  const decipher = createDecipheriv('aes-256-gcm', scryptSync(secret, salt, 32), iv);
  decipher.setAuthTag(tag);
  writeFileSync(outputPath, Buffer.concat([
    decipher.update(encrypted.subarray(52)), decipher.final(),
  ]), { mode: 0o600 });
}

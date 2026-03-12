import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import logger from '../config/logger';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;      // GCM recommended IV size
const TAG_LENGTH = 16;     // Auth tag length
const PREFIX = 'enc:';     // Marker to distinguish encrypted vs plaintext values

/**
 * Returns 32-byte key from env. Returns null if not configured.
 */
function getKey(): Buffer | null {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) return null;

  // Accept hex (64 chars) or base64 (44 chars) encoded 32-byte key
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length === 32) return buf;

  logger.warn('CREDENTIAL_ENCRYPTION_KEY is set but invalid length — encryption disabled');
  return null;
}

/**
 * Encrypt a plaintext string. Returns `enc:<iv>:<tag>:<ciphertext>` (all hex).
 * If no key is configured, returns the value as-is (plaintext fallback).
 */
export function encryptCredential(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a credential value. Handles both encrypted (`enc:...`) and legacy plaintext.
 */
export function decryptCredential(value: string): string {
  if (!value.startsWith(PREFIX)) return value; // legacy plaintext — pass through

  const key = getKey();
  if (!key) {
    throw new Error('Encrypted credential found but CREDENTIAL_ENCRYPTION_KEY is not set');
  }

  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Malformed encrypted credential');

  const [ivHex, tagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

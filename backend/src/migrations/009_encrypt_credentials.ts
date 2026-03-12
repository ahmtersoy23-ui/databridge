/**
 * One-time migration: encrypt existing plaintext credentials.
 *
 * Usage:
 *   CREDENTIAL_ENCRYPTION_KEY=<hex-or-base64> npx tsx src/migrations/009_encrypt_credentials.ts
 *
 * Safe to re-run: skips values already encrypted (prefixed with "enc:").
 */
import dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import { encryptCredential } from '../utils/crypto';

async function main() {
  if (!process.env.CREDENTIAL_ENCRYPTION_KEY) {
    console.error('ERROR: CREDENTIAL_ENCRYPTION_KEY env var is required');
    process.exit(1);
  }

  const dbPool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    // Wisersell password
    const ws = await dbPool.query('SELECT id, password FROM wisersell_credentials WHERE id = 1');
    if (ws.rows.length && ws.rows[0].password && !ws.rows[0].password.startsWith('enc:')) {
      const encrypted = encryptCredential(ws.rows[0].password);
      await dbPool.query('UPDATE wisersell_credentials SET password = $1 WHERE id = 1', [encrypted]);
      console.log('✓ Wisersell password encrypted');
    } else {
      console.log('⊘ Wisersell password — already encrypted or not configured');
    }

    // Wayfair client_secret
    const wf = await dbPool.query('SELECT id, client_secret FROM wayfair_credentials WHERE id = 1');
    if (wf.rows.length && wf.rows[0].client_secret && !wf.rows[0].client_secret.startsWith('enc:')) {
      const encrypted = encryptCredential(wf.rows[0].client_secret);
      await dbPool.query('UPDATE wayfair_credentials SET client_secret = $1 WHERE id = 1', [encrypted]);
      console.log('✓ Wayfair client_secret encrypted');
    } else {
      console.log('⊘ Wayfair client_secret — already encrypted or not configured');
    }

    console.log('\nMigration complete.');
  } finally {
    await dbPool.end();
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

import { Pool } from 'pg';
import logger from './logger';
import {
  DB_MAX_CONNECTIONS,
  DB_IDLE_TIMEOUT_MS,
  DB_CONNECTION_TIMEOUT_MS,
  SHARED_DB_MAX_CONNECTIONS,
} from './constants';

// DataBridge own database
export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'databridge_db',
  user: process.env.DB_USER || 'databridge',
  password: process.env.DB_PASSWORD,
  max: DB_MAX_CONNECTIONS,
  idleTimeoutMillis: DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
});

pool.on('error', (err: Error) => {
  logger.error('[DB] databridge_db idle client error:', err.message);
  if (err.message.includes('password authentication failed') ||
      (err.message.includes('database') && err.message.includes('does not exist'))) {
    process.exit(1);
  }
});

// Shared database (pricelab_db) - read-only for sku_master
export const sharedPool = new Pool({
  host: process.env.SHARED_DB_HOST || process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.SHARED_DB_PORT || process.env.DB_PORT || '5432'),
  database: process.env.SHARED_DB_NAME || 'pricelab_db',
  user: process.env.SHARED_DB_USER || process.env.DB_USER || 'pricelab',
  password: process.env.SHARED_DB_PASSWORD || process.env.DB_PASSWORD,
  max: SHARED_DB_MAX_CONNECTIONS,
  idleTimeoutMillis: DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
});

sharedPool.on('error', (err: Error) => {
  logger.error('[DB] pricelab_db (shared) idle client error:', err.message);
});

export async function checkConnections(): Promise<void> {
  const dbClient = await pool.connect();
  logger.info('[DB] databridge_db connection OK');
  dbClient.release();

  const sharedClient = await sharedPool.connect();
  logger.info('[DB] pricelab_db (shared) connection OK');
  sharedClient.release();
}

export async function closePools(): Promise<void> {
  await Promise.all([
    pool.end().then(() => logger.info('[DB] databridge_db pool closed')),
    sharedPool.end().then(() => logger.info('[DB] pricelab_db pool closed')),
  ]);
}

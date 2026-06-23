import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

export async function setupTestDb() {
  const dbName = `pocmcpserver_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const baseUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/postgres';
  const adminPool = new Pool({ connectionString: baseUrl });

  try {
    await adminPool.query(`CREATE DATABASE ${dbName}`);
  } catch (error) {
    await adminPool.end();
    throw error;
  }
  await adminPool.end();

  const testDbUrl = baseUrl.replace(/\/[^/]*$/, `/${dbName}`);
  process.env.TEST_ADMIN_DATABASE_URL = baseUrl;
  process.env.DATABASE_URL = testDbUrl;
  process.env.START_SERVER = 'false'; // Prevent server from starting on import

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.join(__dirname, '../../schema.sql');
  const seedPath = path.join(__dirname, '../../seed-data.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const seed = fs.readFileSync(seedPath, 'utf8');

  const pool = new Pool({ connectionString: testDbUrl });
  try {
    await pool.query(schema);
    await pool.query(seed);
  } catch (error) {
    await pool.end();
    throw error;
  }
  await pool.end();

  // Import the main module (which will run migration and seed again, but that's OK)
  const {
    pool: mainPool,
    createFplMcpServer,
    ...handlers
  } = await import('../index.js');

  return { dbName, testDbUrl, mainPool, createFplMcpServer, handlers };
}

export async function teardownTestDb(dbName: string, mainPool?: any) {
  // Close the main pool first to release connections
  if (mainPool) {
    await mainPool.end();
  }

  const adminDatabaseUrl = process.env.TEST_ADMIN_DATABASE_URL || 'postgresql://localhost:5432/postgres';
  const adminPool = new Pool({ connectionString: adminDatabaseUrl });

  try {
    // Terminate all connections to the database
    await adminPool.query(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = $1
      AND pid <> pg_backend_pid()
    `, [dbName]);

    await adminPool.query(`DROP DATABASE ${dbName}`);
  } catch (error) {
    console.error('Error dropping test database:', error);
  } finally {
    await adminPool.end();
    delete process.env.TEST_ADMIN_DATABASE_URL;
  }
}

import pg from 'pg';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getDatabaseUrl = () => {
  const rawUrl = process.env.DATABASE_URL ?? "";
  if (!rawUrl) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    const sslMode = parsed.searchParams.get("sslmode");
    const usesLegacySslMode = sslMode === "prefer" || sslMode === "require" || sslMode === "verify-ca";
    if (usesLegacySslMode && !parsed.searchParams.has("uselibpqcompat")) {
      parsed.searchParams.set("uselibpqcompat", "true");
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
};

const pool = new Pool({
  connectionString: getDatabaseUrl(),
  ssl: getDatabaseUrl().includes('neon.tech') ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 30000,
});

async function isBootstrapSchemaApplied() {
  const result = await pool.query(`
    SELECT to_regclass('public.users') IS NOT NULL AS schema_exists;
  `);

  return result.rows[0]?.schema_exists === true;
}

async function runMigration() {
  try {
    console.log('[Migration] Starting database migration...');

    if (await isBootstrapSchemaApplied()) {
      console.log('[Migration] Existing schema detected; skipping bootstrap migration');
      return;
    }
    
    // Apply schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schema);
    console.log('[Migration] Schema applied successfully');
    
    // Apply seed data
    const seedPath = path.join(__dirname, 'seed-data.sql');
    const seed = fs.readFileSync(seedPath, 'utf8');
    await pool.query(seed);
    console.log('[Migration] Seed data applied successfully');
    
    console.log('[Migration] Database migration completed successfully');
  } catch (error) {
    console.error('[Migration] Error during migration:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run migration if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await runMigration();
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

export { runMigration };

import pg from 'pg';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

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

async function runMigration() {
  try {
    console.log('[Migration] Starting database migration...');
    
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
  runMigration()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { runMigration };

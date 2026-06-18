import pg from 'pg';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = 'postgresql://neondb_owner:npg_erwyh5nFq9JP@ep-muddy-grass-aia40flm-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { 
    rejectUnauthorized: false,
    // Additional SSL options for proxy environments
    // The connection string already has sslmode=require and channel_binding=require
  },
  // Add connection timeout for proxy environments
  connectionTimeoutMillis: 30000,
});

async function applySchema() {
  try {
    console.log('Connecting to database...');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    
    console.log('Applying schema...');
    await pool.query(schema);
    
    console.log('✅ Schema applied successfully!');
    
    // Verify tables were created
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    
    console.log('\nTables created:');
    result.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });
    
  } catch (error) {
    console.error('❌ Error applying schema:', error);
  } finally {
    await pool.end();
  }
}

applySchema();

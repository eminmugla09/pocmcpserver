# Database Setup Guide

## Prerequisites

- Node.js and npm installed
- Neon PostgreSQL database (already provided)

## Installation

1. Install dependencies:
```bash
npm install
```

2. Set environment variables in a `.env` file:
```env
DATABASE_URL=postgresql://neondb_owner:npg_erwyh5nFq9JP@ep-muddy-grass-aia40flm-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
JWT_SECRET=your-super-secret-jwt-key-change-in-production
```

## Applying the Schema

### Option 1: Using psql (recommended)
```bash
psql "postgresql://neondb_owner:npg_erwyh5nFq9JP@ep-muddy-grass-aia40flm-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require" -f schema.sql
```

### Option 2: Using Node.js script
Create a temporary script `apply-schema.js`:
```javascript
import pg from 'pg';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function applySchema() {
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('Schema applied successfully!');
  } catch (error) {
    console.error('Error applying schema:', error);
  } finally {
    await pool.end();
  }
}

applySchema();
```

Run it:
```bash
node apply-schema.js
```

## Using the Auth Module

### Example Usage

```typescript
import { register, login, verifyToken } from './auth.js';

// Register a new user
const registerResult = await register({
  email: 'user@example.com',
  password: 'securePassword123',
  full_name: 'John Doe'
});

if (registerResult.success) {
  console.log('User registered:', registerResult.user);
  console.log('Token:', registerResult.token);
}

// Login
const loginResult = await login({
  email: 'user@example.com',
  password: 'securePassword123'
});

if (loginResult.success) {
  console.log('Login successful:', loginResult.user);
  console.log('Token:', loginResult.token);
}

// Verify a token
const verification = verifyToken(loginResult.token);
console.log('Token valid:', verification.valid);
console.log('User ID:', verification.userId);
```

### Express.js Integration Example

```typescript
import express from 'express';
import { register, login, authMiddleware } from './auth.js';

const app = express();
app.use(express.json());

// Register endpoint
app.post('/api/register', async (req, res) => {
  const result = await register(req.body);
  res.json(result);
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  const result = await login(req.body);
  res.json(result);
});

// Protected route
app.get('/api/profile', authMiddleware, async (req, res) => {
  // req.user contains userId and email
  res.json({ message: 'Protected data', user: req.user });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

## Database Schema Overview

The schema includes the following tables:

### Authentication
- `users` - User accounts for authentication

### FPL Data
- `customers` - Customer information
- `accounts` - Account details
- `account_programs` - Account-program enrollments (many-to-many)
- `premises` - Property/service location information
- `registered_vehicles` - Registered EV vehicles
- `ev_enrollments` - FPL EVolution Home enrollments
- `ev_eligibility` - EV eligibility checks
- `billing` - Billing information
- `bill_charges` - Bill charge breakdowns
- `payment_history` - Payment history records
- `usage_history` - Monthly usage history
- `service_connection_quotes` - Service connection quotes
- `service_connection_orders` - Service connection orders
- `ev_enrollment_orders` - EV enrollment orders
- `move_intents` - Customer move intent records

## Security Notes

1. **Change JWT_SECRET** in production - use a strong, random secret
2. **Use environment variables** for all sensitive data
3. **Enable HTTPS** in production
4. **Implement rate limiting** on auth endpoints
5. **Use strong password policies** (minimum 8 characters, recommend 12+)
6. **Consider adding email verification** for registration
7. **Implement password reset** functionality
8. **Add account lockout** after failed login attempts

## Testing the Connection

Create a test script `test-db.js`:
```javascript
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function testConnection() {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('Database connected successfully!');
    console.log('Server time:', result.rows[0].now);
  } catch (error) {
    console.error('Database connection failed:', error);
  } finally {
    await pool.end();
  }
}

testConnection();
```

Run it:
```bash
node test-db.js
```

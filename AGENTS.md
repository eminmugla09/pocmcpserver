# FPL Agent MCP — Project Guide

## Purpose

TypeScript/Node.js MCP server that exposes utility (FPL/EV) tools over stdio or HTTP.
Implements customer/account lookup, billing, EV enrollment, service orders, and move-in workflows.

## Repository Layout

- `src/index.ts` — main entrypoint: server creation, tool registration, HTTP/stdio transports
- `src/auth.ts` — JWT auth, login/registration, customer access helpers
- `schema.sql` — PostgreSQL schema (17 tables)
- `seed-data.sql` — sample customers, accounts, premises, billing, EV records
- `migrate-db.js` — startup migration runner

## Build / Run

```bash
# Install dependencies
npm install

# Build (TypeScript -> dist/)
npm run build

# Start server
npm start

# Dev mode
npm run dev
```

## Database Setup

Requires a PostgreSQL database. Set `DATABASE_URL` before running.

```bash
# Example local setup
export DATABASE_URL="postgresql://localhost:5432/pocmcpserver?sslmode=disable"
createdb pocmcpserver
psql -d pocmcpserver -f schema.sql
psql -d pocmcpserver -f seed-data.sql
```

The server calls `runMigration()` on startup to ensure required tables exist.

## Testing

```bash
# Run the full test suite
npm test

# Run tests in watch mode
npm run test:watch

# Run a single test file
npx vitest run src/tests/get_account_summary.test.ts

# Run tests with coverage report
npm test -- --coverage
```

Tests are integration tests backed by a real PostgreSQL database.
Set `DATABASE_URL` to a test database before running tests, or the test harness will default to a local test DB.

```bash
export DATABASE_URL="postgresql://localhost:5432/pocmcpserver_test?sslmode=disable"
createdb pocmcpserver_test
npm test
```

### Test Coverage Goals

- **Target Coverage**: 100% statement, branch, function, and line coverage
- **Current Coverage**: ~40% statements, ~29% branches, ~43% functions, ~40% lines
- **Gap Areas**: 
  - `auth.ts`: Needs comprehensive authentication flow testing (currently ~18%)
  - `index.ts`: Error handling, edge cases, and utility functions need coverage
  - HTTP server and transport layer testing
  - Database migration and connection handling

### Test Structure

```
src/tests/
├── helpers.ts              # Test database setup/teardown utilities
├── account-tools.test.ts   # Account lookup and management tests
├── billing-tools.test.ts   # Billing and payment tests
├── customer-tools.test.ts  # Customer profile management tests
├── ev-tools.test.ts        # EV enrollment and charging tests
├── service-tools.test.ts   # Service orders and connection tests
├── support-tools.test.ts   # Support case and audit tests
└── auth.test.ts            # Authentication utilities tests
```

### Testing Best Practices

1. **Database Isolation**: Each test file creates its own test database to ensure isolation
2. **Test Data**: Use seed data for consistent test scenarios
3. **Handler Testing**: Test each handler independently with realistic inputs
4. **Error Cases**: Test error handling, edge cases, and validation
5. **Authentication**: Test both authenticated and unauthenticated scenarios
6. **Authorization**: Test customer access control and permission boundaries
7. **Data Validation**: Test input validation and sanitization
8. **Transaction Safety**: Test database transaction rollback on errors

### Adding New Tests

When adding a new tool or handler:

1. Create a test file in `src/tests/` following the naming convention `[category]-tools.test.ts`
2. Use the test helper functions from `helpers.ts` for database setup
3. Test both success and failure scenarios
4. Include edge cases and validation testing
5. Verify database state changes where appropriate
6. Test authentication and authorization if applicable

## Key Conventions

- ESM modules (`"type": "module"` in package.json).
- Handlers are registered via `server.registerTool(name, { description, inputSchema }, handler)`.
- Most tools return `jsonContent(handlerResult)` so responses are JSON wrapped in MCP text content.
- Authorization uses a Bearer JWT. `account_number` and `customer_number` are auto-resolved for authenticated users when omitted.
- Database connections use connection pooling for performance.
- All database operations use parameterized queries to prevent SQL injection.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `JWT_SECRET` | `your-secret-key-change-in-production` | JWT signing secret |
| `MCP_TRANSPORT` | `stdio` | `http` or `stdio` |
| `PORT` | `3000` | HTTP port (also forces HTTP transport if set) |

## Development Guidelines

### Code Style

- Use TypeScript for type safety
- Follow existing naming conventions (camelCase for variables, PascalCase for types)
- Add JSDoc comments for complex functions
- Use async/await for asynchronous operations
- Handle errors gracefully with try-catch blocks
- Log errors for debugging but don't expose sensitive information

### Database Operations

- Always use parameterized queries
- Use transactions for multi-step operations
- Handle connection errors gracefully
- Close connections properly in cleanup
- Use connection pooling for performance

### Security

- Never log or expose sensitive data (passwords, tokens, PII)
- Validate and sanitize all user inputs
- Use JWT tokens for authentication
- Implement proper authorization checks
- Follow principle of least privilege
- Keep dependencies updated

### Performance

- Use database indexes appropriately
- Implement caching where beneficial
- Optimize database queries
- Use connection pooling
- Implement pagination for large result sets
- Consider async operations for long-running tasks

## Common Tasks

- **Add a new tool**: Add a handler function in `src/index.ts` and register it inside `createFplMcpServer()`. Create corresponding tests in `src/tests/`.
- **Update seed data**: Edit `seed-data.sql` and re-seed the test DB.
- **Run tests against fresh data**: Test setup applies schema/seed before each run.
- **Add authentication**: Use the JWT utilities from `auth.ts` and implement proper authorization checks.
- **Handle errors**: Implement consistent error handling with meaningful error messages.
- **Add logging**: Use console.error for errors, but avoid logging sensitive information.

## Troubleshooting

### Database Connection Issues
- Verify `DATABASE_URL` is set correctly
- Check database server is running
- Ensure database exists and schema is applied
- Verify network connectivity and firewall rules

### Test Failures
- Check test database setup in `helpers.ts`
- Verify seed data is consistent
- Ensure test isolation (no shared state between tests)
- Check for timing issues with async operations
- Verify database cleanup between tests

### Authentication Issues
- Verify `JWT_SECRET` is set consistently
- Check token expiration and validation
- Ensure user exists and is active
- Verify customer access permissions

## Project Status

- **Test Coverage**: ~40% statements, ~29% branches, ~43% functions, ~40% lines
- **Test Count**: 76 tests passing across 8 test files
- **Known Coverage Gaps**: Auth module, error handling, HTTP transport layer
- **Priority**: Increase coverage to 100% to identify all potential bugs

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from './helpers.js';
describe('HTTP Transport Layer Tests', () => {
    let dbName;
    let handlers;
    let mainPool;
    let httpServer = null;
    let baseUrl = '';
    let dynamicClientId = '';
    let dynamicClientSecret = '';
    const defaultClientId = process.env.OAUTH_CLIENT_ID ?? 'chatgpt-fpl-agent';
    const defaultClientSecret = process.env.OAUTH_CLIENT_SECRET ?? '';
    const waitForServer = async (url) => {
        const maxAttempts = 40;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            try {
                const response = await fetch(`${url}/health`);
                if (response.ok) {
                    return;
                }
            }
            catch {
                // Retry until the server is ready.
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error('HTTP server did not become ready in time.');
    };
    beforeAll(async () => {
        const setup = await setupTestDb();
        dbName = setup.dbName;
        handlers = setup.handlers;
        mainPool = setup.mainPool;
        const port = 3300 + Math.floor(Math.random() * 300);
        baseUrl = `http://127.0.0.1:${port}`;
        process.env.MCP_TRANSPORT = 'http';
        process.env.PORT = String(port);
        httpServer = handlers.startHttpServer();
        await waitForServer(baseUrl);
    });
    afterAll(async () => {
        if (httpServer) {
            await new Promise((resolve) => {
                httpServer?.close(() => resolve());
            });
            httpServer = null;
        }
        await teardownTestDb(dbName, mainPool);
    });
    describe('HTTP Endpoints', () => {
        it('should return health response', async () => {
            const response = await fetch(`${baseUrl}/health`);
            const payload = await response.json();
            expect(response.status).toBe(200);
            expect(payload.status).toBe('ok');
            expect(payload.mcpPath).toBe('/mcp');
        });
        it('should return OAuth metadata', async () => {
            const response = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
            const payload = await response.json();
            expect(response.status).toBe(200);
            expect(payload.authorization_endpoint).toContain('/oauth/authorize');
            expect(payload.token_endpoint).toContain('/oauth/token');
        });
        it('should validate register metadata requirements', async () => {
            const response = await fetch(`${baseUrl}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_name: 'Test Client' })
            });
            const payload = await response.json();
            expect(response.status).toBe(400);
            expect(payload.error).toBe('invalid_client_metadata');
        });
        it('should register OAuth client when redirect_uris is provided', async () => {
            const response = await fetch(`${baseUrl}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_name: 'Test Client',
                    redirect_uris: ['https://example.com/callback']
                })
            });
            const payload = await response.json();
            expect(response.status).toBe(201);
            expect(payload.client_id).toBeDefined();
            expect(payload.client_secret).toBeDefined();
            dynamicClientId = payload.client_id;
            dynamicClientSecret = payload.client_secret;
        });
        it('should return openid configuration', async () => {
            const response = await fetch(`${baseUrl}/.well-known/openid-configuration`);
            const payload = await response.json();
            expect(response.status).toBe(200);
            expect(payload.response_types_supported).toContain('code');
            expect(payload.token_endpoint).toContain('/oauth/token');
        });
        it('should return invalid_client for unknown OAuth token client', async () => {
            const response = await fetch(`${baseUrl}/oauth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'grant_type=authorization_code&code=abc&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&client_id=unknown-client'
            });
            const payload = await response.json();
            expect(response.status).toBe(401);
            expect(payload.error).toBe('invalid_client');
        });
    });
    describe('MCP Transport', () => {
        it('should initialize MCP session over /mcp', async () => {
            const response = await fetch(`${baseUrl}/mcp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: {}
                })
            });
            const text = await response.text();
            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('text/event-stream');
            expect(text).toContain('protocolVersion');
            expect(text).toContain('fpl-agent-mcp');
        });
        it('should list tools over /mcp', async () => {
            const response = await fetch(`${baseUrl}/mcp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 2,
                    method: 'tools/list',
                    params: {}
                })
            });
            const text = await response.text();
            expect(response.status).toBe(200);
            expect(text).toContain('get_customer_profile');
            expect(text).toContain('cancel_service_order');
        });
        it('should return not found for unknown route', async () => {
            const response = await fetch(`${baseUrl}/does-not-exist`);
            const payload = await response.json();
            expect(response.status).toBe(404);
            expect(payload.error).toBe('Not found');
        });
        it('should reject unauthorized MCP tool invocation', async () => {
            const response = await fetch(`${baseUrl}/mcp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 3,
                    method: 'tools/call',
                    params: { name: 'lookup_account', arguments: { customer_number: '1009988776' } }
                })
            });
            const payload = await response.json();
            expect(response.status).toBe(401);
            expect(payload.error.message).toContain('Authentication required');
        });
    });
    describe('OAuth Branch Coverage', () => {
        const issueAuthorizationCode = async (clientId, redirectUri, state = 's1') => {
            const response = await fetch(`${baseUrl}/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&code_challenge=plain-challenge&code_challenge_method=plain`, {
                method: 'POST',
                redirect: 'manual',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'email=woarzus%40gmail.com&password=password123'
            });
            expect(response.status).toBe(302);
            const location = response.headers.get('location') || '';
            const code = new URL(location).searchParams.get('code');
            expect(code).toBeTruthy();
            return code;
        };
        it('should reject authorize request for invalid client', async () => {
            const response = await fetch(`${baseUrl}/oauth/authorize?client_id=bad&response_type=code&redirect_uri=https://example.com/callback`);
            const html = await response.text();
            expect(response.status).toBe(400);
            expect(html).toContain('Invalid client or response_type');
        });
        it('should render oauth login page for valid client', async () => {
            const response = await fetch(`${baseUrl}/oauth/authorize?client_id=${encodeURIComponent(dynamicClientId)}&response_type=code&redirect_uri=${encodeURIComponent('https://example.com/callback')}&state=abc`);
            const html = await response.text();
            expect(response.status).toBe(200);
            expect(html).toContain('Sign in to connect your FPL account to ChatGPT');
        });
        it('should reject authorize request with invalid redirect uri', async () => {
            const response = await fetch(`${baseUrl}/oauth/authorize?client_id=${encodeURIComponent(dynamicClientId)}&response_type=code&redirect_uri=${encodeURIComponent('https://evil.example/callback')}`);
            const html = await response.text();
            expect(response.status).toBe(400);
            expect(html).toContain('Invalid redirect_uri');
        });
        it('should reject authorize login when credentials are missing', async () => {
            const response = await fetch(`${baseUrl}/oauth/authorize?client_id=${encodeURIComponent(dynamicClientId)}&response_type=code&redirect_uri=${encodeURIComponent('https://example.com/callback')}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: ''
            });
            const html = await response.text();
            expect(response.status).toBe(400);
            expect(html).toContain('Email and password are required');
        });
        it('should reject authorize login with invalid credentials', async () => {
            const response = await fetch(`${baseUrl}/oauth/authorize?client_id=${encodeURIComponent(dynamicClientId)}&response_type=code&redirect_uri=${encodeURIComponent('https://example.com/callback')}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'email=woarzus%40gmail.com&password=wrongpass'
            });
            const html = await response.text();
            expect(response.status).toBe(401);
            expect(html).toContain('Invalid email or password');
        });
        it('should reject authorize login for deactivated user', async () => {
            await mainPool.query(`UPDATE users SET is_active = FALSE WHERE email = $1`, ['woarzus@gmail.com']);
            const response = await fetch(`${baseUrl}/oauth/authorize?client_id=${encodeURIComponent(dynamicClientId)}&response_type=code&redirect_uri=${encodeURIComponent('https://example.com/callback')}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'email=woarzus%40gmail.com&password=password123'
            });
            const html = await response.text();
            expect(response.status).toBe(401);
            expect(html).toContain('Account is deactivated');
            await mainPool.query(`UPDATE users SET is_active = TRUE WHERE email = $1`, ['woarzus@gmail.com']);
        });
        it('should issue auth code and exchange for token with PKCE plain method', async () => {
            const authorizeResponse = await fetch(`${baseUrl}/oauth/authorize?client_id=${encodeURIComponent(dynamicClientId)}&response_type=code&redirect_uri=${encodeURIComponent('https://example.com/callback')}&state=xyz&code_challenge=plain-challenge&code_challenge_method=plain`, {
                method: 'POST',
                redirect: 'manual',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'email=woarzus%40gmail.com&password=password123'
            });
            expect(authorizeResponse.status).toBe(302);
            const location = authorizeResponse.headers.get('location') || '';
            expect(location).toContain('code=');
            expect(location).toContain('state=xyz');
            const redirectUrl = new URL(location);
            const code = redirectUrl.searchParams.get('code');
            const badPkceResponse = await fetch(`${baseUrl}/oauth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent('https://example.com/callback')}&client_id=${encodeURIComponent(dynamicClientId)}&client_secret=${encodeURIComponent(dynamicClientSecret)}&code_verifier=wrong`
            });
            const badPkcePayload = await badPkceResponse.json();
            expect(badPkceResponse.status).toBe(400);
            expect(badPkcePayload.error).toBe('invalid_grant');
            const goodAuthorizeResponse = await fetch(`${baseUrl}/oauth/authorize?client_id=${encodeURIComponent(dynamicClientId)}&response_type=code&redirect_uri=${encodeURIComponent('https://example.com/callback')}&state=xyz2&code_challenge=plain-challenge&code_challenge_method=plain`, {
                method: 'POST',
                redirect: 'manual',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'email=woarzus%40gmail.com&password=password123'
            });
            const goodLocation = goodAuthorizeResponse.headers.get('location') || '';
            const goodCode = new URL(goodLocation).searchParams.get('code');
            const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `grant_type=authorization_code&code=${encodeURIComponent(goodCode)}&redirect_uri=${encodeURIComponent('https://example.com/callback')}&client_id=${encodeURIComponent(dynamicClientId)}&client_secret=${encodeURIComponent(dynamicClientSecret)}&code_verifier=plain-challenge`
            });
            const tokenPayload = await tokenResponse.json();
            expect(tokenResponse.status).toBe(200);
            expect(tokenPayload.access_token).toBeDefined();
            expect(tokenPayload.refresh_token).toBeDefined();
            const refreshResponse = await fetch(`${baseUrl}/oauth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(tokenPayload.refresh_token)}&client_id=${encodeURIComponent(dynamicClientId)}&client_secret=${encodeURIComponent(dynamicClientSecret)}`
            });
            const refreshPayload = await refreshResponse.json();
            expect(refreshResponse.status).toBe(200);
            expect(refreshPayload.access_token).toBeDefined();
        });
        it('should reject unsupported grant type', async () => {
            const response = await fetch(`${baseUrl}/oauth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `grant_type=client_credentials&client_id=${encodeURIComponent(dynamicClientId)}&client_secret=${encodeURIComponent(dynamicClientSecret)}`
            });
            const payload = await response.json();
            expect(response.status).toBe(400);
            expect(payload.error).toBe('unsupported_grant_type');
        });
        it('should reject token exchange for missing authorization code', async () => {
            const response = await fetch(`${baseUrl}/oauth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `grant_type=authorization_code&code=missing-code&redirect_uri=${encodeURIComponent('https://example.com/callback')}&client_id=${encodeURIComponent(dynamicClientId)}&client_secret=${encodeURIComponent(dynamicClientSecret)}&code_verifier=plain-challenge`
            });
            const payload = await response.json();
            expect(response.status).toBe(400);
            expect(payload.error).toBe('invalid_grant');
            expect(payload.error_description).toContain('Code not found');
        });
        it('should reject token exchange when redirect uri mismatches', async () => {
            const code = await issueAuthorizationCode(dynamicClientId, 'https://example.com/callback', 'redirect-mismatch');
            const response = await fetch(`${baseUrl}/oauth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent('https://another.example/callback')}&client_id=${encodeURIComponent(dynamicClientId)}&client_secret=${encodeURIComponent(dynamicClientSecret)}&code_verifier=plain-challenge`
            });
            const payload = await response.json();
            expect(response.status).toBe(400);
            expect(payload.error).toBe('invalid_grant');
            expect(payload.error_description).toContain('redirect_uri mismatch');
        });
        it('should reject token exchange when code is already used', async () => {
            const code = await issueAuthorizationCode(dynamicClientId, 'https://example.com/callback', 'used-code');
            const firstResponse = await fetch(`${baseUrl}/oauth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent('https://example.com/callback')}&client_id=${encodeURIComponent(dynamicClientId)}&client_secret=${encodeURIComponent(dynamicClientSecret)}&code_verifier=plain-challenge`
            });
            expect(firstResponse.status).toBe(200);
            const secondResponse = await fetch(`${baseUrl}/oauth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent('https://example.com/callback')}&client_id=${encodeURIComponent(dynamicClientId)}&client_secret=${encodeURIComponent(dynamicClientSecret)}&code_verifier=plain-challenge`
            });
            const payload = await secondResponse.json();
            expect(secondResponse.status).toBe(400);
            expect(payload.error).toBe('invalid_grant');
            expect(payload.error_description).toContain('already used');
        });
        it('should reject token exchange when authorization code belongs to another client', async () => {
            const secondClient = await fetch(`${baseUrl}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_name: 'Second Test Client',
                    redirect_uris: ['https://example.com/callback']
                })
            });
            const secondClientPayload = await secondClient.json();
            const secondClientId = secondClientPayload.client_id;
            const secondClientSecret = secondClientPayload.client_secret;
            const code = await issueAuthorizationCode(dynamicClientId, 'https://example.com/callback', 'client-mismatch');
            const response = await fetch(`${baseUrl}/oauth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent('https://example.com/callback')}&client_id=${encodeURIComponent(secondClientId)}&client_secret=${encodeURIComponent(secondClientSecret)}&code_verifier=plain-challenge`
            });
            const payload = await response.json();
            expect(response.status).toBe(400);
            expect(payload.error).toBe('invalid_grant');
            expect(payload.error_description).toContain('client mismatch');
        });
        it('should accept token exchange with client credentials in basic auth header', async () => {
            const code = await issueAuthorizationCode(dynamicClientId, 'https://example.com/callback', 'basic-auth');
            const basicCreds = Buffer.from(`${dynamicClientId}:${dynamicClientSecret}`).toString('base64');
            const response = await fetch(`${baseUrl}/oauth/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Authorization: `Basic ${basicCreds}`
                },
                body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent('https://example.com/callback')}&code_verifier=plain-challenge`
            });
            const payload = await response.json();
            expect(response.status).toBe(200);
            expect(payload.access_token).toBeDefined();
        });
        it('should reject refresh grant for missing refresh token', async () => {
            const response = await fetch(`${baseUrl}/oauth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: defaultClientId,
                    client_secret: defaultClientSecret
                })
            });
            const payload = await response.json();
            expect(response.status).toBe(400);
            expect(payload.error).toBe('invalid_request');
        });
        it('should reject refresh grant for unknown refresh token', async () => {
            const response = await fetch(`${baseUrl}/oauth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: defaultClientId,
                    client_secret: defaultClientSecret,
                    refresh_token: 'missing-refresh-token'
                })
            });
            const payload = await response.json();
            expect(response.status).toBe(400);
            expect(payload.error).toBe('invalid_grant');
            expect(payload.error_description).toContain('not found');
        });
        it('should reject revoked and expired refresh tokens on refresh endpoint', async () => {
            const revokedToken = `revoked-${Date.now()}`;
            const expiredToken = `expired-${Date.now()}`;
            await mainPool.query(`INSERT INTO oauth_refresh_tokens (refresh_token, client_id, user_id, email, expires_at, revoked)
         VALUES ($1, $2, (SELECT id FROM users WHERE email = $3), $3, NOW() + INTERVAL '1 day', TRUE),
                ($4, $2, (SELECT id FROM users WHERE email = $3), $3, NOW() - INTERVAL '1 day', FALSE)`, [revokedToken, defaultClientId, 'woarzus@gmail.com', expiredToken]);
            const revokedResponse = await fetch(`${baseUrl}/oauth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: defaultClientId,
                    client_secret: defaultClientSecret,
                    refresh_token: revokedToken
                })
            });
            const revokedPayload = await revokedResponse.json();
            expect(revokedResponse.status).toBe(400);
            expect(revokedPayload.error_description).toContain('revoked');
            const expiredResponse = await fetch(`${baseUrl}/oauth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: defaultClientId,
                    client_secret: defaultClientSecret,
                    refresh_token: expiredToken
                })
            });
            const expiredPayload = await expiredResponse.json();
            expect(expiredResponse.status).toBe(400);
            expect(expiredPayload.error_description).toContain('expired');
        });
        it('should issue access token from refresh endpoint with valid default-client refresh token', async () => {
            const code = await issueAuthorizationCode(defaultClientId, 'https://example.com/default-callback', 'default-client');
            const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent('https://example.com/default-callback')}&client_id=${encodeURIComponent(defaultClientId)}&client_secret=${encodeURIComponent(defaultClientSecret)}&code_verifier=plain-challenge`
            });
            const tokenPayload = await tokenResponse.json();
            expect(tokenResponse.status).toBe(200);
            const refreshResponse = await fetch(`${baseUrl}/oauth/refresh`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Authorization: `Basic ${Buffer.from(`${defaultClientId}:${defaultClientSecret}`).toString('base64')}`
                },
                body: `refresh_token=${encodeURIComponent(tokenPayload.refresh_token)}`
            });
            const refreshPayload = await refreshResponse.json();
            expect(refreshResponse.status).toBe(200);
            expect(refreshPayload.access_token).toBeDefined();
        });
    });
    describe('MCP Auth Branches', () => {
        it('should reject tools call when bearer token is malformed', async () => {
            const response = await fetch(`${baseUrl}/mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer not-a-jwt'
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 30,
                    method: 'tools/call',
                    params: { name: 'lookup_account', arguments: { customer_number: '1009988776' } }
                })
            });
            const payload = await response.json();
            expect(response.status).toBe(401);
            expect(payload.error.message).toContain('Invalid token format');
        });
        it('should reject tools call when token has no userId claim', async () => {
            const jwt = await import('jsonwebtoken');
            const token = jwt.default.sign({ email: 'woarzus@gmail.com' }, process.env.JWT_SECRET || 'change-me', { expiresIn: '1h' });
            const response = await fetch(`${baseUrl}/mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 31,
                    method: 'tools/call',
                    params: { name: 'lookup_account', arguments: { customer_number: '1009988776' } }
                })
            });
            const payload = await response.json();
            expect(response.status).toBe(401);
            expect(payload.error.message).toContain('Invalid token format');
        });
    });
    describe('In-Process Transport Construction', () => {
        it('should create MCP server instance in-process', async () => {
            const { createFplMcpServer } = await import('../index.js');
            const server = createFplMcpServer();
            expect(server).toBeDefined();
        });
        it('should construct server under stdio transport setting', async () => {
            const originalTransport = process.env.MCP_TRANSPORT;
            process.env.MCP_TRANSPORT = 'stdio';
            const { createFplMcpServer } = await import('../index.js');
            const server = createFplMcpServer();
            expect(server).toBeDefined();
            if (originalTransport) {
                process.env.MCP_TRANSPORT = originalTransport;
            }
            else {
                delete process.env.MCP_TRANSPORT;
            }
        });
        it('should construct server under http transport setting', async () => {
            const originalTransport = process.env.MCP_TRANSPORT;
            process.env.MCP_TRANSPORT = 'http';
            const { createFplMcpServer } = await import('../index.js');
            const server = createFplMcpServer();
            expect(server).toBeDefined();
            if (originalTransport) {
                process.env.MCP_TRANSPORT = originalTransport;
            }
            else {
                delete process.env.MCP_TRANSPORT;
            }
        });
    });
    describe('Handler Availability', () => {
        it('should have lookupAccountHandler', async () => {
            expect(handlers.lookupAccountHandler).toBeDefined();
            expect(typeof handlers.lookupAccountHandler).toBe('function');
        });
        it('should have getAccountSummaryHandler', async () => {
            expect(handlers.getAccountSummaryHandler).toBeDefined();
            expect(typeof handlers.getAccountSummaryHandler).toBe('function');
        });
        it('should have getBillingInquiryHandler', async () => {
            expect(handlers.getBillingInquiryHandler).toBeDefined();
            expect(typeof handlers.getBillingInquiryHandler).toBe('function');
        });
        it('should have getEvEnrollmentHandler', async () => {
            expect(handlers.getEvEnrollmentHandler).toBeDefined();
            expect(typeof handlers.getEvEnrollmentHandler).toBe('function');
        });
        it('should have registerVehicleHandler', async () => {
            expect(handlers.registerVehicleHandler).toBeDefined();
            expect(typeof handlers.registerVehicleHandler).toBe('function');
        });
        it('should have updateRegisteredVehicleHandler', async () => {
            expect(handlers.updateRegisteredVehicleHandler).toBeDefined();
            expect(typeof handlers.updateRegisteredVehicleHandler).toBe('function');
        });
        it('should have removeRegisteredVehicleHandler', async () => {
            expect(handlers.removeRegisteredVehicleHandler).toBeDefined();
            expect(typeof handlers.removeRegisteredVehicleHandler).toBe('function');
        });
        it('should have getCustomerProfileHandler', async () => {
            expect(handlers.getCustomerProfileHandler).toBeDefined();
            expect(typeof handlers.getCustomerProfileHandler).toBe('function');
        });
    });
    describe('Database Pool', () => {
        it('should have database pool available', async () => {
            const { pool } = await import('../index.js');
            expect(pool).toBeDefined();
        });
        it('should be able to query database', async () => {
            const { pool } = await import('../index.js');
            const result = await pool.query('SELECT 1 as test');
            expect(result.rows).toHaveLength(1);
            expect(result.rows[0].test).toBe(1);
        });
    });
});

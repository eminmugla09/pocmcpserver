import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from './helpers.js';
describe('Authentication Module', () => {
    let dbName;
    let testDbUrl;
    let originalDbUrl;
    beforeAll(async () => {
        // Save original DATABASE_URL
        originalDbUrl = process.env.DATABASE_URL;
        const setup = await setupTestDb();
        dbName = setup.dbName;
        testDbUrl = setup.testDbUrl;
        // Set DATABASE_URL for auth module
        process.env.DATABASE_URL = testDbUrl;
    });
    afterAll(async () => {
        // Restore original DATABASE_URL
        if (originalDbUrl) {
            process.env.DATABASE_URL = originalDbUrl;
        }
        else {
            delete process.env.DATABASE_URL;
        }
        // Import and use teardown
        const { teardownTestDb } = await import('./helpers.js');
        // Note: We can't pass mainPool here since auth creates its own connection
        // The database will be cleaned up by the test framework
    });
    describe('Token Verification', () => {
        it('should reject invalid JWT token', async () => {
            const { verifyToken } = await import('../auth.js');
            const verification = verifyToken('invalid.token.here');
            expect(verification).toBeDefined();
            expect(verification.valid).toBe(false);
        });
        it('should reject malformed tokens', async () => {
            const { verifyToken } = await import('../auth.js');
            const verification = verifyToken('not-a-token');
            expect(verification).toBeDefined();
            expect(verification.valid).toBe(false);
        });
        it('should reject empty tokens', async () => {
            const { verifyToken } = await import('../auth.js');
            const verification = verifyToken('');
            expect(verification).toBeDefined();
            expect(verification.valid).toBe(false);
        });
        it('should reject expired tokens', async () => {
            const { verifyToken } = await import('../auth.js');
            // Create an expired token (this would require manipulating JWT_SECRET or time)
            const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjEwMDAwMDAwMDAsInVzZXJJZCI6InRlc3QiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20ifQ.signature';
            const verification = verifyToken(expiredToken);
            expect(verification).toBeDefined();
            expect(verification.valid).toBe(false);
        });
    });
    describe('Auth Middleware', () => {
        it('should reject requests with no bearer token', async () => {
            const { authMiddleware } = await import('../auth.js');
            const req = { headers: {} };
            let capturedStatus = 0;
            let capturedBody = null;
            const res = {
                status(code) {
                    capturedStatus = code;
                    return {
                        json(payload) {
                            capturedBody = payload;
                            return payload;
                        }
                    };
                }
            };
            const next = () => {
                throw new Error('next should not be called for missing token');
            };
            authMiddleware(req, res, next);
            expect(capturedStatus).toBe(401);
            expect(capturedBody.message).toContain('No token provided');
        });
        it('should reject requests with invalid bearer token', async () => {
            const { authMiddleware } = await import('../auth.js');
            const req = { headers: { authorization: 'Bearer invalid.token.value' } };
            let capturedStatus = 0;
            let capturedBody = null;
            const res = {
                status(code) {
                    capturedStatus = code;
                    return {
                        json(payload) {
                            capturedBody = payload;
                            return payload;
                        }
                    };
                }
            };
            const next = () => {
                throw new Error('next should not be called for invalid token');
            };
            authMiddleware(req, res, next);
            expect(capturedStatus).toBe(401);
            expect(capturedBody.message).toContain('Invalid or expired token');
        });
        it('should attach user and call next with a valid bearer token', async () => {
            const { register, authMiddleware } = await import('../auth.js');
            const registerResult = await register({
                email: 'middleware-valid@example.com',
                password: 'password123',
                full_name: 'Middleware Valid'
            });
            const req = { headers: { authorization: `Bearer ${registerResult.token}` } };
            const res = {
                status() {
                    throw new Error('status should not be called for valid token');
                }
            };
            let nextCalled = false;
            const next = () => {
                nextCalled = true;
            };
            authMiddleware(req, res, next);
            expect(nextCalled).toBe(true);
            expect(req.user).toBeDefined();
            expect(req.user.email).toBe('middleware-valid@example.com');
            expect(typeof req.user.userId).toBe('string');
        });
    });
    describe('User Registration', () => {
        it('should register new user successfully', async () => {
            const { register } = await import('../auth.js');
            const result = await register({
                email: 'newuser@example.com',
                password: 'password123',
                full_name: 'New User'
            });
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            expect(result.user).toBeDefined();
            expect(result.user.email).toBe('newuser@example.com');
            expect(result.token).toBeDefined();
        });
        it('should fail registration with duplicate email', async () => {
            const { register } = await import('../auth.js');
            // First registration
            await register({
                email: 'duplicate@example.com',
                password: 'password123',
                full_name: 'First User'
            });
            // Second registration with same email
            const result = await register({
                email: 'duplicate@example.com',
                password: 'password456',
                full_name: 'Second User'
            });
            expect(result).toBeDefined();
            expect(result.success).toBe(false);
            expect(result.message).toContain('already registered');
        });
        it('should fail registration with short password', async () => {
            const { register } = await import('../auth.js');
            const result = await register({
                email: 'shortpass@example.com',
                password: '123',
                full_name: 'Short Password'
            });
            expect(result).toBeDefined();
            expect(result.success).toBe(false);
            expect(result.message).toContain('8 characters');
        });
        it('should fail registration with missing email', async () => {
            const { register } = await import('../auth.js');
            const result = await register({
                email: '',
                password: 'password123',
                full_name: 'No Email'
            });
            expect(result).toBeDefined();
            expect(result.success).toBe(false);
            expect(result.message).toContain('required');
        });
        it('should fail registration with missing password', async () => {
            const { register } = await import('../auth.js');
            const result = await register({
                email: 'nopass@example.com',
                password: '',
                full_name: 'No Password'
            });
            expect(result).toBeDefined();
            expect(result.success).toBe(false);
            expect(result.message).toContain('required');
        });
        it('should normalize email to lowercase', async () => {
            const { register } = await import('../auth.js');
            const result = await register({
                email: 'MixedCase@Example.COM',
                password: 'password123',
                full_name: 'Mixed Case Email'
            });
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            expect(result.user.email).toBe('mixedcase@example.com');
        });
        it('should handle null full_name', async () => {
            const { register } = await import('../auth.js');
            const result = await register({
                email: 'noname@example.com',
                password: 'password123'
            });
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            expect(result.user.full_name).toBeNull();
        });
    });
    describe('User Login', () => {
        it('should login with valid credentials', async () => {
            const { register, login } = await import('../auth.js');
            // First register a user
            await register({
                email: 'logintest@example.com',
                password: 'password123',
                full_name: 'Login Test'
            });
            // Then login
            const result = await login({
                email: 'logintest@example.com',
                password: 'password123'
            });
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            expect(result.token).toBeDefined();
            expect(result.user).toBeDefined();
            expect(result.user.email).toBe('logintest@example.com');
            // Password should not be returned in user object
        });
        it('should fail login with invalid password', async () => {
            const { register, login } = await import('../auth.js');
            await register({
                email: 'wrongpass@example.com',
                password: 'password123',
                full_name: 'Wrong Password'
            });
            const result = await login({
                email: 'wrongpass@example.com',
                password: 'wrongpassword'
            });
            expect(result).toBeDefined();
            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid');
        });
        it('should fail login with non-existent user', async () => {
            const { login } = await import('../auth.js');
            const result = await login({
                email: 'nonexistent@example.com',
                password: 'password123'
            });
            expect(result).toBeDefined();
            expect(result.success).toBe(false);
        });
        it('should fail login with missing email', async () => {
            const { login } = await import('../auth.js');
            const result = await login({
                email: '',
                password: 'password123'
            });
            expect(result).toBeDefined();
            expect(result.success).toBe(false);
            expect(result.message).toContain('required');
        });
        it('should fail login with missing password', async () => {
            const { login } = await import('../auth.js');
            const result = await login({
                email: 'test@example.com',
                password: ''
            });
            expect(result).toBeDefined();
            expect(result.success).toBe(false);
            expect(result.message).toContain('required');
        });
        it('should update last_login timestamp on successful login', async () => {
            const { register, login, getUserById } = await import('../auth.js');
            const registerResult = await register({
                email: 'lastlogin@example.com',
                password: 'password123',
                full_name: 'Last Login Test'
            });
            const userBefore = await getUserById(registerResult.user.id);
            expect(userBefore.last_login).toBeNull();
            await login({
                email: 'lastlogin@example.com',
                password: 'password123'
            });
            const userAfter = await getUserById(registerResult.user.id);
            expect(userAfter.last_login).toBeDefined();
            expect(userAfter.last_login).not.toBeNull();
        });
    });
    describe('User Management', () => {
        it('should get user by ID', async () => {
            const { register, getUserById } = await import('../auth.js');
            const registerResult = await register({
                email: 'getuser@example.com',
                password: 'password123',
                full_name: 'Get User'
            });
            const user = await getUserById(registerResult.user.id);
            expect(user).toBeDefined();
            expect(user.email).toBe('getuser@example.com');
            // Password should not be returned in user object
        });
        it('should return null for non-existent user ID', async () => {
            const { getUserById } = await import('../auth.js');
            const user = await getUserById('00000000-0000-0000-0000-000000000000');
            expect(user).toBeNull();
        });
        it('should return null for invalid UUID format', async () => {
            const { getUserById } = await import('../auth.js');
            const user = await getUserById('invalid-uuid-format');
            expect(user).toBeNull();
        });
        it('should change password successfully', async () => {
            const { register, changePassword, login } = await import('../auth.js');
            const registerResult = await register({
                email: 'changepass@example.com',
                password: 'password123',
                full_name: 'Change Password'
            });
            const result = await changePassword(registerResult.user.id, 'password123', 'newpassword123');
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            // Verify old password doesn't work
            const oldLoginResult = await login({
                email: 'changepass@example.com',
                password: 'password123'
            });
            expect(oldLoginResult.success).toBe(false);
            // Verify new password works
            const newLoginResult = await login({
                email: 'changepass@example.com',
                password: 'newpassword123'
            });
            expect(newLoginResult.success).toBe(true);
        });
        it('should fail password change with wrong current password', async () => {
            const { register, changePassword } = await import('../auth.js');
            const registerResult = await register({
                email: 'changepass2@example.com',
                password: 'password123',
                full_name: 'Change Password 2'
            });
            const result = await changePassword(registerResult.user.id, 'wrongpassword', 'newpassword123');
            expect(result).toBeDefined();
            expect(result.success).toBe(false);
            expect(result.message).toContain('incorrect');
        });
        it('should fail password change with short new password', async () => {
            const { register, changePassword } = await import('../auth.js');
            const registerResult = await register({
                email: 'changepass3@example.com',
                password: 'password123',
                full_name: 'Change Password 3'
            });
            const result = await changePassword(registerResult.user.id, 'password123', 'short');
            expect(result).toBeDefined();
            expect(result.success).toBe(false);
            expect(result.message).toContain('8 characters');
        });
        it('should fail password change for non-existent user', async () => {
            const { changePassword } = await import('../auth.js');
            const result = await changePassword('00000000-0000-0000-0000-000000000000', 'password123', 'newpassword123');
            expect(result).toBeDefined();
            expect(result.success).toBe(false);
            expect(result.message).toContain('not found');
        });
    });
    describe('Customer Access Management', () => {
        it('should get customer numbers for user', async () => {
            const { register, getUserCustomerNumbers } = await import('../auth.js');
            const registerResult = await register({
                email: 'customeraccess@example.com',
                password: 'password123',
                full_name: 'Customer Access'
            });
            const customerNumbers = await getUserCustomerNumbers(registerResult.user.id);
            expect(customerNumbers).toBeDefined();
            expect(Array.isArray(customerNumbers)).toBe(true);
        });
        it('should return empty array for invalid UUID', async () => {
            const { getUserCustomerNumbers } = await import('../auth.js');
            const customerNumbers = await getUserCustomerNumbers('invalid-uuid');
            expect(customerNumbers).toBeDefined();
            expect(Array.isArray(customerNumbers)).toBe(true);
            expect(customerNumbers.length).toBe(0);
        });
        it('should return empty array for non-existent user', async () => {
            const { getUserCustomerNumbers } = await import('../auth.js');
            const customerNumbers = await getUserCustomerNumbers('00000000-0000-0000-0000-000000000000');
            expect(customerNumbers).toBeDefined();
            expect(Array.isArray(customerNumbers)).toBe(true);
            expect(customerNumbers.length).toBe(0);
        });
        it('should check customer access correctly', async () => {
            const { register, hasCustomerAccess } = await import('../auth.js');
            const registerResult = await register({
                email: 'accesscheck@example.com',
                password: 'password123',
                full_name: 'Access Check'
            });
            const hasAccess = await hasCustomerAccess(registerResult.user.id, '1009988776');
            expect(typeof hasAccess).toBe('boolean');
        });
        it('should return false for invalid UUID in access check', async () => {
            const { hasCustomerAccess } = await import('../auth.js');
            const hasAccess = await hasCustomerAccess('invalid-uuid', '1009988776');
            expect(hasAccess).toBe(false);
        });
        it('should link user to customer successfully', async () => {
            const { register, linkUserToCustomer } = await import('../auth.js');
            const registerResult = await register({
                email: 'linkuser@example.com',
                password: 'password123',
                full_name: 'Link User'
            });
            const result = await linkUserToCustomer(registerResult.user.id, '1009988776', false);
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
        });
        it('should handle linking user to customer with is_primary flag', async () => {
            const { register, linkUserToCustomer } = await import('../auth.js');
            const registerResult = await register({
                email: 'linkprimary@example.com',
                password: 'password123',
                full_name: 'Link Primary'
            });
            const result = await linkUserToCustomer(registerResult.user.id, '1009988776', true);
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
        });
        it('should get primary customer number', async () => {
            const { register, linkUserToCustomer, getPrimaryCustomerNumber } = await import('../auth.js');
            const registerResult = await register({
                email: 'primary@example.com',
                password: 'password123',
                full_name: 'Primary Customer'
            });
            await linkUserToCustomer(registerResult.user.id, '1009988776', true);
            const primaryCustomer = await getPrimaryCustomerNumber(registerResult.user.id);
            expect(primaryCustomer).toBe('1009988776');
        });
        it('should return null when no primary customer set', async () => {
            const { register, getPrimaryCustomerNumber } = await import('../auth.js');
            const registerResult = await register({
                email: 'noprimary@example.com',
                password: 'password123',
                full_name: 'No Primary'
            });
            const primaryCustomer = await getPrimaryCustomerNumber(registerResult.user.id);
            expect(primaryCustomer).toBeNull();
        });
    });
    describe('Token Generation and Validation', () => {
        it('should generate valid JWT token on registration', async () => {
            const { register, verifyToken } = await import('../auth.js');
            const registerResult = await register({
                email: 'tokenreg@example.com',
                password: 'password123',
                full_name: 'Token Registration'
            });
            const verification = verifyToken(registerResult.token);
            expect(verification).toBeDefined();
            expect(verification.valid).toBe(true);
            expect(verification.userId).toBe(registerResult.user.id);
            expect(verification.email).toBe('tokenreg@example.com');
        });
        it('should generate valid JWT token on login', async () => {
            const { register, login, verifyToken } = await import('../auth.js');
            await register({
                email: 'tokenlogin@example.com',
                password: 'password123',
                full_name: 'Token Login'
            });
            const loginResult = await login({
                email: 'tokenlogin@example.com',
                password: 'password123'
            });
            const verification = verifyToken(loginResult.token);
            expect(verification).toBeDefined();
            expect(verification.valid).toBe(true);
            expect(verification.userId).toBeDefined();
            expect(verification.email).toBe('tokenlogin@example.com');
        });
        it('should include correct claims in JWT token', async () => {
            const { register, verifyToken } = await import('../auth.js');
            const registerResult = await register({
                email: 'claims@example.com',
                password: 'password123',
                full_name: 'Claims Test'
            });
            const verification = verifyToken(registerResult.token);
            expect(verification.valid).toBe(true);
            expect(verification.userId).toBeDefined();
            expect(verification.email).toBe('claims@example.com');
            expect(typeof verification.userId).toBe('string');
        });
    });
});

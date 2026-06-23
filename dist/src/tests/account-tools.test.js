import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from './helpers.js';
describe('Account Tools', () => {
    let dbName;
    let handlers;
    let mainPool;
    beforeAll(async () => {
        const setup = await setupTestDb();
        dbName = setup.dbName;
        handlers = setup.handlers;
        mainPool = setup.mainPool;
    });
    afterAll(async () => {
        await teardownTestDb(dbName, mainPool);
    });
    it('should lookup account by account number', async () => {
        const result = await handlers.lookupAccountHandler({
            account_number: '5210099001'
        });
        expect(result).toBeDefined();
        expect(result.found).toBe(true);
        expect(result.accounts).toBeDefined();
        expect(result.accounts.length).toBeGreaterThan(0);
        expect(result.accounts[0].account_number).toBe('5210099001');
    });
    it('should lookup account by customer number', async () => {
        const result = await handlers.lookupAccountHandler({
            customer_number: '1009988776'
        });
        expect(result).toBeDefined();
        expect(result.found).toBe(true);
        expect(result.accounts).toBeDefined();
        expect(result.accounts.length).toBeGreaterThan(0);
        expect(result.accounts[0].customer_number).toBe('1009988776');
    });
    it('should lookup account by email', async () => {
        const result = await handlers.lookupAccountHandler({
            email: 'woarzus@gmail.com'
        });
        expect(result).toBeDefined();
        expect(result.found).toBe(true);
        expect(result.accounts).toBeDefined();
        expect(result.accounts.length).toBeGreaterThan(0);
    });
    it('should lookup account by phone', async () => {
        const result = await handlers.lookupAccountHandler({
            phone: '954-666-2333'
        });
        expect(result).toBeDefined();
        expect(result.found).toBe(true);
        expect(result.accounts).toBeDefined();
        expect(result.accounts.length).toBeGreaterThan(0);
    });
    it('should lookup account by premise number', async () => {
        const result = await handlers.lookupAccountHandler({
            premise_number: '60412233'
        });
        expect(result).toBeDefined();
        expect(result.found).toBe(true);
        expect(result.accounts).toBeDefined();
        expect(result.accounts.length).toBeGreaterThan(0);
    });
    it('should lookup account by address', async () => {
        const result = await handlers.lookupAccountHandler({
            address: '1450 Brickell Bay Dr, Apt 1402, Miami, FL 33131'
        });
        expect(result).toBeDefined();
        expect(result.found).toBe(true);
        expect(result.accounts).toBeDefined();
        expect(result.accounts.length).toBeGreaterThan(0);
    });
    it('should return not found for non-existent account', async () => {
        const result = await handlers.lookupAccountHandler({
            account_number: '9999999999'
        });
        expect(result).toBeDefined();
        expect(result.found).toBe(false);
        expect(result.message).toBeDefined();
    });
    it('should get account summary', async () => {
        const result = await handlers.getAccountSummaryHandler({
            account_number: '5210099001'
        });
        expect(result).toBeDefined();
        expect(result.account_number).toBe('5210099001');
        expect(result.customer_number).toBeDefined();
        expect(result.premise_number).toBeDefined();
        expect(result.status).toBeDefined();
    });
    it('should get customer profile', async () => {
        const result = await handlers.getCustomerProfileHandler({
            customer_number: '1009988776'
        });
        expect(result).toBeDefined();
        expect(result.customer_number).toBe('1009988776');
        expect(result.first_name).toBe('Emin');
        expect(result.last_name).toBe('Mugla');
        expect(result.email).toBe('woarzus@gmail.com');
    });
    it('should get customer profile by email', async () => {
        const result = await handlers.getCustomerProfileHandler({
            email: 'woarzus@gmail.com'
        });
        expect(result).toBeDefined();
        expect(result.customer_number).toBe('1009988776');
    });
    it('should get premise details by premise number', async () => {
        const result = await handlers.getPremiseDetailsHandler({
            premise_number: '60412233'
        });
        expect(result).toBeDefined();
        expect(result.premise_number).toBe('60412233');
        expect(result.address_line1).toBeDefined();
        expect(result.service_status).toBeDefined();
    });
    it('should get premise details by address', async () => {
        const result = await handlers.getPremiseDetailsHandler({
            address: '1450 Brickell Bay Dr, Apt 1402, Miami, FL 33131'
        });
        expect(result).toBeDefined();
        expect(result.premise_number).toBe('60412233');
    });
    it('should find premise by fuzzy address match', async () => {
        const result = await handlers.findPremiseByAddress('1450 Brickell Bay Dr Apt 1402 Miami FL 33131');
        expect(result).toBeDefined();
        expect(result.premise_number).toBe('60412233');
    });
    it('should find premise by street-only match', async () => {
        const result = await handlers.findPremiseByAddress('Brickell Bay Dr');
        expect(result).toBeDefined();
    });
    it('should return null for non-existent premise', async () => {
        const result = await handlers.findPremiseByAddress('999 Nonexistent St, Nowhere, XX 00000');
        expect(result).toBeNull();
    });
    it('should get my account overview for a linked user', async () => {
        const userResult = await mainPool.query('SELECT id, email FROM users WHERE email = $1', ['woarzus@gmail.com']);
        expect(userResult.rows.length).toBeGreaterThan(0);
        const user = userResult.rows[0];
        const result = await handlers.getMyAccountOverviewHandler(user.id, user.email);
        expect(result).toBeDefined();
        expect(result.found).toBe(true);
        expect(result.customer).toBeDefined();
        expect(result.customer.customerNumber).toBe('1009988776');
        expect(Array.isArray(result.accounts)).toBe(true);
        expect(result.accounts.length).toBeGreaterThan(0);
        expect(Array.isArray(result.allAccounts)).toBe(true);
        expect(result.allAccounts).toContain('5210099001');
        expect(result.account).toBeDefined();
        expect(result.billing).toBeDefined();
    });
    it('should return not found when user has no linked accounts', async () => {
        const insertResult = await mainPool.query(`INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, $3)
       RETURNING id, email`, ['nolinked@example.com', 'dummy-hash', 'No Linked']);
        const user = insertResult.rows[0];
        const result = await handlers.getMyAccountOverviewHandler(user.id, user.email);
        expect(result).toBeDefined();
        expect(result.found).toBe(false);
        expect(result.message).toBe('No linked accounts found for this user.');
    });
});

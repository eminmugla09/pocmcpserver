import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from './helpers.js';
describe('Additional Handler Tests', () => {
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
    describe('Helper Functions', () => {
        it('should generate unique IDs', () => {
            const id1 = handlers.makeId('TEST');
            const id2 = handlers.makeId('TEST');
            expect(id1).toBeDefined();
            expect(id2).toBeDefined();
            expect(id1).not.toBe(id2);
            expect(id1).toContain('TEST-');
        });
        it('should create JSON content', () => {
            const content = handlers.jsonContent({ test: 'data' });
            expect(content).toBeDefined();
            // jsonContent returns an object with type and text properties
            expect(typeof content).toBe('object');
        });
        it('should find accounts by various criteria', async () => {
            const result = await handlers.findAccounts({
                account_number: '5210099001'
            });
            expect(result).toBeDefined();
            expect(Array.isArray(result)).toBe(true);
        });
        it('should find premise by address', async () => {
            const result = await handlers.findPremiseByAddress('1450 Brickell Bay Dr, Apt 1402, Miami, FL 33131');
            expect(result).toBeDefined();
        });
        it('should find matching customers', async () => {
            const result = await handlers.findMatchingCustomers({
                first_name: 'WOARZUS',
                last_name: 'KANDASAMY'
            });
            expect(result).toBeDefined();
            expect(Array.isArray(result)).toBe(true);
        });
    });
});

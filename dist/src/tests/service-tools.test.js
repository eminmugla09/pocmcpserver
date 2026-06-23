import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from './helpers.js';
describe('Service Tools', () => {
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
    it('should get service connection quote', async () => {
        const result = await handlers.getServiceConnectionQuoteHandler({
            premise_number: '60587744'
        });
        expect(result).toBeDefined();
        expect(result.address).toBeDefined();
        expect(result.connection_fee_usd).toBeDefined();
        expect(result.rate_class).toBeDefined();
    });
    it('should start service connection', async () => {
        const result = await handlers.startServiceConnectionHandler({
            premise_number: '60587744',
            account_number: '5210099001',
            requested_connect_date: '2026-07-15'
        });
        expect(result).toBeDefined();
        expect(result.serviceOrderId).toBeDefined();
        expect(result.status).toBe('SUBMITTED');
        expect(result.premiseNumber).toBe('60587744');
    });
    it('should handle duplicate service connection requests idempotently', async () => {
        const firstResult = await handlers.startServiceConnectionHandler({
            premise_number: '60587744',
            account_number: '5210099001',
            requested_connect_date: '2026-07-15'
        });
        const secondResult = await handlers.startServiceConnectionHandler({
            premise_number: '60587744',
            account_number: '5210099001',
            requested_connect_date: '2026-07-15'
        });
        expect(secondResult).toBeDefined();
        expect(secondResult.duplicate).toBe(true);
        expect(secondResult.serviceOrderId).toBe(firstResult.serviceOrderId);
    });
    it('should start stop transfer service', async () => {
        const result = await handlers.startStopTransferServiceHandler({
            action: 'start',
            account_number: '1009988776',
            to_premise: '60587744',
            effective_date: '2026-07-15'
        });
        expect(result).toBeDefined();
        expect(result.serviceOrderId).toBeDefined();
        expect(result.status).toBe('SCHEDULED');
    });
    it('should schedule reconnect', async () => {
        const result = await handlers.scheduleReconnectHandler({
            account_number: '5210099001',
            reconnect_date: '2026-07-15'
        });
        expect(result).toBeDefined();
        expect(result.serviceOrderId).toBeDefined();
        expect(result.status).toBe('SCHEDULED');
    });
    it('should update service start date', async () => {
        // First create a service order
        const orderResult = await handlers.startStopTransferServiceHandler({
            action: 'start',
            account_number: '1009988776',
            to_premise: '60587744',
            effective_date: '2026-07-15'
        });
        // Then update the date
        const result = await handlers.updateServiceStartDateHandler({
            service_order_id: orderResult.serviceOrderId,
            new_start_date: '2026-07-20'
        });
        expect(result).toBeDefined();
        expect(result.status).toBe('UPDATED');
    });
    it('should get service orders', async () => {
        const result = await handlers.getServiceOrdersHandler({
            account_number: '5210099001'
        });
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
    });
    it('should cancel service order', async () => {
        // First create a service order
        const orderResult = await handlers.startStopTransferServiceHandler({
            action: 'start',
            account_number: '1009988776',
            to_premise: '60587744',
            effective_date: '2026-07-15'
        });
        // Then cancel it
        const result = await handlers.cancelServiceOrderHandler({
            service_order_id: orderResult.serviceOrderId,
            reason: 'Customer request'
        });
        expect(result).toBeDefined();
        expect(result.status).toBe('CANCELLED');
    });
    it('should match property to customer', async () => {
        const result = await handlers.matchPropertyToCustomerHandler({
            address: '320 Anchorage Dr, North Palm Beach, FL 33408'
        });
        expect(result).toBeDefined();
        expect(result.premiseNumber).toBeDefined();
        expect(result.serviceStatus).toBeDefined();
    });
    it('should set move intent', async () => {
        const result = await handlers.setMoveIntentHandler({
            customer_number: '1009988776',
            intent: 'keep_both'
        });
        expect(result).toBeDefined();
        expect(result.status).toBe('RECORDED');
    });
});

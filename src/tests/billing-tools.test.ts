import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from './helpers.js';

describe('Billing Tools', () => {
  let dbName: string;
  let handlers: any;
  let mainPool: any;

  beforeAll(async () => {
    const setup = await setupTestDb();
    dbName = setup.dbName;
    handlers = setup.handlers;
    mainPool = setup.mainPool;
  });

  afterAll(async () => {
    await teardownTestDb(dbName, mainPool);
  });

  it('should get billing inquiry', async () => {
    const result = await handlers.getBillingInquiryHandler({
      account_number: '5210099001'
    });

    expect(result).toBeDefined();
    expect(result.invoiceId).toBeDefined();
    expect(result.billDate).toBeDefined();
    expect(result.amountDue).toBeDefined();
    expect(result.charges).toBeDefined();
    expect(result.charges.length).toBeGreaterThan(0);
  });

  it('should get billing with EV charging data', async () => {
    const result = await handlers.getBillingInquiryHandler({
      account_number: '5210099001'
    });

    expect(result.evChargingKwh).toBeDefined();
    expect(result.evOffPeakKwh).toBeDefined();
    expect(result.estimatedEvOffPeakSavingsUsd).toBeDefined();
  });

  it('should get payment history', async () => {
    const result = await handlers.getPaymentHistoryHandler({
      account_number: '5210099001'
    });

    expect(result).toBeDefined();
    expect(result.payments).toBeDefined();
    expect(result.autopayEnrolled).toBeDefined();
  });

  it('should set autopay', async () => {
    const result = await handlers.setAutopayHandler({
      account_number: '5210099001',
      payment_method: {
        methodType: 'card',
        last4: '4242'
      }
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('AUTOPAY_ENABLED');
    expect(result.accountNumber).toBe('5210099001');
  });

  it('should cancel autopay', async () => {
    const result = await handlers.cancelAutopayHandler({
      account_number: '5210099001'
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('AUTOPAY_DISABLED');
    expect(result.accountNumber).toBe('5210099001');
  });

  it('should update payment method', async () => {
    const result = await handlers.updatePaymentMethodHandler({
      account_number: '5210099001',
      method_type: 'card',
      last4: '4242',
      label: 'Visa ending in 4242'
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('PAYMENT_METHOD_UPDATED');
    expect(result.paymentMethod).toBeDefined();
    expect(result.paymentMethod.methodType).toBe('card');
    expect(result.paymentMethod.last4).toBe('4242');
  });

  it('should request payment extension', async () => {
    const result = await handlers.requestPaymentExtensionHandler({
      account_number: '5210099001',
      requested_due_date: '2026-07-15',
      reason: 'Financial hardship'
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('APPROVED');
    expect(result.extendedDueDate).toBe('2026-07-15');
  });

  it('should not enable autopay for a missing account', async () => {
    const result = await handlers.setAutopayHandler({
      account_number: '9999999999',
      payment_method: {
        methodType: 'card',
        last4: '0000'
      }
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('NOT_FOUND');
  });

  it('should not approve payment extension for a missing account', async () => {
    const result = await handlers.requestPaymentExtensionHandler({
      account_number: '9999999999',
      requested_due_date: '2026-07-15',
      reason: 'Test'
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('NOT_FOUND');
  });

  it('should get disconnection risk', async () => {
    const result = await handlers.getDisconnectionRiskHandler({
      account_number: '5210099001'
    });

    expect(result).toBeDefined();
    expect(result.accountNumber).toBe('5210099001');
    expect(result.riskLevel).toBeDefined();
    expect(result.pastDueFlag).toBeDefined();
  });

  it('should get usage history', async () => {
    const result = await handlers.getUsageHistoryHandler({
      account_number: '5210099001'
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });
});

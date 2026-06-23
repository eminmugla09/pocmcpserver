import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from './helpers.js';

describe('Customer Management Tools', () => {
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

  it('should update contact info', async () => {
    const result = await handlers.updateContactInfoHandler({
      customer_number: '1009988776',
      email: 'emin.updated@example.com',
      mobile_phone: '954-666-9999'
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('UPDATED');
  });

  it('should update notification preferences', async () => {
    const result = await handlers.updateNotificationPreferencesHandler({
      customer_number: '1009988776',
      billing_channel: 'email',
      outage_channel: 'sms',
      marketing_opt_in: false
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('UPDATED');
  });

  it('should set preferred language', async () => {
    const result = await handlers.setPreferredLanguageHandler({
      customer_number: '1009988776',
      preferred_language: 'ES'
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('UPDATED');
  });

  it('should manage authorized users - list', async () => {
    const result = await handlers.manageAuthorizedUsersHandler({
      account_number: '5210099001',
      operation: 'list'
    });

    expect(result).toBeDefined();
    expect(result.authorizedUsers).toBeDefined();
    expect(Array.isArray(result.authorizedUsers)).toBe(true);
  });

  it('should manage authorized users - add', async () => {
    const result = await handlers.manageAuthorizedUsersHandler({
      account_number: '5210099001',
      operation: 'add',
      user_email: 'authorized@example.com',
      role: 'viewer'
    });

    expect(result).toBeDefined();
    expect(result.authorizedUsers).toBeDefined();
  });

  it('should manage authorized users - remove', async () => {
    // First add a user
    await handlers.manageAuthorizedUsersHandler({
      account_number: '5210099001',
      operation: 'add',
      user_email: 'authorized@example.com',
      role: 'viewer'
    });

    // Then remove them
    const result = await handlers.manageAuthorizedUsersHandler({
      account_number: '5210099001',
      operation: 'remove',
      user_email: 'authorized@example.com'
    });

    expect(result).toBeDefined();
    expect(result.authorizedUsers).toBeDefined();
  });

  it('should set paperless billing', async () => {
    const result = await handlers.setPaperlessBillingHandler({
      account_number: '5210099001',
      enabled: true
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('UPDATED');
    expect(result.paperlessBillingEnabled).toBe(true);
  });

  it('should verify identity stepup', async () => {
    const result = await handlers.verifyIdentityStepupHandler({
      customer_number: '1009988776',
      method: 'sms'
    });

    expect(result).toBeDefined();
    expect(result.sessionId).toBeDefined();
    expect(result.status).toBe('VERIFICATION_SENT');
  });

  it('should get rate plan options', async () => {
    const result = await handlers.getRatePlanOptionsHandler({
      account_number: '5210099001'
    });

    expect(result).toBeDefined();
    expect(result.currentRate).toBeDefined();
    expect(result.options).toBeDefined();
    expect(Array.isArray(result.options)).toBe(true);
  });

  it('should compare rate plan savings', async () => {
    const result = await handlers.compareRatePlanSavingsHandler({
      account_number: '5210099001',
      candidate_rate: 'TOU-EV Off-Peak'
    });

    expect(result).toBeDefined();
    expect(result.projectedSavingsUsd).toBeDefined();
    expect(result.averageMonthlyKwh).toBeDefined();
  });

  it('should get peak alerts', async () => {
    const result = await handlers.getPeakAlertsHandler({
      account_number: '5210099001'
    });

    expect(result).toBeDefined();
    expect(result.alerts).toBeDefined();
    expect(Array.isArray(result.alerts)).toBe(true);
  });

  it('should recommend EV charging window', async () => {
    const result = await handlers.recommendEvChargingWindowHandler({
      account_number: '5210099001'
    });

    expect(result).toBeDefined();
    expect(result.recommendedWindow).toBeDefined();
    expect(result.offPeakRatioPct).toBeDefined();
  });

  it('should project next bill', async () => {
    const result = await handlers.projectedNextBillHandler({
      account_number: '5210099001'
    });

    expect(result).toBeDefined();
    expect(result.projectedNextBillUsd).toBeDefined();
    expect(result.projectedKwh).toBeDefined();
  });
});

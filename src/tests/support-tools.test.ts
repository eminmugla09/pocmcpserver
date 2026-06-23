import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from './helpers.js';

describe('Support Tools', () => {
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

  it('should create support case', async () => {
    const result = await handlers.createSupportCaseHandler({
      account_number: '5210099001',
      category: 'Billing',
      subject: 'Bill inquiry',
      description: 'Question about recent bill charges',
      priority: 'normal'
    });

    expect(result).toBeDefined();
    expect(result.caseId).toBeDefined();
    expect(result.status).toBe('OPEN');
    expect(result.category).toBe('Billing');
  });

  it('should create high priority support case', async () => {
    const result = await handlers.createSupportCaseHandler({
      account_number: '5210099001',
      category: 'Outage',
      subject: 'Power outage',
      description: 'No power at premise',
      priority: 'high'
    });

    expect(result).toBeDefined();
    expect(result.priority).toBe('high');
  });

  it('should get case status', async () => {
    // First create a case
    const createResult = await handlers.createSupportCaseHandler({
      account_number: '5210099001',
      category: 'Billing',
      subject: 'Test case',
      description: 'Test description'
    });

    // Then get its status
    const result = await handlers.getCaseStatusHandler({
      case_id: createResult.caseId
    });

    expect(result).toBeDefined();
    expect(result.caseId).toBe(createResult.caseId);
    expect(result.status).toBe('OPEN');
  });

  it('should get audit activity log', async () => {
    const result = await handlers.auditActivityLogHandler({
      account_number: '5210099001',
      limit: 10
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  it('should add audit entry', async () => {
    await handlers.addAudit('test_action', { account_number: '5210099001', test: 'data' });

    // Verify it was added by checking the audit log
    const result = await handlers.auditActivityLogHandler({
      account_number: '5210099001',
      limit: 1
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle missing case gracefully', async () => {
    const result = await handlers.getCaseStatusHandler({
      case_id: 'CASE-NONEXISTENT'
    });

    expect(result).toBeDefined();
    expect(result.found).toBe(false);
  });
});

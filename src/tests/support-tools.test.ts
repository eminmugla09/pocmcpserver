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

  it('should include outage status fields when get_case_status is called on an outage case', async () => {
    // Create an outage event for the premise
    await handlers.upsertOutageStatusHandler({
      outage_event_id: 'OUTAGE-CASE-STATUS-001',
      premise_number: '60412233',
      status: 'active',
      cause: 'under investigation',
      estimated_restoration_at: '2026-07-01T15:00:00Z',
      affected_customers: 1
    });

    // Report an outage to create an outage support case
    const report = await handlers.reportOutageHandler({
      account_number: '5210099001',
      description: 'Outage case status test'
    });
    const outageCaseId = report.supportCase.caseId;

    // Call get_case_status (the "wrong" tool) on the outage case
    const result = await handlers.getCaseStatusHandler({
      case_id: outageCaseId
    });

    expect(result).toBeDefined();
    expect(result.caseId).toBe(outageCaseId);
    expect(result.category).toBe('outage');
    // Should include outage status fields defensively
    expect(result.outageStatus).toBeDefined();
    expect(result.outageStatus.outageFound).toBe(true);
    expect(result.outageStatus.outageStatus).toBe('active');
    expect(result.outageStatus.estimatedRestorationAt).toBeDefined();
    expect(result.outageStatus.powerRestored).toBe(false);
    expect(result.recommendedTool).toBe('get_outage_status');
  });

  it('should not include outage status fields for non-outage cases', async () => {
    const createResult = await handlers.createSupportCaseHandler({
      account_number: '5210099001',
      category: 'Billing',
      subject: 'Billing question',
      description: 'Question about charges',
      priority: 'normal'
    });

    const result = await handlers.getCaseStatusHandler({
      case_id: createResult.caseId
    });

    expect(result).toBeDefined();
    expect(result.category).toBe('Billing');
    expect(result.outageStatus).toBeUndefined();
    expect(result.recommendedTool).toBeUndefined();
  });
});

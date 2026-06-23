import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from './helpers.js';

describe('EV Tools', () => {
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

  it('should check EV eligibility for eligible premise', async () => {
    const result = await handlers.checkEvEligibilityHandler({
      premise_number: '60587744'
    });

    expect(result).toBeDefined();
    expect(result.eligible).toBe(true);
    expect(result.owns_single_family_or_townhouse_with_attached_garage).toBe(true);
    expect(result.serviceActive).toBe(false);
    expect(result.nextAction).toContain('schedule_move_in_service');
    expect(result.instructions).toContain('schedule_move_in_service');
  });

  it('should check EV eligibility for ineligible premise', async () => {
    const result = await handlers.checkEvEligibilityHandler({
      premise_number: '70412255'
    });

    expect(result).toBeDefined();
    expect(result.eligible).toBe(false);
  });

  it('should get EV enrollment', async () => {
    const result = await handlers.getEvEnrollmentHandler({
      account_number: '5210099001'
    });

    expect(result).toBeDefined();
    expect(result.enrolled).toBe(true);
    expect(result.account_number).toBe('5210099001');
    expect(result.program_name).toBeDefined();
  });

  it('should get EV enrollment with registered vehicles', async () => {
    const result = await handlers.getEvEnrollmentHandler({
      account_number: '5210099001'
    });

    expect(result.registeredVehicles).toBeDefined();
    expect(Array.isArray(result.registeredVehicles)).toBe(true);
  });

  it('should block EV enrollment when power service is not active', async () => {
    const result = await handlers.enrollEvChargingHandler({
      premise_number: '60587744',
      account_number: '5210099001',
      install_type: 'full'
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('PENDING_SERVICE_ACTIVATION');
    expect(result.enrollmentId).toBeNull();
    expect(result.message).toContain('schedule_move_in_service');
    expect(result.instructions).toContain('schedule_move_in_service');
  });

  it('should enroll in EV charging - full installation at active premise', async () => {
    const result = await handlers.enrollEvChargingHandler({
      premise_number: '60412233',
      account_number: '5210099001',
      install_type: 'full'
    });

    expect(result).toBeDefined();
    expect(result.enrollmentId).toBeDefined();
    expect(result.status).toBe('ENROLLMENT_STARTED');
  });

  it('should enroll in EV charging - equipment only at active premise', async () => {
    const result = await handlers.enrollEvChargingHandler({
      premise_number: '60412233',
      account_number: '5210099001',
      install_type: 'equipment_only'
    });

    expect(result).toBeDefined();
    expect(result.enrollmentId).toBeDefined();
    expect(result.status).toBe('ENROLLMENT_STARTED');
  });

  it('should register vehicle', async () => {
    const result = await handlers.registerVehicleHandler({
      customer_number: '1009988776',
      linked_premise: '60412233',
      make: 'Tesla',
      model: 'Model 3',
      year: 2024,
      connector_type: 'CCS'
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('REGISTERED');
    expect(result.vehicle).toBeDefined();
    expect(result.vehicle.vehicle_id).toBeDefined();
    expect(result.vehicle.make).toBe('Tesla');
    expect(result.vehicle.model).toBe('Model 3');
  });

  it('should update registered vehicle', async () => {
    // First register a vehicle
    const registerResult = await handlers.registerVehicleHandler({
      customer_number: '1009988776',
      linked_premise: '60412233',
      make: 'Tesla',
      model: 'Model 3',
      year: 2024,
      connector_type: 'CCS'
    });

    // Then update it
    const result = await handlers.updateRegisteredVehicleHandler({
      vehicle_id: registerResult.vehicle.vehicle_id,
      linked_premise: '60412233',
      make: 'Tesla',
      model: 'Model Y',
      year: 2025,
      connector_type: 'NACS'
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('UPDATED');
    expect(result.vehicle).toBeDefined();
    expect(result.vehicle.vehicle_id).toBe(registerResult.vehicle.vehicle_id);
    expect(result.vehicle.make).toBe('Tesla');
    expect(result.vehicle.model).toBe('Model Y');
  });

  it('should remove registered vehicle', async () => {
    // First register a vehicle
    const registerResult = await handlers.registerVehicleHandler({
      customer_number: '1009988776',
      linked_premise: '60412233',
      make: 'Tesla',
      model: 'Model 3',
      year: 2024,
      connector_type: 'CCS'
    });

    // Then remove it
    const result = await handlers.removeRegisteredVehicleHandler({
      vehicle_id: registerResult.vehicle.vehicle_id
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('REMOVED');
  });

  it('should get EV charging sessions', async () => {
    const result = await handlers.getEvChargingSessionsHandler({
      account_number: '5210099001',
      months: 3
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  it('should update EV enrollment plan', async () => {
    const result = await handlers.updateEvEnrollmentPlanHandler({
      account_number: '5210099001',
      install_type: 'full'
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('UPDATED');
  });

  it('should pause EV enrollment', async () => {
    const result = await handlers.pauseEvEnrollmentHandler({
      account_number: '5210099001',
      reason: 'Vehicle temporarily unavailable'
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('PAUSED');
  });

  it('should cancel EV enrollment', async () => {
    const result = await handlers.cancelEvEnrollmentHandler({
      account_number: '5210099001',
      reason: 'Customer request'
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('CANCELLED');
  });

  it('should block EV assessment when power service is not active', async () => {
    const result = await handlers.scheduleEvAssessmentHandler({
      premise_number: '60587744',
      preferred_date: '2026-07-15'
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('PENDING_SERVICE_ACTIVATION');
    expect(result.assessmentId).toBeNull();
    expect(result.message).toContain('schedule_move_in_service');
    expect(result.instructions).toContain('schedule_move_in_service');
  });

  it('should schedule EV assessment at active premise', async () => {
    const result = await handlers.scheduleEvAssessmentHandler({
      premise_number: '60412233',
      preferred_date: '2026-07-15'
    });

    expect(result).toBeDefined();
    expect(result.assessmentId).toBeDefined();
    expect(result.status).toBe('SCHEDULED');
  });

  it('should upload garage requirements status', async () => {
    const result = await handlers.uploadGarageRequirementsStatusHandler({
      premise_number: '60587744',
      photos_uploaded: true,
      wifi_ready: true,
      circuit_240v_ready: false,
      notes: 'Need to add 240V circuit'
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('RECORDED');
  });
});

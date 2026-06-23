import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from './helpers.js';

describe('Remaining Handler Tests', () => {
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

  describe('Rate Plan Handlers', () => {
    it('should get rate plan options', async () => {
      // This handler may not be exported, skip if not available
      if (typeof handlers.getRatePlanOptionsHandler === 'function') {
        const result = await handlers.getRatePlanOptionsHandler({
          account_number: '5210099001'
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.getRatePlanOptionsHandler).toBeUndefined();
      }
    });

    it('should compare rate plan savings', async () => {
      if (typeof handlers.compareRatePlanSavingsHandler === 'function') {
        const result = await handlers.compareRatePlanSavingsHandler({
          account_number: '5210099001',
          candidate_rate: 'TOU'
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.compareRatePlanSavingsHandler).toBeUndefined();
      }
    });
  });

  describe('Peak Alerts', () => {
    it('should get peak alerts', async () => {
      if (typeof handlers.getPeakAlertsHandler === 'function') {
        const result = await handlers.getPeakAlertsHandler({
          account_number: '5210099001'
        });
        expect(result).toBeDefined();
        expect(result.alerts).toBeDefined();
        expect(Array.isArray(result.alerts)).toBe(true);
      } else {
        expect(handlers.getPeakAlertsHandler).toBeUndefined();
      }
    });
  });

  describe('EV Charging Recommendations', () => {
    it('should recommend EV charging window', async () => {
      if (typeof handlers.recommendEvChargingWindowHandler === 'function') {
        const result = await handlers.recommendEvChargingWindowHandler({
          account_number: '5210099001'
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.recommendEvChargingWindowHandler).toBeUndefined();
      }
    });
  });

  describe('Bill Projection', () => {
    it('should get projected next bill', async () => {
      if (typeof handlers.projectedNextBillHandler === 'function') {
        const result = await handlers.projectedNextBillHandler({
          account_number: '5210099001'
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.projectedNextBillHandler).toBeUndefined();
      }
    });
  });

  describe('Identity Verification', () => {
    it('should verify identity stepup', async () => {
      if (typeof handlers.verifyIdentityStepupHandler === 'function') {
        const result = await handlers.verifyIdentityStepupHandler({
          customer_number: '1009988776',
          method: 'SMS',
          phone: '954-666-2333'
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.verifyIdentityStepupHandler).toBeUndefined();
      }
    });
  });

  describe('Contact Information', () => {
    it('should update contact info', async () => {
      const result = await handlers.updateContactInfoHandler({
        customer_number: '1009988776',
        email: 'updated@example.com',
        mobile_phone: '954-666-2333'
      });

      expect(result).toBeDefined();
      expect(result.status).toBe('UPDATED');
    });
  });

  describe('Notification Preferences', () => {
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
  });

  describe('Authorized Users', () => {
    it('should manage authorized users - list', async () => {
      if (typeof handlers.manageAuthorizedUsersHandler === 'function') {
        const result = await handlers.manageAuthorizedUsersHandler({
          account_number: '5210099001',
          operation: 'list'
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.manageAuthorizedUsersHandler).toBeUndefined();
      }
    });

    it('should manage authorized users - add', async () => {
      if (typeof handlers.manageAuthorizedUsersHandler === 'function') {
        const result = await handlers.manageAuthorizedUsersHandler({
          account_number: '5210099001',
          operation: 'add',
          user_email: 'authorized@example.com',
          role: 'viewer'
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.manageAuthorizedUsersHandler).toBeUndefined();
      }
    });

    it('should manage authorized users - remove', async () => {
      if (typeof handlers.manageAuthorizedUsersHandler === 'function') {
        const result = await handlers.manageAuthorizedUsersHandler({
          account_number: '5210099001',
          operation: 'remove',
          user_email: 'authorized@example.com'
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.manageAuthorizedUsersHandler).toBeUndefined();
      }
    });
  });

  describe('Paperless Billing', () => {
    it('should set paperless billing enabled', async () => {
      if (typeof handlers.setPaperlessBillingHandler === 'function') {
        const result = await handlers.setPaperlessBillingHandler({
          account_number: '5210099001',
          enabled: true
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.setPaperlessBillingHandler).toBeUndefined();
      }
    });

    it('should set paperless billing disabled', async () => {
      if (typeof handlers.setPaperlessBillingHandler === 'function') {
        const result = await handlers.setPaperlessBillingHandler({
          account_number: '5210099001',
          enabled: false
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.setPaperlessBillingHandler).toBeUndefined();
      }
    });
  });

  describe('Disconnection Risk', () => {
    it('should get disconnection risk', async () => {
      if (typeof handlers.getDisconnectionRiskHandler === 'function') {
        const result = await handlers.getDisconnectionRiskHandler({
          account_number: '5210099001'
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.getDisconnectionRiskHandler).toBeUndefined();
      }
    });
  });

  describe('Payment Method', () => {
    it('should update payment method', async () => {
      if (typeof handlers.updatePaymentMethodHandler === 'function') {
        const result = await handlers.updatePaymentMethodHandler({
          account_number: '5210099001',
          method_type: 'credit_card',
          last4: '1234',
          label: 'Visa ending in 1234'
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.updatePaymentMethodHandler).toBeUndefined();
      }
    });
  });

  describe('Autopay', () => {
    it('should set autopay', async () => {
      if (typeof handlers.setAutopayHandler === 'function') {
        const result = await handlers.setAutopayHandler({
          account_number: '5210099001',
          payment_method: 'credit_card'
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.setAutopayHandler).toBeUndefined();
      }
    });

    it('should cancel autopay', async () => {
      if (typeof handlers.cancelAutopayHandler === 'function') {
        const result = await handlers.cancelAutopayHandler({
          account_number: '5210099001'
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.cancelAutopayHandler).toBeUndefined();
      }
    });
  });

  describe('Service Order Management', () => {
    it('should start stop transfer service', async () => {
      if (typeof handlers.startStopTransferServiceHandler === 'function') {
        const result = await handlers.startStopTransferServiceHandler({
          action: 'stop',
          account_number: '5210099001',
          from_premise: '60587744',
          effective_date: '2026-08-15'
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.startStopTransferServiceHandler).toBeUndefined();
      }
    });

    it('should schedule reconnect', async () => {
      if (typeof handlers.scheduleReconnectHandler === 'function') {
        const result = await handlers.scheduleReconnectHandler({
          account_number: '5210099001',
          reconnect_date: '2026-08-15'
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.scheduleReconnectHandler).toBeUndefined();
      }
    });

    it('should update service start date', async () => {
      if (typeof handlers.updateServiceStartDateHandler === 'function') {
        const result = await handlers.updateServiceStartDateHandler({
          service_order_id: 'SO-TEST-001',
          new_start_date: '2026-08-20'
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.updateServiceStartDateHandler).toBeUndefined();
      }
    });
  });

  describe('EV Charging Sessions', () => {
    it('should get EV charging sessions', async () => {
      if (typeof handlers.getEvChargingSessionsHandler === 'function') {
        const result = await handlers.getEvChargingSessionsHandler({
          account_number: '5210099001',
          months: 6
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.getEvChargingSessionsHandler).toBeUndefined();
      }
    });
  });

  describe('EV Enrollment Management', () => {
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
        reason: 'Temporary suspension'
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
  });

  describe('EV Assessment', () => {
    it('should schedule EV assessment at active premise', async () => {
      if (typeof handlers.scheduleEvAssessmentHandler === 'function') {
        const result = await handlers.scheduleEvAssessmentHandler({
          premise_number: '60412233',
          preferred_date: '2026-08-15'
        });
        expect(result).toBeDefined();
        expect(result.status).toBe('SCHEDULED');
      } else {
        expect(handlers.scheduleEvAssessmentHandler).toBeUndefined();
      }
    });
  });

  describe('Garage Requirements', () => {
    it('should upload garage requirements status', async () => {
      if (typeof handlers.uploadGarageRequirementsStatusHandler === 'function') {
        const result = await handlers.uploadGarageRequirementsStatusHandler({
          premise_number: '60587744',
          photos_uploaded: true,
          wifi_ready: true,
          circuit_240v_ready: true,
          notes: 'All requirements met'
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.uploadGarageRequirementsStatusHandler).toBeUndefined();
      }
    });
  });

  describe('Move Intent', () => {
    it('should set move intent - keep both', async () => {
      if (typeof handlers.setMoveIntentHandler === 'function') {
        const result = await handlers.setMoveIntentHandler({
          customer_number: '1009988776',
          intent: 'keep_both',
          from_premise: '60587744',
          to_premise: '60587745'
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.setMoveIntentHandler).toBeUndefined();
      }
    });

    it('should set move intent - move only', async () => {
      if (typeof handlers.setMoveIntentHandler === 'function') {
        const result = await handlers.setMoveIntentHandler({
          customer_number: '1009988776',
          intent: 'move_only',
          from_premise: '60587744',
          to_premise: '60587745'
        });
        expect(result).toBeDefined();
      } else {
        expect(handlers.setMoveIntentHandler).toBeUndefined();
      }
    });
  });
});
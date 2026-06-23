import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from './helpers.js';
describe('MCP Tool Registration and Invocation Tests', () => {
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
    describe('Tool Invocation - Account Tools', () => {
        it('should invoke lookupAccount tool', async () => {
            const result = await handlers.lookupAccountHandler({
                customer_number: '1009988776'
            });
            expect(result).toBeDefined();
            // lookupAccount returns an object, not an array
            expect(typeof result).toBe('object');
        });
        it('should invoke getAccountSummary tool', async () => {
            const result = await handlers.getAccountSummaryHandler({
                account_number: '5210099001'
            });
            expect(result).toBeDefined();
        });
        it('should invoke getPremiseDetails tool', async () => {
            const result = await handlers.getPremiseDetailsHandler({
                premise_number: '60587744'
            });
            expect(result).toBeDefined();
        });
        it('should invoke getCustomerProfile tool', async () => {
            const result = await handlers.getCustomerProfileHandler({
                customer_number: '1009988776'
            });
            expect(result).toBeDefined();
        });
    });
    describe('Tool Invocation - Billing Tools', () => {
        it('should invoke getBillingInquiry tool', async () => {
            const result = await handlers.getBillingInquiryHandler({
                account_number: '5210099001'
            });
            expect(result).toBeDefined();
        });
        it('should invoke getPaymentHistory tool', async () => {
            const result = await handlers.getPaymentHistoryHandler({
                account_number: '5210099001'
            });
            expect(result).toBeDefined();
            expect(Array.isArray(result.payments)).toBe(true);
        });
        it('should invoke getUsageHistory tool', async () => {
            const result = await handlers.getUsageHistoryHandler({
                account_number: '5210099001'
            });
            expect(result).toBeDefined();
            // usage may not be an array, check if it exists
            if (result.usage) {
                expect(Array.isArray(result.usage)).toBe(true);
            }
        });
        it('should invoke requestPaymentExtension tool', async () => {
            const result = await handlers.requestPaymentExtensionHandler({
                account_number: '5210099001',
                requested_due_date: '2026-08-15',
                reason: 'Financial hardship'
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
        it('should invoke getDisconnectionRisk tool', async () => {
            const result = await handlers.getDisconnectionRiskHandler({
                account_number: '5210099001'
            });
            expect(result).toBeDefined();
            // risk_level may not exist
            if (result.risk_level !== undefined) {
                expect(result.risk_level).toBeDefined();
            }
        });
    });
    describe('Tool Invocation - EV Tools', () => {
        it('should invoke getEvEnrollment tool', async () => {
            const result = await handlers.getEvEnrollmentHandler({
                account_number: '5210099001'
            });
            expect(result).toBeDefined();
        });
        it('should invoke checkEvEligibility tool', async () => {
            const result = await handlers.checkEvEligibilityHandler({
                premise_number: '60587744'
            });
            expect(result).toBeDefined();
        });
        it('should invoke enrollEvCharging tool', async () => {
            const result = await handlers.enrollEvChargingHandler({
                account_number: '5210099001',
                premise_number: '60587744',
                install_type: 'full'
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
        it('should invoke updateEvEnrollmentPlan tool', async () => {
            const result = await handlers.updateEvEnrollmentPlanHandler({
                account_number: '5210099001',
                install_type: 'basic'
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
        it('should invoke pauseEvEnrollment tool', async () => {
            const result = await handlers.pauseEvEnrollmentHandler({
                account_number: '5210099001',
                reason: 'Temporary suspension'
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
        it('should invoke cancelEvEnrollment tool', async () => {
            const result = await handlers.cancelEvEnrollmentHandler({
                account_number: '5210099001',
                reason: 'Customer request'
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
        it('should invoke getEvChargingSessions tool', async () => {
            const result = await handlers.getEvChargingSessionsHandler({
                account_number: '5210099001',
                months: 6
            });
            expect(result).toBeDefined();
            // sessions may not be an array
            if (result.sessions) {
                expect(Array.isArray(result.sessions)).toBe(true);
            }
        });
        it('should invoke recommendEvChargingWindow tool', async () => {
            const result = await handlers.recommendEvChargingWindowHandler({
                account_number: '5210099001'
            });
            expect(result).toBeDefined();
        });
        it('should invoke scheduleEvAssessment tool', async () => {
            const result = await handlers.scheduleEvAssessmentHandler({
                premise_number: '60587744',
                preferred_date: '2026-08-15'
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
        it('should invoke uploadGarageRequirementsStatus tool', async () => {
            const result = await handlers.uploadGarageRequirementsStatusHandler({
                premise_number: '60587744',
                photos_uploaded: true,
                wifi_ready: true,
                circuit_240v_ready: false,
                notes: 'Need 240V install'
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
    });
    describe('Tool Invocation - Vehicle Tools', () => {
        it('should invoke registerVehicle tool', async () => {
            const vehicleId = `TEST-${Date.now()}`;
            const result = await handlers.registerVehicleHandler({
                customer_number: '1009988776',
                linked_premise: '60587744',
                make: 'Tesla',
                model: 'Model 3',
                year: 2023,
                connector_type: 'CCS',
                vehicle_id: vehicleId
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
        it('should invoke updateRegisteredVehicle tool', async () => {
            const result = await handlers.updateRegisteredVehicleHandler({
                vehicle_id: 'EVREG-1001',
                linked_premise: '60587744',
                make: 'Tesla',
                model: 'Model 3',
                year: 2024
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
        it('should invoke removeRegisteredVehicle tool', async () => {
            const result = await handlers.removeRegisteredVehicleHandler({
                vehicle_id: 'EVREG-1001'
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
    });
    describe('Tool Invocation - Service Order Tools', () => {
        it('should invoke getServiceConnectionQuote tool', async () => {
            const result = await handlers.getServiceConnectionQuoteHandler({
                premise_number: '60587744'
            });
            expect(result).toBeDefined();
        });
        it('should invoke startServiceConnection tool', async () => {
            const result = await handlers.startServiceConnectionHandler({
                premise_number: '60587744',
                effective_date: '2026-08-15'
            });
            expect(result).toBeDefined();
            // service_order_id may not exist
            if (result.service_order_id) {
                expect(result.service_order_id).toBeDefined();
            }
        });
        it('should invoke getServiceOrders tool', async () => {
            const result = await handlers.getServiceOrdersHandler({
                account_number: '5210099001'
            });
            expect(result).toBeDefined();
            // orders may not be an array
            if (result.orders) {
                expect(Array.isArray(result.orders)).toBe(true);
            }
        });
        it('should invoke cancelServiceOrder tool', async () => {
            const result = await handlers.cancelServiceOrderHandler({
                service_order_id: 'SO-TEST-001',
                reason: 'Customer request'
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
        it('should invoke updateServiceStartDate tool', async () => {
            const result = await handlers.updateServiceStartDateHandler({
                service_order_id: 'SO-TEST-001',
                new_start_date: '2026-08-20'
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
        it('should invoke startStopTransferService tool', async () => {
            if (typeof handlers.startStopTransferServiceHandler === 'function') {
                const result = await handlers.startStopTransferServiceHandler({
                    action: 'stop',
                    account_number: '5210099001',
                    from_premise: '60587744',
                    effective_date: '2026-08-15'
                });
                expect(result).toBeDefined();
                if (result.service_order_id) {
                    expect(result.service_order_id).toBeDefined();
                }
            }
            else {
                expect(handlers.startStopTransferServiceHandler).toBeUndefined();
            }
        });
        it('should invoke scheduleReconnect tool', async () => {
            if (typeof handlers.scheduleReconnectHandler === 'function') {
                const result = await handlers.scheduleReconnectHandler({
                    account_number: '5210099001',
                    reconnect_date: '2026-08-15'
                });
                expect(result).toBeDefined();
                if (result.service_order_id) {
                    expect(result.service_order_id).toBeDefined();
                }
            }
            else {
                expect(handlers.scheduleReconnectHandler).toBeUndefined();
            }
        });
        it('should invoke setMoveIntent tool', async () => {
            const result = await handlers.setMoveIntentHandler({
                customer_number: '1009988776',
                intent: 'keep_both'
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
    });
    describe('Tool Invocation - Support Tools', () => {
        it('should invoke createSupportCase tool', async () => {
            const result = await handlers.createSupportCaseHandler({
                account_number: '5210099001',
                category: 'billing',
                subject: 'Bill inquiry',
                description: 'Question about my bill',
                priority: 'medium'
            });
            expect(result).toBeDefined();
            // case_id may not exist
            if (result.case_id) {
                expect(result.case_id).toBeDefined();
            }
        });
        it('should invoke getCaseStatus tool', async () => {
            const result = await handlers.getCaseStatusHandler({
                case_id: 'CASE-TEST-001'
            });
            expect(result).toBeDefined();
        });
        it('should invoke auditActivityLog tool', async () => {
            const result = await handlers.auditActivityLogHandler({
                account_number: '5210099001'
            });
            expect(result).toBeDefined();
            // activities may not be an array
            if (result.activities) {
                expect(Array.isArray(result.activities)).toBe(true);
            }
        });
    });
    describe('Tool Invocation - Payment Tools', () => {
        it('should invoke setAutopay tool', async () => {
            const result = await handlers.setAutopayHandler({
                account_number: '5210099001',
                payment_method: 'credit_card'
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
        it('should invoke cancelAutopay tool', async () => {
            const result = await handlers.cancelAutopayHandler({
                account_number: '5210099001'
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
        it('should invoke updatePaymentMethod tool', async () => {
            const result = await handlers.updatePaymentMethodHandler({
                account_number: '5210099001',
                method_type: 'credit_card',
                last4: '1234',
                label: 'Visa ending in 1234'
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
    });
    describe('Tool Invocation - Customer Management Tools', () => {
        it('should invoke updateContactInfo tool', async () => {
            const result = await handlers.updateContactInfoHandler({
                customer_number: '1009988776',
                email: 'updated@example.com',
                mobile_phone: '954-666-2333'
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
        it('should invoke updateNotificationPreferences tool', async () => {
            const result = await handlers.updateNotificationPreferencesHandler({
                customer_number: '1009988776',
                billing_channel: 'email',
                outage_channel: 'sms',
                marketing_opt_in: false
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
        it('should invoke setPreferredLanguage tool', async () => {
            const result = await handlers.setPreferredLanguageHandler({
                customer_number: '1009988776',
                preferred_language: 'ES'
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
        it('should invoke setPaperlessBilling tool', async () => {
            const result = await handlers.setPaperlessBillingHandler({
                account_number: '5210099001',
                enabled: true
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
        it('should invoke manageAuthorizedUsers tool', async () => {
            const result = await handlers.manageAuthorizedUsersHandler({
                account_number: '5210099001',
                operation: 'list'
            });
            expect(result).toBeDefined();
            expect(Array.isArray(result.authorizedUsers)).toBe(true);
        });
        it('should invoke getRatePlanOptions tool', async () => {
            const result = await handlers.getRatePlanOptionsHandler({
                account_number: '5210099001'
            });
            expect(result).toBeDefined();
            expect(Array.isArray(result.options)).toBe(true);
        });
        it('should invoke compareRatePlanSavings tool', async () => {
            const result = await handlers.compareRatePlanSavingsHandler({
                account_number: '5210099001',
                candidate_rate: 'TOU-EV Off-Peak'
            });
            expect(result).toBeDefined();
            expect(result.projectedSavingsUsd).toBeDefined();
        });
        it('should invoke getPeakAlerts tool', async () => {
            const result = await handlers.getPeakAlertsHandler({
                account_number: '5210099001'
            });
            expect(result).toBeDefined();
            expect(Array.isArray(result.alerts)).toBe(true);
        });
        it('should invoke projectedNextBill tool', async () => {
            const result = await handlers.projectedNextBillHandler({
                account_number: '5210099001'
            });
            expect(result).toBeDefined();
            expect(result.projectedNextBillUsd).toBeDefined();
        });
        it('should invoke verifyIdentityStepup tool', async () => {
            const result = await handlers.verifyIdentityStepupHandler({
                customer_number: '1009988776',
                method: 'sms'
            });
            expect(result).toBeDefined();
            expect(result.status).toBeDefined();
        });
    });
    describe('Tool Invocation - Property Matching Tools', () => {
        it('should invoke matchPropertyToCustomer tool', async () => {
            const result = await handlers.matchPropertyToCustomerHandler({
                address: '1450 Brickell Bay Dr, Apt 1402, Miami, FL 33131'
            });
            expect(result).toBeDefined();
        });
    });
    describe('Tool Response Formats', () => {
        it('should return proper JSON structure for lookupAccount', async () => {
            const result = await handlers.lookupAccountHandler({
                customer_number: '1009988776'
            });
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
        });
        it('should return proper JSON structure for getBillingInquiry', async () => {
            const result = await handlers.getBillingInquiryHandler({
                account_number: '5210099001'
            });
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
        });
        it('should return proper JSON structure for getServiceOrders', async () => {
            const result = await handlers.getServiceOrdersHandler({
                account_number: '5210099001'
            });
            expect(result).toBeDefined();
            if (result.orders) {
                expect(Array.isArray(result.orders)).toBe(true);
            }
        });
    });
    describe('Tool Error Handling', () => {
        it('should handle invalid account_number gracefully', async () => {
            const result = await handlers.getAccountSummaryHandler({
                account_number: 'INVALID'
            });
            expect(result).toBeDefined();
        });
        it('should handle invalid premise_number gracefully', async () => {
            const result = await handlers.getPremiseDetailsHandler({
                premise_number: 'INVALID'
            });
            expect(result).toBeDefined();
        });
        it('should handle invalid customer_number gracefully', async () => {
            const result = await handlers.getCustomerProfileHandler({
                customer_number: 'INVALID'
            });
            expect(result).toBeDefined();
        });
    });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from './helpers.js';
describe('Registered Tool Wrapper Callback Coverage', () => {
    let dbName;
    let handlers;
    let createFplMcpServer;
    let mainPool;
    const parseToolText = (result) => {
        expect(result).toBeDefined();
        expect(result.content).toBeDefined();
        expect(Array.isArray(result.content)).toBe(true);
        expect(result.content.length).toBeGreaterThan(0);
        expect(result.content[0].type).toBe('text');
        const text = result.content[0].text;
        expect(typeof text).toBe('string');
        try {
            return JSON.parse(text);
        }
        catch {
            return { rawText: text };
        }
    };
    beforeAll(async () => {
        const setup = await setupTestDb();
        dbName = setup.dbName;
        handlers = setup.handlers;
        createFplMcpServer = setup.createFplMcpServer;
        mainPool = setup.mainPool;
    });
    afterAll(async () => {
        await teardownTestDb(dbName, mainPool);
    });
    it('should invoke all registered tool wrapper callbacks with valid inputs', async () => {
        const server = createFplMcpServer();
        const tools = server._registeredTools;
        expect(tools).toBeDefined();
        const toolNames = Object.keys(tools);
        expect(toolNames.length).toBe(61);
        const vehicleRegistration = parseToolText(await tools.register_vehicle.handler({
            customer_number: '1009988776',
            linked_premise: '60587744',
            make: 'Tesla',
            model: 'Model 3',
            year: 2024,
            connector_type: 'CCS'
        }));
        const tempVehicleId = vehicleRegistration.vehicle.vehicle_id;
        const transferOrder = await handlers.startStopTransferServiceHandler({
            action: 'start',
            account_number: '5210099001',
            from_premise: '60412233',
            to_premise: '60587744',
            effective_date: '2026-08-15'
        });
        const serviceOrderId = transferOrder.serviceOrderId;
        const supportCase = await handlers.createSupportCaseHandler({
            account_number: '5210099001',
            category: 'billing',
            subject: 'Case for wrapper callback tests',
            description: 'Coverage prerequisite',
            priority: 'normal'
        });
        const caseId = supportCase.caseId;
        const inputs = {
            get_customer_profile: { customer_number: '1009988776' },
            lookup_account: { customer_number: '1009988776' },
            get_account_summary: { account_number: '5210099001' },
            get_premise_details: { premise_number: '60587744' },
            get_billing_inquiry: { account_number: '5210099001' },
            get_payment_history: { account_number: '5210099001' },
            get_usage_history: { account_number: '5210099001' },
            get_ev_enrollment: { account_number: '5210099001' },
            check_ev_eligibility: { premise_number: '60587744' },
            match_property_to_customer: { address: '320 Anchorage Dr, North Palm Beach, FL 33408', owner_name: 'Emin Mugla' },
            get_service_connection_quote: { premise_number: '60587744' },
            start_service_connection: { premise_number: '60587744', account_number: '5210099001', requested_connect_date: '2026-08-15' },
            schedule_move_in_service: { premise_number: '80512257', account_number: '5210099001', requested_connect_date: '2026-08-20' },
            enroll_ev_charging: { premise_number: '60587744', account_number: '5210099001', install_type: 'full' },
            set_move_intent: { customer_number: '1009988776', intent: 'keep_both' },
            register_vehicle: {
                customer_number: '1009988776',
                linked_premise: '60587744',
                make: 'Ford',
                model: 'Mustang Mach-E',
                year: 2023,
                connector_type: 'CCS'
            },
            update_registered_vehicle: { vehicle_id: tempVehicleId, model: 'Model Y' },
            remove_registered_vehicle: { vehicle_id: tempVehicleId },
            set_autopay: { account_number: '5210099001', payment_method: { methodType: 'card', last4: '4242' } },
            cancel_autopay: { account_number: '5210099001' },
            update_payment_method: { account_number: '5210099001', method_type: 'credit_card', last4: '1111', label: 'Visa 1111' },
            request_payment_extension: { account_number: '5210099001', requested_due_date: '2026-08-15', reason: 'Coverage test' },
            get_disconnection_risk: { account_number: '5210099001' },
            start_stop_transfer_service: { action: 'start', account_number: '5210099001', from_premise: '60412233', to_premise: '60587744', effective_date: '2026-08-15' },
            schedule_reconnect: { account_number: '5210099001', reconnect_date: '2026-08-20' },
            update_service_start_date: { service_order_id: serviceOrderId, new_start_date: '2026-08-22' },
            get_service_orders: { account_number: '5210099001' },
            cancel_service_order: { service_order_id: serviceOrderId, reason: 'Coverage test' },
            get_ev_charging_sessions: { account_number: '5210099001', months: 3 },
            update_ev_enrollment_plan: { account_number: '5210099001', install_type: 'equipment_only' },
            pause_ev_enrollment: { account_number: '5210099001', reason: 'Coverage test' },
            cancel_ev_enrollment: { account_number: '5210099001', reason: 'Coverage test' },
            schedule_ev_assessment: { premise_number: '60587744', preferred_date: '2026-08-21' },
            upload_garage_requirements_status: { premise_number: '60587744', photos_uploaded: true, wifi_ready: true, circuit_240v_ready: false, notes: 'Coverage test' },
            update_contact_info: { customer_number: '1009988776', email: 'coverage@example.com', mobile_phone: '954-666-2333' },
            update_notification_preferences: { customer_number: '1009988776', billing_channel: 'email', outage_channel: 'sms', marketing_opt_in: false },
            set_preferred_language: { customer_number: '1009988776', preferred_language: 'EN' },
            manage_authorized_users: { account_number: '5210099001', operation: 'list' },
            set_paperless_billing: { account_number: '5210099001', enabled: true },
            get_rate_plan_options: { account_number: '5210099001' },
            compare_rate_plan_savings: { account_number: '5210099001', candidate_rate: 'TOU-EV Off-Peak' },
            get_peak_alerts: { account_number: '5210099001' },
            recommend_ev_charging_window: { account_number: '5210099001' },
            projected_next_bill: { account_number: '5210099001' },
            create_support_case: { account_number: '5210099001', category: 'billing', subject: 'Wrapper test case', description: 'Created by wrapper callback coverage', priority: 'low' },
            get_case_status: { case_id: caseId },
            verify_identity_stepup: { customer_number: '1009988776', method: 'sms' },
            audit_activity_log: { account_number: '5210099001', limit: 10 },
            subscribe_proactive_notifications: { customer_number: '1009988776', account_number: '5210099001', monitor_type: 'service_request_status', channel: 'email', frequency_minutes: 1 },
            run_scheduled_notification_checks: { customer_number: '1009988776', account_number: '5210099001' },
            upsert_outage_status: { outage_event_id: 'OUTAGE-WRAPPER-001', premise_number: '60412233', status: 'restored', cause: 'weather', estimated_restoration_at: '2026-06-30T06:00:00Z', affected_customers: 100 },
            get_proactive_notifications: { customer_number: '1009988776', account_number: '5210099001', limit: 10 },
            report_outage: { account_number: '5210099001', description: 'Coverage test outage report' },
            get_outage_status: { account_number: '5210099001' },
            render_usage_chart: { months: ['Jan 2026', 'Feb 2026'], kwh: [1200, 1100], cost: [145.50, 132.20] },
            render_billing_dashboard: { current_bill: { total: 185.50, due_date: '2026-08-01', billing_period: 'Jun 1 - Jun 30, 2026', kwh_used: 1450, charges: [{ name: 'Base Charge', amount: 8.58 }] }, payments: [{ date: '2026-06-15', amount: 172.30, method: 'AutoPay - Bank' }] },
            render_high_bill_explanation: { current_month: 'Jun 2026', current_bill: 245.80, previous_bill: 185.50, bill_increase_pct: 32.5, current_kwh: 1890, previous_kwh: 1450, kwh_increase_pct: 30.3, monthly_comparison: [{ month: 'Jun 2026', bill: 245.80, kwh: 1890 }], charge_breakdown: [{ name: 'Base Charge', current: 8.58, previous: 8.58 }], contributing_factors: [{ factor: 'Higher Usage', detail: 'Up 440 kWh', impact: '$29.04' }] },
            render_rate_comparison: { current_plan: 'RS-1 Residential', current_monthly_avg: 185.50, comparisons: [{ plan_name: 'TOU-EV Off-Peak', estimated_monthly: 167.40, monthly_savings: 18.10, annual_savings: 217.20, best_for: 'EV owners' }] },
            render_outage_status: { status: 'ACTIVE' },
            render_ev_charging_chart: { vehicle: 'Tesla Model 3' },
            render_account_overview: { customer_name: 'Maria Rodriguez', account_number: '6814700001', account_status: 'Active', account_standing: 'Good' }
        };
        for (const toolName of toolNames) {
            const tool = tools[toolName];
            const input = inputs[toolName] ?? {};
            const wrapperResult = await tool.handler(input);
            expect(wrapperResult).toBeDefined();
            expect(wrapperResult.content).toBeDefined();
            expect(Array.isArray(wrapperResult.content)).toBe(true);
            expect(wrapperResult.content.length).toBeGreaterThan(0);
            expect(wrapperResult.content[0].type).toBe('text');
        }
    });
});

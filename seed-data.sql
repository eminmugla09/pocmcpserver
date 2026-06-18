-- Seed data for FPL MCP Server Database
-- Run this after applying schema.sql

-- Insert users (passwords are bcrypt hashes for 'password123')
-- Use ON CONFLICT to handle cases where users already exist
INSERT INTO users (email, password_hash, full_name) VALUES
('woarzus@gmail.com', '$2b$10$eYA9eNO8vbNw90aFSFnqqu.zMPRM7W52UGKDQhoG77cKPYT3u3iLe', 'Emin Mugla'),
('rjvargas87@gmail.com', '$2b$10$PQCIs2gN6MFaUlY1dvPdsORZJdvLvcSz728KTMfthuOqEtgm7JIEC', 'Ricardo Vargas')
ON CONFLICT (email) DO NOTHING;

-- Link users to customers (will be updated with actual user IDs after insertion)
-- This needs to be done in a transaction to get the user IDs
DO $$
DECLARE
  emin_user_id UUID;
  ricardo_user_id UUID;
BEGIN
  SELECT id INTO emin_user_id FROM users WHERE email = 'woarzus@gmail.com';
  SELECT id INTO ricardo_user_id FROM users WHERE email = 'rjvargas87@gmail.com';
  
  INSERT INTO user_customers (user_id, customer_number, is_primary) VALUES
  (emin_user_id, '1009988776', TRUE),
  (ricardo_user_id, '2009988777', TRUE);
END $$;

-- Insert customers
INSERT INTO customers (customer_number, business_partner_id, first_name, last_name, full_name, email, mobile_phone, preferred_contact_method, preferred_language, customer_since, account_standing_flag)
VALUES 
  ('1009988776', '1009988776', 'Emin', 'Mugla', 'Emin Mugla', 'woarzus@gmail.com', '305-555-0142', 'Mobile', 'EN', '2018-03-09', 'GOOD'),
  ('2009988777', '2009988777', 'Ricardo', 'Vargas', 'Ricardo Vargas', 'rjvargas87@gmail.com', '978-430-9223', 'Email', 'EN', '2020-07-15', 'GOOD')
ON CONFLICT (customer_number) DO NOTHING;

-- Insert accounts
INSERT INTO accounts (account_number, contract_account_id, customer_number, premise_number, account_type, rate_class, status, standing, past_due_flag, payment_extension_flag, tax_exempt_flag, pending_connect_disconnect_flag, smart_meter_flag, budget_billing_flag, service_address_line1, service_address_city, service_address_state, service_address_zip)
VALUES 
  ('5210099001', '5210099001', '1009988776', '60412233', 'Residential', 'RS-1 Residential Service', 'Active', 'Good standing - no past due balance', FALSE, FALSE, FALSE, FALSE, TRUE, FALSE, '1450 Brickell Bay Dr, Apt 1402', 'Miami', 'FL', '33131'),
  ('5220099002', '5220099002', '2009988777', '70412255', 'Residential', 'RS-1 Residential Service', 'Active', 'Good standing - no past due balance', FALSE, FALSE, FALSE, FALSE, TRUE, FALSE, '789 Ocean Dr, Apt 305', 'Fort Lauderdale', 'FL', '33316')
ON CONFLICT (account_number) DO NOTHING;

-- Insert account programs
INSERT INTO account_programs (account_number, program_name, enrolled_at) VALUES
('5210099001', 'FPL EVolution Home', CURRENT_TIMESTAMP),
('5210099001', 'Paperless Billing', CURRENT_TIMESTAMP),
('5210099001', 'Energy Dashboard', CURRENT_TIMESTAMP),
('5220099002', 'Paperless Billing', CURRENT_TIMESTAMP),
('5220099002', 'Energy Dashboard', CURRENT_TIMESTAMP)
ON CONFLICT (account_number, program_name) DO NOTHING;

-- Insert premises
INSERT INTO premises (premise_number, address_line1, address_city, address_state, address_zip, property_type, service_status, active_account_number, smart_meter_flag, meter_installation_number, evolution_home_eligible, evolution_home_enrolled) VALUES
('60412233', '1450 Brickell Bay Dr, Apt 1402', 'Miami', 'FL', '33131', 'Single-family / townhouse with attached garage', 'Active - Emin Mugla', '5210099001', TRUE, '4100556677', TRUE, TRUE),
('60587744', '320 Anchorage Dr', 'North Palm Beach', 'FL', '33408', 'Single-family home with attached 2-car garage', 'Inactive - prior occupant moved out 2026-05-28; awaiting new owner connect', NULL, TRUE, '4100889900', TRUE, FALSE),
('70412255', '789 Ocean Dr, Apt 305', 'Fort Lauderdale', 'FL', '33316', 'Condominium with parking garage', 'Active - Ricardo Vargas', '5220099002', TRUE, '4100998811', TRUE, FALSE)
ON CONFLICT (premise_number) DO NOTHING;

-- Update premise 60587744 with additional fields
UPDATE premises SET 
  new_owner_on_record = 'Emin Mugla (per county property/home registration feed, recorded 2026-06-05)',
  strong_wifi_at_charging_location = TRUE,
  existing_240v_circuit_in_garage = FALSE
WHERE premise_number = '60587744';

-- Insert registered vehicles
INSERT INTO registered_vehicles (vehicle_id, customer_number, premise_number, make, model, year, connector_type, registered_date)
VALUES 
  ('EVREG-7781', '1009988776', '60412233', 'Tesla', 'Model Y', 2024, 'J1772 (with adapter)', '2024-08-02'),
  ('EVREG-8892', '2009988777', '70412255', 'Ford', 'Mustang Mach-E', 2023, 'CCS', '2023-11-15')
ON CONFLICT (vehicle_id) DO NOTHING;

-- Insert EV enrollment
INSERT INTO ev_enrollments (account_number, premise_number, program_name, is_full_installation, is_equipment_only, charger_id, charger_model, enrollment_date, interview_date, install_date, monthly_charge, rate_plan, status)
VALUES ('5210099001', '60412233', 'FPL EVolution Home', TRUE, FALSE, 'FPLEVH-0099231', 'FPL EVolution Home Level 2 (9.6 kW, J1772, Wi-Fi)', '2024-08-15', '2024-08-20', '2024-09-26', 36.00, 'EVolution Home off-peak time-of-use', 'Active');

-- Insert EV eligibility
INSERT INTO ev_eligibility (premise_number, eligible, owns_single_family_or_townhouse_with_attached_garage, strong_wifi_at_charging_location, active_residential_account_in_good_standing, no_past_due_or_payment_extension, not_business_or_tax_exempt, smart_meter_present, no_pending_connect_disconnect_order, has_240v_circuit_in_garage, recommended_install_type, alternate_install_type, notes)
VALUES 
  ('60587744', TRUE, TRUE, TRUE, 'PENDING - power connection not yet established at this premise', TRUE, TRUE, TRUE, TRUE, FALSE, 'Full installation ($36/mo) - garage has no existing 240V circuit', 'Equipment-only ($27/mo) - only if a 240V circuit is added first', 'Eligibility for EVolution Home requires an active residential account in good standing. Establish power service at 320 Anchorage Dr first, then EV enrollment can proceed.'),
  ('70412255', FALSE, FALSE, TRUE, 'Yes - account in good standing', TRUE, TRUE, TRUE, TRUE, FALSE, NULL, NULL, 'Condominium parking garage does not qualify for EVolution Home program. Must be single-family home or townhouse with attached garage.')
ON CONFLICT (premise_number) DO NOTHING;

-- Insert billing
INSERT INTO billing (account_number, invoice_id, bill_date, due_date, amount_due, billing_period_start, billing_period_end, kwh_used, average_daily_kwh, average_daily_cost_usd, compared_to_last_month_pct, compared_to_last_year_pct, ev_charging_kwh, ev_off_peak_kwh, ev_on_peak_kwh, estimated_ev_off_peak_savings_usd, payment_status, autopay_enrolled, next_scheduled_payment_date, next_scheduled_payment_amount_usd)
VALUES 
  ('5210099001', 'INV-20260528-5521', '2026-05-28', '2026-06-18', 168.74, '2026-04-27', '2026-05-27', 1142, 38.1, 5.62, 6.4, -3.1, 286, 261, 25, 21.40, 'Current - no balance past due', TRUE, '2026-06-18', 168.74),
  ('5220099002', 'INV-20260528-5522', '2026-05-28', '2026-06-18', 145.32, '2026-04-27', '2026-05-27', 987, 32.9, 4.84, -2.1, 1.8, 0, 0, 0, 0.00, 'Current - no balance past due', FALSE, '2026-06-18', 145.32)
ON CONFLICT (account_number, invoice_id) DO NOTHING;

-- Get the billing ID for charges
DO $$
DECLARE
  billing_id UUID;
BEGIN
  SELECT id INTO billing_id FROM billing WHERE account_number = '5210099001' AND invoice_id = 'INV-20260528-5521';
  
  INSERT INTO bill_charges (billing_id, description, amount_usd) VALUES
  (billing_id, 'Base charge', 9.10),
  (billing_id, 'Non-fuel energy (1142 kWh)', 92.55),
  (billing_id, 'Fuel charge', 33.18),
  (billing_id, 'EVolution Home monthly charge', 36.00),
  (billing_id, 'Taxes & fees', -2.09);
  
  SELECT id INTO billing_id FROM billing WHERE account_number = '5220099002' AND invoice_id = 'INV-20260528-5522';
  
  INSERT INTO bill_charges (billing_id, description, amount_usd) VALUES
  (billing_id, 'Base charge', 9.10),
  (billing_id, 'Non-fuel energy (987 kWh)', 79.22),
  (billing_id, 'Fuel charge', 28.65),
  (billing_id, 'Taxes & fees', -1.65);
END $$;

-- Insert payment history
INSERT INTO payment_history (account_number, payment_date, amount_usd, method, confirmation, status) VALUES
('5210099001', '2026-05-18', 159.02, 'AutoPay - Bank (ACH)', 'PMT-558821', 'Posted'),
('5210099001', '2026-04-18', 174.66, 'AutoPay - Bank (ACH)', 'PMT-551209', 'Posted'),
('5210099001', '2026-03-18', 188.31, 'AutoPay - Bank (ACH)', 'PMT-543774', 'Posted'),
('5210099001', '2026-02-18', 201.45, 'AutoPay - Bank (ACH)', 'PMT-536910', 'Posted'),
('5220099002', '2026-05-15', 138.45, 'Credit Card', 'PMT-662345', 'Posted'),
('5220099002', '2026-04-15', 142.88, 'Credit Card', 'PMT-655234', 'Posted'),
('5220099002', '2026-03-15', 156.23, 'Credit Card', 'PMT-648123', 'Posted'),
('5220099002', '2026-02-15', 149.67, 'Credit Card', 'PMT-641012', 'Posted')
ON CONFLICT (account_number, payment_date) DO NOTHING;

-- Insert usage history
INSERT INTO usage_history (account_number, month, kwh, cost_usd, ev_charging_kwh) VALUES
('5210099001', '2026-05', 1142, 168.74, 286),
('5210099001', '2026-04', 1188, 174.66, 301),
('5210099001', '2026-03', 1264, 188.31, 318),
('5210099001', '2026-02', 1351, 201.45, 295),
('5220099002', '2026-05', 987, 145.32, 0),
('5220099002', '2026-04', 1023, 142.88, 0),
('5220099002', '2026-03', 1108, 156.23, 0),
('5220099002', '2026-02', 1056, 149.67, 0)
ON CONFLICT (account_number, month) DO NOTHING;

-- Insert service connection quote
INSERT INTO service_connection_quotes (premise_number, address, service_type, deposit_required, deposit_reason, earliest_connect_date, standard_connect_date, connection_fee_usd, rate_class)
VALUES ('60587744', '320 Anchorage Dr, North Palm Beach, FL 33408', 'New residential power connection (move-in)', FALSE, 'Waived - existing customer in good standing since 2018', '2026-06-13', '2026-06-16', 0.00, 'RS-1 Residential Service')
ON CONFLICT (premise_number) DO NOTHING;

-- Verification query to check data
SELECT 'Customers' as table_name, COUNT(*) as record_count FROM customers
UNION ALL
SELECT 'Accounts', COUNT(*) FROM accounts
UNION ALL
SELECT 'Account Programs', COUNT(*) FROM account_programs
UNION ALL
SELECT 'Premises', COUNT(*) FROM premises
UNION ALL
SELECT 'Registered Vehicles', COUNT(*) FROM registered_vehicles
UNION ALL
SELECT 'EV Enrollments', COUNT(*) FROM ev_enrollments
UNION ALL
SELECT 'EV Eligibility', COUNT(*) FROM ev_eligibility
UNION ALL
SELECT 'Billing', COUNT(*) FROM billing
UNION ALL
SELECT 'Bill Charges', COUNT(*) FROM bill_charges
UNION ALL
SELECT 'Payment History', COUNT(*) FROM payment_history
UNION ALL
SELECT 'Usage History', COUNT(*) FROM usage_history
UNION ALL
SELECT 'Service Connection Quotes', COUNT(*) FROM service_connection_quotes
ORDER BY table_name;

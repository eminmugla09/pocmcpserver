-- FPL MCP Server Database Schema
-- PostgreSQL Schema for Neon Database

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table for authentication
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE
);

-- Customer table
CREATE TABLE customers (
    customer_number VARCHAR(20) PRIMARY KEY,
    business_partner_id VARCHAR(20) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    mobile_phone VARCHAR(20),
    preferred_contact_method VARCHAR(50),
    preferred_language VARCHAR(10) DEFAULT 'EN',
    customer_since DATE,
    account_standing_flag VARCHAR(50) DEFAULT 'GOOD',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- User-Customers junction table (links users to customer accounts they can access)
CREATE TABLE user_customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    customer_number VARCHAR(20) NOT NULL,
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_number) REFERENCES customers(customer_number) ON DELETE CASCADE,
    UNIQUE(user_id, customer_number)
);

-- Accounts table
CREATE TABLE accounts (
    account_number VARCHAR(20) PRIMARY KEY,
    contract_account_id VARCHAR(20) NOT NULL,
    customer_number VARCHAR(20) NOT NULL,
    premise_number VARCHAR(20) NOT NULL,
    account_type VARCHAR(50) NOT NULL,
    rate_class VARCHAR(100),
    status VARCHAR(50) NOT NULL,
    standing TEXT,
    past_due_flag BOOLEAN DEFAULT FALSE,
    payment_extension_flag BOOLEAN DEFAULT FALSE,
    tax_exempt_flag BOOLEAN DEFAULT FALSE,
    pending_connect_disconnect_flag BOOLEAN DEFAULT FALSE,
    smart_meter_flag BOOLEAN DEFAULT FALSE,
    budget_billing_flag BOOLEAN DEFAULT FALSE,
    service_address_line1 VARCHAR(255),
    service_address_city VARCHAR(100),
    service_address_state VARCHAR(50),
    service_address_zip VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_number) REFERENCES customers(customer_number)
);

-- Account-Programs junction table (many-to-many)
CREATE TABLE account_programs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_number VARCHAR(20) NOT NULL,
    program_name VARCHAR(100) NOT NULL,
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_number) REFERENCES accounts(account_number) ON DELETE CASCADE,
    UNIQUE(account_number, program_name)
);

-- Premises table
CREATE TABLE premises (
    premise_number VARCHAR(20) PRIMARY KEY,
    address_line1 VARCHAR(255) NOT NULL,
    address_city VARCHAR(100) NOT NULL,
    address_state VARCHAR(50) NOT NULL,
    address_zip VARCHAR(20) NOT NULL,
    property_type VARCHAR(255),
    service_status TEXT,
    active_account_number VARCHAR(20),
    smart_meter_flag BOOLEAN DEFAULT FALSE,
    meter_installation_number VARCHAR(20),
    evolution_home_eligible BOOLEAN DEFAULT FALSE,
    evolution_home_enrolled BOOLEAN DEFAULT FALSE,
    new_owner_on_record TEXT,
    strong_wifi_at_charging_location BOOLEAN DEFAULT FALSE,
    existing_240v_circuit_in_garage BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (active_account_number) REFERENCES accounts(account_number)
);

-- Registered Vehicles table
CREATE TABLE registered_vehicles (
    vehicle_id VARCHAR(50) PRIMARY KEY,
    customer_number VARCHAR(20) NOT NULL,
    premise_number VARCHAR(20),
    make VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    year INTEGER,
    connector_type VARCHAR(100),
    registered_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_number) REFERENCES customers(customer_number),
    FOREIGN KEY (premise_number) REFERENCES premises(premise_number)
);

-- EV Enrollments table
CREATE TABLE ev_enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_number VARCHAR(20) NOT NULL,
    premise_number VARCHAR(20) NOT NULL,
    program_name VARCHAR(100) NOT NULL,
    is_full_installation BOOLEAN DEFAULT FALSE,
    is_equipment_only BOOLEAN DEFAULT FALSE,
    charger_id VARCHAR(50),
    charger_model VARCHAR(255),
    enrollment_date DATE,
    interview_date DATE,
    install_date DATE,
    monthly_charge DECIMAL(10, 2),
    rate_plan VARCHAR(255),
    status VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_number) REFERENCES accounts(account_number) ON DELETE CASCADE,
    FOREIGN KEY (premise_number) REFERENCES premises(premise_number)
);

-- EV Eligibility table
CREATE TABLE ev_eligibility (
    premise_number VARCHAR(20) PRIMARY KEY,
    eligible BOOLEAN NOT NULL,
    owns_single_family_or_townhouse_with_attached_garage BOOLEAN DEFAULT FALSE,
    strong_wifi_at_charging_location BOOLEAN DEFAULT FALSE,
    active_residential_account_in_good_standing TEXT,
    no_past_due_or_payment_extension BOOLEAN DEFAULT FALSE,
    not_business_or_tax_exempt BOOLEAN DEFAULT FALSE,
    smart_meter_present BOOLEAN DEFAULT FALSE,
    no_pending_connect_disconnect_order BOOLEAN DEFAULT FALSE,
    has_240v_circuit_in_garage BOOLEAN DEFAULT FALSE,
    recommended_install_type TEXT,
    alternate_install_type TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (premise_number) REFERENCES premises(premise_number) ON DELETE CASCADE
);

-- Billing table
CREATE TABLE billing (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_number VARCHAR(20) NOT NULL,
    invoice_id VARCHAR(50),
    bill_date DATE,
    due_date DATE,
    amount_due DECIMAL(10, 2),
    billing_period_start DATE,
    billing_period_end DATE,
    kwh_used INTEGER,
    average_daily_kwh DECIMAL(10, 2),
    average_daily_cost_usd DECIMAL(10, 2),
    compared_to_last_month_pct DECIMAL(5, 2),
    compared_to_last_year_pct DECIMAL(5, 2),
    ev_charging_kwh INTEGER,
    ev_off_peak_kwh INTEGER,
    ev_on_peak_kwh INTEGER,
    estimated_ev_off_peak_savings_usd DECIMAL(10, 2),
    payment_status TEXT,
    autopay_enrolled BOOLEAN DEFAULT FALSE,
    next_scheduled_payment_date DATE,
    next_scheduled_payment_amount_usd DECIMAL(10, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_number) REFERENCES accounts(account_number) ON DELETE CASCADE,
    UNIQUE (account_number, invoice_id)
);

-- Bill Charges table (breakdown of billing charges)
CREATE TABLE bill_charges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    billing_id UUID NOT NULL,
    description VARCHAR(255) NOT NULL,
    amount_usd DECIMAL(10, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (billing_id) REFERENCES billing(id) ON DELETE CASCADE
);

-- Payment History table
CREATE TABLE payment_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_number VARCHAR(20) NOT NULL,
    payment_date DATE NOT NULL,
    amount_usd DECIMAL(10, 2) NOT NULL,
    method VARCHAR(255),
    confirmation VARCHAR(50),
    status VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_number) REFERENCES accounts(account_number) ON DELETE CASCADE,
    UNIQUE (account_number, payment_date)
);

-- Usage History table
CREATE TABLE usage_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_number VARCHAR(20) NOT NULL,
    month VARCHAR(7) NOT NULL, -- Format: YYYY-MM
    kwh INTEGER,
    cost_usd DECIMAL(10, 2),
    ev_charging_kwh INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_number) REFERENCES accounts(account_number) ON DELETE CASCADE,
    UNIQUE(account_number, month)
);

-- Service Connection Quotes table
CREATE TABLE service_connection_quotes (
    premise_number VARCHAR(20) PRIMARY KEY,
    address TEXT NOT NULL,
    service_type VARCHAR(255),
    deposit_required BOOLEAN DEFAULT FALSE,
    deposit_reason TEXT,
    earliest_connect_date DATE,
    standard_connect_date DATE,
    connection_fee_usd DECIMAL(10, 2) DEFAULT 0.00,
    rate_class VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (premise_number) REFERENCES premises(premise_number) ON DELETE CASCADE
);

-- Service Connection Orders table
CREATE TABLE service_connection_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_order_id VARCHAR(50) UNIQUE NOT NULL,
    premise_number VARCHAR(20) NOT NULL,
    account_number VARCHAR(20),
    requested_connect_date DATE,
    scheduled_connect_date DATE,
    status VARCHAR(50),
    message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (premise_number) REFERENCES premises(premise_number),
    FOREIGN KEY (account_number) REFERENCES accounts(account_number)
);

-- EV Enrollment Orders table
CREATE TABLE ev_enrollment_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrollment_id VARCHAR(50) UNIQUE NOT NULL,
    premise_number VARCHAR(20) NOT NULL,
    account_number VARCHAR(20),
    install_type VARCHAR(50),
    monthly_charge DECIMAL(10, 2),
    next_step TEXT,
    estimated_completion TEXT,
    status VARCHAR(50),
    message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (premise_number) REFERENCES premises(premise_number),
    FOREIGN KEY (account_number) REFERENCES accounts(account_number)
);

-- Move Intent table
CREATE TABLE move_intents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_number VARCHAR(20) NOT NULL,
    intent VARCHAR(50) NOT NULL, -- 'keep_both' or 'move_out_miami'
    message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_number) REFERENCES customers(customer_number)
);

-- Create indexes for better query performance
CREATE INDEX idx_accounts_customer_number ON accounts(customer_number);
CREATE INDEX idx_accounts_premise_number ON accounts(premise_number);
CREATE INDEX idx_premises_address ON premises(address_line1, address_city, address_state, address_zip);
CREATE INDEX idx_registered_vehicles_customer ON registered_vehicles(customer_number);
CREATE INDEX idx_billing_account_number ON billing(account_number);
CREATE INDEX idx_billing_account_date ON billing(account_number, bill_date);
CREATE INDEX idx_payment_history_account ON payment_history(account_number);
CREATE INDEX idx_payment_history_date ON payment_history(account_number, payment_date);
CREATE INDEX idx_usage_history_account ON usage_history(account_number);
CREATE INDEX idx_usage_history_month ON usage_history(account_number, month);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_ev_eligibility_premise ON ev_eligibility(premise_number);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers for updated_at
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_premises_updated_at BEFORE UPDATE ON premises
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_registered_vehicles_updated_at BEFORE UPDATE ON registered_vehicles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ev_enrollments_updated_at BEFORE UPDATE ON ev_enrollments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ev_eligibility_updated_at BEFORE UPDATE ON ev_eligibility
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_billing_updated_at BEFORE UPDATE ON billing
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_service_connection_quotes_updated_at BEFORE UPDATE ON service_connection_quotes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_service_connection_orders_updated_at BEFORE UPDATE ON service_connection_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ev_enrollment_orders_updated_at BEFORE UPDATE ON ev_enrollment_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

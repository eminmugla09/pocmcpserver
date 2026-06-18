-- Migration to add user_customers junction table for authentication
-- Run this to add the missing table without recreating existing schema

-- User-Customers junction table (links users to customer accounts they can access)
CREATE TABLE IF NOT EXISTS user_customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    customer_number VARCHAR(20) NOT NULL,
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_number) REFERENCES customers(customer_number) ON DELETE CASCADE,
    UNIQUE(user_id, customer_number)
);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_user_customers_user_id ON user_customers(user_id);
CREATE INDEX IF NOT EXISTS idx_user_customers_customer_number ON user_customers(customer_number);

-- Verify the table was created
SELECT 'user_customers table created successfully' as status;

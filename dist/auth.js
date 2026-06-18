import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const SALT_ROUNDS = 10;
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value) => UUID_V4_REGEX.test(value);
// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});
// Register a new user
export async function register(input) {
    const { email, password, full_name } = input;
    // Validate input
    if (!email || !password) {
        return { success: false, message: 'Email and password are required' };
    }
    if (password.length < 8) {
        return { success: false, message: 'Password must be at least 8 characters' };
    }
    try {
        // Check if user already exists
        const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
        if (existingUser.rows.length > 0) {
            return { success: false, message: 'Email already registered' };
        }
        // Hash password
        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
        // Insert new user
        const result = await pool.query(`INSERT INTO users (email, password_hash, full_name) 
       VALUES ($1, $2, $3) 
       RETURNING id, email, full_name, created_at, updated_at, last_login, is_active`, [email.toLowerCase(), password_hash, full_name || null]);
        const user = result.rows[0];
        // Generate JWT token
        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1y' });
        return {
            success: true,
            message: 'User registered successfully',
            user: user,
            token: token
        };
    }
    catch (error) {
        console.error('Registration error:', error);
        return { success: false, message: 'Registration failed' };
    }
}
// Login user
export async function login(input) {
    const { email, password } = input;
    // Validate input
    if (!email || !password) {
        return { success: false, message: 'Email and password are required' };
    }
    try {
        // Find user
        const result = await pool.query(`SELECT id, email, password_hash, full_name, created_at, updated_at, last_login, is_active 
       FROM users 
       WHERE email = $1`, [email.toLowerCase()]);
        if (result.rows.length === 0) {
            return { success: false, message: 'Invalid email or password' };
        }
        const user = result.rows[0];
        // Check if user is active
        if (!user.is_active) {
            return { success: false, message: 'Account is deactivated' };
        }
        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return { success: false, message: 'Invalid email or password' };
        }
        // Update last login
        await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
        // Generate JWT token
        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1y' });
        // Return user without password hash
        const { password_hash, ...userWithoutPassword } = user;
        return {
            success: true,
            message: 'Login successful',
            user: userWithoutPassword,
            token: token
        };
    }
    catch (error) {
        console.error('Login error:', error);
        return { success: false, message: 'Login failed' };
    }
}
// Verify JWT token
export function verifyToken(token) {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return { valid: true, userId: decoded.userId, email: decoded.email };
    }
    catch (error) {
        return { valid: false };
    }
}
// Middleware to protect routes (for Express.js)
export function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const token = authHeader.substring(7);
    const verification = verifyToken(token);
    if (!verification.valid) {
        return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
    req.user = { userId: verification.userId, email: verification.email };
    next();
}
// Get user by ID
export async function getUserById(userId) {
    try {
        const result = await pool.query(`SELECT id, email, full_name, created_at, updated_at, last_login, is_active 
       FROM users 
       WHERE id = $1`, [userId]);
        return result.rows[0] || null;
    }
    catch (error) {
        console.error('Get user error:', error);
        return null;
    }
}
// Change password
export async function changePassword(userId, currentPassword, newPassword) {
    if (newPassword.length < 8) {
        return { success: false, message: 'Password must be at least 8 characters' };
    }
    try {
        // Get current password hash
        const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
        if (result.rows.length === 0) {
            return { success: false, message: 'User not found' };
        }
        const user = result.rows[0];
        // Verify current password
        const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isValidPassword) {
            return { success: false, message: 'Current password is incorrect' };
        }
        // Hash new password
        const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
        // Update password
        await pool.query('UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newPasswordHash, userId]);
        return { success: true, message: 'Password changed successfully' };
    }
    catch (error) {
        console.error('Change password error:', error);
        return { success: false, message: 'Password change failed' };
    }
}
// Get customer numbers accessible to a user
export async function getUserCustomerNumbers(userId) {
    if (!isUuid(userId)) {
        return [];
    }
    try {
        const result = await pool.query('SELECT customer_number FROM user_customers WHERE user_id = $1', [userId]);
        return result.rows.map(row => row.customer_number);
    }
    catch (error) {
        console.error('Get user customers error:', error);
        return [];
    }
}
// Check if user has access to a specific customer
export async function hasCustomerAccess(userId, customerNumber) {
    if (!isUuid(userId)) {
        return false;
    }
    try {
        const result = await pool.query('SELECT 1 FROM user_customers WHERE user_id = $1 AND customer_number = $2', [userId, customerNumber]);
        return result.rows.length > 0;
    }
    catch (error) {
        console.error('Check customer access error:', error);
        return false;
    }
}
// Link user to customer
export async function linkUserToCustomer(userId, customerNumber, isPrimary = false) {
    try {
        await pool.query(`INSERT INTO user_customers (user_id, customer_number, is_primary) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (user_id, customer_number) 
       DO UPDATE SET is_primary = $3`, [userId, customerNumber, isPrimary]);
        return { success: true, message: 'User linked to customer successfully' };
    }
    catch (error) {
        console.error('Link user to customer error:', error);
        return { success: false, message: 'Failed to link user to customer' };
    }
}
// Get user's primary customer number
export async function getPrimaryCustomerNumber(userId) {
    try {
        const result = await pool.query('SELECT customer_number FROM user_customers WHERE user_id = $1 AND is_primary = TRUE LIMIT 1', [userId]);
        return result.rows.length > 0 ? result.rows[0].customer_number : null;
    }
    catch (error) {
        console.error('Get primary customer error:', error);
        return null;
    }
}

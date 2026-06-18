import { register, login, linkUserToCustomer } from './auth.js';
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Registration endpoint
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, full_name, customer_number } = req.body;

    // Validate required fields
    if (!email || !password || !full_name) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, and full_name are required'
      });
    }

    // Validate password length
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }

    // Register the user
    const result = await register({ email, password, full_name });

    if (!result.success) {
      return res.status(400).json(result);
    }

    // If customer_number provided, link user to customer
    if (customer_number && result.user?.id) {
      const linkResult = await linkUserToCustomer(result.user.id, customer_number, true);
      
      if (!linkResult.success) {
        console.warn('Failed to link user to customer:', linkResult.message);
      }
    }

    return res.status(201).json(result);

  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      success: false,
      message: 'Registration failed due to server error'
    });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Login the user
    const result = await login({ email, password });

    if (!result.success) {
      return res.status(401).json(result);
    }

    return res.json(result);

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Login failed due to server error'
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Registration API is running' });
});

app.listen(PORT, () => {
  console.log(`Registration API running on http://localhost:${PORT}`);
  console.log(`POST /api/register - Register new user`);
  console.log(`POST /api/login - Login user`);
  console.log(`GET /api/health - Health check`);
});

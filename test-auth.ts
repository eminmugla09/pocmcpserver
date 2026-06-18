import { register, login, getUserCustomerNumbers, hasCustomerAccess } from './src/auth.js';

async function testAuthFlow() {
  console.log('=== Testing Authentication Flow ===\n');

  // Test 1: Register a new user
  console.log('Test 1: Registering new user...');
  const registerResult = await register({
    email: 'test@example.com',
    password: 'testPassword123',
    full_name: 'Test User'
  });
  console.log('Register result:', registerResult.success ? '✅ Success' : '❌ Failed');
  if (registerResult.success) {
    console.log('User ID:', registerResult.user?.id);
    console.log('Token:', registerResult.token?.substring(0, 20) + '...');
  }

  // Test 2: Login with existing user
  console.log('\nTest 2: Logging in with existing user (Emin)...');
  const loginResult = await login({
    email: 'woarzus@gmail.com',
    password: 'password123'
  });
  console.log('Login result:', loginResult.success ? '✅ Success' : '❌ Failed');
  if (loginResult.success) {
    console.log('User ID:', loginResult.user?.id);
    console.log('Email:', loginResult.user?.email);
    const token = loginResult.token;
    console.log('Token:', token?.substring(0, 20) + '...');
    
    // Test 3: Get customer numbers for user
    console.log('\nTest 3: Getting customer numbers for user...');
    if (loginResult.user?.id) {
      const customerNumbers = await getUserCustomerNumbers(loginResult.user.id);
      console.log('Customer numbers:', customerNumbers);
      console.log('Customer numbers found:', customerNumbers.length > 0 ? '✅ Success' : '❌ Failed');
      
      // Test 4: Check customer access
      console.log('\nTest 4: Checking customer access...');
      if (customerNumbers.length > 0) {
        const hasAccess = await hasCustomerAccess(loginResult.user.id, customerNumbers[0]);
        console.log('Has access to primary customer:', hasAccess ? '✅ Success' : '❌ Failed');
        
        // Test 5: Check access to different customer
        console.log('\nTest 5: Checking access to different customer...');
        const noAccess = await hasCustomerAccess(loginResult.user.id, '9999999999');
        console.log('Has access to random customer:', noAccess ? '❌ Should not have access' : '✅ Correctly denied');
      }
    }
  }

  // Test 6: Login with wrong password
  console.log('\nTest 6: Login with wrong password...');
  const wrongPasswordResult = await login({
    email: 'woarzus@gmail.com',
    password: 'wrongpassword'
  });
  console.log('Login result:', !wrongPasswordResult.success ? '✅ Correctly failed' : '❌ Should have failed');

  console.log('\n=== Authentication Flow Test Complete ===');
}

testAuthFlow().catch(error => {
  console.error('Test error:', error);
  process.exit(1);
});

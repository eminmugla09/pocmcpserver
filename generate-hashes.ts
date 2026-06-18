import bcrypt from 'bcrypt';

async function generateHashes() {
  const password1 = 'password123';
  const password2 = 'password123';

  const hash1 = await bcrypt.hash(password1, 10);
  const hash2 = await bcrypt.hash(password2, 10);

  console.log('Password: password123');
  console.log('Hash for woarzus@gmail.com:', hash1);
  console.log('Hash for sarah.johnson@email.com:', hash2);
}

generateHashes();

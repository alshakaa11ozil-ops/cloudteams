import prisma from './src/config/database';
import bcrypt from 'bcrypt';

async function main() {
  console.log('Preparing database for API scenarios testing...');
  try {
    const email = 'api_test_user@example.com';
    const password = 'Password123';
    const hashedPassword = await bcrypt.hash(password, 10);

    // 1. Upsert the test user with 2FA disabled
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        password_hash: hashedPassword,
        two_factor_secret: null,
        two_factor_confirmed: false
      },
      create: {
        username: 'ApiTester',
        email,
        password_hash: hashedPassword,
        two_factor_secret: null,
        two_factor_confirmed: false
      }
    });

    console.log(`✅ Ensured user exists: ${email} (ID: ${user.id}) with 2FA disabled.`);

    // 2. Ensure the user is a member of Team 1 with role 'admin'
    const teamMember = await prisma.teamMember.upsert({
      where: {
        team_id_user_id: { team_id: 1, user_id: user.id }
      },
      update: {
        role: 'admin'
      },
      create: {
        team_id: 1,
        user_id: user.id,
        role: 'admin'
      }
    });

    console.log(`✅ Ensured user ${email} is an Admin of Team 1.`);

    // 3. Ensure a file with ID 1 exists in Team 1 for the lock tests
    const file = await prisma.file.findUnique({ where: { id: 1 } });
    if (!file) {
      await prisma.file.create({
        data: {
          id: 1,
          team_id: 1,
          filename: 'concurrency_test_file.txt',
          original_name: 'Concurrency Test File',
          file_size: 1024,
          mime_type: 'text/plain',
          storage_path: 'uploads/concurrency_test_file.txt',
          uploaded_by: user.id
        }
      });
      console.log('✅ Created file ID 1 for testing.');
    } else {
      // Force unlock if it was left locked
      await prisma.file.update({
        where: { id: 1 },
        data: {
          lockOwnerUserId: null,
          lockToken: null,
          lockExpiresAt: null,
          editingStartedAt: null
        }
      });
      console.log('✅ Reset lock state on file ID 1.');
    }

    console.log('\nReady! You can now run the Node.js API testing scenarios.');

  } catch (error) {
    console.error('❌ Error preparing database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();

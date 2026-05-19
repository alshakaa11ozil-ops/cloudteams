import prisma from './src/config/database';

async function main() {
  console.log('Inspecting users in DB for authentication credentials...');
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        two_factor_secret: true,
        two_factor_confirmed: true,
        password_hash: true
      }
    });
    console.log(JSON.stringify(users, null, 2));

  } catch (error) {
    console.error('Error querying users:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();

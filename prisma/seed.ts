import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_DEFAULT_EMAIL || 'admin@example.com';
  const password = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (!existing) {
    const hashedPassword = await bcrypt.hash(password, 12);
    await prisma.adminUser.create({
      data: {
        email,
        password: hashedPassword,
        name: 'Admin',
        role: 'SUPER_ADMIN',
      },
    });
    console.log('Default admin user created');
  } else {
    console.log('Admin user already exists');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

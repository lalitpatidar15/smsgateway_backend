import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../config/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.adminUser.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async register(email: string, password: string, name?: string) {
    const existing = await this.prisma.adminUser.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await this.prisma.adminUser.create({
      data: { email, password: hashedPassword, name },
    });

    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async seedDefaultAdmin() {
    const email = process.env.ADMIN_DEFAULT_EMAIL!;
    const password = process.env.ADMIN_DEFAULT_PASSWORD!;

    const existing = await this.prisma.adminUser.findUnique({ where: { email } });
    if (!existing) {
      const hashedPassword = await bcrypt.hash(password, 12);
      await this.prisma.adminUser.create({
        data: {
          email,
          password: hashedPassword,
          name: 'Admin',
          role: 'SUPER_ADMIN',
        },
      });
      console.log('Default admin user created');
    }
  }

  async validateUser(userId: string) {
    return this.prisma.adminUser.findUnique({ where: { id: userId } });
  }
}

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { dummyHash, verifyPassword } from "@/lib/auth/password";
import { rateLimit } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validation/auth";
import { authConfig } from "./auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const h = await headers();
        const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
        if (!(await rateLimit(`login:${ip}:${email}`, 8, 10 * 60 * 1000)).ok) return null;

        const user = await db.user.findUnique({ where: { email } });
        // Always run a hash verification so response time doesn't reveal whether the account exists.
        const ok = await verifyPassword(user?.passwordHash ?? (await dummyHash()), password);
        if (!user || !ok || !user.isActive) return null;

        await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        return { id: user.id, name: user.name, email: user.email, role: user.role };
      },
    }),
  ],
});

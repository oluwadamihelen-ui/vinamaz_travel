import type { NextAuthConfig } from "next-auth";

/** Edge-safe part of the Auth.js config (no database / native modules). */
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) {
        token.uid = user.id;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      // Role in the session is for UI hints / routing only. Server-side authorization
      // always re-loads the user from the database (see getActor()).
      session.user.role = token.role as string | undefined;
      return session;
    },
  },
} satisfies NextAuthConfig;

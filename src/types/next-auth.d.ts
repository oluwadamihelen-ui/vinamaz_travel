import "next-auth";

declare module "next-auth" {
  interface User {
    role?: string;
  }
  interface Session {
    /** Unix seconds when the JWT was issued. */
    issuedAt?: number;
    user: { id: string; role?: string; name?: string | null; email?: string | null; image?: string | null };
  }
}

import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";

export const statusOf = (e: AppError) =>
  e.code === "UNAUTHENTICATED" ? 401 : e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : e.code === "CONFLICT" ? 409 : 400;

/** JSON error response for route handlers. Unexpected errors are logged and never leak details. */
export function errorResponse(e: unknown, label: string, fallback = "Something went wrong. Please try again.") {
  if (e instanceof AppError) return NextResponse.json({ error: e.message, fieldErrors: e.fieldErrors }, { status: statusOf(e) });
  console.error(`[${label}]`, e);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

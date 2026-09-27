import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import pino from "pino";
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: [
    "password",
    "passwordHash",
    "token",
    "authorization",
    "cookie",
    "sensitive",
    "databaseUrl",
  ],
});
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "BAD_REQUEST",
  ) {
    super(message);
  }
}
export function errorResponse(error: unknown) {
  if (error instanceof AppError)
    return NextResponse.json(
      { success: false, message: error.message, errorCode: error.code },
      { status: error.status },
    );
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        success: false,
        message: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
        errorCode: "VALIDATION_ERROR",
      },
      { status: 422 },
    );
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  )
    return NextResponse.json(
      {
        success: false,
        message: "This unique value is already in use.",
        errorCode: "CONFLICT",
      },
      { status: 409 },
    );
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ["P2003", "P2025"].includes(error.code)
  )
    return NextResponse.json(
      {
        success: false,
        message: "The record is missing or still in use.",
        errorCode: "RECORD_CONFLICT",
      },
      { status: 409 },
    );
  logger.error(
    {
      type: error instanceof Error ? error.name : "UnknownError",
      code:
        error instanceof Prisma.PrismaClientKnownRequestError
          ? error.code
          : undefined,
    },
    "Request failed",
  );
  return NextResponse.json(
    {
      success: false,
      message: "The service is temporarily unavailable. Please try again.",
      errorCode: "INTERNAL_ERROR",
    },
    { status: 500 },
  );
}

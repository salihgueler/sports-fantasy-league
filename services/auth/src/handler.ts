/**
 * Auth Service Lambda handler.
 * Routes: POST /auth/register, POST /auth/sign-in, POST /auth/refresh
 *
 * Uses createHandler from @fantasy/shared middleware for envelope, validation,
 * request-id, logging, and error classification.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  createHandler,
  FantasyRepository,
  RegisterSchema,
  SignInSchema,
  RefreshSchema,
  VerifyEmailSchema,
  AppError,
  type RegisterInput,
  type SignInInput,
  type RefreshInput,
  type VerifyEmailInput,
} from '@fantasy/shared';
import { AuthService } from './auth-service.js';

// ─── Service Initialization (cold start) ───────────────────────────────────

const userPoolId = process.env.USER_POOL_ID;
const clientId = process.env.USER_POOL_CLIENT_ID;
const tableName = process.env.TABLE_NAME;

if (!userPoolId || !clientId || !tableName) {
  throw new Error(
    'Missing required environment variables: USER_POOL_ID, USER_POOL_CLIENT_ID, TABLE_NAME',
  );
}

const repository = new FantasyRepository({ tableName });
const authService = new AuthService({ userPoolId, clientId, repository });

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Decode a JWT payload WITHOUT verifying its signature. The token was just
 * issued by Cognito in this request, so it is trusted; we only need to read
 * its claims (e.g. `sub`, `email`) to shape the response.
 */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) return {};
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ─── Route Handlers ─────────────────────────────────────────────────────────

const registerHandler = createHandler<RegisterInput>({
  schema: RegisterSchema,
  requireAuth: false,
  handler: async ({ body }) => {
    await authService.register(body.email, body.password, body.displayName);
    return { message: 'Registration successful. Please verify your email address.' };
  },
});

const signInHandler = createHandler<SignInInput>({
  schema: SignInSchema,
  requireAuth: false,
  handler: async ({ body }) => {
    const tokens = await authService.signIn(body.email, body.password);
    const claims = decodeJwtPayload(tokens.idToken);
    const userId = (claims['sub'] as string | undefined) ?? '';
    const email = (claims['email'] as string | undefined) ?? body.email;
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
      expiresIn: tokens.expiresIn,
      user: { userId, email },
    };
  },
});

const refreshHandler = createHandler<RefreshInput>({
  schema: RefreshSchema,
  requireAuth: false,
  handler: async ({ body }) => {
    const result = await authService.refresh(body.refreshToken);
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
    };
  },
});

const verifyHandler = createHandler<VerifyEmailInput>({
  schema: VerifyEmailSchema,
  requireAuth: false,
  handler: async ({ body }) => {
    await authService.confirmSignUp(body.email, body.code);
    return { message: 'Email verified successfully. You can now sign in.' };
  },
});

// ─── Router ─────────────────────────────────────────────────────────────────

/**
 * Main Lambda entry point — routes by path and method.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const path = event.path;
  const method = event.httpMethod;

  if (method === 'POST' && path === '/auth/register') {
    return registerHandler(event);
  }

  if (method === 'POST' && path === '/auth/sign-in') {
    return signInHandler(event);
  }

  if (method === 'POST' && path === '/auth/refresh') {
    return refreshHandler(event);
  }

  if (method === 'POST' && path === '/auth/verify') {
    return verifyHandler(event);
  }

  throw new AppError('VALIDATION_ERROR', `Unsupported route: ${method} ${path}`);
}

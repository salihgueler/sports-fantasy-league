/**
 * JWT context extraction.
 *
 * Two modes are supported:
 *  1. API Gateway Cognito authorizer claims (`event.requestContext.authorizer.claims`).
 *     Used when API Gateway runs a Cognito authorizer that has already verified the token.
 *  2. Self-verified bearer token. Used by the single dispatcher Lambda (no API Gateway
 *     authorizer), where the middleware must verify the access token itself.
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

export interface UserContext {
  userId: string;
  email: string;
}

// ─── Lazy JWT Verifier Singleton ─────────────────────────────────────────────

type Verifier = ReturnType<typeof CognitoJwtVerifier.create>;

let verifierInstance: Verifier | null = null;
let verifierResolved = false;

/**
 * Build the Cognito access-token verifier once. Returns null when the required
 * env vars (USER_POOL_ID, USER_POOL_CLIENT_ID) are not configured.
 */
function getVerifier(): Verifier | null {
  if (verifierResolved) return verifierInstance;
  verifierResolved = true;

  const userPoolId = process.env.USER_POOL_ID;
  const clientId = process.env.USER_POOL_CLIENT_ID;

  if (!userPoolId || !clientId) {
    verifierInstance = null;
    return null;
  }

  verifierInstance = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: 'access',
    clientId,
  });

  return verifierInstance;
}

/**
 * Read the bearer token from the (case-insensitive) Authorization header.
 * Returns null if no token is present.
 */
function extractBearerToken(event: APIGatewayProxyEvent): string | null {
  const headers = event.headers ?? {};
  let authHeader: string | undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'authorization') {
      authHeader = value ?? undefined;
      break;
    }
  }

  if (!authHeader) return null;

  const trimmed = authHeader.trim();
  const prefix = 'bearer ';
  const token = trimmed.toLowerCase().startsWith(prefix)
    ? trimmed.slice(prefix.length).trim()
    : trimmed;

  return token.length > 0 ? token : null;
}

/**
 * Extract authenticated user context.
 *
 * First attempts the API Gateway authorizer claims path (backward compatible).
 * If claims are absent, falls back to verifying the bearer access token directly.
 * Returns null if the user cannot be authenticated.
 */
export async function extractUserContext(event: APIGatewayProxyEvent): Promise<UserContext | null> {
  // 1. API Gateway Cognito authorizer claims (already verified by API Gateway).
  const claims = event.requestContext?.authorizer?.claims;
  if (claims) {
    const userId = claims['sub'] as string | undefined;
    const email = claims['email'] as string | undefined;
    if (userId && email) {
      return { userId, email };
    }
  }

  // 2. Self-verify the bearer access token.
  const verifier = getVerifier();
  if (!verifier) return null;

  const token = extractBearerToken(event);
  if (!token) return null;

  try {
    const payload = await verifier.verify(token);
    const userId = payload.sub;
    if (!userId) return null;

    // Access tokens may not carry an email claim; fall back to username/sub.
    const email =
      (payload['email'] as string | undefined) ??
      (payload['username'] as string | undefined) ??
      userId;

    return { userId, email };
  } catch {
    return null;
  }
}

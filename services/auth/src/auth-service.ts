/**
 * Auth Service — wraps Amazon Cognito Identity Provider and maps
 * results/errors to the platform error envelope.
 *
 * Requirements: R1.1, R1.2, R1.3, R1.4, R1.5, R1.8, R1.9, R1.10
 */

import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  type AuthFlowType,
} from '@aws-sdk/client-cognito-identity-provider';
import { AppError, FantasyRepository, buildUserProfileKey } from '@fantasy/shared';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresIn: number;
}

export interface AuthServiceConfig {
  userPoolId: string;
  clientId: string;
  repository: FantasyRepository;
}

// ─── Lockout Constants ──────────────────────────────────────────────────────

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// ─── Auth Service Class ─────────────────────────────────────────────────────

export class AuthService {
  private readonly cognito: CognitoIdentityProviderClient;
  private readonly clientId: string;
  private readonly repository: FantasyRepository;

  constructor(config: AuthServiceConfig) {
    this.cognito = new CognitoIdentityProviderClient({});
    this.clientId = config.clientId;
    this.repository = config.repository;
  }

  // ─── Register ───────────────────────────────────────────────────────────

  /**
   * Register a new user account. Sends a verification email.
   * Maps Cognito errors → platform error codes.
   */
  async register(email: string, password: string, displayName: string): Promise<void> {
    try {
      const result = await this.cognito.send(
        new SignUpCommand({
          ClientId: this.clientId,
          Username: email,
          Password: password,
          UserAttributes: [{ Name: 'email', Value: email }],
        }),
      );

      const userSub = result.UserSub;
      if (!userSub) {
        throw new AppError('INTERNAL_ERROR', 'Sign-up did not return a user identifier');
      }
      await this.repository.put({
        ...buildUserProfileKey(userSub),
        userId: userSub,
        email,
        displayName,
        notificationPrefs: {
          deadlineReminder: true,
          scoreUpdates: true,
          leagueChat: true,
          transferNews: false,
        },
        avatarUrl: undefined,
        createdAt: new Date().toISOString(),
        entityType: 'USER_PROFILE',
      });
    } catch (err: unknown) {
      if (err instanceof Error) {
        switch (err.name) {
          case 'UsernameExistsException':
            throw new AppError(
              'EMAIL_ALREADY_REGISTERED',
              'An account with this email already exists',
            );
          case 'InvalidPasswordException':
            throw new AppError('VALIDATION_ERROR', 'Password does not meet policy requirements', {
              fields: { password: [err.message] },
            });
          case 'InvalidParameterException':
            throw new AppError('VALIDATION_ERROR', err.message, {
              fields: { email: [err.message] },
            });
          default:
            throw err;
        }
      }
      throw err;
    }
  }

  // ─── Confirm Sign Up ──────────────────────────────────────────────────────

  /**
   * Confirm a user's email address with the verification code sent on sign-up.
   * Idempotent: if the account is already confirmed, returns successfully.
   */
  async confirmSignUp(email: string, code: string): Promise<void> {
    try {
      await this.cognito.send(
        new ConfirmSignUpCommand({
          ClientId: this.clientId,
          Username: email,
          ConfirmationCode: code,
        }),
      );
    } catch (err: unknown) {
      if (err instanceof Error) {
        switch (err.name) {
          case 'CodeMismatchException':
            throw new AppError('VALIDATION_ERROR', 'Invalid verification code', {
              fields: { code: ['Invalid verification code'] },
            });
          case 'ExpiredCodeException':
            throw new AppError('VALIDATION_ERROR', 'Verification code has expired', {
              fields: { code: ['Code expired'] },
            });
          case 'NotAuthorizedException':
            // Account already confirmed — treat as success (idempotent)
            return;
          case 'UserNotFoundException':
            throw new AppError('VALIDATION_ERROR', 'Account not found');
          default:
            throw err;
        }
      }
      throw err;
    }
  }

  // ─── Sign In ────────────────────────────────────────────────────────────

  /**
   * Authenticate with email + password. Returns a token pair.
   * Implements lockout: 5 failures in 15 min → 15 min lock.
   */
  async signIn(email: string, password: string): Promise<TokenPair> {
    // Check lockout state before attempting auth
    await this.checkLockout(email);

    try {
      const result = await this.cognito.send(
        new InitiateAuthCommand({
          AuthFlow: 'USER_PASSWORD_AUTH' as AuthFlowType,
          ClientId: this.clientId,
          AuthParameters: {
            USERNAME: email,
            PASSWORD: password,
          },
        }),
      );

      const authResult = result.AuthenticationResult;
      if (!authResult?.AccessToken || !authResult.RefreshToken || !authResult.IdToken) {
        throw new AppError('INTERNAL_ERROR', 'Incomplete authentication response from provider');
      }

      // Reset failed attempts on successful login
      await this.resetFailedAttempts(email);

      return {
        accessToken: authResult.AccessToken,
        refreshToken: authResult.RefreshToken,
        idToken: authResult.IdToken,
        expiresIn: authResult.ExpiresIn ?? 3600,
      };
    } catch (err: unknown) {
      if (err instanceof AppError) {
        throw err;
      }

      if (err instanceof Error) {
        switch (err.name) {
          case 'NotAuthorizedException':
            // Record the failed attempt for lockout tracking
            await this.recordFailedAttempt(email);
            throw new AppError('INVALID_CREDENTIALS', 'The email or password is incorrect');
          case 'UserNotConfirmedException':
            throw new AppError(
              'VALIDATION_ERROR',
              'Email verification is required before sign-in',
              {
                fields: { email: ['Email address has not been verified'] },
              },
            );
          case 'UserNotFoundException':
            // Map to same error as invalid credentials to avoid user enumeration
            await this.recordFailedAttempt(email);
            throw new AppError('INVALID_CREDENTIALS', 'The email or password is incorrect');
          default:
            throw err;
        }
      }
      throw err;
    }
  }

  // ─── Refresh ────────────────────────────────────────────────────────────

  /**
   * Refresh an access token using a valid refresh token.
   */
  async refresh(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
    try {
      const result = await this.cognito.send(
        new InitiateAuthCommand({
          AuthFlow: 'REFRESH_TOKEN_AUTH' as AuthFlowType,
          ClientId: this.clientId,
          AuthParameters: {
            REFRESH_TOKEN: refreshToken,
          },
        }),
      );

      const authResult = result.AuthenticationResult;
      if (!authResult?.AccessToken) {
        throw new AppError('INTERNAL_ERROR', 'Incomplete refresh response from provider');
      }

      return {
        accessToken: authResult.AccessToken,
        expiresIn: authResult.ExpiresIn ?? 3600,
      };
    } catch (err: unknown) {
      if (err instanceof Error) {
        switch (err.name) {
          case 'NotAuthorizedException':
            throw new AppError('TOKEN_EXPIRED', 'The refresh token is expired or invalid');
          default:
            throw err;
        }
      }
      throw err;
    }
  }

  // ─── Lockout Helpers ────────────────────────────────────────────────────

  /**
   * Check if the account is currently locked out.
   * Reads the lockout counter from DynamoDB.
   */
  private async checkLockout(email: string): Promise<void> {
    const record = await this.repository.get<LockoutRecord>(`LOCKOUT#${email}`, 'ATTEMPTS');

    if (!record) return;

    // If account is locked and lockout hasn't expired
    if (record.lockedUntil) {
      const now = Date.now();
      if (now < record.lockedUntil) {
        throw new AppError(
          'ACCOUNT_LOCKED',
          'Account is temporarily locked due to too many failed sign-in attempts',
        );
      }
      // Lockout expired — reset
      await this.resetFailedAttempts(email);
    }
  }

  /**
   * Record a failed sign-in attempt. If threshold reached, lock the account.
   */
  private async recordFailedAttempt(email: string): Promise<void> {
    const now = Date.now();
    const windowStart = now - LOCKOUT_WINDOW_MS;

    const record = await this.repository.get<LockoutRecord>(`LOCKOUT#${email}`, 'ATTEMPTS');

    let attempts: number[] = [];

    if (record?.attempts) {
      // Filter to only attempts within the window
      attempts = record.attempts.filter((ts) => ts > windowStart);
    }

    attempts.push(now);

    if (attempts.length >= MAX_FAILED_ATTEMPTS) {
      // Lock the account
      await this.repository.put({
        PK: `LOCKOUT#${email}`,
        SK: 'ATTEMPTS',
        attempts,
        lockedUntil: now + LOCKOUT_DURATION_MS,
        ttl: Math.floor((now + LOCKOUT_DURATION_MS + 86400000) / 1000), // TTL: lockout + 24h
      });
    } else {
      await this.repository.put({
        PK: `LOCKOUT#${email}`,
        SK: 'ATTEMPTS',
        attempts,
        ttl: Math.floor((now + LOCKOUT_WINDOW_MS + 86400000) / 1000), // TTL: window + 24h
      });
    }
  }

  /**
   * Reset the lockout counter after a successful sign-in or expired lockout.
   */
  private async resetFailedAttempts(email: string): Promise<void> {
    await this.repository.delete(`LOCKOUT#${email}`, 'ATTEMPTS');
  }
}

// ─── Internal Types ─────────────────────────────────────────────────────────

interface LockoutRecord extends Record<string, unknown> {
  PK: string;
  SK: string;
  attempts: number[];
  lockedUntil?: number;
  ttl?: number;
}

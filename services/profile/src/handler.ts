/**
 * Lambda handlers for Profile service routes.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import {
  createHandler,
  FantasyRepository,
  UpdateDisplayNameSchema,
  UpdateNotificationPrefsSchema,
  AppError,
  type UpdateDisplayNameInput,
  type UpdateNotificationPrefsInput,
} from '@fantasy/shared';

import { ProfileService } from './profile-service.js';

// ─── Shared Instances (reused across warm invocations) ──────────────────────

const TABLE_NAME = process.env['TABLE_NAME']!;
const AVATAR_BUCKET = process.env['AVATAR_BUCKET']!;

const repo = new FantasyRepository({ tableName: TABLE_NAME });
const s3 = new S3Client({});
const profileService = new ProfileService(repo, s3, AVATAR_BUCKET);

// ─── GET /profile ───────────────────────────────────────────────────────────

export const getProfileHandler = createHandler({
  requireAuth: true,
  handler: async ({ user }) => {
    return profileService.getProfile(user!.userId);
  },
});

// ─── PUT /profile/display-name ──────────────────────────────────────────────

export const updateDisplayNameHandler = createHandler<UpdateDisplayNameInput>({
  schema: UpdateDisplayNameSchema,
  requireAuth: true,
  handler: async ({ user, body }) => {
    return profileService.updateDisplayName(user!.userId, body.displayName);
  },
});

// ─── PUT /profile/notifications ─────────────────────────────────────────────

export const updateNotificationPrefsHandler = createHandler<UpdateNotificationPrefsInput>({
  schema: UpdateNotificationPrefsSchema,
  requireAuth: true,
  handler: async ({ user, body }) => {
    return profileService.updateNotificationPrefs(user!.userId, body);
  },
});

// ─── POST /profile/avatar-upload-url ────────────────────────────────────────

export const createAvatarUploadUrlHandler = createHandler({
  requireAuth: true,
  handler: async ({ user, event }) => {
    let contentType = 'image/jpeg';

    if (event.body) {
      try {
        const parsed = JSON.parse(event.body);
        if (parsed.contentType) {
          contentType = parsed.contentType;
        }
      } catch {
        // Fall through with default content type
      }
    }

    return profileService.createAvatarUploadUrl(user!.userId, contentType);
  },
});

// ─── Router ─────────────────────────────────────────────────────────────────

/**
 * Main Lambda entry point — routes by path and method.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const path = event.path;
  const method = event.httpMethod;

  if (method === 'GET' && path === '/profile') {
    return getProfileHandler(event);
  }

  if (method === 'PUT' && path === '/profile/display-name') {
    return updateDisplayNameHandler(event);
  }

  if (method === 'PUT' && path === '/profile/notifications') {
    return updateNotificationPrefsHandler(event);
  }

  if (method === 'POST' && path === '/profile/avatar-upload-url') {
    return createAvatarUploadUrlHandler(event);
  }

  throw new AppError('VALIDATION_ERROR', `Unsupported route: ${method} ${path}`);
}

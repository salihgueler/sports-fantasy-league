/**
 * Profile Service — manages user profiles, display names, notification prefs, and avatar uploads.
 */

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  FantasyRepository,
  buildUserProfileKey,
  AppError,
  type UserProfile,
  type NotificationPrefs,
} from '@fantasy/shared';

// ─── Configuration ──────────────────────────────────────────────────────────

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png'] as const;
const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const DISPLAY_NAME_MIN = 1;
const DISPLAY_NAME_MAX = 50;

// ─── Service ────────────────────────────────────────────────────────────────

export class ProfileService {
  private readonly repo: FantasyRepository;
  private readonly s3: S3Client;
  private readonly avatarBucket: string;

  constructor(repo: FantasyRepository, s3: S3Client, avatarBucket: string) {
    this.repo = repo;
    this.s3 = s3;
    this.avatarBucket = avatarBucket;
  }

  /**
   * Retrieve a user profile by userId. Throws USER_NOT_FOUND if it does not exist.
   */
  async getProfile(userId: string): Promise<UserProfile> {
    const key = buildUserProfileKey(userId);
    const item = await this.repo.get<Record<string, unknown>>(key.PK, key.SK);

    if (!item) {
      throw new AppError('USER_NOT_FOUND', `User profile not found for userId: ${userId}`);
    }

    return this.toUserProfile(item);
  }

  /**
   * Update the display name for a user.
   * Validates the name is 1–50 characters; throws INVALID_DISPLAY_NAME otherwise.
   */
  async updateDisplayName(userId: string, name: string): Promise<UserProfile> {
    const trimmed = name.trim();

    if (trimmed.length < DISPLAY_NAME_MIN || trimmed.length > DISPLAY_NAME_MAX) {
      throw new AppError(
        'INVALID_DISPLAY_NAME',
        `Display name must be between ${DISPLAY_NAME_MIN} and ${DISPLAY_NAME_MAX} characters`,
      );
    }

    const key = buildUserProfileKey(userId);

    await this.repo.update(
      key.PK,
      key.SK,
      'SET #dn = :dn',
      { '#dn': 'displayName' },
      { ':dn': trimmed },
    );

    return this.getProfile(userId);
  }

  /**
   * Update notification preferences for a user.
   * All preference keys must be valid booleans; throws INVALID_NOTIFICATION_PREFERENCE otherwise.
   */
  async updateNotificationPrefs(userId: string, prefs: NotificationPrefs): Promise<UserProfile> {
    const validKeys: Array<keyof NotificationPrefs> = [
      'deadlineReminder',
      'scoreUpdates',
      'leagueChat',
      'transferNews',
    ];

    for (const key of validKeys) {
      if (typeof prefs[key] !== 'boolean') {
        throw new AppError(
          'INVALID_NOTIFICATION_PREFERENCE',
          `Notification preference "${key}" must be a boolean`,
        );
      }
    }

    const extraKeys = Object.keys(prefs).filter(
      (k) => !validKeys.includes(k as keyof NotificationPrefs),
    );
    if (extraKeys.length > 0) {
      throw new AppError(
        'INVALID_NOTIFICATION_PREFERENCE',
        `Unknown notification preference keys: ${extraKeys.join(', ')}`,
      );
    }

    const key = buildUserProfileKey(userId);

    await this.repo.update(
      key.PK,
      key.SK,
      'SET #np = :np',
      { '#np': 'notificationPrefs' },
      { ':np': prefs },
    );

    return this.getProfile(userId);
  }

  /**
   * Generate a pre-signed S3 PUT URL for avatar upload.
   * Constrains content type to JPEG/PNG and max size to 5 MB.
   */
  async createAvatarUploadUrl(userId: string, contentType: string): Promise<{ url: string }> {
    if (!ALLOWED_CONTENT_TYPES.includes(contentType as (typeof ALLOWED_CONTENT_TYPES)[number])) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Avatar content type must be one of: ${ALLOWED_CONTENT_TYPES.join(', ')}`,
      );
    }

    const extension = contentType === 'image/png' ? 'png' : 'jpg';
    const objectKey = `avatars/${userId}.${extension}`;

    const command = new PutObjectCommand({
      Bucket: this.avatarBucket,
      Key: objectKey,
      ContentType: contentType,
      ContentLength: MAX_AVATAR_SIZE_BYTES,
    });

    const url = await getSignedUrl(this.s3, command, {
      expiresIn: 300, // 5 minutes
      signableHeaders: new Set(['content-type', 'content-length']),
    });

    return { url };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private toUserProfile(item: Record<string, unknown>): UserProfile {
    return {
      userId: item['userId'] as string,
      email: item['email'] as string,
      displayName: item['displayName'] as string,
      avatarUrl: item['avatarUrl'] as string | undefined,
      notificationPrefs: item['notificationPrefs'] as NotificationPrefs,
      createdAt: item['createdAt'] as string,
    };
  }
}

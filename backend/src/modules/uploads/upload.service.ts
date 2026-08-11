import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { UploadError } from '../../utils/errors';
import { getSettings } from '../settings/settings.service';

if (env.cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

export type UploadFolder = 'members' | 'receipts' | 'documents';

export interface UploadResult {
  url: string;
  publicId: string;
  format: string;
  bytes: number;
  provider: 'cloudinary' | 'local';
}

/**
 * Magic-number signatures.
 *
 * The declared MIME type and the file extension are both attacker-controlled, so the
 * real type is determined from the first bytes of the buffer and the request is
 * rejected if the two disagree.
 */
const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    ext: 'png',
    test: (b) =>
      b.length > 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) =>
      b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mime: 'application/pdf',
    ext: 'pdf',
    test: (b) => b.length > 4 && b.subarray(0, 4).toString('ascii') === '%PDF',
  },
];

export function detectFileType(buffer: Buffer): { mime: string; ext: string } | null {
  return SIGNATURES.find((s) => s.test(buffer)) ?? null;
}

/** Validates size and true content type against the configured policy. */
export async function validateFile(
  file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
): Promise<{ mime: string; ext: string }> {
  const settings = await getSettings();
  const maxBytes = settings.maxUploadSizeMb * 1024 * 1024;

  if (file.size > maxBytes) {
    throw new UploadError(`The file is larger than the ${settings.maxUploadSizeMb}MB limit.`);
  }
  if (file.size === 0) {
    throw new UploadError('The file is empty.');
  }

  const detected = detectFileType(file.buffer);
  if (!detected) {
    throw new UploadError(
      'The file type could not be recognised. Upload a JPG, PNG, WebP or PDF.',
    );
  }
  if (!settings.allowedUploadMimeTypes.includes(detected.mime)) {
    throw new UploadError(
      `${detected.mime} files are not permitted. Allowed types: ${settings.allowedUploadMimeTypes.join(
        ', ',
      )}.`,
    );
  }
  // A mismatch between the declared and actual type is treated as hostile.
  if (file.mimetype !== detected.mime && !file.mimetype.startsWith('application/octet-stream')) {
    logger.warn(
      { declared: file.mimetype, detected: detected.mime, name: file.originalname },
      'Rejected upload: declared MIME type does not match file contents',
    );
    throw new UploadError('The file contents do not match its declared type.');
  }

  return detected;
}

/**
 * Uploads to Cloudinary.
 *
 * When Cloudinary credentials are absent — the default in development — the file is
 * written to `storage/uploads` and served by the API instead, so every upload-dependent
 * feature works locally and switches to Cloudinary the moment credentials appear.
 */
export async function uploadFile(
  file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
  folder: UploadFolder,
): Promise<UploadResult> {
  const detected = await validateFile(file);

  if (!env.cloudinaryConfigured) {
    return storeLocally(file.buffer, folder, detected.ext);
  }

  try {
    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `${env.CLOUDINARY_FOLDER}/${folder}`,
          resource_type: detected.mime === 'application/pdf' ? 'raw' : 'image',
          // Never trust a client-supplied filename as a storage key.
          public_id: crypto.randomBytes(16).toString('hex'),
          overwrite: false,
          invalidate: true,
        },
        (error, uploaded) => {
          if (error || !uploaded) return reject(error ?? new Error('Upload failed'));
          resolve(uploaded as unknown as Record<string, unknown>);
        },
      );
      stream.end(file.buffer);
    });

    return {
      url: String(result.secure_url),
      publicId: String(result.public_id),
      format: String(result.format ?? detected.ext),
      bytes: Number(result.bytes ?? file.size),
      provider: 'cloudinary',
    };
  } catch (err) {
    logger.error({ err }, 'Cloudinary upload failed');
    throw new UploadError('The file could not be uploaded. Please try again.');
  }
}

const LOCAL_ROOT = path.resolve(__dirname, '../../../storage/uploads');

async function storeLocally(
  buffer: Buffer,
  folder: UploadFolder,
  ext: string,
): Promise<UploadResult> {
  const dir = path.join(LOCAL_ROOT, folder);
  await fs.mkdir(dir, { recursive: true });

  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  await fs.writeFile(path.join(dir, name), buffer);

  logger.info({ folder, name }, 'Cloudinary is not configured — stored upload on local disk');

  return {
    url: `${env.BACKEND_URL}${env.API_PREFIX}/uploads/files/${folder}/${name}`,
    publicId: `local:${folder}/${name}`,
    format: ext,
    bytes: buffer.length,
    provider: 'local',
  };
}

export async function deleteFile(publicId: string): Promise<void> {
  if (publicId.startsWith('local:')) {
    const relative = publicId.slice('local:'.length);
    // Contain the delete inside the uploads root regardless of the stored value.
    const target = path.resolve(LOCAL_ROOT, relative);
    if (!target.startsWith(LOCAL_ROOT)) {
      throw new UploadError('Invalid file reference.');
    }
    await fs.unlink(target).catch(() => undefined);
    return;
  }

  if (!env.cloudinaryConfigured) return;
  try {
    await cloudinary.uploader.destroy(publicId, { invalidate: true });
  } catch (err) {
    logger.warn({ err, publicId }, 'Failed to delete Cloudinary asset');
  }
}

export function localFilePath(folder: string, name: string): string | null {
  // Reject anything that is not a plain generated filename.
  if (!/^[a-z0-9]+\.[a-z0-9]{2,5}$/i.test(name)) return null;
  if (!['members', 'receipts', 'documents'].includes(folder)) return null;
  return path.join(LOCAL_ROOT, folder, name);
}

export function uploadsConfiguredWith(): 'cloudinary' | 'local' {
  return env.cloudinaryConfigured ? 'cloudinary' : 'local';
}

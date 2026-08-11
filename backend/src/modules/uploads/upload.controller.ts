import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { Permission } from '../../config/permissions';
import { env } from '../../config/env';
import { authenticate, requirePermission } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { AuditAction, AuditModule } from '../../types/enums';
import { NotFoundError, UploadError } from '../../utils/errors';
import { asyncHandler, created, ok } from '../../utils/http';
import { recordAudit } from '../audit/audit.service';
import {
  deleteFile,
  localFilePath,
  uploadFile,
  uploadsConfiguredWith,
  type UploadFolder,
} from './upload.service';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.uploadMaxBytes, files: 1 },
});

export const uploadRouter = Router();

/**
 * Serves locally stored files when Cloudinary is not configured.
 * Public by design — the URLs are unguessable 128-bit names, mirroring the
 * unauthenticated-but-unguessable behaviour of a Cloudinary delivery URL.
 */
uploadRouter.get(
  '/files/:folder/:name',
  asyncHandler(async (req: Request, res: Response) => {
    const filePath = localFilePath(req.params.folder, req.params.name);
    if (!filePath) throw new NotFoundError('File');
    return new Promise<void>((resolve, reject) => {
      res.sendFile(filePath, (err) => (err ? reject(new NotFoundError('File')) : resolve()));
    });
  }),
);

uploadRouter.use(authenticate, requirePermission(Permission.UPLOADS_CREATE));

uploadRouter.get(
  '/config',
  asyncHandler(async (_req: Request, res: Response) =>
    ok(res, {
      provider: uploadsConfiguredWith(),
      maxFileSizeMb: env.UPLOAD_MAX_FILE_SIZE_MB,
      acceptedTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    }),
  ),
);

uploadRouter.post(
  '/',
  upload.single('file'),
  validate({
    body: z.object({
      folder: z.enum(['members', 'receipts', 'documents']).default('documents'),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw new UploadError('No file was received.');

    const folder = (req.body as { folder: UploadFolder }).folder;
    const result = await uploadFile(req.file, folder);

    await recordAudit(
      {
        action: AuditAction.UPLOAD,
        module: AuditModule.UPLOADS,
        description: `Uploaded ${result.format.toUpperCase()} file to ${folder} (${Math.round(
          result.bytes / 1024,
        )} KB)`,
        entityLabel: result.publicId,
        newValues: { publicId: result.publicId, provider: result.provider },
      },
      req,
    );

    return created(res, result);
  }),
);

uploadRouter.delete(
  '/',
  validate({ body: z.object({ publicId: z.string().min(3).max(300) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { publicId } = req.body as { publicId: string };
    await deleteFile(publicId);

    await recordAudit(
      {
        action: AuditAction.DELETE,
        module: AuditModule.UPLOADS,
        description: `Deleted uploaded file ${publicId}`,
        entityLabel: publicId,
      },
      req,
    );

    return ok(res, { message: 'The file has been deleted.' });
  }),
);

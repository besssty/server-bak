/** Відповідає за завантаження PDF-файлів матеріалів. */

import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { MATERIAL_CONSTRAINTS } from '../domain/materialDomain';

const materialUploadTmpDir = path.join(process.cwd(), 'tmp');

// Перевіряє наявність тимчасової папки та створює її за потреби.
export function ensureMaterialUploadTmpDir(): void {
  if (!fs.existsSync(materialUploadTmpDir)) {
    fs.mkdirSync(materialUploadTmpDir, { recursive: true });
  }
}

// Налаштовує middleware для прийому PDF-файлу матеріалу через multer.
export const materialPdfUpload = multer({
  // Тимчасово зберігає файл у папці tmp, поки контролер читає та обробляє PDF.
  dest: materialUploadTmpDir,
  // Обмежує максимальний розмір файлу, щоб не приймати надто великі PDF.
  limits: { fileSize: MATERIAL_CONSTRAINTS.PDF_MAX_SIZE_BYTES },
  fileFilter(_req, file, cb) {
    // Дозволяє PDF за MIME-типом або за розширенням, якщо браузер передав неточний MIME.
    const isPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);
    if (isPdf) cb(null, true);
    else cb(new Error('Дозволені тільки PDF файли'));
  },
});

// Видаляє тимчасовий файл після завершення обробки.
export function cleanupUploadedFile(filePath: string | undefined): void {
  if (!filePath) return;
  if (!fs.existsSync(filePath)) return;

  try {
    fs.unlinkSync(filePath);
  } catch {
    // Помилка cleanup не повинна перекривати основний результат запиту.
  }
}

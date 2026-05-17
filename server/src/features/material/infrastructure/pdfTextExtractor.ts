/** Infrastructure-файл: pdfTextExtractor. */

import { extractStructuredTextFromPdf } from './pdfParser';
import type { PdfTextExtractorPort } from '../application/ports';

export const pdfTextExtractor: PdfTextExtractorPort = {
  extractStructuredTextFromPdf,
};

/** Application-сервіс: ports. */

export interface GeneratedCard {
  question: string;
  answer: string;
}

export interface CardGeneratorPort {
  generateCardsFromMaterialText(text: string): Promise<GeneratedCard[]>;
}

export interface PdfTextExtractorPort {
  extractStructuredTextFromPdf(filePath: string): Promise<string>;
}

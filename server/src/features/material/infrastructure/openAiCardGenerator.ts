/** Infrastructure-файл: openAiCardGenerator. */

import { generateCardsFromMaterialText } from './openaiClient';
import type { CardGeneratorPort } from '../application/ports';

export const openAiCardGenerator: CardGeneratorPort = {
  generateCardsFromMaterialText,
};

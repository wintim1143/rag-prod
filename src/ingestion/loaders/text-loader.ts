import { nowIso, titleFromFilename } from './common.js';
import type { DocumentLoader } from './types.js';

/** 纯文本加载器（.txt）。 */
export const loadText: DocumentLoader = async ({ buffer, sourcePath }) => ({
  text: buffer.toString('utf8'),
  metadata: {
    title: titleFromFilename(sourcePath),
    sourcePath,
    sourceType: 'text',
    uploadedAt: nowIso(),
  },
});

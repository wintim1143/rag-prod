import mammoth from 'mammoth';
import { buildMetadata, withLoaderError } from './common.js';
import type { DocumentLoader } from './types.js';

/** DOCX 加载器（.docx）：抽取段落与表格文本。 */
export const loadDocx: DocumentLoader = ({ buffer, sourcePath }) =>
  withLoaderError(sourcePath, 'DOCX', async () => {
    const result = await mammoth.extractRawText({ buffer });
    return {
      text: result.value.trim(),
      metadata: buildMetadata(sourcePath, 'docx'),
    };
  });

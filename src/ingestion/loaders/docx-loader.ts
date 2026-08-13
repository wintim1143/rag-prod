import mammoth from 'mammoth';
import { nowIso, titleFromFilename } from './common.js';
import { LoaderError } from './errors.js';
import type { DocumentLoader } from './types.js';

/** DOCX 加载器（.docx）：抽取段落与表格文本。 */
export const loadDocx: DocumentLoader = async ({ buffer, sourcePath }) => {
  let value: string;
  try {
    const result = await mammoth.extractRawText({ buffer });
    value = result.value;
  } catch (err) {
    throw new LoaderError(
      `DOCX 解析失败（${sourcePath}）: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return {
    text: value.trim(),
    metadata: {
      title: titleFromFilename(sourcePath),
      sourcePath,
      sourceType: 'docx',
      uploadedAt: nowIso(),
    },
  };
};

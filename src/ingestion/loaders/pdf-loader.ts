import { extractText, getDocumentProxy } from 'unpdf';
import { nowIso, titleFromFilename } from './common.js';
import { LoaderError } from './errors.js';
import type { DocumentLoader } from './types.js';

/**
 * PDF 加载器（.pdf）：抽取文本层（数字生成的 PDF）。
 * 扫描件/图片型 PDF 文本层为空，返回空文本（OCR 属可选项，默认不做）。
 */
export const loadPdf: DocumentLoader = async ({ buffer, sourcePath }) => {
  let text: string;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    text = result.text;
  } catch (err) {
    throw new LoaderError(
      `PDF 解析失败（${sourcePath}）: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return {
    text: text.trim(),
    metadata: {
      title: titleFromFilename(sourcePath),
      sourcePath,
      sourceType: 'pdf',
      uploadedAt: nowIso(),
    },
  };
};

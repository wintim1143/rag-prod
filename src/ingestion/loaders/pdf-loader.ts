import { extractText, getDocumentProxy } from 'unpdf';
import { buildMetadata, withLoaderError } from './common.js';
import type { DocumentLoader } from './types.js';

/**
 * PDF 加载器（.pdf）：抽取文本层（数字生成的 PDF）。
 * 扫描件/图片型 PDF 文本层为空，返回空文本（OCR 属可选项，默认不做）。
 */
export const loadPdf: DocumentLoader = ({ buffer, sourcePath }) =>
  withLoaderError(sourcePath, 'PDF', async () => {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    return {
      text: result.text.trim(),
      metadata: buildMetadata(sourcePath, 'pdf'),
    };
  });

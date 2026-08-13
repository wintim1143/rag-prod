import path from 'node:path';
import { UnsupportedFormatError } from './errors.js';
import { loadText } from './text-loader.js';
import { loadMarkdown } from './markdown-loader.js';
import { loadHtml } from './html-loader.js';
import { loadPdf } from './pdf-loader.js';
import { loadDocx } from './docx-loader.js';
import type { DocumentLoader, LoaderInput, LoadedDocument } from './types.js';

/** 按文件扩展名分派加载器。 */
const EXTENSION_LOADERS: Record<string, DocumentLoader> = {
  '.txt': loadText,
  '.md': loadMarkdown,
  '.markdown': loadMarkdown,
  '.html': loadHtml,
  '.htm': loadHtml,
  '.pdf': loadPdf,
  '.docx': loadDocx,
};

/** 当前支持的扩展名清单（供目录摄入过滤）。 */
export const SUPPORTED_EXTENSIONS: readonly string[] = Object.freeze(Object.keys(EXTENSION_LOADERS));

/** 根据扩展名加载文档；不支持格式抛 UnsupportedFormatError。 */
export async function loadDocument(input: LoaderInput): Promise<LoadedDocument> {
  const ext = path.extname(input.sourcePath).toLowerCase();
  const loader = EXTENSION_LOADERS[ext];
  if (!loader) {
    throw new UnsupportedFormatError(ext, input.sourcePath);
  }
  return loader(input);
}

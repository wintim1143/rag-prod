import { buildMetadata } from './common.js';
import type { DocumentLoader } from './types.js';

/** Markdown 加载器（.md / .markdown）：正文保留全文，标题取首个一级标题。 */
export const loadMarkdown: DocumentLoader = async ({ buffer, sourcePath }) => {
  const text = buffer.toString('utf8');
  const firstHeading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return {
    text,
    metadata: buildMetadata(sourcePath, 'markdown', firstHeading),
  };
};

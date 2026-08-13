import * as cheerio from 'cheerio';
import { buildMetadata, withLoaderError } from './common.js';
import type { DocumentLoader } from './types.js';

/** 按标题/段落/列表项逐行抽取正文，保留标题层级可读性（而非压平成单行）。 */
function extractReadableText($: cheerio.CheerioAPI): string {
  return $('body')
    .find('h1, h2, h3, h4, h5, h6, p, li, tr')
    .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter((text) => text.length > 0)
    .join('\n');
}

/** HTML 加载器（.html / .htm）：剥离导航/脚本/样式，取正文文本。 */
export const loadHtml: DocumentLoader = ({ buffer, sourcePath }) =>
  withLoaderError(sourcePath, 'HTML', async () => {
    const $ = cheerio.load(buffer.toString('utf8'));
    $('script, style, noscript, iframe, svg, nav, header, footer, aside, form').remove();
    const title = $('title').first().text().trim() || $('h1').first().text().trim();
    return {
      text: extractReadableText($),
      metadata: buildMetadata(sourcePath, 'html', title || undefined),
    };
  });

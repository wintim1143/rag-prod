import * as cheerio from 'cheerio';
import { nowIso, titleFromFilename } from './common.js';
import { LoaderError } from './errors.js';
import type { DocumentLoader } from './types.js';

/** HTML 加载器（.html / .htm）：剥离导航/脚本/样式，取正文文本。 */
export const loadHtml: DocumentLoader = async ({ buffer, sourcePath }) => {
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(buffer.toString('utf8'));
  } catch (err) {
    throw new LoaderError(
      `HTML 解析失败（${sourcePath}）: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  $('script, style, noscript, iframe, svg, nav, header, footer, aside, form').remove();
  const title =
    $('title').first().text().trim() ||
    $('h1').first().text().trim() ||
    titleFromFilename(sourcePath);
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  return {
    text,
    metadata: {
      title,
      sourcePath,
      sourceType: 'html',
      uploadedAt: nowIso(),
    },
  };
};

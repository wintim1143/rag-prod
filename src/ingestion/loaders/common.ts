import { LoaderError } from './errors.js';
import type { LoadedDocument, SourceType } from './types.js';

/** 从文件路径提取不含扩展名的文件名作为默认标题。 */
export function titleFromFilename(sourcePath: string): string {
  const base = sourcePath.split(/[\\/]/).pop() ?? sourcePath;
  const idx = base.lastIndexOf('.');
  return idx > 0 ? base.slice(0, idx) : base;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 组装加载器统一元数据；未提供标题时回落到文件名。 */
export function buildMetadata(
  sourcePath: string,
  sourceType: SourceType,
  title?: string,
): LoadedDocument['metadata'] {
  return {
    title: title ?? titleFromFilename(sourcePath),
    sourcePath,
    sourceType,
    uploadedAt: nowIso(),
  };
}

/** 把解析异常包装为 LoaderError，带上源路径与格式名。 */
export async function withLoaderError<T>(
  sourcePath: string,
  format: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new LoaderError(
      `${format} 解析失败（${sourcePath}）: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

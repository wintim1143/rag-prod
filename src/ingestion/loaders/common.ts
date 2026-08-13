import type { LoaderError } from './errors.js';

/** 从文件路径提取不含扩展名的文件名作为默认标题。 */
export function titleFromFilename(sourcePath: string): string {
  const base = sourcePath.split(/[\\/]/).pop() ?? sourcePath;
  const idx = base.lastIndexOf('.');
  return idx > 0 ? base.slice(0, idx) : base;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 判断是否为加载阶段错误（UnsupportedFormatError / LoaderError）。 */
export function isLoaderError(err: unknown): err is LoaderError {
  return err instanceof Error && err.name === 'LoaderError';
}

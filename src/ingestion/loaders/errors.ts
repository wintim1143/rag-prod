/** 加载阶段错误类型。 */

export class LoaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoaderError';
  }
}

/** 文件扩展名不受支持的格式。 */
export class UnsupportedFormatError extends LoaderError {
  readonly extension: string;

  constructor(extension: string, sourcePath: string) {
    super(`不支持的文件格式 "${extension}"（${sourcePath}）。支持: .txt .md .html .pdf .docx`);
    this.name = 'UnsupportedFormatError';
    this.extension = extension;
  }
}

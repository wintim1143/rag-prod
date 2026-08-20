import { z } from 'zod';

/**
 * 配置中心：从环境变量读取并校验全部 provider 配置。
 *
 * 设计约束：
 * - 纯函数：loadConfig() 只读传入的 env 源（默认 process.env），不碰文件系统。
 *   `.env` 文件的加载由入口（src/index.ts）负责，测试可直接注入 env 对象。
 * - 校验失败抛出 ConfigError，报错逐条列出字段、原因与当前值。
 * - Embedding 相关变量缺省回落到 LLM_*（即默认同 provider）。
 */

/** 把空字符串视为「未设置」，使 zod 的 required/default 逻辑统一。 */
function emptyToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

/** 必填非空字符串（空串视为未设置，报「必填」）。 */
function requiredString(label: string) {
  return z.preprocess(
    emptyToUndefined,
    z.string({ required_error: `${label} 必填` }).trim().min(1, { message: `${label} 不能为空` }),
  );
}

/** 必填非空字符串，缺省时使用 fallback。 */
function requiredStringWithDefault(label: string, fallback: string) {
  return z
    .preprocess(
      emptyToUndefined,
      z.string({ required_error: `${label} 必填` }).trim().min(1, { message: `${label} 不能为空` }),
    )
    .default(fallback);
}

/** 可选字符串（空串视为未设置）。 */
function optionalString() {
  return z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());
}

/** 可选 URL（空串视为未设置）。 */
function optionalUrl() {
  return z.preprocess(
    emptyToUndefined,
    z.string().trim().url({ message: '必须是合法 URL' }).optional(),
  );
}

/** 整数环境变量（空串视为未设置）。 */
function boolEnv(label: string, fallback: boolean) {
  return z.preprocess(
    emptyToUndefined,
    z
      .enum(['true', 'false'], { invalid_type_error: `${label} 必须是 true 或 false` })
      .transform((value) => value === 'true')
      .default(String(fallback) as 'true' | 'false'),
  );
}

function intEnv(
  label: string,
  bounds: { min?: number; max?: number; positive?: boolean } = {},
) {
  let schema = z.coerce
    .number({ required_error: `${label} 必填` })
    .int({ message: `${label} 必须是整数` });
  if (bounds.positive) {
    schema = schema.positive({ message: `${label} 必须大于 0` });
  }
  if (bounds.min !== undefined) {
    schema = schema.min(bounds.min, { message: `${label} 必须 ≥ ${bounds.min}` });
  }
  if (bounds.max !== undefined) {
    schema = schema.max(bounds.max, { message: `${label} 必须 ≤ ${bounds.max}` });
  }
  return z.preprocess(emptyToUndefined, schema);
}

/**
 * 原始环境变量的校验 schema。键名与 README「环境变量」表一一对应。
 * 后续切片（02 分块、03 检索参数、08 查询优化）需要新增变量时，在此追加。
 */
const envSchema = z.object({
  // ---- chat / embedding 云 API（OpenAI 兼容）----
  LLM_BASE_URL: z.preprocess(
    emptyToUndefined,
    z.string({ required_error: 'LLM_BASE_URL 必填' }).trim().url({ message: '必须是合法 URL' }),
  ),
  LLM_API_KEY: requiredString('LLM_API_KEY'),
  LLM_MODEL: requiredString('LLM_MODEL'),

  // Embedding：可缺省，resolveConfig 回落到 LLM_*（cloud 模式）
  EMBEDDING_BASE_URL: optionalUrl(),
  EMBEDDING_API_KEY: optionalString(),
  EMBEDDING_MODEL: optionalString(),
  // local = 本地 Transformers.js（默认，不依赖云）；cloud = 云 OpenAI 兼容 API
  EMBEDDING_MODE: z
    .preprocess(emptyToUndefined, z.enum(['local', 'cloud'], { required_error: 'EMBEDDING_MODE 必填' }))
    .default('local'),

  // ---- 向量库 ----
  LANCE_DB_PATH: requiredStringWithDefault('LANCE_DB_PATH', './data/lance'),

  // ---- 重排器（03：bge-reranker 家族的 Transformers.js 版 tokenizer 有兼容 bug，
  //        默认用可用的 ms-marco cross-encoder；模型 id 可按需替换）----
  RERANKER_MODEL: requiredStringWithDefault('RERANKER_MODEL', 'Xenova/ms-marco-MiniLM-L-6-v2'),

  // ---- 摄入切分（02 生效）----
  CHUNK_SIZE: intEnv('CHUNK_SIZE', { positive: true }).default(800),
  CHUNK_OVERLAP: intEnv('CHUNK_OVERLAP', { min: 0 }).default(100),

  // ---- 检索（03 生效）----
  RETRIEVAL_N: intEnv('RETRIEVAL_N', { min: 1 }).default(50),
  RETRIEVAL_K: intEnv('RETRIEVAL_K', { min: 1 }).default(5),

  // ---- 摄入路径安全（可选；设置后 /ingest 只允许该目录内的路径）----
  INGEST_ROOT: optionalString(),

  // ---- 租户（05 生效）：摄入时给块打的默认租户标记，检索 API 强制过滤 ----
  DEFAULT_TENANT: requiredStringWithDefault('DEFAULT_TENANT', 'default'),

  // ---- 查询优化（08）----
  QUERY_REWRITE: boolEnv('QUERY_REWRITE', false),
  MULTI_QUERY: boolEnv('MULTI_QUERY', false),
  HYDE: boolEnv('HYDE', false),

  // ---- Chat（09）----
  CHAT_MODE: z.preprocess(emptyToUndefined, z.enum(['fixed', 'agentic'])).default('fixed'),
  CHAT_STREAM: boolEnv('CHAT_STREAM', false),
  AGENT_MAX_STEPS: intEnv('AGENT_MAX_STEPS', { min: 1, max: 10 }).default(3),
  AGENT_TIMEOUT_MS: intEnv('AGENT_TIMEOUT_MS', { min: 1000, max: 120000 }).default(30000),

  // ---- HTTP 服务 ----
  PORT: intEnv('PORT', { min: 1, max: 65535 }).default(3000),
  NODE_ENV: z
    .preprocess(
      emptyToUndefined,
      z.enum(['development', 'test', 'production'], { required_error: 'NODE_ENV 必填' }),
    )
    .default('development'),
}).superRefine((raw, ctx) => {
  const provided = [
    raw.EMBEDDING_BASE_URL,
    raw.EMBEDDING_API_KEY,
    raw.EMBEDDING_MODEL,
  ].filter((v) => v !== undefined).length;
  if (provided !== 0 && provided !== 3) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['EMBEDDING_BASE_URL'],
      message: 'EMBEDDING_* 必须三项同时设置或全部留空，避免专用密钥/模型名错配 LLM 的 baseUrl',
    });
  }
  if (raw.CHUNK_OVERLAP >= raw.CHUNK_SIZE) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CHUNK_OVERLAP'],
      message: 'CHUNK_OVERLAP 必须小于 CHUNK_SIZE',
    });
  }
});

type RawConfig = z.infer<typeof envSchema>;

/** 应用可直接消费的扁平配置（回落已解析）。 */
export interface Config {
  llm: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  embedding: {
    baseUrl: string;
    apiKey: string;
    model: string;
    /** 向量化方式：本地 Transformers.js（默认）或云 OpenAI 兼容 API。 */
    mode: 'local' | 'cloud';
    /** 是否显式配置了独立 embedding provider（供诊断/日志区分）。 */
    usesDedicatedProvider: boolean;
  };
  lance: {
    dbPath: string;
  };
  ingest: {
    /** 限制 /ingest 可读的根目录（未设置则不限制，默认本地开发模式）。 */
    root?: string;
  };
  tenant: {
    /** 摄入块默认归属的租户；检索 API 强制带 tenant 过滤。 */
    default: string;
  };
  reranker: {
    model: string;
  };
  chunking: {
    chunkSize: number;
    chunkOverlap: number;
  };
  retrieval: {
    /** 混合检索粗筛候选数（RRF 融合后进入重排的数量）。 */
    n: number;
    /** 重排后返回的 top-k。 */
    k: number;
  };
  queryOptimization: {
    rewrite: boolean;
    multiQuery: boolean;
    hyde: boolean;
  };
  chat: {
    mode: 'fixed' | 'agentic';
    stream: boolean;
    maxSteps: number;
    timeoutMs: number;
  };
  server: {
    port: number;
    env: 'development' | 'test' | 'production';
  };
}

/** 配置校验失败时抛出的错误。 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** 把 Embedding 缺省项回落到 LLM_*，产出最终 Config。 */
export function resolveConfig(raw: RawConfig): Config {
  const usesDedicatedProvider =
    raw.EMBEDDING_BASE_URL !== undefined ||
    raw.EMBEDDING_API_KEY !== undefined ||
    raw.EMBEDDING_MODEL !== undefined;
  return {
    llm: {
      baseUrl: raw.LLM_BASE_URL,
      apiKey: raw.LLM_API_KEY,
      model: raw.LLM_MODEL,
    },
    embedding: {
      baseUrl: raw.EMBEDDING_BASE_URL ?? raw.LLM_BASE_URL,
      apiKey: raw.EMBEDDING_API_KEY ?? raw.LLM_API_KEY,
      model: raw.EMBEDDING_MODEL ?? raw.LLM_MODEL,
      mode: raw.EMBEDDING_MODE,
      usesDedicatedProvider,
    },
    lance: {
      dbPath: raw.LANCE_DB_PATH,
    },
    ingest: {
      root: raw.INGEST_ROOT,
    },
    tenant: {
      default: raw.DEFAULT_TENANT,
    },
    reranker: {
      model: raw.RERANKER_MODEL,
    },
    chunking: {
      chunkSize: raw.CHUNK_SIZE,
      chunkOverlap: raw.CHUNK_OVERLAP,
    },
    retrieval: {
      n: raw.RETRIEVAL_N,
      k: raw.RETRIEVAL_K,
    },
    queryOptimization: {
      rewrite: raw.QUERY_REWRITE,
      multiQuery: raw.MULTI_QUERY,
      hyde: raw.HYDE,
    },
    chat: {
      mode: raw.CHAT_MODE,
      stream: raw.CHAT_STREAM,
      maxSteps: raw.AGENT_MAX_STEPS,
      timeoutMs: raw.AGENT_TIMEOUT_MS,
    },
    server: {
      port: raw.PORT,
      env: raw.NODE_ENV,
    },
  };
}

function formatIssues(
  issues: z.ZodIssue[],
  source: Record<string, string | undefined>,
): string {
  const lines = issues.map((issue) => {
    const key = issue.path.join('.') || '(root)';
    const raw = source[key];
    const shown = raw === undefined ? '未设置' : JSON.stringify(raw);
    return `  ✖ ${key}: ${issue.message}（当前值: ${shown}）`;
  });
  return `环境配置校验失败（请检查环境变量或 .env 文件）:\n${lines.join('\n')}`;
}

export interface LoadConfigOptions {
  /** 环境变量来源，默认 process.env（测试时注入）。 */
  env?: Record<string, string | undefined>;
}

/** 读取并校验环境变量，返回最终配置；失败抛出 ConfigError。 */
export function loadConfig(options: LoadConfigOptions = {}): Config {
  const source: Record<string, string | undefined> = options.env ?? process.env;
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(formatIssues(result.error.issues, source));
  }
  return resolveConfig(result.data);
}

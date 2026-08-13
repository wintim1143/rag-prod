import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, type Config } from '../src/config/index.js';
import { validEnv } from './helpers.js';

function captureConfigError(run: () => Config): ConfigError {
  try {
    run();
  } catch (err) {
    if (err instanceof ConfigError) {
      return err;
    }
    throw err;
  }
  throw new Error('期望抛出 ConfigError，但没有抛出');
}

describe('loadConfig — 有效配置', () => {
  it('解析全部必填配置', () => {
    const config = loadConfig({ env: validEnv() });
    expect(config.llm).toEqual({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test-key',
      model: 'deepseek-chat',
    });
    expect(config.server.port).toBe(3000);
    expect(config.server.env).toBe('test');
  });

  it('Embedding 缺省回落到 LLM（默认本地模式，同 provider）', () => {
    const config = loadConfig({ env: validEnv() });
    expect(config.embedding).toEqual({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test-key',
      model: 'deepseek-chat',
      mode: 'local',
      usesDedicatedProvider: false,
    });
  });

  it('EMBEDDING_MODE 默认 local，可切 cloud', () => {
    const local = loadConfig({ env: validEnv() });
    expect(local.embedding.mode).toBe('local');

    const cloud = loadConfig({ env: { ...validEnv(), EMBEDDING_MODE: 'cloud' } });
    expect(cloud.embedding.mode).toBe('cloud');
  });

  it('显式设置 EMBEDDING_* 时启用独立 provider', () => {
    const env = {
      ...validEnv(),
      EMBEDDING_BASE_URL: 'https://api.openai.com/v1',
      EMBEDDING_API_KEY: 'sk-embed-key',
      EMBEDDING_MODEL: 'text-embedding-3-small',
    };
    const config = loadConfig({ env });
    expect(config.embedding.usesDedicatedProvider).toBe(true);
    expect(config.embedding.baseUrl).toBe('https://api.openai.com/v1');
    expect(config.embedding.model).toBe('text-embedding-3-small');
  });

  it('空串的 EMBEDDING_* 视为未设置，回落 LLM', () => {
    const env = { ...validEnv(), EMBEDDING_BASE_URL: '  ', EMBEDDING_API_KEY: '' };
    const config = loadConfig({ env });
    expect(config.embedding.usesDedicatedProvider).toBe(false);
    expect(config.embedding.baseUrl).toBe('https://api.deepseek.com/v1');
  });

  it('LANCE_DB_PATH / RERANKER_MODEL / PORT / NODE_ENV 使用默认值', () => {
    const config = loadConfig({ env: validEnv() });
    expect(config.lance.dbPath).toBe('./data/lance');
    expect(config.reranker.model).toBe('Xenova/ms-marco-MiniLM-L-6-v2');

    const { PORT: _port, ...noPort } = validEnv();
    expect(loadConfig({ env: noPort }).server.port).toBe(3000);
  });

  it('解析 INGEST_ROOT（可选）；缺省为 undefined', () => {
    const withRoot = loadConfig({ env: { ...validEnv(), INGEST_ROOT: './data/uploads' } });
    expect(withRoot.ingest.root).toBe('./data/uploads');

    const without = loadConfig({ env: validEnv() });
    expect(without.ingest.root).toBeUndefined();
  });
});

describe('loadConfig — 校验失败', () => {
  it('缺失必填 LLM_API_KEY 抛出 ConfigError，报错含字段与原因', () => {
    const { LLM_API_KEY: _k, ...env } = validEnv();
    const err = captureConfigError(() => loadConfig({ env }));
    expect(err.message).toContain('LLM_API_KEY');
    expect(err.message).toContain('必填');
    expect(err.message).toContain('未设置');
  });

  it('LLM_BASE_URL 非法 URL 时给出清晰报错', () => {
    const env = { ...validEnv(), LLM_BASE_URL: 'not-a-url' };
    const err = captureConfigError(() => loadConfig({ env }));
    expect(err.message).toContain('LLM_BASE_URL');
    expect(err.message).toContain('合法 URL');
  });

  it('PORT 非数字时报错并展示当前值', () => {
    const env = { ...validEnv(), PORT: 'abc' };
    const err = captureConfigError(() => loadConfig({ env }));
    expect(err.message).toContain('PORT');
    expect(err.message).toContain('abc');
  });

  it('PORT 超出范围时报错', () => {
    const env = { ...validEnv(), PORT: '99999' };
    const err = captureConfigError(() => loadConfig({ env }));
    expect(err.message).toContain('PORT');
    expect(err.message).toContain('99999');
  });

  it('NODE_ENV 非法时报错', () => {
    const env = { ...validEnv(), NODE_ENV: 'staging' };
    const err = captureConfigError(() => loadConfig({ env }));
    expect(err.message).toContain('NODE_ENV');
    expect(err.message).toContain('staging');
  });

  it('多个错误一次性列出', () => {
    const env = {
      LLM_BASE_URL: 'https://ok.example/v1',
      LLM_MODEL: '',
      PORT: 'not-a-port',
      NODE_ENV: 'bad',
    };
    const err = captureConfigError(() => loadConfig({ env }));
    expect(err.message).toContain('LLM_API_KEY');
    expect(err.message).toContain('PORT');
    expect(err.message).toContain('NODE_ENV');
  });

  it('只设置部分 EMBEDDING_* 时报错（须三项同设或全空）', () => {
    const env = { ...validEnv(), EMBEDDING_MODEL: 'text-embedding-3-small' };
    const err = captureConfigError(() => loadConfig({ env }));
    expect(err.message).toContain('EMBEDDING_*');
    expect(err.message).toContain('三项同时设置');
  });
});

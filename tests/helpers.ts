/** 测试共享工具。 */

export interface TestEnv {
  [key: string]: string | undefined;
}

/** 一组通过校验的最小有效环境变量。 */
export function validEnv(): TestEnv {
  return {
    LLM_BASE_URL: 'https://api.deepseek.com/v1',
    LLM_API_KEY: 'sk-test-key',
    LLM_MODEL: 'deepseek-chat',
    QUERY_REWRITE: 'false',
    MULTI_QUERY: 'false',
    HYDE: 'false',
    CHAT_MODE: 'fixed',
    CHAT_STREAM: 'true',
    AGENT_MAX_STEPS: '3',
    AGENT_TIMEOUT_MS: '30000',
    PORT: '3000',
    NODE_ENV: 'test',
  };
}

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
    PORT: '3000',
    NODE_ENV: 'test',
  };
}

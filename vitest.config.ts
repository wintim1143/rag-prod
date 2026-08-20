import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // LanceDB 冷启动 + 重排在无 GPU 机器上较慢：
    // 1) 放宽单测超时避免环境性误报；2) 关闭文件级并发避免 128 个用例抢 CPU/磁盘导致偶发超时
    testTimeout: 60000,
    fileParallelism: false,
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});

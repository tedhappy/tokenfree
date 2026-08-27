#!/usr/bin/env node
// TokenFree 数据准备脚本：确保构建/运行所需的三个业务数据文件存在。
// 数据分治策略：运行时文件（sites/config/models.json）不进 Git；Git 里只有 .seed.json 基线。
// 本脚本在构建（prebuild）时运行 —— 若运行时文件缺失，用种子兜底；已存在则绝不覆盖，保护服务器/本地业务数据。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'src', 'data');

const RUNTIME_TO_SEED = [
  ['sites.json', 'sites.seed.json'],
  ['config.json', 'config.seed.json'],
  ['models.json', 'models.seed.json'],
];

let created = 0;
for (const [runtime, seed] of RUNTIME_TO_SEED) {
  const runtimePath = path.join(DATA_DIR, runtime);
  const seedPath = path.join(DATA_DIR, seed);
  // 运行时已存在（服务器/本地业务数据 / 首次迁移后残留）→ 跳过，绝不覆盖
  if (fs.existsSync(runtimePath)) continue;
  // 运行时缺失且存在种子 → 用种子兜底，保证构建有初始数据
  if (fs.existsSync(seedPath)) {
    fs.copyFileSync(seedPath, runtimePath);
    console.log(`[prepare-data] 生成空缺数据文件: ${runtime}（来自 ${seed}）`);
    created += 1;
  } else {
    // 两者都缺失：这是异常态，给出清晰提示而非静默
    console.error(`[prepare-data] 缺少 ${runtime} 且无 ${seed} 可兜底，请检查 src/data 目录`);
    process.exitCode = 1;
  }
}

if (created === 0) {
  console.log('[prepare-data] 运行时数据已就绪，无需生成');
}

// dsh-dynamic-bg 构建脚本
//
// 做的事很简单：把 src/client.template.js 原样拷成 lib/client.js。
// 之所以还要一个脚本而不是直接 cp：
//   1. 顺便做语法自检（node --check），防止手滑改坏模板却浑然不知
//   2. 顺便把 src/ 下的共享常量注入进去（将来要加资源内联也在这扩）
//   3. 给社区投稿留一个可复现的构建入口（CI 能跑）
//
// 用法：node scripts/build.mjs

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const tplPath = path.join(root, "src", "client.template.js");
const outPath = path.join(root, "lib", "client.js");

const src = await fs.readFile(tplPath, "utf8");

// 写产物
await fs.writeFile(outPath, src, "utf8");

// 语法自检（用运行本脚本的同一个 node）
try {
  execFileSync(process.execPath, ["--check", outPath], { stdio: "pipe" });
  console.log("✓ 语法检查通过");
} catch (e) {
  console.error("✗ 语法检查失败，产物已生成但不可用：");
  console.error(e.stderr?.toString() ?? String(e));
  process.exit(1);
}

const size = (await fs.stat(outPath)).size;
console.log(`✓ 构建完成：lib/client.js  ${size} 字节  （源 src/client.template.js）`);

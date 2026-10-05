// dsh-dynamic-bg —— 宿主一半
//
// 职责（2026-10-03 扩展）：
//   1. /dsh-dynamic-bg/media   —— 读本地媒体文件喂给浏览器（原有）
//   2. /dsh-dynamic-bg/browse  —— 列目录（给界面的"选文件夹"用）
//   3. /dsh-dynamic-bg/pick    —— 列文件夹里的媒体文件（给"选具体文件"用）
//   4. /dsh-dynamic-bg/probe   —— 探文件是否可读 + 拿基本信息
//
// 安全边界（能上社区的前提，一条都不放松）：
//   · 只允许读「媒体扩展名」的文件（图/视频），其它一律 403
//   · 只允许绝对路径，且解析后不能落在敏感目录
//   · 目录浏览只列「子目录 + 媒体文件」，不列其它文件（不会泄露 .ssh 之类）
//   · 单文件上限 2GB，目录列项上限 2000
//   · 永远不写文件，只读

import { createReadStream, statSync, readdirSync, appendFileSync } from "node:fs";
import { extname, resolve, sep, join, dirname, basename } from "node:path";
import { homedir } from "node:os";

export const name = "dsh-dynamic-bg";

/** 需要 webserver 来挂路由。 */
export const inject = ["webServer"];

const ROUTE_MEDIA = "/dsh-dynamic-bg/media";
const ROUTE_BROWSE = "/dsh-dynamic-bg/browse";
const ROUTE_PICK = "/dsh-dynamic-bg/pick";
const ROUTE_PROBE = "/dsh-dynamic-bg/probe";
const ROUTE_DIAG = "/dsh-dynamic-bg/diag";
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
const MAX_ENTRIES = 2000;

/** 扩展名 → MIME。客户端 src/client.template.js 里那份要跟这里保持一致。 */
const MIME = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  avif: "image/avif", bmp: "image/bmp", gif: "image/gif", svg: "image/svg+xml",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  m4v: "video/x-m4v", ogv: "video/ogg",
};

/** 明确拒绝的目录前缀（防误读系统敏感文件）。 */
const DENY_PREFIX = [
  "/etc", "/private/etc", "/private/var/db", "/var/db",
  "/System", "/private/var/vm", "/dev",
];

/** 浏览时额外隐藏的目录（不是禁止读，只是不在列表里露出来）。 */
const HIDE_DIRS = new Set([
  ".ssh", ".gnupg", ".aws", ".config", "Library", "node_modules",
  ".Trash", ".cache", ".npm", ".pnpm-store", ".git",
]);

function mimeOf(p) {
  const ext = extname(p).replace(/^\./, "").toLowerCase();
  return MIME[ext] ?? "";
}

function isDenied(abs) {
  for (const d of DENY_PREFIX) {
    if (abs === d || abs.startsWith(d + sep)) return true;
  }
  return false;
}

/** 解析并校验一个待读路径；返回 {ok, abs, mime, size} 或 {ok:false, code, msg}。 */
export function resolveMedia(rawPath) {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    return { ok: false, code: 400, msg: "path 不能为空" };
  }
  const trimmed = rawPath.trim();
  const abs = resolve(trimmed);
  if (!trimmed.startsWith("/")) {
    return { ok: false, code: 400, msg: "必须是绝对路径" };
  }
  if (isDenied(abs)) {
    return { ok: false, code: 403, msg: "这个目录不允许读取" };
  }
  const mime = mimeOf(abs);
  if (mime === "") {
    return { ok: false, code: 403, msg: "只支持图片 / 视频类型" };
  }
  let st;
  try {
    st = statSync(abs);
  } catch {
    return { ok: false, code: 404, msg: "文件不存在或读不到：" + abs };
  }
  if (!st.isFile()) return { ok: false, code: 400, msg: "不是一个文件" };
  if (st.size > MAX_BYTES) return { ok: false, code: 413, msg: "文件超过 2GB" };
  return { ok: true, abs, mime, size: st.size };
}

/** 列目录：返回子目录 + 媒体文件（其它文件不列）。 */
export function listDir(rawPath) {
  // 空路径 = 从用户主目录开始
  const target = (typeof rawPath === "string" && rawPath.trim() !== "")
    ? resolve(rawPath.trim())
    : homedir();
  if (isDenied(target)) return { ok: false, code: 403, msg: "这个目录不允许浏览" };

  let st;
  try {
    st = statSync(target);
  } catch {
    return { ok: false, code: 404, msg: "目录不存在：" + target };
  }
  if (!st.isDirectory()) return { ok: false, code: 400, msg: "不是一个目录" };

  let ents = [];
  try {
    ents = readdirSync(target, { withFileTypes: true });
  } catch (e) {
    return { ok: false, code: 403, msg: "没有权限读这个目录（macOS 可能要求授权）" };
  }

  const dirs = [];
  const files = [];
  for (const e of ents) {
    if (e.name.startsWith(".")) continue;              // 隐藏文件一律不列
    const full = join(target, e.name);
    if (e.isDirectory()) {
      if (HIDE_DIRS.has(e.name)) continue;
      dirs.push({ name: e.name, path: full });
    } else if (e.isFile()) {
      const mime = mimeOf(e.name);
      if (mime === "") continue;                        // 非媒体不列
      let size = 0;
      try { size = statSync(full).size; } catch {}
      files.push({ name: e.name, path: full, mime, size });
    }
    if (dirs.length + files.length >= MAX_ENTRIES) break;
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name, "zh"));
  files.sort((a, b) => a.name.localeCompare(b.name, "zh"));

  return {
    ok: true,
    path: target,
    parent: dirname(target) === target ? null : dirname(target),
    dirs,
    files,
    home: homedir(),
  };
}

export function apply(ctx) {
  const mount = (c) => {
    const server = c.webServer;
    if (server === undefined || server === null || typeof server.register !== "function") {
      c.logger?.warn?.("dsh-dynamic-bg: 拿不到 webServer.register，路由未注册");
      return;
    }

    const json = (res, code, obj) => {
      const body = JSON.stringify(obj);
      res.writeHead(code, { "content-type": "application/json; charset=utf-8" }).end(body);
    };

    // ── 媒体读取 ──
    const mediaHandler = (req, res) => {
      let url;
      try {
        url = new URL(req.url ?? "", "http://127.0.0.1");
      } catch {
        res.writeHead(400).end("bad url");
        return;
      }
      const r = resolveMedia(url.searchParams.get("path") ?? "");
      if (!r.ok) {
        res.writeHead(r.code, { "content-type": "text/plain; charset=utf-8" }).end(r.msg);
        return;
      }

      const range = req.headers.range;
      const headers = {
        "content-type": r.mime,
        "cache-control": "no-cache",
        "accept-ranges": "bytes",
      };

      if (typeof range === "string" && /^bytes=\d*-\d*$/.test(range.trim())) {
        const [s, e] = range.replace(/bytes=/, "").split("-");
        const start = s === "" ? 0 : Number(s);
        const end = e === "" || Number(e) >= r.size ? r.size - 1 : Number(e);
        if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
          res.writeHead(416, { "content-range": `bytes */${r.size}` }).end();
          return;
        }
        res.writeHead(206, {
          ...headers,
          "content-range": `bytes ${start}-${end}/${r.size}`,
          "content-length": String(end - start + 1),
        });
        createReadStream(r.abs, { start, end }).pipe(res);
        return;
      }

      res.writeHead(200, { ...headers, "content-length": String(r.size) });
      createReadStream(r.abs).pipe(res);
    };

    // ── 目录浏览 ──
    const browseHandler = (req, res) => {
      let url;
      try { url = new URL(req.url ?? "", "http://127.0.0.1"); } catch { return json(res, 400, { ok: false, msg: "bad url" }); }
      const r = listDir(url.searchParams.get("path") ?? "");
      json(res, r.ok ? 200 : r.code, r);
    };

    // ── 探活（文件能不能读）──
    const probeHandler = (req, res) => {
      let url;
      try { url = new URL(req.url ?? "", "http://127.0.0.1"); } catch { return json(res, 400, { ok: false, msg: "bad url" }); }
      const r = resolveMedia(url.searchParams.get("path") ?? "");
      json(res, 200, r.ok
        ? { ok: true, path: r.abs, name: basename(r.abs), mime: r.mime, size: r.size,
            kind: r.mime.startsWith("video/") ? "video" : "image" }
        : { ok: false, code: r.code, msg: r.msg });
    };

    // ── 自检通道（把前端实测的渲染尺寸写文件，供排查用）──
    const diagHandler = (req, res) => {
      let url;
      try { url = new URL(req.url ?? "", "http://127.0.0.1"); } catch { return json(res, 400, { ok: false }); }
      const rec = { at: new Date().toISOString() };
      for (const [k, v] of url.searchParams) rec[k] = v;
      try {
        const line = JSON.stringify(rec);
        appendFileSync("/tmp/dsh-dynbg-diag.log", line + "\n");
      } catch (e) {}
      json(res, 200, { ok: true });
    };

    const routes = [
      { kind: "exact", path: ROUTE_MEDIA, handler: mediaHandler },
      { kind: "exact", path: ROUTE_BROWSE, handler: browseHandler },
      { kind: "exact", path: ROUTE_PICK, handler: browseHandler },
      { kind: "exact", path: ROUTE_PROBE, handler: probeHandler },
      { kind: "exact", path: ROUTE_DIAG, handler: diagHandler },
    ];

    for (const route of routes) {
      if (typeof c.effect === "function") {
        c.effect(() => server.register(route), `dsh-dynamic-bg: ${route.path}`);
      } else {
        server.register(route);
      }
    }
    c.logger?.info?.("dsh-dynamic-bg: 4 条路由已挂载");
  };

  // ⚠️ 宿主侧绝对不能调 ctx.inject（2026-10-02 血案：会导致 "web boot: 1 entry did not activate"）
  //    服务依赖已在模块级 `export const inject = ["webServer"]` 声明，apply 里直接 mount。
  mount(ctx);
}

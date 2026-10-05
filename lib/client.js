// dsh-dynamic-bg —— 客户端一半
//
// 功能（2026-10-03 扩展后）：
//   · 背景：静态图 / GIF 动图 / 视频
//   · 文件夹浏览 + 选文件（不用手打路径）
//   · 主题跟随：自动（白昼亮/黑夜暗）/ 固定深色 / 固定浅色
//   · 字号调节：小 / 标准 / 大 / 特大
//   · 每个对话独立背景
//   · 氛围层：漂浮诗句 / 01 数据流
//   · 实时预览
//
// 设计铁律（都是血案换来的）：
//   1. 插槽组件必须返回 React 元素，绝不能返回 DOM（否则 React #31 → renderer 被杀）
//   2. 宿主侧服务依赖在模块级 inject 声明，apply 里直接用
//   3. 只改 DSH 的 --dsw-* 令牌，不碰带哈希的类名
//   4. 所有样式挂在 body.dsh-dynbg-on 下，关掉即原样

window.__ModuleLoader__.load({
  id: "dsh-dynamic-bg",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    // 侧边栏入口必须用 React（2026-10-02 血案：返回 DOM → React #31 → 客户端打不开）
    var react = require("react");

    const STYLE_ID = "dsh-dynamic-bg-style";
    const LAYER_ID = "dsh-dynamic-bg-layer";
    const AMBIENT_ID = "dsh-dynamic-bg-ambient";
    const STORE_KEY = "dsh-dynamic-bg:config";
    const PER_SESSION_KEY = "dsh-dynamic-bg:per-session";
    const ROUTE = "/dsh-dynamic-bg/media";
    const ROUTE_BROWSE = "/dsh-dynamic-bg/browse";
    const ROUTE_PROBE = "/dsh-dynamic-bg/probe";
    const ROUTE_DIAG = "/dsh-dynamic-bg/diag";

    const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "avif", "bmp", "gif", "svg"];
    const VIDEO_EXT = ["mp4", "webm", "mov", "m4v", "ogv"];

    const DEFAULT = {
      path: "",
      kind: "video",
      enabled: false,
      configVersion: 2,
      veil: 46,
      blur: 0,
      opacity: 100,
      fit: "cover",
      composerBlur: 6,      // 输入框聚焦毛玻璃的模糊半径 px
      composerTint: 38,     // 输入框聚焦时的底色透明度 %
      dim: false,
      muted: true,
      loop: true,
      playbackRate: 100,
      themeMode: "auto",      // auto | dark | light
      textStyle: "hacker-green", // off | readable | glass | hacker-green | hacker-amber | hacker-magenta | hacker-white | hacker-cyan
      perSession: false,
      ambient: "poem",        // off | poem | binary（默认开，方便直接看到效果）
      ambientOpacity: 18,
      ambientSpeed: 100,
      ambientDensity: 3,      // 每秒新增条数（保留兼容）
      poemLib: "libai",       // libai | all
      ambientLanes: 7,        // 泳道数（决定横向密度、且防重叠）
      ambientColorMode: "theme", // theme | custom
      ambientColor: "#e8f4fa",   // 自定义文字色
    };


    /** 配置结构版本：升级默认素材时 +1，老配置会自动迁移。 */
    const CONFIG_VERSION = 2;
    /** 历史上被我设成默认、后来换掉的素材（迁移时替换）。 */
    const RETIRED_DEFAULTS = [];

    function loadConfig() {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw === null) return { ...DEFAULT };
        const saved = JSON.parse(raw);
        const merged = { ...DEFAULT, ...saved };
        // ⚠️ 2026-10-03：旧版本存的配置里缺新字段（泳道/颜色/竖排…），
        //    合并时已由 DEFAULT 补齐。但 path/enabled 这类用户改过的要保留 ——
        //    所以只在"用户从没设过 path"时才套用新默认。
        if (typeof saved.path !== "string" || saved.path === "") {
          merged.path = DEFAULT.path;
          merged.kind = DEFAULT.kind;
        }
        // 2026-10-03 素材迁移：老配置里存的是我设的旧默认（如 5070），换成新默认。
        // 只替换"我设过的旧默认"，用户自己挑的素材不动。迁移结果落盘。
        let migrated = false;
        if (RETIRED_DEFAULTS.indexOf(saved.path) !== -1) {
          merged.path = DEFAULT.path;
          merged.kind = DEFAULT.kind;
          migrated = true;
        }
        // ★★★ 2026-10-03 关键修复（顶/底灰条的真凶）★★★
        // fit: "contain" 会让视频完整显示而上下留黑边，黑边处露出遮蔽层+系统材质
        // ⇒ 就是那两条"灰条"。窗口中部被视频铺满 ⇒ 看起来透明。
        // 强制改回 "cover"（铺满、不留边）。
        if (saved.fit === "contain") { merged.fit = "cover"; migrated = true; }
        // 2026-10-03 回滚：金色诗词那版把浓度默认提到 34、配色改成 gold，
        // 这里把被它改过的值改回绿色黑客版当时的状态（浓度 18、配色跟随主题）。
        if (Number(saved.ambientOpacity) === 34) { merged.ambientOpacity = 18; migrated = true; }
        if (saved.ambientColorMode === "gold") { merged.ambientColorMode = "theme"; migrated = true; }
        if (saved.configVersion !== CONFIG_VERSION) { merged.configVersion = CONFIG_VERSION; migrated = true; }
        if (saved.enabled === undefined) { merged.enabled = DEFAULT.enabled; migrated = true; }
        if (saved.ambient === undefined) { merged.ambient = DEFAULT.ambient; migrated = true; }
        if (migrated) {
          try { localStorage.setItem(STORE_KEY, JSON.stringify(merged)); } catch (e) {}
          migrationToast = String(merged.path).split("/").pop();
        }
        return merged;
      } catch {
        return { ...DEFAULT };
      }
    }
    function saveConfig(cfg) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch {}
    }

    function loadPerSession() {
      try {
        const raw = localStorage.getItem(PER_SESSION_KEY);
        return raw === null ? {} : JSON.parse(raw);
      } catch { return {}; }
    }
    function savePerSession(obj) {
      try { localStorage.setItem(PER_SESSION_KEY, JSON.stringify(obj)); } catch {}
    }

    function currentSessionId() {
      try {
        const m = location.pathname.match(/session\/([A-Za-z0-9-]+)/) ||
                  location.hash.match(/session\/([A-Za-z0-9-]+)/);
        if (m) return m[1];
        if (window.__dshCurrentSessionId) return window.__dshCurrentSessionId;
        const q = new URLSearchParams(location.search).get("session");
        if (q) return q;
      } catch {}
      return "default";
    }

    function kindOf(p) {
      const ext = String(p).split(".").pop().toLowerCase();
      if (VIDEO_EXT.indexOf(ext) >= 0) return "video";
      if (IMAGE_EXT.indexOf(ext) >= 0) return "image";
      return "";
    }
    function mediaUrl(p) {
      return ROUTE + "?path=" + encodeURIComponent(p);
    }

    // ────────── 样式 ──────────
    function ensureStyle() {
      if (document.getElementById(STYLE_ID) !== null) return;
      const el = document.createElement("style");
      el.id = STYLE_ID;
      el.textContent = `
body.dsh-dynbg-on { background-color: transparent !important; }
/* ★★★ 2026-10-03 第十八次修（材质层遮蔽）★★★
   顶/底灰条的真正来源 = Electron 主进程的 vibrancy:"sidebar"（macOS 系统毛玻璃）。
   材质在网页渲染层【下面】，CSS 改不掉；tint 只是前景着色。
   解法：在壁纸层(z-index:-3)下面铺一层不透明底(z-index:-4)，
   把系统毛玻璃完全挡住 —— 壁纸铺满处看到壁纸，壁纸没盖到处看到这层底色。
   视觉上依然是"壁纸透出整个窗口"，但不再有毛玻璃的灰。 */
body.dsh-dynbg-on::before {
  content: ""; position: fixed; inset: 0; z-index: -4;
  pointer-events: none;
  /* 半透明深底：挡住 vibrancy 材质的"灰变化"，但让壁纸亮度穿过来 */
  /* 不透明深底：彻底挡住 macOS 系统材质（那层灰）。
     正常情况下被壁纸层完全盖住；视频加载中/失败时露出的也是深色，不是灰。 */
  background: rgb(10, 14, 24);
}
body.dsh-dynbg-on #${LAYER_ID} {
  position: fixed; inset: 0; z-index: -3;
  pointer-events: none; overflow: hidden;
}
body.dsh-dynbg-on #${LAYER_ID} > img,
body.dsh-dynbg-on #${LAYER_ID} > video {
  width: 100%; height: 100%; display: block;
  object-fit: var(--dsh-dynbg-fit, cover);
  opacity: var(--dsh-dynbg-opacity, 1);
  filter: blur(var(--dsh-dynbg-blur, 0px));
  transform: scale(var(--dsh-dynbg-scale, 1));
}
body.dsh-dynbg-on::after {
  content: ""; position: fixed; inset: 0; z-index: -2;
  pointer-events: none;
  background: rgba(2, 6, 18, var(--dsh-dynbg-veil, 0.46));
}
body.dsh-dynbg-on:not([data-ds-dark-theme])::after {
  background: rgba(255, 255, 255, var(--dsh-dynbg-veil, 0.46));
}
/* ⚠️ 2026-10-03 修：原来用 !important 硬覆盖 --dsw-alias-bg-base / -sidebar-fill，
   结果 DSH 把这些令牌用在很多地方（标题栏、边栏底…），被统一成一个半透明色后
   左上/左下出现跟周围不一致的灰块。改为：
   · 只把「最外层容器」变透明（让壁纸透出来）
   · 内部组件颜色交给 DSH 自己按主题渲染，一个令牌都不动 */
body.dsh-dynbg-on,
body.dsh-dynbg-on #root,
body.dsh-dynbg-on #root > div {
  background-color: transparent !important;
}
/* 侧边栏的几处底色：透明掉，让壁纸连贯透出
   （2026-10-03 第二次修：上次只改 #root，这三处的底色就露出来成了灰块） */
body.dsh-dynbg-on {
  /* ⚠️ 2026-10-03 大清理：这一段我来回改了 8 次，每次都在猜令牌，结果把
     侧边栏按钮的底色搞了出来（用户：原本没有，是修灰块修出来的）。
     现在只保留【确实必需】的三条，其余全部删掉，让 DSH 用自己的默认值：
       · bg-base  —— 不给它透明，右侧对话区就是纯黑（今天验证过）
       · mask-blur + bg-mask-*  —— 不给它取消，顶部/底部就是灰毛玻璃（今天验证过）
     侧边栏（含按钮）一个令牌都不动，恢复 DSH 原样。 */
  --dsw-mask-blur: blur(20px) saturate(125%) !important;
  /* ★★★ 2026-10-03 改：二级界面（设置/弹窗/图片查看器）要能看 ───
     这几个是"遮罩/菜单"专用变量，全透明会让背后的字透上来，界面内容反而看不见。
     恢复成「半透明深底 + 模糊」：背景还能感到壁纸，但看不见背后的字。
     默认值参考（DSH 自带）：bg-mask-1 浅色 rgba(0,0,0,.24) / 深色 rgba(0,0,0,.5) */
  --dsw-alias-bg-mask-1: rgba(4, 8, 16, .58) !important;
  --dsw-alias-bg-mask-2: transparent !important;
  --dsw-alias-bg-mask-3: transparent !important;
  --dsw-alias-bg-mask-drop: transparent !important;
  --dsw-alias-bg-mask-photo: transparent !important;
}

body.dsh-dynbg-on.dsh-dynbg-dim #${LAYER_ID} { filter: brightness(0.72); }

/* ★★★ 2026-10-03 第七次修（这次有 DOM 证据了）★★★
   用户给的开发者工具截图显示，左侧这几个元素用的是【CSS Modules 哈希类名】：
     .__3WPZCG_topStrip      顶部条（左上角那个灰块）
     .__3WPZCG_newSession    「新对话」「定时任务」按钮
     .__3WPZCG_root          整个侧边栏容器
   哈希前缀每次构建都可能变 ⇒ 用【属性选择器】匹配后缀，稳。 */
body.dsh-dynbg-on [class*="_topStrip"],
body.dsh-dynbg-on [class*="_quietBars"],
body.dsh-dynbg-on [class*="_newSession"],
body.dsh-dynbg-on [class*="_logoRow"],
body.dsh-dynbg-on [class*="_panelList"],
body.dsh-dynbg-on [class*="_regionArea"],
body.dsh-dynbg-on [class*="_footerArea"],
/* ★★★ 2026-10-03 修：那条贯穿上下的【竖分割线】★★★
   DSH 写死了：[data-platform=darwin] ._6Qf49G_centerCol{ border-left:.5px solid var(--dsw-alias-border-l3) }
   全透明界面下这条线特别显眼，看着像"多了个图层/被挡住一条"。
   把三列的左右边线全部去掉（只去左右，不动上下，避免影响别的分隔）。 */
body.dsh-dynbg-on [class*="_centerCol"],
body.dsh-dynbg-on [class*="_rightbarCol"],
body.dsh-dynbg-on [class*="_sidebarCol"],
body.dsh-dynbg-on [class*="_frame"] {
  border-left: 0 none !important;
  border-right: 0 none !important;
}

/* ★★★ 2026-10-03 加：「已编辑」这类卡片的黑底 ★★★
   DSH 里这些卡片不走 --dsw-alias-*，而是【本地变量间接引用静态色】：
     .ztjrea_card { --changes-fill: var(--dsw-static-neutral-850) }(深色)
     .ztjrea_header { background: var(--changes-fill) }
   同类还有 --card-fill（普通卡片）、--deliverable-fill（交付卡片）。
   这些变量名是"组件本地"的，全局设成透明最稳（不会误伤别的）；
   hover 留一点半透明反馈，否则鼠标移上去没反应。 */
body.dsh-dynbg-on * {
  --changes-fill: transparent !important;
  --changes-hover: rgba(127, 127, 127, .14) !important;
  --card-fill: transparent !important;
  --card-hover: rgba(127, 127, 127, .14) !important;
  --deliverable-fill: transparent !important;
  --deliverable-hover: rgba(127, 127, 127, .14) !important;
}

/* ★ 代码块元素兜底：有的代码块底是写死的，不光靠变量 */
body.dsh-dynbg-on pre,
body.dsh-dynbg-on code,
body.dsh-dynbg-on [class*="codeBlock" i],
body.dsh-dynbg-on [class*="code-block" i],
body.dsh-dynbg-on [class*="markdownCode" i],
body.dsh-dynbg-on [class*="_codeBlock"],
body.dsh-dynbg-on [class*="_codeBanner"],
body.dsh-dynbg-on [class*="_codeHeader"] {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
}
body.dsh-dynbg-on pre *,
body.dsh-dynbg-on [class*="codeBlock" i] * {
  background-color: transparent !important;
}

/* ★★★ 2026-10-03 加：复制 / 用量 那一行改成【常显】★★★
   DSH 里这行是悬停才出现的：.ppByMG_actions{opacity:0;transition:opacity 80ms}
   悬停祖先时才 opacity:1。透明界面下不悬停就看不见，容易以为没有。
   这里强制常显（含同类动作行 actions / actionRow / rowActions / usage）。 */
body.dsh-dynbg-on [class*="_actions"],
body.dsh-dynbg-on [class*="_actionRow"],
body.dsh-dynbg-on [class*="_rowActions"],
body.dsh-dynbg-on [class*="_usage"] {
  opacity: 1 !important;
  visibility: visible !important;
}

/* ★★★ 2026-10-03 加：设置【内层面板】也要底+模糊 ★★★
   根因：.Dws9Sa_panel{ background: var(--dsw-alias-bg-layer-2) } —— 该变量被我设成透明，
   所以设置面板本体是透的，背后的字全透上来（通用设置那块尤其明显）。
   注意：--dsw-alias-bg-layer-2 不能全局恢复（主界面还要透明），所以只给面板类补底。 */
body.dsh-dynbg-on [role="dialog"],
body.dsh-dynbg-on [aria-modal="true"],
body.dsh-dynbg-on #dsh-dynbg-veil > div,
body.dsh-dynbg-on [class*="Dws9Sa_panel"],
body.dsh-dynbg-on [class*="_settingsPanel"],
body.dsh-dynbg-on [class*="_modal"],
body.dsh-dynbg-on [class*="_dialog"],
body.dsh-dynbg-on [class*="_overlay"] > :not([class*="_mask"]) {
  background-color: rgba(8, 13, 22, .72) !important;
  -webkit-backdrop-filter: blur(26px) saturate(130%) !important;
  backdrop-filter: blur(26px) saturate(130%) !important;
}

/* ★★★ 2026-10-04 第二十三次修：片头片库面板（另一个插件 插件）★★★
   根因：它的 .dba-lib 写的是 background: var(--dsw-alias-bg-elevated, #fff)，
   而这个变量正是**本文件第 498 行设成 transparent 的那个** —— 我们自己定义出来、
   被别的插件读走了 ⇒ 那个面板全透（换机后用户截图发现）。
   ⚠️ 教训：**别给 DSH 本体不存在的变量赋值** —— 第三方插件可能正好读它。 */
body.dsh-dynbg-on .dba-lib {
  background-color: rgba(8, 13, 22, .72) !important;
  -webkit-backdrop-filter: blur(26px) saturate(130%) !important;
  backdrop-filter: blur(26px) saturate(130%) !important;
}
/* 它的遮罩也对齐「更多→设置」：那边是透明的，不压暗全窗 */
body.dsh-dynbg-on .dba-veil {
  background: transparent !important;
}

/* 二级界面遮罩兜底：就算变量被换名，这些类也保证有模糊 */
body.dsh-dynbg-on [class*="_mask"] {
  -webkit-backdrop-filter: blur(20px) saturate(125%) !important;
  backdrop-filter: blur(20px) saturate(125%) !important;
}

body.dsh-dynbg-on [class*="_sidebarCol"] {
  background-color: transparent !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  box-shadow: none !important;
}
/* 按钮的 hover 保留一点反馈，不然点了没感觉 */
body.dsh-dynbg-on [class*="_newSession"]:hover {
  background-color: rgba(127, 127, 127, 0.14) !important;
}
/* 帧容器（它也可能是灰底来源） */
body.dsh-dynbg-on [class*="_frame"] {
  background-color: transparent !important;
}
/* ★ 2026-10-03 第八次修：上面那条命中 topStrip 了但仍显灰 ⇒ 灰底来自父级或伪元素。
   这轮用【组合拳】：凡侧边栏内的一切，背景一律透传 —— 但不碰主内容区。 */
body.dsh-dynbg-on [class*="_sidebarCol"],
body.dsh-dynbg-on [class*="_sidebarCol"] *,
body.dsh-dynbg-on [class*="_topStrip"],
body.dsh-dynbg-on [class*="_topStrip"]::before,
body.dsh-dynbg-on [class*="_topStrip"]::after,
body.dsh-dynbg-on [class*="_quietBars"],
body.dsh-dynbg-on [class*="_quietBars"]::before,
body.dsh-dynbg-on [class*="_quietBars"]::after {
  background-color: transparent !important;
  background-image: none !important;
}
/* ★★★ 2026-10-03 第九次修（找到写死的值了）★★★
   从 DSH 的 CSS 里挖出来的原文：
     ._3WPZCG_newSession { background: #ffffff26 }   ← 白色 15%，写死，不走令牌
     ._3WPZCG_newSession { background: #ffffff8c }   ← 浅色主题版
   这就是"新对话/定时任务"灰块的真正来源 ⇒ 改任何 --dsw-* 令牌都没用。
   现在直接压掉它的 background（用 !important 盖过 DSH 的写死值）。 */
body.dsh-dynbg-on [class*="_newSession"] {
  background: transparent !important;
  background-color: transparent !important;
}
body.dsh-dynbg-on [class*="_newSession"]:hover {
  background: rgba(127, 127, 127, 0.14) !important;
}
/* 收缩态（collapsed）也一起压 */
body.dsh-dynbg-on [class*="_collapsed"] [class*="_newSession"] {
  background: transparent !important;
}
/* 其它可能写死的白色半透明（iconButton / brand / panelRow 本身是 0 0，不用管） */
body.dsh-dynbg-on [class*="_3WPZCG"] {
  --dsw-alias-button-floating-hover: rgba(127, 127, 127, 0.16) !important;
}

body.dsh-dynbg-on #${AMBIENT_ID} {
  /* 只做这一处改动：左侧留 260px 避开侧边栏，其余保持原样
     （上一轮我改令牌+加通配选择器，把右侧对话区的透明度搞坏了 —— 回滚后只留这一行） */
  /* 全宽铺（原来是 left:260px）—— 硬切边正好落在侧栏分界线上，
     看着像"图层边界"。改全宽 + 左侧柔化淡入，边界就看不出来了。 */
  position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: -1;
  pointer-events: none; overflow: hidden;
  opacity: calc(var(--dsh-dynbg-ambient-opacity, 18) / 100);
  -webkit-mask-image: linear-gradient(to right, rgba(0,0,0,0) 0, rgba(0,0,0,0) 150px, rgba(0,0,0,.9) 260px, #000 340px);
  mask-image: linear-gradient(to right, rgba(0,0,0,0) 0, rgba(0,0,0,0) 150px, rgba(0,0,0,.9) 260px, #000 340px);
  font-family: "Songti SC", "STSong", "SimSun", serif;
  color: var(--dsh-dynbg-ambient-color, var(--dsw-alias-text-primary, #e8f4fa));
}
body.dsh-dynbg-on #${AMBIENT_ID} .dsh-dynbg-amb {
  position: absolute;
  /* 竖排：每个字一个块，从上往下排 */
  writing-mode: vertical-rl;
  text-orientation: upright;
  letter-spacing: 0.12em;
  white-space: nowrap;
  line-height: 1.15;
  animation: dsh-dynbg-rise linear forwards;
  will-change: transform, opacity;
  text-shadow: 0 0 10px rgba(0,0,0,.55), 0 0 3px rgba(0,0,0,.4);
  color: inherit;
}
@keyframes dsh-dynbg-rise {
  0%   { transform: translateY(0) rotate(var(--dsh-tilt-from, 0deg)); opacity: 0; }
  12%  { opacity: 1; }
  82%  { opacity: 1; }
  100% { transform: translateY(calc(-100vh - 220px)) rotate(var(--dsh-tilt-to, 0deg)); opacity: 0; }
}

/* ★★★ 2026-10-03 第十六次修（最后一条）：底部状态栏残底 ★★★
   状态条区域（轮数/token 数/缓存命中那行）还有浅暗底 —— 它的容器可能是
   footArea / rootArea / railIn / statusLine 的父级。一律透传。 */
body.dsh-dynbg-on [class*="_footArea"],
body.dsh-dynbg-on [class*="_rootArea"],
body.dsh-dynbg-on [class*="_regionArea"],
body.dsh-dynbg-on [class*="_railIn"],
body.dsh-dynbg-on [class*="_panelList"],
body.dsh-dynbg-on [class*="_statusLine"],
body.dsh-dynbg-on [class*="_status"],
body.dsh-dynbg-on [class*="_tool"] {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  box-shadow: none !important;
}
/* 终极兜底：任何带 elevation-stroke（卡片投影）的容器，在背景开启时投影关掉 */
body.dsh-dynbg-on {
  --dsw-shadow-lv1-blur: none !important;
}

/* ★★★ 2026-10-03 第十九次修：顶/底条的"那层半透明黑" ★★★
   现象：中间透亮，顶/底各有暗带。遮蔽层改半透明后依然存在。
   判断：是 DSH 在顶/底放的【渐变遮罩】（让标题栏/状态栏文字可读的
   scrim）—— 这类通常叫 fade/scrim/gradient-mask，写死 rgba 黑。
   全量抓 fade/scrim 类。 */
body.dsh-dynbg-on [class*="fade" i],
body.dsh-dynbg-on [class*="scrim" i],
body.dsh-dynbg-on [class*="gradient" i],
body.dsh-dynbg-on [class*="Shade" i],
body.dsh-dynbg-on [class*="_shade"] {
  background: transparent !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* ★★★ 2026-10-03 第十次修（真凶锁定，精确选择器）★★★
   侧边栏灰块 = darwin 平台专用的写死白色背景：
     [data-platform=darwin] ._3WPZCG_newSession { background:#ffffff8c }          浅色 55%
     [data-platform=darwin] [data-ds-dark-theme] ._3WPZCG_newSession {background:#ffffff26} 深色15%
   我之前的 [class*="_newSession"] 优先级不够，被它盖过。
   现在用【同等优先级 + !important】压掉。 */
/* ⚠️ 修正：data-platform=data-ds-dark-theme 都在 <html> 上（是 body 的祖先），
   我上一版写成 body 的后代 ⇒ 永远匹配不到。现在顺序反过来。 */
html[data-platform=darwin] body.dsh-dynbg-on [class*="_newSession"],
[data-platform=darwin] [data-ds-dark-theme] body.dsh-dynbg-on [class*="_newSession"] {
  background: transparent !important;
  background-color: transparent !important;
}
html[data-platform=darwin] body.dsh-dynbg-on [class*="_newSession"]:hover,
[data-platform=darwin] [data-ds-dark-theme] body.dsh-dynbg-on [class*="_newSession"]:hover {
  background: rgba(127, 127, 127, 0.14) !important;
}

/* 侧边栏根容器 background:var(--dsw-specific-sidebar-fill) —— 令牌设透明 */
/* ★★★ 2026-10-04 第二十四次修（方案 B）：被插件读走的变量，从 body 挪到 #root ★★★
   根因：这些变量原来设在 body 上，而 body 是一切元素的祖先 ⇒ 每个插件都读到「透明」
   （实测撞到：另一个插件 的「片头片库」面板整块透）。
   实测依据：主界面四大块（侧栏/顶栏/输入框/新会话）全在 #root 内 ⇒ 挪进来不影响主界面；
   插件浮层挂在 body 下、#root 之外 ⇒ 拿回 DSH 原值。
   回退：把这段挪回下面的 body 块即可。 */
body.dsh-dynbg-on #root {
  --dsw-alias-bg-elevated: transparent !important;
  --dsw-alias-bg-layer-1: transparent !important;
  --dsw-alias-bg-layer-2: transparent !important;
  --dsw-alias-bg-layer-3: transparent !important;
  --dsw-alias-bg-layer-4: transparent !important;
  --dsw-alias-bg-module-platform: transparent !important;
  --dsw-specific-input-major: transparent !important;
  --dsw-specific-menu: rgba(8, 12, 20, .74) !important;
  --dsw-specific-sidebar-fill: transparent !important;
  --dsw-specific-tip: transparent !important;
  --dsw-alias-bg-base: transparent !important;
  --dsw-shadow-lv1: none !important;
  --dsw-menu-backdrop-filter: blur(24px) saturate(130%) !important;
}

body.dsh-dynbg-on {
  /* ★ 第十四次修：specific-* 系列（深色主题下 94% 不透明）全部透传。
     它们用于顶栏/弹层/气泡底。弹出菜单变透明可接受，总比顶/底暗条好。 */
  /* ★★★ 2026-10-03 加：代码块的黑底（用户要求透明）★★★
     DSH 里代码块走这几个别名变量：
       --dsw-alias-markdown-code-block        正文代码块底
       --dsw-alias-markdown-code-block-banner 代码块上方那条（"代码块"标题栏 + 复制按钮）
       --dsw-alias-markdown-inline-code       行内 code
       --dsw-alias-markdown-tag               标签
       --dsw-alias-bg-l1 / bg-l2              另一套背景别名（与 bg-layer-* 并行） */
  --dsw-alias-markdown-code-block: transparent !important;
  --dsw-alias-markdown-code-block-banner: transparent !important;
  --dsw-alias-markdown-inline-code: transparent !important;
  --dsw-alias-markdown-tag: transparent !important;
  --dsw-alias-bg-l1: transparent !important;
  --dsw-alias-bg-l2: transparent !important;
  /* 代码块的底还可能是这两个 --dsl-* 变量（规则里优先级高于 --dsw-alias-*） */
  --dsl-code-block-background: transparent !important;
  --dsl-code-block-banner-background-color: transparent !important;
  --dsw-specific-selector: transparent !important;
  --dsw-specific-bubble: transparent !important;
  --dsw-specific-bubble-highlight: transparent !important;
  --dsw-specific-login-input: transparent !important;
  --dsw-specific-docpreview: transparent !important;
  --dsw-specific-session-header: transparent !important;
  --dsw-specific-files-body: transparent !important;
  --dsw-specific-dock-bar: transparent !important;
  /* ★ 第十五次修：layer/elevated/overlay 系（顶栏浮层与气泡卡底）全部透传。
     这些是"浮在上面的小卡片"用的 —— 全透明后层次感靠描边+文字对比维持。 */
  --dsw-alias-bg-overlay: transparent !important;
  --dsw-alias-bg-multi-select: transparent !important;
  --dsw-alias-bg-skeleton: transparent !important;
  --dsw-alias-bg-document-preview: transparent !important;
  --dsw-alias-bg-document-selection: transparent !important;
  /* ★★★ 2026-10-03 第十七次修（终极真凶）★★★
     DSH 用 Electron 原生 vibrancy（系统毛玻璃），CSS 改不掉材质本身；
     但材质之上的「前景 tint」是这个变量：
       body[data-ds-dark-theme] { --dsw-desktop-window-tint: color-mix(24 25 28 50%) }
     深灰 50% 铺满窗口 ⇒ 顶/底毛玻璃区显出灰条。
     把它透传 ⇒ 毛玻璃区只剩系统 blur（几乎无着色），视觉上跟中间一致。 */
  --dsw-desktop-window-tint: transparent !important;
  /* 它的别名（titlebar 用的是这个） */
  --welcome-tint: transparent !important;
}
/* titlebar 及 welcome 元素：直接压掉 tint 背景 */
body.dsh-dynbg-on .titlebar,
body.dsh-dynbg-on [class*="titlebar"],
body.dsh-dynbg-on [class*="Titlebar"],
body.dsh-dynbg-on [class*="titleBar"] {
  background: transparent !important;
  background-color: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* 顶部条 / logo 行：保险压掉（它本身没 background，但防父级透出的） */
body.dsh-dynbg-on [class*="_topStrip"],
body.dsh-dynbg-on [class*="_topStrip"]::before,
body.dsh-dynbg-on [class*="_topStrip"]::after,
body.dsh-dynbg-on [class*="_logoRow"] {
  background: transparent !important;
  background-color: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* ★★★ 2026-10-03 第二十一次修（精确覆盖 sidebarCol 渐变）★★★
   DSH 的 darwin 深色主题规则（特异性 (0,2,0)）：
     [data-platform=darwin] [data-ds-dark-theme] ._6Qf49G_sidebarCol {
       background: linear-gradient(to bottom, #7a9bf014, #7a9bf000 35%, #8f89b800 68%, #8f89b812),
                   color-mix(in srgb, var(--dsw-specific-sidebar-fill) 50%, transparent);
     }
   顶部 #7a9bf014（蓝 8%）+ 底部 #8f89b812（蓝紫 7%）+ 中间透明 = 顶/底灰条的真相。
   用【完全同构的选择器 + 更高特异性 + !important】精确压掉，background 直接设 none。 */
[data-platform=darwin] [data-ds-dark-theme] body.dsh-dynbg-on [class*="_sidebarCol"],
[data-platform=darwin] body.dsh-dynbg-on [class*="_sidebarCol"],
html[data-platform=darwin] body.dsh-dynbg-on [class*="_sidebarCol"] {
  background: none !important;
  background-image: none !important;
  background-color: transparent !important;
}
}

/* ★★★ 2026-10-03 第十二次修：底部输入框整块不透明 ★★★
   从 DSH CSS 挖到的真凶：
     .ST7X_W_composerSeat { background: linear-gradient(180deg,
        color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0px,
        var(--dsw-alias-bg-base) 36px); }        ← 底座渐变遮罩
   还有输入框卡片自己的 bg-layer 系背景。全部压掉。 */
body.dsh-dynbg-on [class*="_composerSeat"],
body.dsh-dynbg-on [class*="_composerSeat"]::before,
body.dsh-dynbg-on [class*="_composerSeat"]::after {
  background: transparent !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
/* 输入框容器/卡片（R7PCuq_frame / gOeFyG_root 等）：只留描边，底色透传 */
body.dsh-dynbg-on [class*="_composer"],
body.dsh-dynbg-on [class*="_composer"] > div,
body.dsh-dynbg-on [class*="_composer"] [class*="_card"],
body.dsh-dynbg-on [class*="_composer"] [class*="_frame"] {
  background-color: transparent !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
/* ★★★ 2026-10-04 第二十二次修（用户选⑥：打字时才加实）★★★
   空态保持全透明（看壁纸）；**聚焦打字时**才升到低透明度 + 强模糊。
   触发用 :focus-within —— composer 里是 contenteditable，聚焦时父级能感知。
   ⚠️ 口径照历史教训：「毛玻璃 = 低透明度 + 强模糊」，
      提高不透明度会变成一块纯色板，模糊等于白做。 */
body.dsh-dynbg-on [class*="_composer"]:focus-within {
  --dsw-specific-input-major: var(--dsh-dynbg-cptint, rgba(6, 18, 12, 0.38)) !important;
}
body.dsh-dynbg-on [class*="_composer"]:focus-within [class*="_card"],
body.dsh-dynbg-on [class*="_composer"]:focus-within [class*="_frame"] {
  background-color: var(--dsh-dynbg-cptint, rgba(6, 18, 12, 0.38)) !important;
  backdrop-filter: blur(var(--dsh-dynbg-cpblur, 6px)) saturate(1.25) !important;
  -webkit-backdrop-filter: blur(var(--dsh-dynbg-cpblur, 6px)) saturate(1.25) !important;
}

/* 顶部标题栏（topStrip 已压，但 header 本体可能还有一层） */
body.dsh-dynbg-on [class*="_header"]:not(button):not([class*="_composer"]),
body.dsh-dynbg-on header {
  background: transparent !important;
  background-color: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* ★★★ 2026-10-03 第十三次修：窗口级毛玻璃层（顶/底暗条的总后台）★★★
   DSH 里有三种 .mask 类（Dws9Sa_mask / jbq9pW_mask / _mask_o6lrb_18），
   全都是 position:absolute + inset:var(--dsh-frame-chrome-top) + bg-mask + backdrop-blur。
   它们盖在窗口上形成顶/底的"镀铬"暗条。全部禁用。 */
body.dsh-dynbg-on [class$="_mask"],
body.dsh-dynbg-on [class*=" mask"],
body.dsh-dynbg-on [class*="_mask_"] {
  background: transparent !important;
  background-color: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
/* DSH 把 frame-chrome-top 变量用来定位这些层 —— 把它归零，让它们不再覆盖顶/底 */
body.dsh-dynbg-on {
  --dsh-frame-chrome-top: 0px !important;
  --dsh-frame-overlay-top: 0px !important;
}
/* 兜底：window drag 区域（交通灯那条）也透明 */
body.dsh-dynbg-on [data-window-drag] {
  background: transparent !important;
  background-color: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* ══════════════════════════════════════════════════════════════
   文字增强 / 黑客风格（2026-10-03 用户：正文在壁纸上看不清）
   切换开关 = body[data-dsh-text]；--dsh-hk 存 RGB 三元组（霓虹主色）
   预设：off | readable | glass | hacker-cyan | hacker-green | hacker-amber
   ⚠️ 一律用 #root 作用域 —— 我自己的壁纸层/面板挂在 body 上，#root 里没有，
      所以背景和设置面板不受影响。
   ══════════════════════════════════════════════════════════════ */

/* ① readable：只提升可读性，不改配色 —— 暗描边让文字从壁纸里"浮"出来 */
body.dsh-dynbg-on[data-dsh-text="readable"] #root * {
  text-shadow: 0 0 2px rgba(0,0,0,.95), 0 0 6px rgba(0,0,0,.66), 0 1px 1px rgba(0,0,0,.9) !important;
}

/* ② glass：文字区加暗色毛玻璃底衬（读得清，保留原配色） */
body.dsh-dynbg-on[data-dsh-text="glass"] #root * {
  text-shadow: 0 0 3px rgba(0,0,0,.92), 0 1px 2px rgba(0,0,0,.8) !important;
}
body.dsh-dynbg-on[data-dsh-text="glass"] #root [class*="_composer"],
body.dsh-dynbg-on[data-dsh-text="glass"] #root [class*="_panelList"],
body.dsh-dynbg-on[data-dsh-text="glass"] #root [class*="_centerCol"],
body.dsh-dynbg-on[data-dsh-text="glass"] #root [class*="_rightbarCol"] {
  background-color: rgba(4, 9, 18, .58) !important;
  backdrop-filter: blur(12px) saturate(130%) !important;
  -webkit-backdrop-filter: blur(12px) saturate(130%) !important;
}

/* ③④⑤ 黑客风：等宽字体 + 霓虹色 + 辉光 */
body.dsh-dynbg-on[data-dsh-text="hacker-cyan"]    { --dsh-hk: 122, 226, 255; }
body.dsh-dynbg-on[data-dsh-text="hacker-green"]   { --dsh-hk: 62, 255, 128; }
body.dsh-dynbg-on[data-dsh-text="hacker-amber"]   { --dsh-hk: 255, 186, 70; }
body.dsh-dynbg-on[data-dsh-text="hacker-magenta"] { --dsh-hk: 255, 118, 226; }
body.dsh-dynbg-on[data-dsh-text="hacker-white"]   { --dsh-hk: 248, 252, 255; }

body.dsh-dynbg-on[data-dsh-text^="hacker"] #root * {
  font-family: ui-monospace, "SF Mono", Menlo, Monaco, "JetBrains Mono", "Courier New", monospace !important;
  /* 2026-10-03 用户：不要光晕 —— 全部 text-shadow 去掉，纯平字 */
  text-shadow: none !important;
  font-weight: 500 !important;
}
/* 霓虹文字色：只染文本语义元素；弱化层次靠透明度，别一片死亮 */
body.dsh-dynbg-on[data-dsh-text^="hacker"] #root :is(p, span, div, li, a, label, h1, h2, h3, h4, h5, h6, td, th, summary, small, strong, em, code, pre, input, textarea) {
  color: rgb(var(--dsh-hk)) !important;
}
body.dsh-dynbg-on[data-dsh-text^="hacker"] #root :is(small, [class*="caption" i], [class*="secondary" i], [class*="muted" i], [class*="hint" i], [class*="placeholder" i]) {
  opacity: .78;
}
/* 按钮保留一点区分度（比正文稍暗），不然满屏一样亮 */
body.dsh-dynbg-on[data-dsh-text^="hacker"] #root button {
  color: rgb(var(--dsh-hk)) !important;
  border-color: rgba(var(--dsh-hk), .45) !important;
}
`;
      document.head.appendChild(el);
    }

    // ────────── 媒体层 ──────────
    let currentKey = "";

    function showError(msg) {
      const box = document.createElement("div");
      box.id = "dsh-dynbg-err";
      box.textContent = "背景加载失败：" + msg;
      box.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147482001;" +
        "max-width:60vw;padding:9px 13px;border-radius:9px;font-size:12.5px;line-height:1.5;" +
        "background:rgba(200,40,40,.94);color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.3);";
      const old = document.getElementById("dsh-dynbg-err");
      if (old !== null) old.remove();
      document.body.appendChild(box);
      setTimeout(() => { try { box.remove(); } catch {} }, 12000);
    }
    function clearError() {
      const old = document.getElementById("dsh-dynbg-err");
      if (old !== null) old.remove();
    }

    /** 自检上报：把「视频源尺寸 / 元素盒尺寸 / 视口 / object-fit / 实测是否留边」回报给宿主。
     *  用途：截图权限不可用时，靠数据确认壁纸是否铺满（有没有 letterbox 黑边）。 */
    let diagTimer = null;
    function reportDiag(cfg, videoEl) {
      try {
        if (diagTimer !== null) { clearInterval(diagTimer); diagTimer = null; }
        const send = () => {
          try {
            const v = videoEl;
            const vw = v.videoWidth || 0, vh = v.videoHeight || 0;
            const cw = v.clientWidth || 0, ch = v.clientHeight || 0;
            const fit = getComputedStyle(v).objectFit || "?";
            const iw = window.innerWidth, ih = window.innerHeight;
            // 按 object-fit 算"实际画出来的尺寸"，再算上下留边
            let dw = cw, dh = ch;
            if (vw > 0 && vh > 0 && cw > 0 && ch > 0) {
              const sCover = Math.max(cw / vw, ch / vh);
              const sContain = Math.min(cw / vw, ch / vh);
              const sc = fit === "contain" ? sContain : sCover;
              dw = Math.round(vw * sc); dh = Math.round(vh * sc);
            }
            const barTopBottom = Math.max(0, Math.round((ch - dh) / 2));
            const barLeftRight = Math.max(0, Math.round((cw - dw) / 2));
            // 顺带把「二级界面」那几个变量的运行时真实值报出来（验证设置面板是否真有底+模糊）
            let maskInfo = {};
            try {
              const bcs = getComputedStyle(document.body);
              maskInfo = {
                mask1: bcs.getPropertyValue("--dsw-alias-bg-mask-1").trim(),
                maskBlur: bcs.getPropertyValue("--dsw-mask-blur").trim(),
                menu: bcs.getPropertyValue("--dsw-specific-menu").trim(),
                menuBlur: bcs.getPropertyValue("--dsw-menu-backdrop-filter").trim(),
                textStyle: bcs.getPropertyValue("--dsh-hk").trim() ? "hacker" : "?"
              };
            } catch (e) {}
            // 设置面板实况（用户打开设置时才采到）
            let panelInfo = "";
            try {
              // 按【样式】扫，不猜类名：凡面积够大、且有底或有模糊的元素一律上报
              const parts = [];
              const all = [];
              (function walk(el, d) { if (d > 8 || all.length > 2000) return; for (const c of el.children) { all.push(c); walk(c, d + 1); } })(document.body, 0);
              let scanned = 0;
              for (const el of all) {
                if (++scanned > 2000 || parts.length >= 14) break;
                const cs = getComputedStyle(el);
                if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
                const bf = cs.backdropFilter || cs.webkitBackdropFilter || "none";
                const bg = cs.backgroundColor;
                const opaque = bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
                const _z = parseInt(cs.zIndex) || 0;
                const _float = (cs.position === "fixed" || cs.position === "absolute") && _z >= 20;
                if (bf === "none" && !opaque && !_float) continue;
                const rr = el.getBoundingClientRect();
                if (rr.width < 190 || rr.height < 80) continue;
                const tag = (el.className && typeof el.className === "string" && el.className) ? el.className.slice(0, 26) : ("#" + (el.id || el.tagName));
                parts.push(tag + "{" + Math.round(rr.width) + "x" + Math.round(rr.height) + ";z=" + cs.zIndex + ";pos=" + cs.position + ";bg=" + bg + ";bf=" + bf + "}");
              }
              // 只读探针：主界面各块到底在不在 #root 里（决定方案 B 安不安全）
              let rootInfo = "";
              try {
                const r = document.getElementById("root");
                const chk = (frag) => {
                  const el = document.querySelector('[class*="' + frag + '"]');
                  if (el === null) return frag + ":无";
                  return frag + ":" + (r !== null && r.contains(el) ? "在" : "不在");
                };
                rootInfo = "root=" + (r !== null ? "1" : "0")
                  + " " + chk("_sidebarCol") + " " + chk("_topStrip")
                  + " " + chk("_composer") + " " + chk("_newSession")
                  + " " + chk("_newSessionSidebar") + " || ";
              } catch (e) {}
              panelInfo = (rootInfo + (parts.join(" ~ ").slice(0, 1600) || "none"));
            } catch (e) {}
            const q = new URLSearchParams(Object.assign({ panel: panelInfo || "none" ,
              fit, vw: String(vw), vh: String(vh), cw: String(cw), ch: String(ch),
              iw: String(iw), ih: String(ih), drawn: dw + "x" + dh,
              barTopBottom: String(barTopBottom), barLeftRight: String(barLeftRight),
              path: String(cfg.path).split("/").pop()
            }, maskInfo));
            fetch(ROUTE_DIAG + "?" + q.toString()).catch(() => {});
          } catch (e) {}
        };
        send();
        diagTimer = setInterval(send, 4000);
      } catch (e) {}
    }

    function renderLayer(cfg) {
      if (!cfg.enabled || cfg.path === "") {
        const old = document.getElementById(LAYER_ID);
        if (old !== null) old.remove();
        document.body.classList.remove("dsh-dynbg-on", "dsh-dynbg-dim");
        currentKey = "";
        return;
      }

      const kind = cfg.kind !== "" ? cfg.kind : kindOf(cfg.path);
      const key = cfg.path + "|" + kind;
      document.body.classList.add("dsh-dynbg-on");
      document.body.classList.toggle("dsh-dynbg-dim", cfg.dim === true);
      // 文字增强 / 黑客风格：合法值才写，未知值退回 readable
      const TS = ["off", "readable", "glass", "hacker-green", "hacker-amber", "hacker-magenta", "hacker-white", "hacker-cyan"];
      document.body.setAttribute("data-dsh-text", TS.indexOf(cfg.textStyle) !== -1 ? cfg.textStyle : "readable");

      const root = document.documentElement;
      root.style.setProperty("--dsh-dynbg-veil", String((Number(cfg.veil) || 0) / 100));
      root.style.setProperty("--dsh-dynbg-blur", (Number(cfg.blur) || 0) + "px");
      root.style.setProperty("--dsh-dynbg-opacity", String((cfg.opacity === undefined ? 100 : Number(cfg.opacity)) / 100));
      root.style.setProperty("--dsh-dynbg-fit", cfg.fit === "contain" ? "contain" : "cover");
      root.style.setProperty("--dsh-dynbg-scale", (Number(cfg.blur) || 0) > 0 ? "1.06" : "1");
      root.style.setProperty("--dsh-dynbg-cpblur", (cfg.composerBlur === undefined ? 6 : Number(cfg.composerBlur)) + "px");
      root.style.setProperty("--dsh-dynbg-cptint", "rgba(6, 18, 12, " + ((cfg.composerTint === undefined ? 38 : Number(cfg.composerTint)) / 100) + ")");

      if (key === currentKey && document.getElementById(LAYER_ID) !== null) return;
      const old = document.getElementById(LAYER_ID);
      if (old !== null) old.remove();

      const layer = document.createElement("div");
      layer.id = LAYER_ID;

      if (kind === "video") {
        const v = document.createElement("video");
        v.muted = cfg.muted !== false;
        v.loop = cfg.loop !== false;
        v.autoplay = true;
        v.playsInline = true;
        v.setAttribute("playsinline", "");
        v.setAttribute("muted", "");
        v.preload = "auto";
        v.playbackRate = (Number(cfg.playbackRate) || 100) / 100;
        v.style.width = "100%";
        v.style.height = "100%";
        v.style.objectFit = "var(--dsh-dynbg-fit, cover)";
        v.addEventListener("error", () => {
          const e = v.error;
          const code = e === null || e === undefined ? "?" : e.code;
          const why = code === 1 ? "加载被中止" : code === 2 ? "网络错误" : code === 3 ? "解码失败" : code === 4 ? "格式不支持或文件读不到" : "未知";
          showError(why + "（code " + code + "）— " + cfg.path);
        });
        v.addEventListener("loadeddata", () => { clearError(); reportDiag(cfg, v); });
        layer.appendChild(v);
        v.src = mediaUrl(cfg.path);
        const pr = v.play();
        if (pr !== undefined && typeof pr.catch === "function") {
          pr.catch((err) => showError("自动播放被拒：" + (err && err.name ? err.name : "?")));
        }
      } else if (kind === "image") {
        const img = document.createElement("img");
        img.alt = "";
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "var(--dsh-dynbg-fit, cover)";
        img.addEventListener("error", () => showError("图片读不到或格式不支持 — " + cfg.path));
        img.addEventListener("load", clearError);
        layer.appendChild(img);
        img.src = mediaUrl(cfg.path);
      } else {
        showError("认不出这个扩展名");
      }

      document.body.appendChild(layer);
      currentKey = key;
    }

    // ────────── 氛围文字层 ──────────
    /** 诗句库（2026-10-03 从 chinese-poetry 数据集提取）
     *   李白：969 句（全量）
     *   全部唐诗：3000 句（精选）*/
    const POEMS_LIBAI = ["三十六離宮，樓臺與天通。", "閣道步行月，美人愁煙空。", "恩疎寵不及，桃李傷春風。", "淫樂意何極，金輿向回中。", "萬乘出黃道，千旗揚彩虹。", "前軍細柳北，後騎甘泉東。", "豈問渭川老，寧邀襄野童。", "秋暮瑤池宴，歸來樂未窮。", "去年戰桑乾源，今年戰蔥河道。", "洗兵條支海上波，放馬天山雪中草。", "萬里長征戰，三軍盡衰老。", "匈奴以殺戮爲耕作，古來唯見白骨黃沙田。", "秦家築城備胡處，漢家還有烽火然。", "烽火然不息，征戰無已時。", "野戰格鬬死，敗馬號鳴向天悲。", "烏鳶啄人腸，銜飛上挂枯樹枝。", "士卒塗草莽，將軍空爾爲。", "乃知兵者是凶器，聖人不得已而用之。", "君不見黃河之水天上來，奔流到海不復回。", "君不見高堂明鏡悲白髮，朝如青絲暮成雪。", "人生得意須盡歡，莫使金尊空對月。", "天生我材必有用，千金散盡還復來。", "烹羊宰牛且爲樂，會須一飲三百杯。", "岑夫子，丹丘生，將進酒，杯莫停。", "與君歌一曲，請君爲我側耳聽。", "鐘鼓饌玉不足貴，但願長醉不復醒。", "古來聖賢皆寂寞，惟有飲者留其名。", "陳王昔時宴平樂，斗酒十千恣歡謔。", "主人何爲言少錢，徑須酤取對君酌。", "君馬黃，我馬白。", "馬色雖不同，人心本無隔。", "共作遊冶盤，雙行洛陽陌。", "長劒既照曜，高冠何赩赫。", "各有千金裘，俱爲五侯客。", "猛虎落陷穽，壯夫時屈厄。", "相知在急難，獨好亦何益。", "我思仙人，乃在碧海之東隅。", "海寒多天風，白波連山倒蓬壺。", "長鯨噴湧不可涉，撫心茫茫淚如珠。", "西來青鳥東飛去，願寄一書謝麻姑。", "辟邪伎作鼓吹驚，雉子班之奏曲成。", "喔咿振迅欲飛鳴，扇錦翼，雄風生。", "雙雌同飲啄，趫悍誰能爭。", "乍向草中耿介死，不求黃金籠下生。", "天地至廣大，何惜遂物情。", "善卷讓天子，務光亦逃名。", "所貴曠士懷，朗然合太清。", "垂楊拂綠水，搖豔東風年。", "花明玉關雪，葉暖金窗煙。", "美人結長恨，相對心悽然。", "攀條折春色，遠寄龍庭前。", "明月出天山，蒼茫雲海間。", "長風幾萬里，吹度玉門關。", "漢下白登道，胡窺青海灣。", "由來征戰地，不見有人還。", "戍客望邊色，思歸多苦顏。", "高樓當此夜，歎息未應閑。", "白玉誰家郎，回車渡天津。", "看花東上陌，驚動洛陽人。", "紫騮行且嘶，雙飜碧玉蹄。", "臨流不肎渡，似惜錦障泥。", "白雪關山遠，黃雲海樹迷。", "揮鞭萬里去，安得念春閨。", "幽州胡馬客，綠眼虎皮冠。", "笑拂兩隻箭，萬人不可干。", "彎弓若轉月，白雁落雲端。", "雙雙掉鞭行，遊獵向樓蘭。", "出門不顧後，報國死何難。", "天驕五單于，狼戾好凶殘。", "牛馬散北海，割鮮若虎餐。", "雖居燕支山，不道朔雪寒。", "婦女馬上笑，顏如赬玉盤。", "飜入射鳥獸，花月醉雕鞍。", "旄頭四光芒，爭戰若蜂攢。", "白刃灑赤血，流沙爲之丹。", "名將古誰是，疲兵良可歎。", "何時天狼滅？父子得閑安。", "銀鞍白鼻騧，綠地障泥錦。", "細雨春風花落時，揮鞭且就胡姬飲。", "黃河西來決崐崘，咆吼萬里觸龍門。", "波滔天，堯咨嗟。", "大禹理百川，兒啼不窺家。", "殺湍湮洪水，九州始蠶麻。", "其害乃去，茫然風沙。", "被髮之叟狂而癡，清晨徑流欲奚爲。", "旁人不惜妻止之，公無渡河苦渡之。", "虎可搏，河難憑。", "公果溺死流海湄，有長鯨白齒若雪山。", "公乎公乎，挂骨於其間，箜篌所悲竟不還。", "登高丘而望遠海，六鼇骨已霜，三山流安在。", "扶桑半摧折，白日沈光彩。", "銀臺金闕如夢中，秦皇漢武空相待。", "精衛費木石，黿鼉無所憑。", "君不見驪山茂陵盡灰滅，牧羊之子來攀登。", "盜賊劫寶玉，精靈竟何能。", "松子棲金華，安期入蓬海。", "此人古之仙，羽化竟何在？", "浮生速流電，倏忽變光彩。", "天地無凋換，容顏有遷改。", "對酒不肯飲，含情欲誰待。", "勸君莫拒杯，春風笑人來。", "桃李如舊識，傾花向我開。", "流鶯啼碧樹，明月窺金罍。", "昨來朱顏子，今日白髮催。", "棘生石虎殿，鹿走姑蘇臺。", "自古帝王宅，城闕閉黃埃。", "君若不飲酒，昔人安在哉。", "美女渭橋東，春還事蠶作。", "五馬如飛龍，青絲結金絡。", "不知誰家子，調笑來相謔。", "妾本秦羅敷，玉顏豔名都。", "綠條映素手，采桑向城隅。", "使君且不顧，況復論秋胡。", "寒螿愛碧草，鳴鳳棲青梧。", "託心自有處，但怪傍人愚。", "徒令白日暮，高駕空踟躕。", "日出東方隈，似從地底來。", "歷天又入海，六龍所舍安在哉？", "其始與終古不息，人非元氣安能與之久裴回。", "草不謝榮於春風，木不怨落於秋天。", "誰揮鞭策驅四運，萬物興歇皆自然。", "羲和羲和，汝奚汩沒於荒淫之波。", "魯陽何德？駐景揮戈。", "逆道違天，矯誣實多。", "吾將囊括大塊，浩然與溟涬同科。", "漢家秦地月，流影照明妃。", "一上玉關道，天涯去不歸。", "漢月還從東海出，明妃西嫁無來日。", "燕支長寒雪作花，蛾眉顦顇沒胡沙。", "生乏黃金枉圖畫，死留青冢使人嗟。", "昭君拂玉鞍，上馬啼紅頰。", "今日漢宮人，明朝胡地妾。", "桃李得日開，榮華照當年。", "東風動百物，草木盡欲言。", "枯枝無醜葉，涸水吐清泉。", "大力運天地，羲和無停鞭。", "功名不早著，竹帛將何宣？", "桃李務青春，誰能貫白日。", "富貴與神仙，蹉跎成兩失。", "金石猶銷鑠，風霜無久質。", "畏落日月後，強歡歌與酒。", "秋霜不惜人，倏忽侵蒲柳。", "白日何短短，百年苦易滿。", "蒼穹浩茫茫，萬劫太極長。", "麻姑垂兩鬢，一半已成霜。", "天公見玉女，大笑億千場。", "吾欲攪六龍，回車挂扶桑。", "北斗酌美酒，勸龍各一觴。", "富貴非所願，爲人駐頹光。", "朝作猛虎行，暮作猛虎吟。", "腸斷非關隴頭水，淚下不爲雍門琴。", "旌旗繽紛兩河道，戰鼓驚山欲傾倒。", "秦人半作燕地囚，胡馬飜銜洛陽草。", "一輸一失關下兵，朝降夕叛幽薊城。", "巨鼇未斬海水動，魚龍奔走安得寧。", "頗似楚漢時，飜覆無定止。", "朝過博浪沙，暮入淮陰市。", "張良未遇韓信貧，劉項存亡在兩臣。", "暫到下邳受兵略，來投漂母作主人。", "賢哲栖栖古如此，今時亦棄青雲士。", "有策不敢犯龍鱗，竄身南國避胡塵。", "寶書長劒挂高閣，金鞍駿馬散故人。", "昨日方爲宣城客，掣鈴交通二千石。", "有時六博快壯心，繞牀三帀呼一擲。", "楚人每道張旭奇，心藏風雲世莫知。", "三吳邦伯多顧盼，四海雄俠皆相推。", "蕭曹曾作沛中吏，攀龍附鳳當有時。", "溧陽酒樓三月春，楊花漠漠愁殺人。", "胡人綠眼吹玉笛，吳歌白紵飛梁塵。", "丈夫相見且爲樂，槌牛撾鼓會衆賓。", "我從此去釣東海，得魚笑寄情相親。", "從軍玉門道，逐虜金微山。", "笛奏梅花曲，刀開明月環。", "鼓聲鳴海上，兵氣擁雲間。", "願斬單于首，長驅靜鐵關。", "百戰沙場碎鐵衣，城南已合數重圍。", "突營射殺呼延將，獨領殘兵千騎歸。", "玉不自言如桃李，魚目笑之卞和恥。", "楚國青蠅何太多？連城白璧遭讒毀。", "荆山長號泣血人，忠臣死爲刖足鬼。", "聽曲知甯戚，[夷]吾因小妻。", "秦穆五羊皮，買死百里奚。", "洗拂青雲上，當時賤如泥。", "朝歌鼓刀叟，虎變蟠溪中。", "一舉釣六合，逐荒營丘東。", "平生渭水曲，誰識此老翁。", "奈何今之人，雙目送征鴻。", "北上何所苦，北上緣太行。", "磴道盤且峻，巉巖凌穹蒼。", "馬足蹶側石，車輪摧高岡。", "沙塵接幽州，烽火連朔方。", "殺氣毒劒戟，嚴風裂衣裳。", "奔鯨夾黃河，鑿齒屯洛陽。", "前行無歸日，返顧思舊鄉。", "慘戚冰雪裏，悲號絕中腸。", "尺布不掩體，皮膚劇枯桑。", "汲水澗谷阻，采薪隴坂長。", "猛虎又掉尾，磨牙皓秋霜。", "草木不可湌，飢飲零露漿。", "歎此北上苦，停驂爲之傷。", "何日王道平？開顏覩天光。", "胡風吹代馬，北擁魯陽關。", "吳兵照海雪，西討何時還？", "半渡上遼津，黃雲慘無顏。", "老母與子別，呼天野草間。", "白馬繞旌旗，悲鳴相追攀。", "白楊秋月苦，早落豫章山。", "本爲休明人，斬虜素不閑。", "豈惜戰鬬死，爲君埽兇頑。", "精感石沒羽，豈忘憚險艱。", "樓船若鯨飛，波蕩落星灣。", "此曲不可奏，三軍鬢成斑。", "朝騎五花馬，謁帝出銀臺。", "秀色誰家子，雲車珠箔開。", "金鞭遙指點，玉勒近遲回。", "夾轂相借問，疑從天上來。", "憐腸愁欲斷，斜日復相催。", "下車何輕盈，飄然似落梅。", "邀入青綺門，當歌共銜杯。", "銜杯映歌扇，似月雲中見。", "相見不相親，不如不相見。", "相見情已深，未語可知心。", "胡爲守空閨，孤眠愁錦衾。", "錦衾與羅幃，纏緜會有時。", "春風正澹蕩，暮雨來何遲？", "願因三青鳥，更報長相思。", "光景不待人，須臾髮成絲。", "當年失行樂，老去徒傷悲。", "持此道密意，無令曠佳期。", "相逢紅塵內，高揖黃金鞭。", "萬戶垂楊裏，君家阿那邊。", "來日一身，攜糧負薪。", "道長食盡，苦口焦脣。", "今日醉飽，樂過千春。", "仙人相存，誘我遠學。", "海陵三山，陸憩五嶽。", "乘龍上三天，飛目瞻兩角。", "授以神藥，金丹滿握。", "蟪蛄蒙恩，深媿短促。", "思填東海，彊銜一木。", "道重天地，軒師廣成。", "蟬翼九五，以求長生。", "下士大笑，如蒼蠅聲。", "行至上留田，孤墳何崢嶸。", "積此萬古恨，春草不復生。", "悲風四邊來，腸斷白楊聲。", "借問誰家地，埋沒蒿里塋。", "古老向余言，言是上留田。", "蓬科馬鬣今已平，昔之弟死兄不葬。", "桓山之禽別離苦，欲去迴翔不能征。", "田氏倉卒骨肉分，青天白日摧紫荆。", "交柯之木本同形，東枝顦顇西枝榮。", "無心之物尚如此，參商胡乃尋天兵。", "孤竹延陵，讓國揚名。", "高風緬邈，頹波激清。", "尺布之謠，塞耳不能聽。", "遊莫逐炎洲翠，棲莫近吳宮燕。", "吳宮火起焚爾窠，炎洲逐翠遭網羅。", "門有車馬客，金鞍曜朱輪。", "謂從丹霄落，乃是故鄉親。", "呼兒埽中堂，坐客論悲辛。", "對酒兩不飲，停觴淚盈巾。", "歎我萬里遊，飄颻三十春。", "空談霸王略，紫綬不挂身。", "雄劒藏玉匣，陰符生素塵。", "廓落無所合，流離湘水濱。", "借問宗黨間，多爲泉下人。", "生苦百戰役，死託萬鬼鄰。", "北風揚胡沙，埋翳周與秦。", "大運且如此，蒼穹寧匪仁。", "惻愴竟何道？存亡任大鈞。", "爾來四萬八千歲，乃與秦塞通人煙。", "西當太白有鳥道，可以橫絕峨眉巔。", "地崩山摧壯士死，然後天梯石棧方鉤連。", "上有六龍迴日之高標，下有衝波逆折之迴川。", "黃鶴之飛尚不得，猨猱欲度愁攀緣。", "青泥何盤盤，百步九折縈巖巒。", "捫參歷井仰脅息，以手撫膺坐長歎。", "問君西遊何時還？畏途巉巖不可攀。", "但見悲鳥號枯木，雄飛呼雌繞林間。", "連峰去天不盈尺，枯松倒挂倚絕壁。", "飛湍瀑流相喧豗，砅崖轉石萬壑雷。", "其嶮也若此，嗟爾遠道之人胡爲乎來哉？", "劒閣崢嶸而崔嵬，一夫當關，萬夫莫開。", "所守或匪親，化爲狼與豺。", "朝避猛虎，夕避長蛇。", "磨牙吮血，殺人如麻。", "錦城雖云樂，不如早還家。", "蜀道之難難於上青天，側身西望長咨嗟。", "嚴風吹霜海草彫，筋幹精堅胡馬驕。", "漢家戰士三十萬，將軍兼領霍嫖姚。", "流星白羽腰間插，劒花秋蓮光出匣。", "天兵照雪下玉關，虜箭如沙射金甲。", "雲龍風虎盡交迴，太白入月敵可摧。", "敵可摧，旄頭滅，履胡之腸涉胡血。", "懸胡青天上，埋胡紫[塞]旁。", "胡無人，漢道昌，陛下之壽三千霜。", "但歌大風雲飛揚，安得猛士兮守四方。", "胡無人，漢道昌。", "錦水東北流，波蕩雙鴛鴦。", "雄巢漢宮樹，雌弄秦草芳。", "寧同萬死碎綺翼，不忍雲間兩分張。", "此時阿嬌正嬌妬，獨坐長門愁日暮。", "但願君恩顧妾深，豈惜黃金將買賦。", "相如作賦得黃金，丈夫好新多異心。", "一朝將聘茂陵女，文君因贈白頭吟。", "東流不作西歸水，落花辭條歸故林。", "兔絲固無情，隨風任顛倒。", "誰使女蘿枝，而來彊縈抱。", "兩草猶一心，人心不如草。", "莫卷龍須席，從他生網絲。", "且留琥珀枕，或有夢來時。", "覆水再收豈滿杯，棄妾已去難重回。", "古時得意不相負，祗今惟見青陵臺。", "錦水東流碧，波蕩雙鴛鴦。", "相如去蜀謁武帝，赤車駟馬生輝光。", "一朝再覽大人作，萬乘忽欲凌雲翔。", "聞道阿嬌失恩寵，千金買賦要君王。", "相如不憶貧賤日，官高金多聘私室。", "茂陵姝子皆見求，文君歡愛徒此畢。", "淚如雙泉水，行墮紫羅襟。", "五起雞三唱，清晨白頭吟。", "長吁不整綠雲鬢，仰訴青天哀怨深。", "城崩杞梁妻，誰道土無心。", "東流不作西歸水，落花辭枝羞故林。", "頭上玉燕釵，是妾嫁時物。", "贈君表相思，羅袖幸時拂。", "且留琥珀枕，還有夢來時。", "鷫鸘裘在錦屏上，自君一挂無由披。", "妾有秦樓鏡，照心勝照井。", "願持照新人，雙對可憐影。", "覆水却收不滿杯，相如還謝文君回。", "古來得意不相負，祗今惟有青陵臺。", "長嘯梁甫吟，何時見陽春？", "君不見朝歌屠叟辭棘津，八十西來釣渭濱。", "寧羞白髮照淥水，逢時吐氣思經綸。", "廣張三千六百鈞，風雅暗與文王親。", "大賢虎變愚不測，當年頗似尋常人。", "君不見高陽酒徒起草中，長揖山東隆準公。", "入門不拜騁雄辨，兩女輟洗來趨風。", "東下齊城七十二，指麾楚漢如旋蓬。", "狂生落拓尚如此，何況壯士當羣雄。", "我欲攀龍見明主，雷公砰訇震天鼓。", "帝旁投壺多玉女，三時大笑開電光。", "倏爍晦冥起風雨，閶闔九門不可通。", "以額叩關閽者怒，白日不照吾精誠。", "杞國無事憂天傾，䝟貐磨牙競人肉。", "騶虞不折生草莖，手接飛猱搏彫虎。", "側足焦原未言苦，智者可卷愚者豪。", "吳楚弄兵無劇孟，亞夫咍爾爲徒勞。", "梁父吟，梁父吟，聲正悲。", "張公兩龍劒，神物合有時。", "風雲感會起屠釣，大人𡸣屼當安之。", "好古笑流俗，素聞賢達風。", "方希佐明主，長揖辭成功。", "白日在高天，回光燭微躬。", "恭承鳳皇詔，歘起雲蘿中。", "清切紫霄迥，優游丹禁通。", "君王賜顏色，聲價凌煙虹。", "乘輿擁翠蓋，扈從金城東。", "寶馬麗絕景，錦衣入新豐。", "倚巖望松雪，對酒鳴絲桐。", "因學揚子雲，獻賦甘泉宮。", "天書美片善，清芬播無窮。", "歸來入咸陽，談笑皆王公。", "一朝去金馬，飄落成飛蓬。", "賓友日疎散，玉尊亦已空。", "才力猶可倚，不慙世上雄。", "閑作東武吟，曲盡情未終。", "書此謝知己，吾尋黃綺翁。", "十五入漢宮，花顏笑春紅。", "君王選玉色，侍寢金屏中。", "薦枕嬌夕月，卷衣戀春風。", "寧知趙飛燕，奪寵恨無窮。", "沈憂能傷人，綠鬢成霜蓬。", "一朝不得意，世事徒爲空。", "鷫鸘換美酒，舞衣罷雕籠。", "寒苦不忍言，爲君奏絲桐。", "腸斷弦亦絕，悲心夜忡忡。", "天回北斗挂西樓，金屋無人螢火流。", "月光欲到長門殿，別作深宮一段愁。", "桂殿長愁不記春，黃金四屋起秋塵。", "夜懸明鏡青天上，獨照長門宮裏人。", "月皎昭陽殿，霜清長信宮。", "天行乘玉輦，飛燕與君同。", "更有留情處，承恩樂未窮。", "誰憐團扇妾，獨坐怨秋風。", "玉階生白露，夜久侵羅襪。", "却下水精簾，玲瓏望秋月。", "秦地羅敷女，采桑綠水邊。", "素手青條上，紅妝白日鮮。", "蠶飢妾欲去，五馬莫留連。", "鏡湖三百里，菡萏發荷花。", "五月西施采，人看隘若邪。", "迴舟不待月，歸去越王家。", "長安一片月，萬戶擣衣聲。", "秋風吹不盡，總是玉關情。", "何日平胡虜？良人罷遠征。", "明朝驛使發，一夜絮征袍。", "素手抽針冷，那堪把剪刀。", "裁縫寄遠道，幾日到臨洮。", "雲陽上征去，兩岸饒商賈。", "吳牛喘月時，拖船一何苦。", "水濁不可飲，壺漿半成土。", "一唱都護歌，心摧淚如雨。", "萬人鑿盤石，無由達江滸。", "君看石芒碭，掩淚悲千古。", "黃雲城邊烏欲棲，歸飛啞啞枝上啼。", "機中織錦秦川女，碧紗如煙隔窗語。", "停梭悵然憶遠人，獨宿孤房淚如雨。", "姑蘇臺上烏棲時，吳王宮裏醉西施。", "吳歌楚舞歡未畢，青山猶銜半邊日。", "海客乘天風，將船遠行役。", "譬如雲中鳥，一去無蹤跡。", "漢水臨襄陽，花開大堤暖。", "佳期大堤下，淚向南雲滿。", "春風復無情，吹我夢魂散。", "不見眼中人，天長音信斷。", "君歌楊叛兒，妾勸新豐酒。", "何許最關人，烏啼白門柳。", "烏啼隱楊花，君醉留妾家。", "博山爐中沈香火，雙咽一氣凌紫霞。", "若耶溪邊采蓮女，笑隔荷花共人語。", "日照新妝水底明，風飄香袖空中舉。", "岸上誰家遊冶郎，三三五五映垂楊。", "紫騮嘶入落花去，見此踟躕空斷腸。", "小姑織白紵，未解將人語。", "大嫂采芙蓉，溪湖千萬重。", "長兄行不在，莫使外人逢。", "願學秋胡婦，真心比古松。", "仙人十五愛吹笙，學得崑丘彩鳳鳴。", "始聞鍊氣餐金液，復道朝天赴玉京。", "玉京迢迢幾千里，鳳笙去去無邊已。", "欲歎離聲發絳脣，更嗟別調流纖指。", "此時惜別詎堪聞，此地相看未忍分。", "重吟真曲和清吹，却奏仙歌響綠雲。", "綠雲紫氣向函關，訪道應尋緱氏山。", "莫學吹笙王子晉，一遇浮丘斷不還。", "長安白日照春空，綠楊結煙桑褭風。", "披香殿前花始紅，流芳發色繡戶中。", "繡戶中，相經過。", "飛燕皇后輕身舞，紫宮夫人絕世歌。", "金天之西，白日所沒。", "康老胡雛，生彼月窟。", "巉巖儀容，[戌]削風骨。", "碧玉炅炅雙目瞳，黃金拳拳兩鬢紅。", "華蓋垂下睫，嵩嶽臨上脣。", "不覩譎詭貌，豈知造化神。", "大道是文康之嚴父，元氣乃文康之老親。", "撫頂弄盤古，推車轉天輪。", "云見日月初生時，鑄冶火精與水銀。", "陽烏未出谷，顧兔半藏身。", "女媧戲黃土，團作愚下人。", "散在六合間，濛濛如沙塵。", "生死了不盡，誰明此胡是仙真。", "西海栽若木，東溟植扶桑。", "別來幾多時，枝葉萬里長。", "中國有七聖，半路頹鴻荒。", "陛下應運起，龍飛入咸陽。", "赤眉立盆子，白水興漢光。", "叱咤四海動，洪濤爲簸揚。", "舉足蹋紫微，天關自開張。", "老胡感至德，東來進仙倡。", "五色師子，九苞鳳凰。", "是老胡雞犬，鳴舞飛帝鄉。", "淋灕颯沓，進退成行。", "能胡歌，獻漢酒。", "跪雙膝，並兩肘。", "散花指天舉素手，拜龍顏，獻聖壽。", "北斗戾，南山摧。", "天子九九八十一[萬]歲，長傾萬歲杯。", "嘗聞秦帝女，傳得鳳凰聲。", "是日逢仙子，當時別有情。", "人吹彩簫去，天借綠雲迎。", "曲在身不返，空餘弄玉名。", "嬴女吹玉簫，吟弄天上春。", "青鸞不獨去，更有攜手人。", "影滅彩雲斷，遺聲落西秦。", "大君若天覆，廣運無不至。", "軒后爪牙常先太山稽，如心之使臂。", "小白鴻翼於夷吾，劉葛魚水本無二。", "土扶可成牆，積德爲厚地。", "梁山感杞妻，慟哭爲之傾。", "金石忽暫開，都由激深情。", "東海有勇婦，何慙蘇子卿。", "學劒越處子，超騰若流星。", "捐軀報夫讐，萬死不顧生。", "白刃耀素雪，蒼天感精誠。", "十步兩躩躍，三呼一交兵。", "斬首掉國門，蹴踏五藏行。", "割此伉儷憤，粲然大義明。", "北海李使君，飛章奏天庭。", "舍罪警風俗，流芳播滄瀛。", "志在列女籍，竹帛已光榮。", "淳于免詔獄，漢主爲緹縈。", "津妾一櫂歌，脫父於嚴刑。", "十子若不肖，不如一女英。", "豫讓斬空衣，有心竟無成。", "要離殺慶忌，壯夫素所輕。", "妻子亦何辜，焚之買虛名。", "豈如東海婦，事立獨揚名。", "鏗鳴鐘，考朗鼓。", "歌白鳩，引拂舞。", "白鳩之白誰與鄰，霜衣雪襟誠可珍。", "含哺七子能平均，食不咽，性安馴。", "首農政，鳴陽春。", "天子刻玉杖，鏤形賜耆人。", "白鷺亦白非純真，外潔其色心匪仁。", "闕五德，無司晨。", "胡爲啄我葭下之紫鱗，鷹鸇鵰鶚，貪而好殺。", "鳳皇雖大聖，不願以爲臣。", "獨漉水中泥，水濁不見月。", "不見月尚可，水深行人沒。", "越鳥從南來，胡鷹亦北度。", "我欲彎弓向天射，惜其中道失歸路。", "落葉別樹，飄零隨風。", "客無所託，悲與此同。", "羅帷舒卷，似有人開。", "明月直入，無心可猜。", "雄劒挂壁，時時龍鳴。", "不斷犀象，繡澀苔生。", "國恥未雪，何由成名。", "神鷹夢澤，不顧鴟鳶。", "爲君一擊，摶鵬九天。", "揚清歌，發皓齒，北方佳人東鄰子。", "且吟白紵停淥水，長袖拂面爲君起。", "寒雲夜卷霜海空，胡風吹天飄塞鴻。", "玉顏滿堂樂未終，館娃日落歌吹濛。", "月寒江清夜沈沈，美人一笑千黃金。", "動君心，冀君賞。", "願作天池雙鴦鴦，一朝飛去青雲上。", "吳刀翦綵縫舞衣，明妝麗服奪春輝。", "揚眉轉袖若雪飛，傾城獨立世所稀。", "麥隴青青三月時，白雉朝飛挾兩雌。", "錦衣綺翼何離褷，犢牧采薪感之悲。", "春天和，白日暖，啄食飲泉勇氣滿。", "枯楊枯楊爾生荑，我獨七十而孤棲。", "彈弦寫恨意不盡，瞑目歸黃泥。", "雙燕復雙燕，雙飛令人羨。", "玉樓珠閣不獨棲，金窗繡戶長相見。", "柏梁失火去，因入吳王宮。", "吳宮又焚蕩，雛盡巢亦空。", "憔悴一身在，孀雌憶故雄。", "雙飛難再得，傷我寸心中。", "淥水明秋月，南湖采白蘋。", "荷花嬌欲語，愁殺蕩舟人。", "春陽如昨日，碧樹鳴黃鸝。", "蕪然蕙草暮，颯爾涼風吹。", "天秋木葉下，月冷莎雞悲。", "坐愁羣芳歇，白露凋華滋。", "閼氏黃葉落，妾望白登臺。", "月出碧雲斷，蟬聲秋色來。", "胡兵沙塞合，漢使玉關回。", "征客無歸日，空悲蕙草摧。", "黃帝鑄鼎於荆山，鍊丹砂。", "丹砂成黃金，騎龍飛上太清家。", "雲愁海思令人嗟，宮中綵女顏如花。", "飄然揮手凌紫霞，從風縱體登鑾車。", "登鑾車，侍軒轅。", "遨遊青天中，其樂不可言。", "鼎湖流水清且閑，軒轅去時有弓劒。", "古人傳道留其間，後宮嬋娟多花顏。", "乘鸞飛煙亦不還，騎龍攀天造天關。", "造天關，聞天語，長雲河車載玉女。", "下視瑤池見王母，蛾眉蕭颯如秋霜。", "蒼蒼雲松，落落綺皓。", "春風爾來爲阿誰，胡蝶忽然滿芳草。", "秀眉霜雪顏桃花，骨青髓綠長美好。", "稱是秦時避世人，勸酒相歡不知老。", "各守兔鹿志，恥隨龍虎爭。", "歘起佐太子，漢王乃復驚。", "顧謂戚夫人，彼翁羽翼成。", "歸來南山下，泛若雲無情。", "舉觴酹巢由，洗耳何獨清？", "浩歌望嵩嶽，意氣還相傾。", "拂彼白石，彈吾素琴。", "幽澗愀兮流泉深，善手明徽高張清。", "心寂歷似千古，松颼飀兮萬尋。", "中見愁猨弔影而危處兮，呌秋木而長吟。", "客有哀時失志而聽者，淚淋浪以霑襟。", "乃緝商綴羽，潺湲成音。", "吾但寫聲發情於妙指，殊不知此曲之古今。", "幽澗泉，鳴深林。", "西門秦氏女，秀色如瓊花。", "手揮白楊刀，清晝殺讐家。", "羅袖灑赤血，英聲凌紫霞。", "直上西山去，關吏相邀遮。", "壻爲燕國王，身被詔獄加。", "犯刑若履虎，不畏落爪牙。", "素頸未及斷，摧眉伏泥沙。", "金雞忽放赦，大辟得寬賒。", "何慙聶政姊，萬古共驚嗟。", "虜陣橫北荒，胡星曜精芒。", "羽書速驚電，烽火晝連光。", "虎竹救邊急，戎車森已行。", "明主不安席，按劒心飛揚。", "推轂出猛將，連旗登戰場。", "兵威衝絕漠，殺氣凌穹蒼。", "列卒赤山下，開營紫塞傍。", "途冬沙風緊，旌旗颯凋傷。", "[畫]角悲海月，征衣卷天霜。", "揮刃斬樓蘭，彎弓射賢王。", "單于一平蕩，種落自奔亡。", "收功報天子，行歌歸咸陽。", "紫閣連終南，青冥天倪色。", "憑崖望咸陽，宮闕羅北極。", "萬井驚畫出，九衢如弦直。", "渭水清銀河，橫天流不息。", "朝野盛文物，衣冠何翕赩。", "廐馬散連山，軍容威絕域。", "伊皐運元化，衛霍輸筋力。", "歌鐘樂未休，榮去老還逼。", "圓光過滿缺，太陽移中昃。", "不散東海金，何爭西輝匿。", "無作牛山悲，惻愴淚霑臆。", "悲來不吟還不笑，天下無人知我心。", "君有數斗酒，我有三尺琴。", "琴鳴酒樂兩相得，一杯不啻千鈞金。", "富貴百年能幾何？死生一度人皆有。", "孤猨坐啼墳上月，且須一盡杯中酒。", "漢帝不憶李將軍，楚王放却屈大夫。", "范子何曾愛五湖，功成名遂身自退。", "劒是一夫用，書能知姓名。", "惠施不肯干萬乘，卜式未必窮一經。", "還須黑頭取方伯，莫謾白首爲儒生。", "漢帝重阿嬌，貯之黃金屋。", "咳唾落九天，隨風生珠玉。", "寵極愛還歇，妒深情却疎。", "長門一步地，不肯暫回車。", "雨落不上天，水覆難再收。", "君情與妾意，各自東西流。", "昔日芙蓉花，今成斷根草。", "以色事他人，能得幾時好。", "龍馬花雪毛，金鞍五陵豪。", "秋霜切玉劒，落日明珠袍。", "鬬雞事萬乘，軒蓋一何高。", "弓摧宜山虎，手接泰山猱。", "酒後競風彩，三杯弄寶刀。", "殺人如翦草，劇孟同遊遨。", "發憤去函谷，從軍向臨洮。", "叱咤萬戰場，匈奴盡波濤。", "歸來使酒氣，未肯拜蕭曹。", "羞入原憲室，荒徑隱蓬蒿。", "燭龍棲寒門，光曜猶旦開。", "日月照之何不及此，惟有北風怒號天上來。", "燕山雪花大如席，片片吹落軒轅臺。", "幽州思婦十二月，停歌罷笑雙蛾摧。", "倚門望行人，念君長城苦寒良可哀。", "別時提劒救邊去，遺此虎文金髀釵。", "中有一雙白羽箭，蜘蛛結網生塵埃。", "箭空在，人今戰死不復迴。", "不忍見此物，焚之已成灰。", "黃河捧土尚可塞，北風雨雪恨難裁。", "深宮高樓入紫清，金作蛟龍盤繡楹。", "佳人當窗弄白日，弦將手語彈鳴箏。", "春風吹落君王耳，此曲乃是升天行。", "因出天池汎蓬瀛，樓船蹙沓波浪驚。", "三千雙蛾獻歌笑，撾鐘考鼓宮殿傾。", "萬姓聚舞歌太平，我無爲，人自寧。", "三十六帝欲相迎，仙人飄翩下雲軿。", "帝不去，留鎬京。", "安能爲軒轅，獨往入窅冥。", "小臣拜獻南山壽，陛下萬古垂鴻名。", "小時不識月，呼作白玉盤。", "又疑瑤臺鏡，飛在青雲端。", "仙人垂兩足，桂樹作團團。", "白兔擣藥成，問言與誰餐。", "蟾蜍蝕圜影，天明夜已殘。", "羿昔落九烏，天人清且安。", "陰精此淪惑，去去不足觀。", "憂來其如何？惻愴摧心肝。", "春風東來忽相過，金尊綠酒生微波。", "落花紛紛稍覺多，美人欲醉朱顏酡。", "青軒桃李能幾何？流光欺人忽蹉跎。", "琴奏龍門之綠桐，玉壺美酒清若空。", "催弦拂柱與君飲，看朱成碧顏始紅。", "胡姬貌如花，當鑪笑春風。", "笑春風，舞羅衣，君今不醉欲安歸。", "紫燕黃金瞳，啾啾搖綠鬉。", "平明相馳逐，結客洛門東。", "少年學劒術，凌轢白猨公。", "珠袍曳錦帶，七首插吳鴻。", "由來萬夫勇，挾此生雄風。", "託交從劇孟，買醉入新豐。", "笑盡一杯酒，殺人都市中。", "羞道易水寒，從令日貫虹。", "燕丹事不立，虛沒秦帝宮。", "舞陽死灰人，安可與成功。", "青雲少年子，挾彈章臺左。", "鞍馬四邊開，突如流星過。", "金丸落飛鳥，夜入瓊樓臥。", "夷齊是何人？獨守西山餓。", "擊筑飲美酒，劒歌易水湄。", "經過燕太子，結託幷州兒。", "少年負壯氣，奮烈自有時。", "因聲魯句踐，爭情勿相欺。", "五陵年少金市東，銀鞍白馬度春風。", "落花踏盡遊何處？笑入胡姬酒肆中。", "君不見淮南少年遊俠客，白日毬獵夜擁擲。", "呼盧百萬終不惜，報讐千里如咫尺。", "少年遊俠好經過，渾身裝束皆綺羅。", "蘭蕙相隨喧妓女，風光去處滿笙歌。", "驕矜自言不可有，俠士堂中養來久。", "好鞍好馬乞與人，十千五千旋沽酒。", "赤心用盡爲知己，黃金不惜栽桃李。", "桃李栽來幾度春，一回花落一回新。", "府縣盡爲門下客，王侯皆是平交人。", "男兒百年且樂命，何須徇書受貧病。", "男兒百年且榮身，何須徇節甘風塵。", "衣冠半是征戰士，窮儒浪作林泉民。", "遮莫枝根長百丈，不如當代多還往。", "遮莫姻親連帝城，不如當身自簪纓。", "看取富貴眼前者，何用悠悠身後名。", "趙客縵胡纓，吳鉤霜雪明。", "銀鞍照白馬，颯沓如流星。", "十步殺一人，千里不留行。", "事了拂衣去，深藏身與名。", "閑過信陵飲，脫劒膝前橫。", "將炙啖朱亥，持觴勸侯嬴。", "三杯吐然諾，五嶽倒爲輕。", "眼花耳熱後，意氣素霓生。", "救趙揮金槌，邯鄲先震驚。", "千秋二壯士，烜赫大梁城。", "縱死俠骨香，不慙世上英。", "誰能書閣下，白首太玄經。", "邊城兒，生年不讀一字書，但知遊獵誇輕趫。", "胡馬秋肥宜白草，騎來躡影何矜驕。", "金鞭拂雲揮鳴鞘，半酣呼鷹出遠郊。", "弓彎滿月不虛發，雙鶬迸落連飛𩩉。", "海邊觀者皆辟易，猛氣英風振沙磧。", "胡雁鳴，辭燕山，昨發委羽朝度關。", "一一銜蘆枝，南飛散落天地間。", "連行接翼往復還，客居煙波寄湘吳。", "凌霜觸雪毛體枯，畏逢矰繳驚相呼。", "嗷嗷空城雀，身計何戚促。", "本與鷦鷯羣，不隨鳳凰族。", "提攜四黃口，飲乳未嘗足。", "食君糠粃餘，常恐烏鳶逐。", "恥涉太行險，羞營覆車粟。", "天命有定端，守分絕所欲。", "長相思，在長安，絡緯秋啼金井欄。", "微霜淒淒簟色寒，孤燈不明思欲絕。", "卷帷望月空長歎，美人如花隔雲端。", "上有青冥之長天，下有綠水之波瀾。", "天長路遠魂飛苦，夢魂不到關山難。", "長相思，摧心肝。", "日色已盡花含煙，月明欲素愁不眠。", "趙瑟初停鳳凰柱，蜀琴欲奏鴛鴦弦。", "昔日橫波目，今成流淚泉。", "不信妾腸斷，歸來看取明鏡前。", "美人在時花滿堂，美人去後花餘牀。", "牀中繡被卷不寢，至今三載猶聞香。", "香亦竟不滅，人亦竟不來。", "相思黃葉落，白露點青苔。", "李陵沒胡沙，蘇武還漢家。", "迢迢五原關，朔雪亂邊花。", "一去隔絕域，思歸但長嗟。", "鴻雁向西北，飛書報天涯。", "金尊清酒斗十千，玉盤珍羞直萬錢。", "停杯投筯不能食，拔劒四顧心茫然。", "欲渡黃河冰塞川，將登太行雪暗天。", "閑來垂釣坐溪上，忽復乘舟夢日邊。", "行路難，行路難，多岐路，今安在？", "長風破浪會有時，直挂雲帆濟滄海。", "大道如青天，我獨不得出。", "羞逐長安社中兒，赤雞白狗賭梨栗。", "彈劒作歌奏苦聲，曳裾王門不稱情。", "淮陰市井笑韓信，漢朝公卿忌賈生。", "君不見昔時燕家重郭隗，擁篲折腰無嫌猜。", "劇辛樂毅感恩分，輸肝剖膽效英才。", "昭王白骨縈蔓草，誰人更掃黃金臺。", "行路難，歸去來。", "有耳莫洗潁川水，有口莫食首陽蕨。", "含光混世貴無名，何用孤高比雲月。", "吾觀自古賢達人，功成不退皆殞身。", "子胥既棄吳江上，屈原終投湘水濱。", "陸機才多豈自保，李斯稅駕苦不早。", "華亭鶴唳詎可聞，上蔡蒼鷹何足道？", "君不見吳中張翰稱達士，秋風忽憶江東行。", "且樂生前一杯酒，何須身後千載名。", "海水直下萬里深，誰人不言此離苦。", "日慘慘兮雲冥冥，猩猩啼煙兮鬼嘯雨。", "我縱言之將何補，皇穹竊恐不照余之忠誠。", "雷馮馮兮欲吼怒，堯舜當之亦禪禹。", "君失臣兮龍爲魚，權歸臣兮鼠變虎。", "帝子泣兮綠雲間，隨風波兮去無還。", "慟哭兮遠望，見蒼梧之深山。", "蒼梧山崩湘水絕，竹上之淚乃可滅。", "別來幾春未還家，玉窗五見櫻桃花。", "況有錦字書，開緘使人嗟。", "至此腸斷彼心絕，雲鬟綠鬢罷攬結。", "愁如迴飆亂白雪，去年寄書報陽臺。", "今年寄書重相催，胡爲東風爲我吹行雲。", "使西來，待來竟不來，落花寂寂委青苔。", "白帝城邊足風波，瞿塘五月誰敢過。", "妾髮初覆額，折花門前劇。", "郎騎竹馬來，遶牀弄青梅。", "同居長干里，兩小無嫌猜。", "十四爲君婦，羞顏尚不開。", "低頭向暗壁，千喚不一迴。", "十五始展眉，願同塵與灰。", "常存抱柱信，豈上望夫臺。", "十六君遠行，瞿塘灩預堆。", "五月不可觸，猨鳴天上哀。", "門前遲行跡，一一生綠苔。", "苔深不能掃，落葉秋風早。", "八月蝴蝶來，雙飛西園草。", "感此傷妾心，坐愁紅顏老。", "早晚下三巴，預將書報家。", "相迎不道遠，直至長風沙。", "憶妾深閨裏，煙塵不曾識。", "嫁與長干人，沙頭候風色。", "五月南風興，思君在巴陵。", "八月西風起，想君發揚子。", "去來悲如何，見少別離多。", "湘潭幾日到，妾夢越風波。", "昨夜狂風度，吹折江頭樹。", "淼淼暗無邊，行人在何處？", "北客真王公，朱衣滿江中。", "日暮來投宿，數朝不肎東。", "好乘浮雲驄，佳期蘭渚東。", "鴛鴦綠浦上，翡翠錦屏中。", "自憐十五餘，顏色桃李紅。", "那作商人婦，愁水復愁風。", "妾本叢臺女，揚蛾入丹闕。", "自倚顏如花，寧知有凋歇。", "一辭玉階下，去若朝雲沒。", "每憶邯鄲城，深宮夢秋月。", "君王不可見，惆悵至明發。", "于闐采花人，自言花相似。", "明妃一朝西入胡，胡中美女多羞死。", "乃知漢地多名姝，胡中無花可方比。", "丹青能令醜者妍，無鹽翻在深宮裏。", "自古妬蛾眉，胡沙埋皓齒。", "天子居未央，妾侍卷衣裳。", "顧無紫宮寵，敢拂黃金牀。", "水至亦不去，熊來尚可當。", "微身奉日月，飄若螢火光。", "願君采葑菲，無以下體妨。", "白龍改常服，偶被豫且制。", "誰使爾爲魚，徒勞訴天帝。", "作書報鯨鯢，勿恃風濤勢。", "濤落歸泥沙，翻遭螻蟻噬。", "萬乘慎出入，柏人以爲誡。", "將軍發白馬，旌節渡黃河。", "簫鼓聒川嶽，滄溟湧洪波。", "武安有振瓦，易水無寒歌。", "鐵騎若雪山，飲流涸滹沱。", "揚兵獵月窟，轉戰畧朝那。", "倚劍登燕然，邊峰列嵯峨。", "蕭條萬里外，耕作五原多。", "一掃清大漠，包虎戢金戈。", "燕南壯士吳門豪，筑中置鉛魚隱刀。", "感君恩重許君命，泰山一擲輕鴻毛。", "沐芳莫彈冠，浴蘭莫振衣。", "處世忌太潔，志人貴藏輝。", "滄浪有釣叟，吾與爾同歸。", "白馬誰家子，黃龍邊塞兒。", "天山三丈雪，豈是遠行時。", "春蕙忽秋草，莎雞鳴曲池。", "風催寒椶響，月入霜閨悲。", "憶與君別年，種桃齊蛾眉。", "桃今百餘尺，花落成枯枝。", "終然獨不見，流淚空自知。", "冬夜夜寒覺夜長，沈吟久坐坐北堂。", "冰合井泉月入閨，青缸凝明照悲嗁。", "青缸滅，嗁轉多，掩妾淚，聽君歌。", "歌有聲，妾有情，情聲合，兩無違。", "一語不入意，從君萬曲梁塵飛。", "踏踏馬頭誰見過，眼看北斗直天河。", "西風羅幕生翠波，鉛華笑妾顰青蛾。", "爲君起唱長相思，簾外嚴霜皆倒飛。", "鳥銜野田草，誤入枯桑裏。", "客土植危根，逢春猶不死。", "草木雖無情，因依尚可生。", "如何同枝葉，各自有枯榮。", "金花折風帽，白馬小遲回。", "翩翩舞廣袖，似鳥海東來。", "雲想衣裳花想容，春風拂檻露華濃。", "若非羣玉山頭見，會向瑤臺月下逢。", "一枝紅豔露凝香，雲雨巫山枉斷腸。", "借問漢宮誰得似，可憐飛燕倚新妝。", "名花傾國兩相歡，長得君王帶笑看。", "解釋春風無限恨，沈香亭北倚闌干。", "小小生金屋，盈盈在紫微。", "山花插寶髻，石竹繡羅衣。", "每出深宮裏，常隨步輦歸。", "只愁歌舞散，化作綵雲飛。", "柳色黃金嫩，梨花白雪香。", "玉樓巢翡翠，金殿鎖鴛鴦。", "選妓隨雕輦，徵歌出洞房。", "宮中誰第一，飛燕在昭陽。", "盧橘爲秦樹，蒲萄出漢宮。", "煙花宜落日，絲管醉春風。", "笛奏龍鳴水，簫吟鳳下空。", "君王多樂事，何必向回中。", "玉樹春歸日，金宮樂事多。", "後庭朝未入，輕輦夜相過。", "笑出花間語，嬌來燭下歌。", "莫教明月去，留著醉姮娥。", "繡戶香風暖，紗窗曙色新。", "宮花爭笑日，池草暗生春。", "綠樹聞歌鳥，青樓見舞人。", "昭陽桃李月，羅綺自相親。", "今日明光裏，還須結伴遊。", "春風開紫殿，天樂下珠樓。", "豔舞全知巧，嬌歌半欲羞。", "更憐花月夜，宮女笑藏鉤。", "寒雪梅中盡，春風柳上歸。", "宮鶯嬌欲醉，簷燕語還飛。", "遲日明歌席，新花豔舞衣。", "晚來移綵仗，行樂泥光輝。", "水綠南薰殿，花紅北闕樓。", "鶯歌聞太液，鳳吹遶瀛洲。", "素女鳴珠佩，天人弄綵毬。", "今朝風日好，宜入未央遊。", "中山孺子妾，特以色見珍。", "雖不如延年妹，亦是當時絕世人。", "桃李出深井，花豔驚上春。", "一貴復一賤，關天豈由身。", "芙蓉老秋霜，團扇羞網塵。", "戚姬髡翦入舂市，萬古共悲辛。", "洞庭白波木葉稀，燕鴻始入吳雲飛。", "吳雲寒，燕鴻苦。", "風號沙宿瀟湘浦，節士感秋淚如雨。", "白日當天心，照之可以事明主。", "壯士憤，雄風生。", "安得倚天劒，跨海斬長鯨。", "狂風吹古月，竊弄章華臺。", "北落明星動光彩，南征猛將如雲雷。", "手中電曳倚天劒，直斬長鯨海水開。", "我見樓船壯心目，頗似龍驤下三蜀。", "揚兵習戰張虎旗，江中白浪如銀屋。", "身居玉帳臨河魁，紫髯若戟冠崔嵬。", "細柳開營揖天子，始知灞上爲嬰孩。", "羌笛橫吹阿嚲回，向月樓中吹落梅。", "將軍自起舞長劒，壯士呼聲動九垓。", "功成獻凱見明主，丹青畫像麒麟臺。", "落日欲沒峴山西，倒著接䍦花下迷。", "襄陽小兒齊拍手，攔街爭唱白銅鞮。", "傍人借問笑何事，笑殺山公醉似泥。", "遙看漢水鴨頭綠，恰似蒲萄初醱醅。", "此江若變作春酒，壘麴便築糟丘臺。", "千金駿馬換少妾，醉坐雕鞍歌落梅。", "車傍側挂一壺酒，鳳笙龍管行相催。", "咸陽市上歎黃犬，何如月下傾金罍。", "君不見晉朝羊公一片石，龜龍剝落生莓苔。", "淚亦不能爲之墮，心亦不能爲之哀。", "誰能憂彼身後事，金鳧銀鴨葬死灰。", "清風朗月不用一錢買，玉山自倒非人推。", "舒州杓，力士鐺，李白與爾同死生。", "襄王雲雨今安在，江水東流猨夜聲。", "襄陽行樂處，歌舞白銅鞮。", "江城回淥水，花月使人迷。", "山公醉酒時，酩酊襄陽下。", "頭上白接䍦，倒著還騎馬。", "峴山臨漢江，水淥沙如雪。", "上有墮淚碑，青苔久磨滅。", "且醉習家池，莫看墮淚碑。", "山公欲上馬，笑殺襄陽兒。", "攀天莫登龍，走山莫騎虎。", "貴賤結交心不移，唯有嚴陵及光武。", "周公稱大聖，管蔡寧相容。", "漢謠一斗粟，不與淮南舂。", "兄弟尚路人，吾心安所從。", "它人方寸間，山海幾千重。", "輕言託朋友，對面九疑峰。", "多花必早落，桃李不如松。", "管鮑久已死，何人繼其蹤。"];

    const POEMS_ALL = ["秦川雄帝宅，函谷壯皇居。", "綺殿千尋起，離宮百雉餘。", "連甍遙接漢，飛觀迥凌虛。", "雲日隱層闕，風煙出綺疎。", "巖廊罷機務，崇文聊駐輦。", "玉匣啓龍圖，金繩披鳳篆。", "韋編斷仍續，縹帙舒還卷。", "對此乃淹留，欹案觀墳典。", "移步出詞林，停輿欣武宴。", "琱弓寫明月，駿馬疑流電。", "驚雁落虛弦，啼猿悲急箭。", "閱賞誠多美，於茲乃忘倦。", "鳴笳臨樂館，眺聽歡芳節。", "急管韻朱絃，清歌凝白雪。", "彩鳳肅來儀，玄鶴紛成列。", "去茲鄭衛聲，雅音方可悅。", "芳辰追逸趣，禁苑信多奇。", "橋形通漢上，峰勢接雲危。", "煙霞交隱映，花鳥自參差。", "何如肆轍跡？萬里賞瑤池。", "飛蓋去芳園，蘭橈遊翠渚。", "萍間日彩亂，荷處香風舉。", "桂楫滿中川，弦歌振長嶼。", "豈必汾河曲，方爲歡宴所。", "落日雙闕昏，回輿九重暮。", "長煙散初碧，皎月澄輕素。", "搴幌翫琴書，開軒引雲霧。", "斜漢耿層閣，清風搖玉樹。", "歡樂難再逢，芳辰良可惜。", "玉酒泛雲罍，蘭殽陳綺席。", "千鍾合堯禹，百獸諧金石。", "得志重寸陰，忘懷輕尺璧。", "建章歡賞夕，二八盡妖妍。", "羅綺昭陽殿，芬芳玳瑁筵。", "珮移星正動，扇掩月初圓。", "無勞上懸圃，即此對神仙。", "以茲遊觀極，悠然獨長想。", "披卷覽前蹤，撫躬尋既往。", "望古茅茨約，瞻今蘭殿廣。", "人道惡高危，虛心戒盈蕩。", "奉天竭誠敬，臨民思惠養。", "納善察忠諫，明科慎刑賞。", "六五誠難繼，四三非易仰。", "廣待淳化敷，方嗣云亭響。", "塞外悲風切，交河冰已結。", "瀚海百重波，陰山千里雪。", "迥戍危烽火，層巒引高節。", "悠悠卷斾旌，飲馬出長城。", "寒沙連騎跡，朔吹斷邊聲。", "胡塵清玉塞，羌笛韻金鉦。", "絕漠干戈戢，車徒振原隰。", "都尉反龍堆，將軍旋馬邑。", "揚麾氛霧靜，紀石功名立。", "荒裔一戎衣，靈臺凱歌入。", "執契靜三邊，持衡臨萬姓。", "玉彩輝關燭，金華流日鏡。", "無爲宇宙清，有美璇璣正。", "皎佩星連景，飄衣雲結慶。", "戢武耀七德，昇文輝九功。", "煙波澄舊碧，塵火息前紅。", "霜野韜蓮劒，關城罷月弓。", "錢綴榆天合，新城柳塞空。", "花銷蔥嶺雪，縠盡流沙霧。", "秋駕轉兢懷，春冰彌軫慮。", "書絕龍庭羽，烽休鳳穴戍。", "衣宵寢二難，食旰餐三懼。", "翦暴興先廢，除兇存昔亡。", "圓蓋歸天壤，方輿入地荒。", "孔海池京邑，雙河沼帝鄉。", "循躬思勵己，撫俗媿時康。", "元首佇鹽梅，股肱惟輔弼。", "羽賢崆嶺四，翼聖襄城七。", "澆俗庶反淳，替文聊就質。", "已知隆至道，共歡區宇一。", "條風開獻節，灰律動初陽。", "百蠻奉遐賮，萬國朝未央。", "雖無舜禹迹，幸欣天地康。", "車軌同八表，書文混四方。", "赫奕儼冠蓋，紛綸盛服章。", "羽旄飛馳道，鐘鼓震巖廊。", "組練輝霞色，霜戟耀朝光。", "晨宵懷至理，終媿撫遐荒。", "壽丘惟舊跡，酆邑乃前基。", "粵予承累聖，懸弧亦在茲。", "弱齡逢運改，提劒鬱匡時。", "指麾八荒定，懷柔萬國夷。", "梯山咸入款，駕海亦來思。", "單于陪武帳，日逐衛文㮰。", "端扆朝四岳，無爲任百司。", "霜節明秋景，輕冰結水湄。", "芸黃徧原隰，禾穎積京畿。", "共樂還鄉宴，歡比大風詩。", "代馬依朔吹，驚禽愁昔叢。", "況茲承眷德，懷舊感深衷。", "積善忻餘慶，暢武悅成功。", "垂衣天下治，端拱車書同。", "白水巡前跡，丹陵幸舊宮。", "列筵歡故老，高宴聚新豐。", "駐蹕撫田畯，回輿訪牧童。", "瑞氣縈丹闕，祥煙散碧空。", "孤嶼含霜白，遙山帶日紅。", "於焉歡擊筑，聊以詠南風。", "昔年懷壯氣，提戈初仗節。", "心隨朗日高，志與秋霜潔。", "移鋒驚電起，轉戰長河決。", "營碎落星沈，陣卷橫雲裂。", "一揮氛沴靜，再舉鯨鯢滅。", "於茲俯舊原，屬目駐華軒。", "沈沙無故迹，減竈有殘痕。", "浪霞穿水淨，峰霧抱蓮昏。", "世途亟流易，人事殊今昔。", "長想眺前蹤，撫躬聊自適。", "新豐停翠輦，譙邑駐鳴笳。", "園荒一徑斷，苔古半階斜。", "前池消舊水，昔樹發今花。", "一朝辭此地，四海遂爲家。", "金輿巡白水，玉輦駐新豐。", "紐落藤披架，花殘菊破叢。", "葉鋪荒草蔓，流竭半池空。", "紉珮蘭凋徑，舒圭葉翦桐。", "昔地一蕃內，今宅九圍中。", "架海波澄鏡，韜戈器反農。", "八表文同軌，無勞歌大風。", "慨然撫長劒，濟世豈邀名。", "星旂紛電舉，日羽肅天行。", "徧野屯萬騎，臨原駐五營。", "登山麾武節，背水縱神兵。", "在昔戎戈動，今來宇宙平。", "崤函稱地險，襟帶壯兩京。", "霜峰直臨道，冰河曲繞城。", "古木參差影，寒猿斷續聲。", "冠蓋往來合，風塵朝夕驚。", "高談先馬度，僞曉預雞鳴。", "棄繻懷遠志，封泥負壯情。", "別有真人氣，安知名不名。", "翠野駐戎軒，盧龍轉征斾。", "遙山麗如綺，長流縈似帶。", "海氣百重樓，巖松千丈蓋。", "玄兔月初明，澄輝照遼碣。", "映雲光暫隱，隔樹花如綴。", "魄滿桂枝圓，輪虧鏡彩缺。", "臨城却影散，帶暈重圍結。", "駐蹕俯九都，停觀妖氛滅。", "碧原開霧隰，綺嶺峻霞城。", "煙峰高下翠，日浪淺深明。", "斑紅粧橤樹，圓青壓溜荆。", "迹巖勞傅想，窺野訪莘情。", "巨川何以濟，舟楫佇時英。", "韶光開令序，淑氣動芳年。", "駐輦華林側，高宴柏梁前。", "紫庭文珮滿，丹墀衮紱連。", "九夷簉瑤席，五狄列瓊筵。", "娛賓歌湛露，廣樂奏鈞天。", "清尊浮綠醑，雅曲韻朱弦。", "粵余君萬國，還慙撫八埏。", "庶幾保貞固，虛己厲求賢。", "未央初壯漢，阿房昔侈秦。", "在危猶騁麗，居奢遂役人。", "豈如家四海，日宇罄朝倫。", "扇天裁戶舊，砌地翦基新。", "引月擎宵桂，飄雲逼曙鱗。", "露除光炫玉，霜闕映雕銀。", "舞接花梁燕，歌迎鳥路塵。", "鏡池波太液，莊苑麗宜春。", "作異甘泉日，停非路寢辰。", "念勞慙逸己，居曠返勞神。", "所欣成大厦，宏材佇渭濱。", "楚王雲夢澤，漢帝長楊宮。", "豈若因農暇，閱武出轘嵩。", "三驅陳銳卒，七萃列材雄。", "寒野霜氛白，平原燒火紅。", "琱戈夏服箭，羽騎綠沈弓。", "怖獸潛幽壑，驚禽散翠空。", "長煙晦落景，灌木振嚴風。", "所爲除民瘼，非是悅林叢。", "烈烈寒風起，慘慘飛雲浮。", "霜濃凝廣隰，冰厚結清流。", "金鞍移上苑，玉勒騁平疇。", "旌旗四望合，罝羅一面求。", "楚踣爭兕殪，秦亡角鹿愁。", "獸忙投密樹，鴻驚起礫洲。", "騎斂原塵靜，戈迴嶺日收。", "心非洛汭逸，意在渭濱游。", "禽荒非所樂，撫轡更招憂。", "披襟眺滄海，憑軾翫春芳。", "積流橫地紀，疎派引天潢。", "仙氣凝三嶺，和風扇八荒。", "拂潮雲布色，穿浪日舒光。", "照岸花分彩，迷雲雁斷行。", "懷卑運深廣，持滿守靈長。", "有形非易測，無源詎可量。", "洪濤經變野，翠島屢成桑。", "之罘思漢帝，碣石想秦皇。", "霓裳非本意，端拱且圖王。", "春蒐馳駿骨，總轡俯長河。", "霞處流縈錦，風前瀁卷羅。", "水花翻照樹，堤蘭倒插波。", "豈必汾陰曲，秋雲發棹歌。", "重巒俯渭水，碧嶂插遙天。", "出紅扶嶺日，入翠貯巖煙。", "疊松朝若夜，複岫闕疑全。", "對此恬千慮，無勞訪九仙。", "高軒曖春色，邃閣媚朝光。", "彤庭飛綵斾，翠幌曜明璫。", "恭己臨四極，垂衣馭八荒。", "霜戟列丹陛，絲竹韻長廊。", "穆矣熏風茂，康哉帝道昌。", "繼文遵後軌，循古鑒前王。", "草秀故春色，梅豔昔年粧。", "巨川思欲濟，終以寄舟航。", "憑軒俯蘭閣，眺矚散靈襟。", "綺峰含翠霧，照日蕊紅林。", "鏤丹霞錦岫，殘素雪斑岑。", "拂浪堤垂柳，嬌花鳥續吟。", "連甍豈一拱，衆幹如千尋。", "明非獨材力，終藉棟梁深。", "彌懷矜樂志，更懼戒盈心。", "媿制勞居逸，方規十產金。", "寒隨窮律變，春逐鳥聲開。", "初風飄帶柳，晚雪間花梅。", "碧林青舊竹，綠沼翠新苔。", "芝田初雁去，綺樹巧鸎來。", "晚霞聊自怡，初晴彌可喜。", "日晃百花色，風動千林翠。", "池魚躍不同，園鳥聲還異。", "寄言博通者，知予物外志。", "一朝春夏改，隔夜鳥花遷。", "陰陽深淺葉，曉夕重輕煙。", "哢鸎猶響殿，橫絲正網天。", "珮高蘭影接，綬細草紋連。", "碧鱗驚櫂側，玄燕舞檐前。", "何必汾陽處，始復有山泉。", "夏律昨留灰，秋箭今移晷。", "峨嵋岫初出，洞庭波漸起。", "桂白發幽巖，菊黃開灞涘。", "運流方可歎，含毫屬微理。", "寒驚薊門葉，秋發小山枝。", "松陰背日轉，竹影避風移。", "提壺菊花岸，高興芙蓉池。", "欲知涼氣早，巢空燕不窺。", "爽氣浮丹闕，秋光澹紫宮。", "衣碎荷疎影，花明菊點叢。", "袍輕低草露，蓋側舞松風。", "散岫飄雲葉，迷路飛煙鴻。", "砌冷蘭凋佩，閨寒樹隕桐。", "別鶴棲琴裏，離猿啼峽中。", "落野飛星箭，弦虛半月弓。", "芳菲夕霧起，暮色滿房櫳。", "山亭秋色滿，巖牖涼風度。", "疎蘭尚染煙，殘菊猶承露。", "古石衣新苔，新巢封古樹。", "歷覽情無極，咫尺輸光暮。", "朝光浮燒野，霜華淨碧空。", "結浪冰初鏡，在逕菊方叢。", "約嶺煙深翠，分旗霞散紅。", "抽思滋泉側，飛想傅巖中。", "碧昏朝合霧，丹卷暝韜霞。", "結葉繁雲色，凝璚徧雪華。", "光樓皎若粉，映幕集疑沙。", "泛柳飛飛絮，粧梅片片花。", "照璧臺圓月，飄珠箔穿露。", "瑤潔短長階，玉藂高下樹。", "映桐珪累白，縈峰蓮抱素。", "斷續氣將沈，徘徊歲云暮。", "懷珍媿隱德，表瑞佇豐年。", "橤間飛禁苑，鶴處舞伊川。", "儻詠幽蘭曲，同懽黃竹篇。", "嶺銜宵月桂，珠穿曉露叢。", "蟬啼覺樹冷，螢火不溫風。", "花生圓菊橤，荷盡戲魚通。", "晨浦鳴飛雁，夕渚集栖鴻。", "颯颯高天吹，氛澄下熾空。", "崇文時駐步，東觀還停輦。", "輟膳翫三墳，暉燈披五典。", "寒心覩肉林，飛魄看沈湎。", "縱情昏主多，克己明君鮮。", "滅身資累惡，成名由積善。", "既承百王末，戰兢隨歲轉。", "二儀初創象，三才乃分位。", "非惟樹司牧，固亦垂文字。", "緜代更膺期，芳圖無輟記。", "炎漢承君道，英謨纂神器。", "潛龍既可躍，逵兔奚難致。", "前史殫妙詞，後昆沈雅思。", "書言揚盛跡，補闕興洪志。", "川谷猶舊途，郡國開新意。", "梅山未覺朽，穀水誰云異。", "車服隨名表，文物因時置。", "鳳戟翼康衢，鑾輿總柔轡。", "清濁必能澄，洪纖幸無棄。", "觀儀不失序，遵禮方由事。", "政宣竹律和，時平玉條備。", "文囿雕奇彩，藝門蘊深致。", "雲飛星共流，風揚月兼至。", "類禋遵令典，壇壝資良地。", "五勝竟無違，百司誠有庇。", "粵予承暇景，談叢引泉祕。", "討論窮義府，看覈披經笥。", "大辨良難仰，小學終先匱。", "聞道諒知榮，含毫孰忘媿。", "蕭條起關塞，搖颺下蓬瀛。", "拂林花亂彩，響谷鳥分聲。", "披雲羅影散，泛水織文生。", "勞歌大風曲，威加四海清。", "罩雲飄遠岫，噴雨泛長河。", "低飛昏嶺腹，斜足灑巖阿。", "泫叢珠締葉，起溜鏡圖波。", "濛柳添絲密，含吹織空羅。", "潔野凝晨曜，裝墀帶夕暉。", "集條分樹玉，拂浪影泉璣。", "色灑妝臺粉，花飄綺席衣。", "入扇縈離匣，點素皎殘機。", "北闕三春晚，南榮九夏初。", "黃鶯弄漸變，翠林花落餘。", "瀑流還響谷，猿啼自應虛。", "早荷向心卷，長楊就影舒。", "此時歡不極，調軫坐相於。", "紅輪不暫駐，烏飛豈復停。", "岑霞漸漸落，溪陰寸寸生。", "藿葉隨光轉，葵心逐照傾。", "晚煙含樹色，棲鳥雜流聲。", "高軒臨碧渚，飛檐迥架空。", "餘花攢鏤檻，殘柳散雕櫳。", "岸菊初含橤，園梨始帶紅。", "莫慮崑山暗，還共盡杯中。", "結伴戲方塘，攜手上雕航。", "船移分細浪，風散動浮香。", "遊鸎無定曲，驚鳧有亂行。", "蓮稀釧聲斷，水廣櫂歌長。", "棲烏還密樹，泛流歸建章。", "華林滿芳景，洛陽徧陽春。", "朱顏含遠日，翠色影長津。", "喬柯囀嬌鳥，低枝映美人。", "昔作園中實，今來席上珍。", "玉衡流桂圃，成蹊正可尋。", "鸎啼密葉外，蝶戲脆花心。", "麗景光朝彩，輕霞散夕陰。", "暫顧暉章側，還眺靈山林。", "岸曲非千里，橋斜異七星。", "暫低逢輦度，還高值浪驚。", "水搖文鷁動，纜轉錦花縈。", "遠近隨輪影，輕重應人行。", "回鑾遊福地，極目玩芳晨。", "梵鐘交二響，法日轉雙輪。", "寶剎遙承露，天花近足春。", "未佩蘭猶小，無絲柳尚新。", "圓光低月殿，碎影亂風筠。", "對此留餘想，超然離俗塵。", "拂霞疑電落，騰虛狀寫虹。", "屈伸煙霧裏，低舉白雲中。", "紛披乍依迥，掣曳或隨風。", "念茲輕薄質，無翅強搖空。", "閶闔總金鞍，上林移玉輦。", "野郊愴新別，河橋非舊餞。", "慘日映峰沈，愁雲隨蓋轉。", "哀笳時斷續，悲旌乍舒卷。", "望望情何極，浪浪淚空泫。", "無復昔時人，芳春共誰遣。", "鑿門初奉律，仗戰始臨戎。", "振鱗方躍浪，騁翼正凌風。", "未展六奇術，先虧一簣功。", "防身豈乏智，殉命有餘忠。", "晦魄移中律，凝暄起麗城。", "罩雲朝蓋上，穿露曉珠呈。", "笑樹花分色，啼枝鳥合聲。", "披襟歡眺望，極目暢春情。", "秋光凝翠嶺，涼吹肅離宮。", "荷疎一蓋缺，樹冷半帷空。", "側陣移鴻影，圓花釘菊叢。", "攄懷俗塵外，高眺白雲中。", "斜廊連綺閣，初月照宵幃。", "塞冷鴻飛疾，園秋蟬噪遲。", "露結林疎葉，寒輕菊吐滋。", "愁心逢此節，長歎獨含悲。", "菊散金風起，荷疎玉露圓。", "將秋數行雁，離夏幾林蟬。", "雲凝愁半嶺，霞碎纈高天。", "還似成都望，直見峨眉前。", "爽氣澄蘭沼，秋風動桂林。", "露凝千片玉，菊散一叢金。", "日岫高低影，雲空點綴陰。", "蓬瀛不可望，泉石且娛心。", "雕宮靜龍漏，綺閣宴公侯。", "珠簾燭燄動，繡柱月光浮。", "雲起將歌發，風停與管遒。", "石鯨分玉溜，劫燼隱平沙。", "柳影冰無葉，梅心凍有花。", "寒野凝朝霧，霜天散夕霞。", "歡情猶未極，落景遽西斜。", "凍雲宵徧嶺，素雪曉凝華。", "入牖千重碎，迎風一半斜。", "不妝空散粉，無樹獨飄花。", "縈空慙夕照，破彩謝晨霞。", "暮景斜芳殿，年華麗綺宮。", "寒辭去冬雪，暖帶入春風。", "階馥舒梅素，盤花卷燭紅。", "共歡新故歲，迎送一宵中。", "歲陰窮暮紀，獻節啓新芳。", "冬盡今宵促，年開明日長。", "冰消出鏡水，梅散入風香。", "對此歡終宴，傾壺待曙光。", "和氣吹綠野，梅雨灑芳田。", "新流添舊澗，宿霧足朝煙。", "雁溼行無次，花霑色更鮮。", "對此欣登歲，披襟弄五弦。", "翠樓含曉霧，蓮峰帶晚雲。", "玉葉依巖聚，金枝觸石分。", "橫天結陣影，逐吹起羅文。", "非復陽臺下，空將惑楚君。", "綺筵移暮景，紫閣引宵煙。", "隔棟歌塵合，分階舞影連。", "聲流三處管，響亂一重絃。", "不似秦樓上，吹簫空學仙。", "殘雲收翠嶺，夕霧結長空。", "帶岫凝全碧，障霞隱半紅。", "髣髴分初月，飄颻度曉風。", "還因三里處，冠蓋遠相通。", "蘭氣已熏宮，新橤半粧叢。", "色含輕重霧，香引去來風。", "拂樹濃舒碧，縈花薄蔽紅。", "還當雜行雨，髣髴隱遙空。", "年柳變池臺，隋堤曲直回。", "逐浪絲陰去，迎風帶影來。", "疎黃一鳥弄，半翠幾眉開。", "縈雪臨春岸，參差間早梅。", "春暉開紫苑，淑景媚蘭場。", "映庭含淺色，凝露泫浮光。", "日麗參差影，風傳輕重香。", "會須君子折，佩裏作芬芳。", "禁苑春暉麗，花蹊綺樹妝。", "綴條深淺色，點露參差光。", "向日分千笑，迎風共一香。", "如何仙嶺側，獨秀隱遙芳。", "參差垂玉闕，舒卷映蘭宮。", "珠光搖素月，竹影亂清風。", "彩散銀鉤上，文斜桂戶中。", "惟當雜羅綺，相與媚房櫳。", "凌晨麗城去，薄暮上林棲。", "辭枝枝暫起，停樹樹還低。", "向日終難託，迎風詎肯迷。", "只待纖纖手，曲裏作宵啼。", "駿骨飲長涇，奔流灑絡纓。", "細紋連噴聚，亂荇繞蹄縈。", "水光鞍上側，馬影溜中橫。", "翻似天池裏，騰波龍種生。", "階蘭凝曙霜，岸菊照晨光。", "露濃晞晚笑，風勁淺殘香。", "細葉凋輕翠，圓花飛碎黃。", "還持今歲色，復結後年芳。", "秋露凝高掌，朝光上翠微。", "參差麗雙闕，照耀滿重闈。", "仙馭隨輪轉，靈烏帶影飛。", "臨波無定彩，入隙有圓暉。", "還當葵藿志，傾葉自相依。", "半月無雙影，全花有四時。", "摧藏千里態，掩抑幾重悲。", "促節縈紅袖，清音滿翠帷。", "駛彈風響急，緩曲釧聲遲。", "空餘關隴恨，因此代相思。", "驅馬出遼陽，萬里轉旂常。", "對敵六奇舉，臨戎八陣張。", "斬鯨澄碧海，卷霧掃扶桑。", "昔去蘭縈翠，今來桂染芳。", "雲芝浮碎葉，冰鏡上朝光。", "回首長安道，方歡宴柏梁。", "曖曖去塵昏灞岸，飛飛輕蓋指河梁。", "雲峰衣結千重葉，雪岫花開幾樹妝。", "深悲黃鶴孤舟遠，獨歎青山別路長。", "聊將分袂霑巾淚，還用持添離席觴。", "四時運灰琯，一夕變冬春。", "送寒餘雪盡，迎歲早梅新。", "燄聽風來動，花開不待春。", "鎮下千行淚，非是爲思人。", "九龍蟠燄動，四照逐花生。", "即此流高殿，堪持待月明。", "上弦明月半，激箭流星遠。", "落雁帶書驚，啼猿映枝轉。", "初秋玉露清，早雁出空鳴。", "隔雲時亂影，因風乍含聲。", "岸曲絲陰聚，波移帶影疎。", "還將眉裏翠，來就鏡中舒。", "貞條障曲砌，翠葉貫寒霜。", "拂牖分龍影，臨池待鳳翔。", "散影玉階柳，含翠隱鳴蟬。", "微形藏葉裏，亂響出風前。", "盤根直盈渚，交幹橫倚天。", "舒華光四海，卷葉蔭三川。", "近谷交縈橤，遙峰對出蓮。", "徑細無全磴，松小未含煙。", "疾風知勁草，板蕩識誠臣。", "勇夫安識義，智者必懷仁。", "太液仙舟迥，西園隱上才。", "未曉征車度，雞鳴關早開。", "煙生遙岸隱，月落半崖陰。", "連山驚鳥亂，隔岫斷猿吟。", "醽醁勝蘭生，翠濤過玉䪥。", "千日醉不醒，十年味不敗。", "絕域降附天下平，八表無事悅聖情。", "雲披霧斂天地明，登封日觀禪云亭。", "太常具禮方告成。", "雪恥酬百王，除兇報千古。", "昔乘匹馬去，今驅萬乘來。", "近日毛雖暖聞弦心已驚。", "龍樓光曙景，魯館啓朝扉。", "豔日濃妝影，低星降婺輝。", "玉庭浮瑞色，銀牓藻祥徽。", "雲轉花縈蓋，霞飄葉綴旂。", "雕軒回翠陌，寶駕歸丹殿。", "鳴珠佩曉衣，鏤璧輪開扇。", "華冠列綺筵，蘭醑申芳宴。", "環階鳳樂陳，玳席珍羞薦。", "蝶舞袖香新，歌分落素塵。", "歡凝歡懿戚，慶叶慶初姻。", "暑闌炎氣息，涼早吹疎頻。", "方期六合泰，共賞萬年春。", "羽蓋飛天漢，鳳駕越層巒。", "俱歎三秋阻，共敍一宵歡。", "璜虧夜月落，靨碎曉星殘。", "誰能重操杼，纖手濯清瀾。", "霓裳轉雲路，鳳駕儼天潢。", "虧星凋夜靨，殘月落朝璜。", "促歡今夕促，長離別後長。", "輕梭聊駐織，掩淚獨悲傷。", "溫渚停仙蹕，豐郊駐曉旌。", "路曲迴輸影，巖虛傳漏聲。", "暖溜驚湍駛，寒空碧霧輕。", "林黃疎葉下，野白曙霜明。", "眺聽良無已，煙霞斷續生。", "端居臨玉扆，初律啓金商。", "鳳闕澄秋色，龍闈引夕涼。", "野淨山氣斂，林疎風露長。", "砌蘭虧半影，巖桂發全香。", "滿蓋荷凋翠，圓花菊散黃。", "揮鞭爭電烈，飛羽亂星光。", "柳空穿石碎，弦虛側月張。", "怯猿啼落岫，驚雁斷分行。", "斜輪低夕景，歸斾擁通莊。", "停軒觀福殿，遊目眺皇畿。", "法輪含日轉，花蓋接雲飛。", "翠煙香綺閣，丹霞光寶衣。", "幡虹遙合彩，定水迥分暉。", "蕭然登十地，自得會三歸。", "日宮開萬仞，月殿聳千尋。", "花蓋飛團影，幡虹曳曲陰。", "綺霞遙籠帳，叢珠細網林。", "寥廓煙雲表，超然物外心。", "今宵冬律盡，來朝麗景新。", "花餘凝地雪，條含煖吹分。", "綬吐芽猶嫩，冰□已鏤津。", "薄紅梅色冷，淺綠柳輕春。", "送迎交兩節，暄寒變一辰。", "屏欲除奢政返淳。", "九月正乘秋，三杯興已周。", "泛桂迎尊滿，吹花向酒浮。", "長房萸早熟，彭澤菊初收。", "四郊秦漢國，八水帝王都。", "閶闔雄里閈，城闕壯規模。", "貫渭稱天邑，含岐實奧區。", "金門披玉館，因此識皇圖。", "眷言君失德，驪邑想秦餘。", "政煩方改篆，愚俗乃焚書。", "阿房久已滅，閣道遂成墟。", "欲厭東南氣，翻傷掩鮑車。", "神皐福地三秦邑，玉臺金闕九仙家。", "寒光猶戀甘泉樹，淑景偏臨建始花。", "綵蝶黃鸎未歌舞，梅香柳色已矜誇。", "迎春正啓流霞席，暫囑曦輪勿遽斜。", "潤色鴻業寄賢才，叨居右弼媿鹽梅。", "運籌帷幄荷時來，職掌圖籍濫蓬萊。", "兩司謬忝謝鍾裴，禮樂銓管效涓埃。", "陳師振旅清九垓，欣承顧問侍天杯。", "銜恩獻壽梁柏臺，黃縑青簡奉康哉。", "鯫生侍從忝王枚，右掖司言實不才。", "宗伯秩禮天地開，帝歌難續仰昭回。", "微臣捧日變寒灰，遠慙班左媿遊陪。", "大明御宇臨萬方，顧慙內政翊陶唐。", "鸞鳴鳳舞向平陽，秦樓魯館沐恩光。", "無心爲子輒求郎，雄才七步謝陳王。", "當熊讓輦媿前芳，再司銓筦恩可忘。", "文江學海思濟航，萬邦考績臣所詳。", "著作不休出中腸，權豪屏迹肅嚴霜。", "鑄鼎開岳造明堂，玉醴由來獻壽觴。", "三陽本是標靈紀，二室由來獨擅名。", "霞衣霞錦千般狀，雲峰雲岫百重生。", "水炫珠光遇泉客，巖懸石鏡厭山精。", "永願乾坤符睿算，長居膝下屬歡情。", "奇峰嶾嶙箕山北，秀崿岹嶢嵩鎮南。", "地首地肺何曾擬，天目天台倍覺慙。", "樹影蒙蘢鄣疊岫，波深洶湧落懸潭。", "□願紫宸居得一，永欣丹扆御通三。", "緬想封唐處，實惟建國初。", "俯察伊晉野，仰觀乃參虛。", "井邑龍斯躍，城池鳳翔餘。", "林塘猶沛澤，臺榭宛舊居。", "運革祚中否，時遷命茲符。", "顧循承丕構，怵惕多憂虞。", "尚恐威不逮，復慮化未孚。", "豈徒勞轍迹，所期訓戎車。", "習俗問黎人，親巡慰里閭。", "永言念成功，頌德臨康衢。", "長懷經綸日，歎息履庭隅。", "艱難安可忘，欲去良踟躕。", "有隋政昏虐，羣雄已交爭。", "先聖按劒起，叱咤風雲生。", "飲馬河洛竭，作氣嵩華驚。", "克敵睿圖就，擒俘帝道亨。", "顧慙嗣寶曆，恭承天下平。", "幸過翦鯨地，感慕神且英。", "弧矢威天下，旌旗遊近縣。", "一面施鳥羅，三驅教人戰。", "暮雲成積雪，曉色開行殿。", "皓然原隰同，不覺林野變。", "北風勇士馬，東日華組練。", "觸地銀麞出，連山縞鹿見。", "月兔落高矰，星狼下急箭。", "既欣盈尺兆，復憶磻谿便。", "歲豐將遇賢，俱荷皇天眷。", "眷言思共理，鑑夢想維良。", "猗歟此推擇，聲績著周行。", "賢能既俟進，黎獻實佇康。", "視人當如子，愛人亦如傷。", "講學試誦論，阡陌勸耕桑。", "虛譽不可飾，清知不可忘。", "求名迹易見，安貞德自彰。", "訟獄必以情，教民貴有常。", "恤惸且存老，撫弱復綏強。", "勉哉各祗命，知予眷萬方。", "端拱臨中樞，緬懷共予理。", "不有臺閣英，孰振循良美。", "分符侯甸內，拜手明庭裏。", "誓節期飲冰，調人方導水。", "嘉聲馳九牧，惠化光千祀。", "時雨侔昔賢，芳猷貫前史。", "佇爾頌中和，吾將令卿士。", "漢家重東郡，宛彼白馬津。", "黎庶既蕃殖，臨之勞近臣。", "遠別初首路，今行方及春。", "課成應第一，良牧爾當仁。", "五月符天數，五音調夏鈞。", "舊來傳五日，無事不稱神。", "穴枕通靈氣，長絲續命人。", "四時花競巧，九子糉爭新。", "方殿臨華節，圓宮宴雅臣。", "進對一言重，遒文六義陳。", "股肱良足詠，風化可還淳。", "北風吹同雲，同雲飛白雪。", "白雪乍迴散，同雲何慘烈。", "未見溫泉冰，寧知火井滅。", "表瑞良在茲，庶幾可怡悅。", "長榆息烽火，高柳靜風塵。", "卜征巡九洛，展豫出三秦。", "昔是潛龍地，今爲上理辰。", "時平乘道泰，聊賞遇年春。", "黃河分地絡，飛觀接天津。", "一覽遺芳翰，千載肅如神。", "昔聞有耆叟，河上獨遺榮。", "跡與塵嚻隔，心將道德幷。", "詎以天地累，寧爲寵辱驚。", "矯然翔寥廓，如何屈堅貞。", "玄玄妙門啓，肅肅祠宇清。", "冥漠無先後，那能紀姓名。", "吳國分牛斗，晉室命龍驤。", "受任敵已滅，策勳名不彰。", "居美未盡善，矜功徒自傷。", "長戟今何在？孤墳此路傍。", "不觀松柏茂，空餘荆棘場。", "歎嗟懸劒隴，誰識夢刀祥。", "洛陽芳樹映天津，灞岸垂楊窣地新。", "直爲經過行處樂，不知虛度兩京春。", "去年餘閏今春早，曙色和風著花草。", "可憐寒食與清明，光輝幷在長安道。", "自從關路入秦川，爭道何人不戲鞭。", "公子途中妨蹴踘，佳人馬上廢鞦韆。", "渭水長橋今欲渡，蔥蔥漸見新豐樹。", "遠看驪岫入雲霄，預想湯池起煙霧。", "煙霧氛氳水殿開，暫拂香輪歸去來。", "今歲清明行已晚，明年寒食更相陪。", "暇景屬三春，高臺聊四望。", "目極千里際，山川一何壯。", "太華見重巖，終南分疊嶂。", "郊原紛綺錯，參差多異狀。", "佳氣滿通溝，遲步入綺樓。", "初鸎一一鳴紅樹，歸雁雙雙去綠洲。", "太液池中下黃鶴，昆明水上映牽牛。", "聞道漢家全盛日，別館離宮趣非一。", "甘泉逶迤亘明光，五柞連延接未央。", "周廬徼道縱橫轉，飛閣迴軒左右長。", "須念作勞居者逸，勿言我後焉能恤。", "爲想雄豪壯柏梁，何如儉陋卑茅室。", "陽烏黯黯向山沈，夕鳥喧喧入上林。", "薄暮賞餘回步輦，還念中人罷百金。", "魯衛情先重，親賢愛轉多。", "冕旒豐暇日，乘景暫經過。", "戚里申高宴，平臺奏雅歌。", "復尋爲善樂，方驗保山河。", "地有招賢處，人傳樂善名。", "鶩池臨九達，龍岫對層城。", "桂月先秋冷，蘋風向晚清。", "鳳樓遙可見，彷彿玉簫聲。", "夫子何爲者？栖栖一代中。", "地猶鄹氏邑，宅即魯王宮。", "歎鳳嗟身否，傷麟怨道窮。", "今看兩楹奠，當與夢時同。", "桂殿與山連，蘭湯湧自然。", "陰崖含秀色，溫谷吐潺湲。", "績爲蠲邪著，功因養正宣。", "願言將億兆，同此共昌延。", "邊服胡塵起，長安漢將飛。", "龍蛇開陣法，貔虎振軍威。", "詐虜腦塗地，征夫血染衣。", "今朝書奏入，明日凱歌歸。", "仙居懷聖德，靈廟肅神心。", "草合人蹤斷，塵濃鳥跡深。", "流沙丹竈沒，關路紫煙沈。", "獨傷千載後，空餘松柏林。", "境出三秦外，途分二陝中。", "山川入虞虢，風俗限西東。", "樹古棠陰在，耕餘讓畔空。", "鳴笳從此去，行見洛陽宮。", "拂曙闢行宮，寒皋野望通。", "繁雲低遠岫，飛雪舞長空。", "賦象恆依物，縈迴屢逐風。", "爲知勤恤意，先此示年豐。", "遺榮期入道，辭老竟抽簪。", "豈不惜賢達，其如高尚心。", "寰中得祕要，方外散幽襟。", "獨有青門餞，羣僚悵別深。", "行邁離秦國，巡方赴洛師。", "路逢三五夜，春色暗中期。", "關外長河轉，宮中淑氣遲。", "歌鐘對明月，不減舊遊時。", "壯徒恆賈勇，拔拒抵長河。", "欲練英雄志，須明勝負多。", "譟齊山岌嶪，氣作水騰波。", "預期年歲稔，先此樂時和。", "節變寒初盡，時和氣已春。", "繁雲先合寸，膏雨自依旬。", "颯颯飛平野，霏霏靜暗塵。", "懸知花葉意，朝夕望中新。", "鑄得千秋鏡，光生百鍊金。", "分將賜羣后，遇象見清心。", "臺上冰華澈，窗中月影臨。", "更銜長綬帶，留意感人深。", "太乙三門訣，元君六甲符。", "下傳金版術，上刻玉清書。", "有美探真士，囊中得祕書。", "自知三醮後，翊我滅殘胡。", "劒閣橫雲峻，鑾輿出狩回。", "翠屏千仞合，丹嶂五丁開。", "灌木縈旗轉，仙雲拂馬來。", "乘時方在德，嗟爾勒銘才。", "寶照含天地，神劒合陰陽。", "日月麗光景，星斗裁文章。", "寫鑑表容質，佩服爲身防。", "從茲一賞玩，永德保齡長。", "道家奠靈簡，自昔仰神仙。", "真子今將命，蒼生福可傳。", "江山尋故國，城郭信依然。", "二室遙相望，雲回洞裏天。", "洞府修真客，衡陽念舊居。", "將成金闕要，願奉玉清書。", "雲路三天近，松溪萬籟虛。", "猶期傳祕訣，來往候仙輿。", "城闕天中近，蓬瀛海上遙。", "歸期千載鶴，春至一來朝。", "采藥逢三秀，餐霞臥九霄。", "參同如有旨，金鼎待君燒。", "三陽麗景早芳辰，四序佳園物候新。", "梅花百樹障去路，垂柳千條暗回津。", "鳥飛直爲驚風葉，魚沒都由怯岸人。", "惟願聖主南山壽，何愁不賞萬年春。", "乾道運無窮，恆將人代工。", "陰陽調曆象，禮樂報玄穹。", "介胄清荒外，衣冠佐域中。", "言談延國輔，詞賦引文雄。", "野霽伊川綠，郊明鞏樹紅。", "冕旒多暇景，詩酒會春風。", "今年通閏月，入夏展春輝。", "樓下風光晚，城隅宴賞歸。", "九歌揚政要，六舞散朝衣。", "天喜時相合，人和事不違。", "禮中推意厚，樂處感心微。", "別賞陽臺樂，前旬暮雨飛。", "撰日巖廊暇，需雲宴樂初。", "萬方朝玉帛，千品會簪裾。", "地入南山近，城分北斗餘。", "池塘垂柳密，原隰野花疎。", "帟幕看逾暗，歌鐘聽自虛。", "興闌歸騎轉，還奏弼違書。", "廣學開書院，崇儒引席珍。", "集賢招衮職，論道命台臣。", "禮樂沿今古，文章革舊新。", "獻酬尊俎列，賓主位班陳。", "節變雲初夏，時移氣尚春。", "所希光史冊，千載仰茲晨。", "紫府求賢士，清谿祖逸人。", "江湖與城闕，異跡且殊倫。", "間有幽棲者，居然厭俗塵。", "林泉先得性，芝桂欲調神。", "地道踰稽嶺，天台接海濱。", "音徽從此間，萬古一芳春。", "鐘鼓嚴更曙，山河野望通。", "鳴鑾下蒲坂，飛斾入秦中。", "地險關逾壯，天平鎮尚雄。", "春來津樹合，月落戍樓空。", "馬色分朝景，雞聲逐曉風。", "所希常道泰，非復候繻同。", "飭駕去京邑，鳴鸞指洛川。", "循途經太華，回蹕暫周旋。", "翠崿留斜影，懸巖冒夕煙。", "四方皆石壁，五位配金天。", "彷彿看高掌，依稀聽子先。", "終當銘歲月，從此記靈仙。", "日觀卜先征，時巡順物情。", "風行未備禮，雲密遽飄霙。", "委樹寒花發，縈空落絮輕。", "朝如玉已會，庭似月猶明。", "既覩膚先合，還欣尺有盈。", "登封何以報？因此謝功成。", "西狩觀周俗，南山歷漢宮。", "薦鮮知路近，省斂覺年豐。", "陰谷含神爨，湯泉養聖功。", "益齡仙井合，愈疾醴源通。", "不重鳴岐鳳，誰矜陳寶雄。", "願將無限澤，霑沐衆心同。", "雷出應乾象，風行順國人。", "川途猶在晉，車馬漸歸秦。", "背陝關山險，橫汾鼓吹頻。", "草依陽谷變，花待北巖春。", "聞有鵷鸞客，清詞雅調新。", "求音思欲報，心跡竟難陳。", "潞國開新府，壺關寵舊林。", "妙旌循吏德，持悅庶氓心。", "禮樂中朝貴，神明列郡欽。", "揚風非贈扇，易俗是張琴。", "藩鎮謳謠滿，行宮雨露深。", "會書丞相策，先賜潁川金。", "宗師心物外，爲道運虛舟。", "不戀巖泉賞，來從宮禁遊。", "探玄知幾歲，習靜更宜秋。", "煙樹辨朝色，風湍聞夜流。", "坐朝繁聽覽，尋勝在清幽。", "欲廣無爲化，因茲庶可求。", "端午臨中夏，時清日復長。", "鹽梅已佐鼎，麯糵且傳觴。", "事古人留迹，年深縷積長。", "當軒知槿茂，向水覺蘆香。", "億兆同歸壽，羣公共保昌。", "忠貞如不替，貽厥後昆芳。", "九達長安道，三陽別館春。", "還將聽朝暇，回作豫遊晨。", "不戰要荒服，無刑禮樂新。", "合酺覃土宇，歡宴接羣臣。", "玉斝飛千日，瓊筵薦八珍。", "舞衣雲曳影，歌扇月開輪。", "伐鼓魚龍雜，撞鐘角觝陳。", "曲終酣興晚，須有醉歸人。", "蘭殿千秋節，稱名萬壽觴。", "風傳率土慶，日表繼天祥。", "玉宇開花蕚，宮縣動會昌。", "衣冠白鷺下，帟幕翠雲長。", "獻遺成新俗，朝儀入舊章。", "月銜花綬鏡，露綴綵絲囊。", "處處祠田祖，年年宴杖鄉。", "深思一德事，小獲萬人康。", "赤帝收三傑，黃軒舉二臣。", "由來丞相重，分掌國之鈞。", "我有握中璧，雙飛席上珍。", "子房推道要，仲子訝風神。", "復輟台衡老，將爲調護人。", "鵷鸞同拜日，車騎擁行塵。", "樂聚南宮宴，觴連北斗醇。", "俾予成百揆，垂拱問彝倫。", "清蹕度河陽，凝笳上太行。", "火龍明鳥道，鐵騎繞羊腸。", "白霧埋陰壑，丹霞助曉光。", "澗泉含宿凍，山木帶餘霜。", "野老茅爲屋，樵人薜作裳。", "宣風問耆艾，敦俗勸耕桑。", "涼德慙先哲，徽猷慕昔皇。", "雜虜忽猖狂，無何敢亂常。", "羽書朝繼入，烽火夜相望。", "將出凶門勇，兵因死地強。", "蒙輪皆突騎，按劒盡鷹揚。", "鼓角雄山野，龍蛇入戰場。", "流膏潤沙漠，濺血染鋒鋩。", "霧掃清玄塞，雲開靜朔方。", "武功今已立，文德愧前王。", "代邸青門右，離宮紫陌陲。", "庭如過沛日，水若渡江時。", "綺觀連雞岫，朱樓接雁池。", "從來敦棣蕚，今此茂荆枝。", "萬葉傳餘慶，千年志不移。", "凭軒聊屬目，輕輦共追隨。", "務本方崇訓，相輝保羽儀。", "時康俗易漸，德薄政難施。", "鼓吹迎飛蓋，弦歌送羽巵。", "所希覃率土，孝弟一同規。", "端拱復垂裳，長懷御遠方。", "股肱申教義，戈劒靖要荒。", "命將綏邊服，雄圖出廟堂。", "三台入武帳，八座起文昌。", "寶胄匡韓主，華宗輔漢王。", "茂先慙博物，平子謝文章。", "盡節恢時佐，輸誠禦寇場。", "三軍臨朔野，駟馬即戎行。", "鼓吹威夷狄，旌軒溢洛陽。", "雲臺先著美，今日更貽芳。", "振武威荒服，揚文肅遠墟。", "金壇申將禮，玉節授軍符。", "免胄三方外，銜刀萬里餘。", "昔時吳會靜，今日虜庭虛。", "分閫仍推轂，援桴且訓車。", "風揚旌斾遠，雨洗甲兵初。", "坐見台階謐，行聞祅祲除。", "檄來雖插羽，箭去亦飛書。", "舟檝功須著，鹽梅望匪疎。", "不應陳七德，欲使化先敷。", "三千初擊浪，九萬欲摶空。", "天地猶驚否，陰陽始遇蒙。", "存貞期歷試，佐貳佇昭融。", "多謝時康理，良慙實賴功。", "長懷問鼎氣，夙負拔山雄。", "不學劉琨舞，先歌漢祖風。", "英髦既包括，豪傑自牢籠。", "人事一朝異，謳歌四海同。", "如何昔朱邸，今此作離宮？", "雁沼澄瀾翠，猿巖落照紅。", "小山秋桂馥，長坂舊蘭叢。", "即是淹留處，乘歡樂未窮。", "河曲回千里，關門限二京。", "所嗟非恃德，設險到天平。", "瑞露垂花綬，寒冰澈寶輸。", "對茲臺上月，聊以慶佳辰。", "啄木觜距長，鳳皇羽毛短。", "苦嫌松桂寒，任逐桑榆煖。", "仙客厭人間，孤雲比性閒。", "話離情未已，煙水萬重山。", "澄潭皎鏡石崔巍，萬壑千巖暗綠苔。", "林亭自有幽貞趣，況復秋深爽氣來。", "憶昔嬌妃在紫宸，鉛華不御得天真。", "霜綃雖似當時態，爭奈嬌波不顧人。", "伊我軒宮，奇樹青葱。", "藹周廬兮，冒霜停雪，以茂以悅。", "恣卷舒兮，連枝同榮，吐綠含英。", "曜春初兮，蓐收御節，寒露微結。", "氣清虛兮，桂宮蘭殿，唯所息宴。", "棲雍渠兮，行搖飛鳴，急難有情。", "情有餘兮，顧惟德涼，夙夜兢惶。", "慙化疎兮，上之所教，下之所效。", "實在予兮，天倫之性，魯衛分政。", "親賢居兮，爰遊爰處，爰笑爰語。", "巡庭除兮，觀此翔禽，以悅我心，良史書兮。", "刻木牽絲作老翁，雞皮鶴髮與真同。", "須臾弄罷寂無事，還似人生一夢中。", "昔見漳濱臥，言將人事違。", "今逢慶誕日，猶謂學仙歸。", "棠棣花重發，鴒原鳥再飛。", "德比代雲布，心如晉水清。", "玉殿肅肅，靈芝煌煌。", "重英發秀，連葉分房。", "宗廟之福，垂其耿光。", "元氣產芝，明神合德。", "紫微間采，白蕣呈色。", "載啓瑞圖，庶符皇極。", "天心有眷，王道惟直。", "幸生芳本，當我扆旒。", "效此靈質，賁其王猷。", "神惟不愛，道亦無求。", "端拱思惟，永荷天休。", "先生年幾許，顏色似童兒。", "夜抱九仙骨，朝披一品衣。", "不食千鍾粟，唯餐兩顆棃。", "天生此間氣，助我化無爲。", "韶年啓仲序，初吉諧良辰。", "肇茲中和節，式慶天地春。", "歡酣朝野同，生德區宇均。", "雲開灑膏露，草疏芳河津。", "歲華今載陽，東作方肆勤。", "慙非熏風唱，曷用慰吾人。", "至化恆在宥，保和茲息人。", "推誠撫諸夏，與物長爲春。", "仲月風景暖，禁城花柳新。", "芳時協金奏，賜宴同羣臣。", "絲竹豈云樂，忠賢惟所親。", "庶洽朝野意，曠然天地均。", "早衣對庭燎，躬化勤意誠。", "時此萬機暇，適與佳節幷。", "曲池潔寒流，芳菊舒金英。", "乾坤爽氣滿，臺殿秋光清。", "朝野慶年豐，高會多歡聲。", "永懷無荒戒，良士同斯情。", "雨霽霜氣肅，天高雲日明。", "繁林已墜葉，寒菊仍舒榮。", "懿此秋節時，更延追賞情。", "池臺列廣宴，絲竹傳新聲。", "至樂非外獎，浹歡同中誠。", "庶敦朝野意，永使風化清。", "牧守寄所重，才賢生爲時。", "宣風自淮甸，授鉞膺藩維。", "入覲展遐戀，臨軒慰來思。", "忠誠在方寸，感激陳情詞。", "報國爾所向，恤人予是資。", "歡宴不盡懷，車馬當還期。", "穀雨將應候，行春猶未遲。", "勿以千里遙，而云無己知。", "憂勤承聖緒，開泰喜時康。", "恭己臨羣后，垂衣御八荒。", "務閑春向暮，朝罷日猶長。", "紫殿初筵列，彤庭廣樂張。", "成功歸輔弼，致理賴忠良。", "共此歡娛事，千秋樂未央。", "獻歲視元朔，萬方咸在庭。", "端旒揖羣后，回輦閱師貞。", "綵仗宿華殿，退朝歸禁營。", "分行左右出，轉斾風雲生。", "歷歷趨複道，容容映層城。", "勇餘矜捷技，令肅無喧聲。", "眷此戎旅節，載嘉良士誠。", "順時傾宴賞，亦以助文經。", "東風變梅柳，萬彙生春光。", "中和紀月令，方與天地長。", "耽樂豈予尚，懿茲時景良。", "庶遂亭育恩，同致寰海康。", "君臣永終始，交泰符陰陽。", "曲沼水新碧，華林桃稍芳。", "勝賞信多歡，戒之在無荒。", "佳節上元巳，芳時屬暮春。", "流觴想蘭亭，捧劒得金人。", "風輕水初綠，日晴花更新。", "天文信昭回，皇道頗敷陳。", "恭己每從儉，清心常保真。", "戒茲游衍樂，書以示羣臣。", "[爽]節在重九，物華新雨餘。", "清秋黃葉下，菊散金潭初。", "萬實行就稔，百工欣所如。", "歡心暢遐邇，殊俗同車書。", "至化自敦睦，佳辰宜宴胥。", "鏘鏘間絲竹，濟濟羅簪裾。", "此樂匪足耽，此誠期永孚。", "令節曉澄霽，四郊煙靄空。", "天清白露潔，菊散黃金叢。", "寡德荷天貺，順時休百工。", "豈懷歌鐘樂，思爲君臣同。", "至化在亭育，相成資始終。", "未知康衢詠，所仰惟年豐。", "爽氣肅時令，早衣聞朔鴻。", "重陽有佳節，具物欣年豐。", "皎潔暮潭色，芬敷新菊叢。", "芳尊滿衢室，繁吹凝煙空。", "惠合信吾道，保和惟爾同。", "推誠至玄化，天下期爲公。", "招提邇皇邑，複道連重城。", "法筵會早秋，駕言訪禪扃。", "嘗聞大仙教，清淨宗無生。", "七物匪吾寶，萬行先求成。", "名相既雙寂，繁華奚所榮。", "金風扇微涼，遠煙凝翠晶。", "松院靜苔色，竹房深磬聲。", "境幽真慮恬，道勝外物輕。", "意適本非說，含毫空復情。", "芳歲肇佳節，物華當仲春。", "乾坤既昭泰，煙景含氤氳。", "德淺荷玄貺，樂成思治人。", "前庭列鐘鼓，廣殿延羣臣。", "八卦隨舞意，五音轉曲新。", "顧非咸池奏，庶協南風熏。", "式宴禮所重，浹歡情必均。", "同和諒在茲，萬國希可親。", "禁苑秋來爽氣多，昆明風動起滄波。", "中流簫鼓誠堪賞，詎假橫汾發櫂歌。", "風雲喜際會，雷雨遂流滋。", "薦幣虛陳禮，動天實精思。", "漸侵九夏節，復在三春時。", "霢霂垂朱闕，飄颻入綠墀。", "郊坰既霑足，黍稷有豐期。", "百辟同康樂，萬方佇雍熙。", "良工運精思，巧極似有神。", "臨窗忽覩繁陰合，再盼真假殊未分。", "輦路生春草，上林花發時。", "憑高何限意，無復侍臣知。", "注想待元老，識君恨不早。", "我家柱石衰，憂來學丘禱。", "上元高會集羣仙，心齋何事欲祈年。", "丹誠儻徹玉帝座，且共吾人慶大田。", "蓂生三五葉初齊，上元羽客出桃蹊。", "不愛仙家登真訣，願蒙四海福黔黎。", "人皆苦炎熱，我愛夏日長。", "熏風自南來，殿閣生微涼。", "大雄真跡枕危巒，梵宇層樓聳萬般。", "日月每從肩上過，山河長在掌中看。", "仙峰不間三春秀，靈境何時六月寒？", "更有上方人罕到，暮鐘朝磬碧雲端。", "綴玉聯珠六十年，誰教冥路作詩仙。", "浮雲不繫名居易，造化無爲字樂天。", "童子解吟《長恨曲》，胡兒能唱《琵琶篇》。", "文章已滿行人耳，一度思卿一愴然。", "雲散晴山幾萬重，煙收春色更沖融。", "帳殿出空登碧漢，遐川俯望色藍籠。", "林光入戶低韶景，嶺氣通宵展霽風。", "今日追遊何所似，莫慙漢武賞汾中。", "款塞旋征騎，和戎委廟賢。", "傾心方倚注，叶力共安邊。", "大殿連雲接爽溪，鐘聲還與鼓聲齊。", "長安若問江南事，說道風光在水西。", "千巖萬壑不辭勞，遠看方知出處高。", "溪澗豈能留得住，終歸大海作波濤。", "海岳宴咸通，七載秉鈞調四序。", "一方獄市獲來蘇。", "只解劈牛兼劈樹，不能誅惡與誅兇。", "上苑桃花朝日明，蘭閨豔妾動春情。", "井上新桃偷面色，檐邊嫩柳學身輕。", "花中來去看舞蝶，樹上長短聽啼鶯。", "林下何須遠借問，出衆風流舊有名。", "羲農首出，軒昊膺期。", "唐虞繼踵，湯禹乘時。", "天下光宅，海內雍熙。", "上玄降鑒，方建隆基。", "太陰凝至化，真耀蘊軒儀。", "德邁娥臺敞，仁高[姒]幄披。", "捫天遂啓極，夢日乃昇曦。", "瞻紫極，望玄穹。", "翹至懇，罄深衷。", "聽雖遠，誠必通。", "垂厚澤，降雲宮。", "乾儀混成沖邃，天道下濟高明。", "闓陽晨披紫闕，太一曉降黃庭。", "圜壇敢申昭報，方璧冀展虔情。", "丹襟式敷衷懇，玄鑒庶察微誠。", "巍巍叡業廣，赫赫聖基隆。", "菲德承先顧，禎符萃眇躬。", "銘開武巖側，圖薦洛川中。", "微誠詎幽感，景命忽昭融。", "有懷慙紫極，無以謝玄穹。", "朝壇霧卷，曙嶺煙沈。", "爰設筐幣，式表誠心。", "筵輝麗璧，樂暢和音。", "仰惟靈鑒，俯察翹襟。", "昭昭上帝，穆穆下臨。", "禮崇備物，樂奏鏘金。", "蘭羞委薦，桂醑盈斟。", "敢希明德，幸罄莊心。", "尊浮九醞，禮備三周。", "陳誠菲奠，契福神猷。", "奠璧郊壇昭大禮，鏘金拊石表虔誠。", "始奏承雲娛帝賞，復歌調露暢韶英。", "荷恩承顧託，執契恭臨撫。", "廟略靜邊荒，天兵曜神武。", "有截資先化，無爲遵舊矩。", "禎符降昊穹，大業光寰宇。", "肅肅祀典，邕邕禮秩。", "三獻已周，九成斯畢。", "爰撤其俎，載遷其實。", "或升或降，惟誠惟質。", "禮終肆類，樂闋九成。", "仰惟明德，敢薦非馨。", "顧慙菲奠，久馳雲軿。", "瞻荷靈澤，悚戀兼盈。", "式乾路，闢天扉。", "迴日馭，動雲衣。", "登金闕，入紫微。", "望仙駕，仰恩徽。", "總章陳昔典，衢室禮惟神。", "宏規則天地，神用叶陶鈞。", "負扆三春旦，充庭萬宇賓。", "顧己誠虛薄，空慙馭兆人。", "仰膺曆數，俯順謳歌。", "遠安邇肅，俗阜時和。", "化光玉鏡，訟息金科。", "方興典禮，永戢干戈。", "至人光俗，大孝通神。", "謙以表性，恭惟立身。", "洪規載啓，茂典方陳。", "譽隆三善，祥開萬春。", "千官肅事，萬國朝宗。", "載延百辟，爰集三宮。", "君臣德合，魚水斯同。", "睿圖方永，周曆長隆。", "禮崇宗祀，志表嚴禋。", "笙鏞合奏，文物惟新。", "敬遵茂典，敢擇良辰。", "絜誠斯著，奠謁方申。", "笙鏞間玉宇，文物昭清輝。", "晬影臨芳奠，休光下太微。", "孝思期有感，明絜庶無違。", "履艮包羣望，居中冠百靈。", "萬方資廣運，庶品荷財成。", "神功諒匪測，盛德實難名。", "藻奠申誠敬，恭祀表惟馨。", "出震位，開平秩。", "扇條風，乘甲乙。", "龍德盛，鳥星出。", "薦珪篚，陳誠實。", "赫赫離精御炎陸，滔滔熾景開隆暑。", "冀延神鑒俯蘭尊，式表虔襟陳桂俎。", "律中夷則，序應收成。", "功宣建武，義表惟明。", "爰申禮奠，庶展翹誠。", "九秋是式，百穀斯盈。", "葭律肇啓隆冬，蘋藻攸陳饗祭。", "黃鍾既陳玉燭，紅粒方殷稔歲。", "九玄眷命，三聖基隆。", "奉成先旨，明臺畢功。", "宗祀展敬，冀表深衷。", "永昌帝業，式播淳風。", "神功不測兮運陰陽，包藏萬宇兮孕八荒。", "天符既出兮帝業昌，願臨明祀兮降禎祥。", "坎澤祠容備舉，坤壇祭典爰申。", "靈睠遙行祕躅，嘉貺薦委殊珍。", "肅禮恭禋載展，翹襟邈志逾殷。", "方期交際懸應。", "祗荷坤德，欽若乾靈。", "慙惕罔寘，興居匪寧。", "恭崇禮則，肅奉儀形。", "惟憑展敬，敢薦非馨。", "菲躬承睿顧，薄德忝坤儀。", "乾乾遵後命，翼翼奉先規。", "撫俗勤雖切，還淳化尚虧。", "未能弘至道，何以契明祇。", "顧德有慙虛菲，明祇屢降禎符。", "汜水初呈祕象，溫洛薦表昌圖。", "玄澤流恩載洽，丹襟荷渥增愉。", "舒云致養，合大資生。", "德以恆固，功由永貞。", "升歌薦序，垂幣翹誠。", "虹開玉照，鳳引金聲。", "蘭俎既升，蘋羞可薦。", "金石載設，咸英已變。", "林澤斯總，山川是徧。", "敢用敷誠，實惟忘倦。", "沈潛演貺分三極，廣大凝禎總萬方。", "既薦羽旌文化啓，還呈干戚武威揚。", "夕惕同龍契，晨兢當鳳扆。", "崇儒習舊規，偃伯循先旨。", "絕壤飛冠蓋，遐區麗山水。", "幸承三聖餘，忻屬千年始。", "百禮崇容，千官肅事。", "靈降舞兆，神凝有粹。", "奠享咸周，威儀畢備。", "奏夏登列，歌雍撤肆。", "皇皇靈睠，穆穆神心。", "暫動凝質，還歸積陰。", "功玄樞紐，理寂高深。", "銜恩佩德，聳志翹襟。", "言旋雲洞兮躡煙塗，永寧中宇兮安下都。", "包涵動植兮順榮枯，長貽寶貺兮贊璇圖。", "調雲闋兮神座興，驂雲駕兮儼將升。", "騰絳霄兮垂景祜，翹丹懇兮荷休徵。", "先德謙撝冠昔，嚴規節素超今。", "奉國忠誠每竭，承家至孝純深。", "追崇懼乖尊意，顯號恐玷徽音。", "既迫王公屢請，方乃俯遂羣心。", "有限無由展敬，奠醑每闕親斟。", "大禮虔申典冊，蘋藻敬薦翹襟。", "九春開上節，千門敞夜扉。", "蘭燈吐新燄，桂魄朗圓輝。", "送酒惟須滿，流杯不用稀。", "務使霞漿興，方乘汎洛歸。", "山窗遊玉女，澗戶對瓊峰。", "巖頂翔雙鳳，潭心倒九龍。", "酒中浮竹葉，杯上寫芙蓉。", "故驗家山賞，惟有風入松。", "高人叶高志，山服往山家。", "迢迢間風月，去去隔煙霞。", "碧岫窺玄洞，玉竈鍊丹砂。", "今日星津上，延首望靈槎。", "陪鑾遊禁苑，侍賞出蘭闈。", "雲偃攢峰蓋，霞低插浪旂。", "日宮疏澗戶，月殿啓巖扉。", "金輪轉金地，香閣曳香衣。", "鐸吟輕吹發，幡搖薄霧霏。", "昔遇焚芝火，山紅連野飛。", "花臺無半影，蓮塔有全輝。", "實賴能仁力，攸資善世威。", "慈緣興福緒，於此罄歸依。", "風枝不可靜，泣血竟何追。", "三山十洞光玄籙，玉嶠金巒鎮紫微。", "均露均霜標勝壤，交風交雨列皇畿。", "萬仞高巖藏日色，千尋幽澗浴雲衣。", "且駐歡筵賞仁智，琱鞍薄晚雜塵飛。", "明朝遊上苑，火急報春知。", "花須連夜發，莫待曉風吹。", "看朱成碧思紛紛，顦顇支離爲憶君。", "不信比來長下淚，開箱驗取石榴裙。", "敷政術，守清勤。", "升顯位，勵相臣。", "仰幽巖而流盼，撫桂枝以凝想。", "將千齡兮此遇，荃何爲兮獨往。", "舊愛柏梁臺，新寵昭陽殿。", "守分辭芳輦，含情泣團扇。", "一朝歌舞榮，夙昔詩書賤。", "頹恩誠已矣，覆水難重薦。", "秋風起函谷，勁氣動河山。", "偃松千嶺上，雜雨二陵間。", "低雲愁廣隰，落日慘重關。", "此時飄紫氣，應驗真人還。", "由來稱獨立，本自號傾城。", "柳葉眉間發，桃花臉上生。", "腕搖金釧響，步轉玉環鳴。", "纖腰宜寶袜，紅衫豔織成。", "懸知一顧重，別覺舞腰輕。", "朝來臨鏡臺，粧罷暫裴回。", "千金始一笑，一召詎能來。", "密葉因裁吐，新花逐翦舒。", "攀條雖不謬，摘橤詎知虛。", "春至由來發，秋還未肯疎。", "帝里重陽節，香園萬乘來。", "卻邪萸入佩，獻壽菊傳杯。", "墖類承天湧，門疑待佛開。", "睿詞懸日月，長得仰昭回。", "葉下洞庭初，思君萬里餘。", "露濃香被冷，月落錦屏虛。", "欲奏江南曲，貪封薊北書。", "書中無別意，惟悵久離居。", "釋子談經處，軒臣刻字留。", "故臺遺老識，殘簡聖皇求。", "駐蹕懷千古，開襟望九州。", "四山緣塞合，二水夾城流。", "宸翰陪瞻仰，天杯接獻酬。", "太平詞藻盛，長願紀鴻休。", "三冬季月景[龍]年，萬乘觀風出灞川。", "遙看電躍龍爲馬，回矚霜原玉作田。", "鸞旂掣曳拂空回，羽騎驂驔躡景來。", "隱隱驪山雲外聳，迢迢御帳日邊開。", "翠幕珠幃敞月營，金罍玉斝泛蘭英。", "歲歲年年常扈蹕，長長久久樂升平。", "逐仙賞，展幽情。", "踰崑閬，邁蓬瀛。", "遊魯館，陟秦臺。", "汚山壁，媿瓊瓌。", "檀欒竹影，飆䫻松聲。", "不煩歌吹，自足娛情。", "仰循茅宇，俯眄喬枝。", "煙霞問訊，風月相知。", "枝條鬱鬱，文質彬彬。", "山林作伴，松桂爲鄰。", "清波洶湧，碧樹冥蒙。", "莫怪留步，因攀桂叢。", "莫論圓嶠，休說方壺。", "何如魯館，即是仙都。", "玉環騰遠創，金埒荷殊榮。", "弗玩珠璣飾，仍留仁智情。", "鑿山便作室，憑樹即爲楹。", "公輸與班爾，從此遂韜聲。", "登山一長望，正遇九春初。", "結駟填街術，閭閻滿邑居。", "鬬雪梅先吐，驚風柳未舒。", "直愁斜日落，不畏酒尊虛。", "霽曉氣清和，披襟賞薜蘿。", "玳瑁凝春色，琉璃漾水波。", "跂石聊長嘯，攀松乍短歌。", "除非物外者，誰就此經過。", "暫爾遊山第，淹留惜未歸。", "霞窗明月滿，澗戶白雲飛。", "書引藤爲架，人將薜作衣。", "此真攀玩所，臨睨賞光輝。", "放曠出煙雲，蕭條自不羣。", "漱流清意府，隱几避嚻氛。", "石畫妝苔色，風梭織水文。", "山室何爲貴？唯餘蘭桂熏。", "策杖臨霞岫，危步下霜蹊。", "志逐深山靜，途隨曲澗迷。", "漸覺心神逸，俄看雲霧低。", "莫怪人題樹，祗爲賞幽棲。", "攀藤招逸客，偃桂協幽情。", "水中看樹影，風裏聽松聲。", "攜琴侍叔夜，負局訪安期。", "不應題石壁，爲記賞山時。", "泉石多仙趣，巖壑寫奇形。", "欲知堪悅耳，唯聽水泠泠。", "巖壑恣登臨，瑩目復怡心。", "風篁類長笛，流水當鳴琴。", "嬾步天台路，惟登地肺山。", "幽巖仙桂滿，今日恣情攀。", "暫遊仁智所，蕭然松桂情。", "寄言棲遯客，勿復訪蓬瀛。", "瀑溜晴疑雨，叢篁晝似昏。", "山中真可玩，暫請報王孫。", "傍池聊試筆，倚石旋題詩。", "豫彈山水調，終擬從鍾期。", "橫鋪豹皮褥，側帶鹿胎巾。", "借問何爲者，山中有逸人。", "沁水田園先自多，齊城樓觀更無過。", "倩語張騫莫辛苦，人今從此識天河。", "參差碧岫聳蓮花，潺湲綠水瑩金沙。", "何須遠訪三山路，人今已到九仙家。", "憑高瞰險足怡心，菌閣桃源不暇尋。", "餘雪依林成玉樹，殘霙點岫即瑤岑。", "勢如連璧友，心似臭蘭人。", "羅袖動香香不已，紅蕖褭褭秋煙裏。", "輕雲嶺上乍搖風，嫩柳池邊初拂水。", "桂葉雙眉久不描，殘妝和淚汚紅綃。", "長門盡日無梳洗，何必珍珠慰寂寥。", "種瓜黃臺下，瓜熟子離離。", "一摘使瓜好，再摘使瓜稀。", "三摘猶自可，摘絕抱蔓歸。", "乾象開層構，離明啓少陽。", "卜征從獻吉，守器屬元良。", "逖矣凌周誦，遙哉掩漢莊。", "好士傾南洛，多才盛北場。", "地分丹鷲嶺，途間白雲鄉。", "儲誠虔曉夕，宸愛積炎涼。", "珠璧連霄漢，萬物仰重光。", "鳳輦騰宸駕，驪籞次乾遊。", "坎德疎溫液，山隈派暖流。", "寒氛空外擁，蒸氣沼中浮。", "林凋帷影散，雲斂蓋陰收。", "霜郊暢玄覽，參差落景遒。", "別有經行所，迥跨重巒側。", "粵因求瘼餘，倏想尋真域。", "放情恣披拂，杖策聊□□。", "□□□□□，□□□□色。", "亂幡霧中見，雁塔雲間識。", "薄煙冪遠郊，遙峰沒歸翼。", "仙橋危石架，幽洞乘□□。", "□□□□□，□□□易測。", "二教無先後，一相平而直。", "冀茲捐俗心，永懷依妙力。", "出嫁辭鄉國，由來此別難。", "聖恩愁遠道，行路泣相看。", "沙塞容顏盡，邊隅粉黛殘。", "妾心何所斷，他日望長安。", "十二層樓倚翠空，鳳鸞相對立梧桐。", "雙成走報監門衛，莫使吳歈入漢宮。", "垂衣臨八極，肅穆四門通。", "自是無爲化，非關輔弼功。", "修文招隱伏，尚武殄妖兇。", "德炳韶光熾，恩霑雨露濃。", "衣冠陪御宴，禮樂盛朝宗。", "萬壽稱觴舉，千年信一同。", "端拱承休命，時清荷聖皇。", "四聰聞受諫，五服遠朝王。", "景媚鶯初囀，春殘日更長。", "命筵多濟濟，盛樂復鏘鏘。", "酆鎬誰將敵，橫汾未可方。", "願齊山嶽壽，祉福永無疆。", "睿澤先寰海，功成展武韶。", "戈鋋清外壘，文物盛中朝。", "聖祚山河固，宸章日月昭。", "玉筵鸞鵠集，仙管鳳皇調。", "御柳新低綠，宮鶯乍囀嬌。", "願將[億]兆慶，千祀奉神堯。", "高高秋月明，北照遼陽城。", "塞迥光初滿，風多暈更生。", "征人望鄉思，戰馬聞鼙驚。", "朔風悲邊草，胡沙暗虜營。", "霜凝匣中劒，風憊原上旌。", "早晚謁金闕，不聞刁斗聲。", "枝上花，花下人，可憐顏色俱青春。", "昨日看花花灼灼，今朝看花花欲落。", "不如盡此花下歡，莫待春風總吹卻。", "鶯歌蝶舞韶光長，紅爐煑茗松花香。", "妝成罷吟恣遊後，獨把芳枝歸洞房。", "閑朝向曉出簾櫳，茗宴東亭四望通。", "遠眺城池山色裏，俯聆絃管水聲中。", "幽篁引沼新抽翠，芳槿低檐欲吐紅。", "坐久此中無限興，更憐團扇起清風。", "昨日夢君歸，賤妾下鳴機。", "極知意氣薄，不著去時衣。", "故言如夢裏，賴得雁書飛。", "一點分明值萬金，開時惟怕冷風侵。", "主人若也勤挑撥，敢向尊前不盡心。", "蓼花蘸水火不滅，水鳥驚魚銀梭投。", "滿目荷花千萬頃，紅碧相雜敷清流。", "孫武已斬吳宮女，琉璃池上佳人頭。", "珠簾高卷莫輕遮，往往相逢隔歲華。", "春氣昨宵飄律管，東風今日放梅花。", "素姿好把芳姿掩，落勢還同舞勢斜。", "坐有賓朋尊有酒，可憐清味屬儂家。", "靈槎思浩蕩，老鶴倚崆峒。", "蒼苔迷古道，紅葉亂朝霞。", "棲鳳枝梢猶輭弱，化龍形狀已依稀。", "晚雨秋陰酒乍醒，感時心緒杳難平。", "黃花冷落不成豔，紅葉颼飀競鼓聲。", "背世返能厭俗態，偶緣猶未忘多情。", "自從雙鬢斑斑白，不學安仁卻自驚。", "殘鶯何事不知秋，橫過幽林尚獨遊。", "老舌百般傾耳聽，深黃一點入煙流。", "棲遲背世同悲魯，瀏亮如笙碎在緱。", "莫更留連好歸去，露華淒冷蓼花愁。", "山舍初成病乍輕，杖藜巾褐稱閑情。", "爐開小火深回暖，溝引新流幾曲聲。", "暫約彭涓安朽質，終期宗遠問無生。", "誰能役役塵中累，貪合魚龍搆強名。", "且維輕舸更遲遲，別酒重傾惜解攜。", "浩浪侵愁光蕩漾，亂山凝恨色高低。", "君馳檜楫情何極，我凭闌干日向西。", "咫尺煙江幾多地，不須懷抱重淒淒。", "江南江北舊家鄉，三十年來夢一場。", "吳苑宮闈今冷落，廣陵臺殿已荒涼。", "雲籠遠岫愁千片，雨打歸舟淚萬行。", "兄弟四人三百口，不堪閑坐細思量。", "珠碎眼前珍，花凋世外春。", "未銷心裏恨，又失掌中身。", "玉笥猶殘藥，香匳已染塵。", "前哀將後感，無淚可霑巾。", "豔質同芳樹，浮危道略同。", "正悲春落實，又苦雨傷叢。", "穠麗今何在？飄零事已空。", "沈沈無問處，千載謝東風。", "永念難消釋，孤懷痛自嗟。", "雨深秋寂莫，愁引病增加。", "咽絕風前思，昏濛眼上花。", "空王應念我，窮子正迷家。", "又見桐花發舊枝，一樓煙雨暮淒淒。", "凭闌惆悵人誰會，不覺澘然淚眼低。", "層城無復見嬌姿，佳節纏哀不自持。", "空有當年舊煙月，芙蓉城上哭蛾眉。", "殷勤移植地，曲檻小闌邊。", "共約重芳日，還憂不盛妍。", "阻風開步障，乘月溉寒泉。", "誰料花前後，蛾眉卻不全。", "失却煙花主，東君自不知。", "清香更何用，猶發去年枝。", "浮生共顦顇，壯歲失嬋娟。", "汗手遺香漬，痕眉染黛煙。", "侁自肩如削，難勝數縷絛。", "天香留鳳尾，餘煖在檀槽。", "顦顇年來甚，蕭條益自傷。", "風威侵病骨，雨氣咽愁腸。", "夜鼎唯煎藥，朝髭半染霜。", "前緣竟何似，誰與問空王。", "病身堅固道情深，宴坐清香思自任。", "月照靜居唯擣藥，門扃幽院只來禽。", "庸醫嬾聽詞何取，小婢將行力未禁。", "賴問空門知氣味，不然煩惱萬塗侵。", "風情漸老見春羞，到處消魂感舊遊。", "多謝長條似相識，強垂煙態拂人頭。", "牙籤萬軸裹紅綃，王粲書同付火燒。", "不於祖龍留面目，遺篇那得到今朝。", "迢迢牽牛星，杳在河之陽。", "粲粲黃姑女，耿耿遙相望。", "鸎狂應有恨，蝶舞已無多。", "揖讓月在手，動搖風滿懷。", "病態如衰弱，厭厭向五年。", "衰顏一病難牽復，曉殿君臨頗自羞。", "冷笑秦皇經遠略，靜憐姬滿苦時巡。", "鬢從今日添新白，菊是去年依舊黃。", "萬古到頭歸一死，醉鄉葬地有高原。", "人生不滿百，剛作千年畫。", "日暎仙雲薄，秋高天碧深。", "烏照始潛輝，龍燭便爭秉。", "凝珠滿露枝，遊颺日已西。", "肅穆寒初至，九重開扇鵠。", "四牖炳燈魚，羽觴無算酌。", "傾盌更爲壽，深卮遞酬賓。", "綠影覆幽池，芳菲四月時。", "管弦朝夕興，組繡百千枝。", "盛引牆看徧，高煩架屢移。", "露輕濡綵筆，蜂誤拂吟髭。", "日照玲瓏幔，風搖翡翠帷。", "早紅飄蘚地，狂蔓挂蛛絲。", "嫩刺牽衣細，新條窣草垂。", "晚香難暫捨，嬌態自相窺。", "深淺分前後，榮華互盛衰。", "尊前留客久，月下欲歸遲。", "何處繁臨砌？誰家密映籬。", "絳羅房燦爛，碧玉葉參差。", "分得殷勤種，開來遠近知。", "晶熒歌袖袂，柔弱舞腰支。", "膏麝誰將比，庭萱自合嗤。", "勻妝低水鑑，泣淚滴煙𩅰。", "畫擬憑梁廣，名宜亞楚姬。", "寄君十八韻，思拙媿新奇。", "竹林二君子，盡日竟沈吟。", "相對終無語，爭先各有心。", "恃強斯有失，守分固無侵。", "若算機籌處，滄滄海未深。", "丱歲便將爲肘腋，二紀何曾離一日。", "更深猶尚立案前，敷奏柔和不傷物。", "今朝榮貴慰我心，雙旌引向重城出。", "褒斜舊地委勳賢，從此生靈永泰息。", "喬巖簇冷煙，幽徑上寒天。", "下瞰峨眉嶺，上窺華岳巔。", "驅馳非取樂，按幸爲憂邊。", "此去如登陟，歌樓路幾千。", "緩轡踰雙劒，行行躡石稜。", "作千尋壁壘，爲萬祀依憑。", "道德雖無取，江山粗可矜。", "回看城闕路，雲疊樹層層。", "先朝神武力開邊，畫斷封疆四五千。", "前望隴山屯劒戟，後憑巫峽鎖烽煙。", "軒皇尚自親平寇，嬴政徒勞愛學仙。", "想到隗宮尋勝處，正應鶯語暮春天。", "輝輝赫赫浮玉雲，宣華池上月華新。", "月華如水浸宮殿，有酒不醉真癡人。", "者邊走，那邊走，只是尋花柳。", "那邊走，者邊走，莫厭金杯酒。", "不緣朝闕去，好此結茅廬。", "三節還鄉兮挂錦衣，碧天朗朗兮愛日暉。", "功成道上兮列旌旗，父老遠來兮相追隨。", "家山鄉眷兮會時稀，今朝設宴兮觥散飛。", "斗牛無孛兮民無欺，吳越一王兮駟馬歸。", "沒了期，沒了期，營基纔了又倉基。", "沒了期，沒了期，春衣纔了又冬衣。", "須將一片地，付與有心人。", "黃河信有澄清日，後代應難繼此才。", "傳語龍王幷水府，錢塘借與築錢城。", "廊廡周遭翠幕遮，禁林深處絕喧譁。", "界開日影憐窗紙，穿破苔痕惡筍芽。", "西第晚宜供露茗，小池寒欲結冰花。", "謝公未是深沈量，猶把輸贏局上誇。", "冰肌玉骨清無汗，水殿風來暗香暖。", "簾開明月獨窺人，敧枕釵橫雲鬢亂。", "起來瓊戶寂無聲，時見疎星渡河漢。", "屈指西風幾時來，只恐流年暗中換。", "春色曾看紫陌頭，亂紅飛盡不禁愁。", "人情自厭芳華歇，一葉隨風落御溝。", "早與元妃慕至化，同躋靈嶽訪真仙。", "當時信有壺中景，今日親來洞裏天。", "儀仗影空寥廓外，金絲聲揭翠微巔。", "惟慙未致華胥理，徒卜升平萬萬年。", "千尋綠嶂夾流溪，登眺因知海岳低。", "瀑布迸舂青石碎，輪茵橫翦翠峰齊。", "步黏苔蘚龍橋滑，日閉煙羅鳥徑迷。", "莫道穹天無路到，此山便是碧雲梯。", "聖帝歸梧野，躬來謁聖顏。", "旋登三徑路，似陟九嶷山。", "日照堆嵐迥，雲橫積翠間。", "期修封禪禮，方俟再躋攀。", "再到金華頂，玄都訪道回。", "雲披分景象，黛鎖顯樓臺。", "雨滌前山淨，風吹去路開。", "翠屏夾流水，何必羨蓬萊。", "周回雲水遊丹景，因與真妃眺上方。", "晴日曉升金晃曜，寒泉夜落玉丁當。", "松梢月轉琴栖影，柏徑風牽麝食香。", "虔煠六銖宜鑄祝，惟祈聖祉保遐昌。", "尋真游勝境，巡禮到陽平。", "水遠波瀾碧，山高氣象清。", "殿嚴孫氏貌，碑暗係師名。", "夜月登壇醮，松風森磬聲。", "虔禱游靈境，元妃夙志同。", "玉香焚靜夜，銀燭炫遼空。", "泉漱雲根月，鐘敲檜杪風。", "印金標聖迹，飛石顯神功。", "滿望天涯極，平臨日脚紅。", "猿來齋石上，僧集講筵中。", "頓作超三界，渾疑證六通。", "願成修偃化，社稷保延洪。", "周遊靈境散幽情，千里江山暫得行。", "所恨風光看未足，卻驅金翠入龜城。", "獲陪翠輦喜殊常，同涉仙壇豈厭長。", "不羨乘鸞入煙霧，此中便是五雲鄉。", "登尋丹壑到玄都，接日紅霞照座隅。", "即向周回巖下看，似看曾進畫圖無。", "共謁御容儀，還同在禁闈。", "笙歌喧寶殿，彩仗耀金徽。", "清淚霑羅袂，紅霞拂繡衣。", "九疑山水遠，無路繼湘妃。", "碧煙紅霧漾人衣，宿霧蒼苔石徑危。", "風巧解吹松上曲，蝶嬌頻采臉邊脂。", "同尋僻境思攜手，暗指遙山學畫眉。", "好把身心清淨處，角冠霞帔事希夷。", "丹景山頭宿梵宮，玉輪金輅駐虛空。", "軍持無水注寒碧，蘭若有花開晚紅。", "武士盡排青嶂下，內人皆在講筵中。", "我家帝子傳王業，積善終期四海同。", "雲浮翠輦屆陽平，真似驂鸞到上清。", "風起半厓聞虎嘯，雨來當面見龍行。", "晚尋水澗聽松韻，夜上星壇看月明。", "長恐前身居此境，玉皇教向錦城生。", "聖燈千萬炬，旋向碧空生。", "細雨溼不暗，好風吹更明。", "磬敲金地響，僧唱梵天聲。", "若說無心法，此光如有情。", "翠驛紅亭近玉京，夢魂猶是在青城。", "比來出看江山景，却被江山看出行。", "上靈睠命膺會昌，盛德殷薦叶辰良。", "景福降兮聖德遠，玄化穆兮天曆長。", "穆穆我后，道應千齡。", "登三處大，得一居貞。", "禮惟崇德，樂以和聲。", "百神仰止，天下文明。", "闓陽播氣，甄曜垂明。", "有赫圜宰，深仁曲成。", "日麗蒼璧，煙開紫營。", "聿遵乾享，式降鴻禎。", "欽惟大帝，[載]仰皇穹。", "始命田燭，爰啓郊宮。", "雲門駭聽，雷鼓鳴空。", "神其介祀，景祚斯融。", "八音斯奏，三獻畢陳。", "寶祚惟永，暉光日新。", "疊璧凝影皇壇路，編珠流彩帝郊前。", "已奏黃鍾歌大呂，還符寶曆祚昌年。", "昔在炎運終，中華亂無象。", "酆郊赤烏見，邙山黑雲上。", "大賚下周車，禁暴開殷網。", "幽明同叶贊，鼎祚齊天壤。", "歌奏畢兮禮獻終，六龍馭兮神將昇。", "明德感兮非黍稷，降福簡兮祚休徵。", "蘋蘩禮著，黍稷誠微。", "音盈鳳管，彩駐龍旂。", "洪歆式就，介福攸歸。", "送樂有闋，靈馭遄飛。", "大陰凝至化，真耀蘊軒儀。", "德邁娥臺敞，仁高姒幄披。", "圓壇敢[申]昭報，方璧冀展虔情。", "丹禁式敷衷懇，玄鑒庶察微誠。", "巍巍睿業廣，赫赫聖基隆。", "敢希[明]德，聿罄莊心。", "樽浮九醞，禮備三周。", "廟畧靜邊荒，天兵耀神武。", "或升或降，唯誠唯質。", "顧慙菲奠，久駐雲軿。", "天之曆數歸睿唐，顧惟菲德欽昊蒼。", "撰吉日兮表殷薦，冀神鑒兮降闓陽。", "恭臨寶位，肅奉瑤圖。", "恆思解網，每軫泣辜。", "德慙巢燧，化劣唐虞。", "期我良弼，式贊嘉謨。", "得一流玄澤，通三御紫宸。", "遠叶千齡運，遐銷九域塵。", "絕瑞駢闐集，殊祥絡繹臻。", "登年慶棲畝，稔歲賀盈囷。", "悠哉廣覆，大矣曲成。", "九玄著象，七曜貞明。", "珪璧是奠，醞酎斯盈。", "作樂崇德，爰暢咸英。", "郊壇展敬，嚴配因心。", "孤竹簫管，空桑瑟琴。", "肅穆大禮，鏗鏘八音。", "恭惟上帝，希降靈歆。", "九成爰奏，三獻式陳。", "欽承景福，恭託明禋。", "坤元光至德，柔訓闡皇風。", "芣苡芳聲遠，螽斯美化隆。", "睿範超千載，嘉猷備六宮。", "肅恭陪盛典，欽若薦禋宗。", "三靈降饗，三后配神。", "虔敷藻奠，敬展郊禋。", "已陳粢盛敷嚴祀，更奏笙鏞協雅聲。", "璇圖寶曆欣寧謐，晏俗淳風樂太平。", "堂堂聖祖興，赫赫昌基泰。", "戎車盟津偃，玉帛塗山會。", "舜日啓祥暉，堯雲卷征斾。", "風猷被有截，聲教覃無外。", "至矣丕搆，烝哉太平。", "授犧膺籙，復禹繼明。", "草木仁化，鳧鷖頌聲。", "祀宗陳德，無媿斯誠。", "郊壇齋帝，禮樂祀天。", "丹青寰宇，宮徵山川。", "神祇畢降，行止重旋。", "融融穆穆，納祉洪延。", "止奏潛聆，登儀宿囀。", "太玉躬奉，參鍾首奠。", "簠簋聿昇，犧牲遰薦。", "昭事顒若，存存以俔。", "爛雲普洽，律風無外。", "千品其凝，九賓斯會。", "禋尊晉燭，純犧滌汰。", "玄覆攸廣，鴻休汪濊。", "六變爰闋，八階載虔。", "祐我皇祚，於萬斯年。", "於赫聖祖，龍飛晉陽。", "底定萬國，奄有四方。", "功格上下，道冠農黃。", "郊天配享，德合無疆。", "崇崇泰畤，肅肅嚴禋。", "粢盛既潔，金石畢陳。", "上帝來享，介福爰臻。", "受釐合祉，寶祚維新。", "祝史正辭，人神叶慶。", "福以德招，享以誠應。", "六變云備，百禮斯浹。", "祀事孔明，祚流萬葉。", "馨香惟后德，明命光天保。", "肅和崇聖靈，陳信表皇道。", "玉鏚初蹈厲，金匏既靜好。", "大號成命，思文配天。", "神光肸蠁，龍駕言旋。", "眇眇閶闔，昭昭上玄。", "俾昌而大，於斯萬年。", "六成既闋，三薦云終。", "神心具醉，聖敬愈崇。", "受釐皇邸，回蹕帷宮。", "穰穰之福，永永無窮。", "款泰壇，柴泰清。", "受天命，報天成。", "竦皇心，薦樂聲。", "志上達，歌下迎。", "億上帝，臨下庭。", "騎日月，陪列星。", "嘉祝信，大糦馨。", "澹神心，醉皇靈。", "相百辟，貢八荒。", "九歌敍，萬舞翔。", "肅振振，鏗皇皇。", "帝欣欣，福穰穰。", "高在上，道光明。", "物資始，德難名。", "承眷命，牧蒼生。", "寰宇謐，太階平。", "天道無親，至誠與鄰。", "山川遍禮，宮徵維新。", "玉帛非盛，聰明會真。", "正斯一德，通乎百神。", "饗帝饗親，維孝維聖。", "緝熙懿德，敷揚成命。", "華夷志同，笙鏞禮盛。", "明靈降止，感此誠敬。", "孝敬中發，和容外彰。", "騰華照宇，如昇太陽。", "貞璧就奠，玄靈垂光。", "禮樂具舉，濟濟洋洋。", "奠祖配天，承天享帝。", "百靈咸秩，四海來祭。", "植我蒼璧，布我玄製。", "華日裴回，神煙容裔。", "俎豆有馥，粢盛潔豐。", "亦有和羹，既戒既平。", "鐘鼓管磬，肅唱和鳴。", "皇皇后祖，來我思成。", "烝烝我后，享獻惟夤。", "躬酌鬱鬯，跪奠明神。", "孝莫孝乎，配上帝親。", "敬莫敬乎，教天下臣。", "皇祖嚴配，配享皇天。", "皇皇降嘏，天子萬年。", "六鐘翕協六變成，八佾倘佯八風生。", "樂九[韶]兮人神感，美七德兮天地清。", "烈祖順三靈，文宗威四海。", "黃鉞誅羣盜，朱旗掃多罪。", "戢兵天下安，約法人心改。", "大哉干羽意，長見風雲在。", "樂已終，[煙]燎上。", "懷靈惠，結皇想。", "歸風疾，迴風爽。", "百[福]來，衆神往。", "履艮斯繩，居中體正。", "龍運垂祉，昭符啓聖。", "式事嚴禋，聿懷嘉慶。", "惟帝永錫，時皇休命。", "殷薦乘春，太壇臨曙。", "八簋盈和，六瑚登御。", "嘉稷匪歆，德馨斯飫。", "祝嘏無易，靈心有豫。", "玉帛犧牲申敬享，金絲鏚羽盛音容。", "庶俾億齡禔景福，長欣萬宇洽時邕。", "象天御宇，乘時布政。", "嚴配申虔，宗禋展敬。", "罇罍盈列，樹羽交映。", "玉幣通誠，祚隆皇聖。", "八牖晨披，五精朝奠。", "霧凝璇篚，風清金縣。", "神滌備全，明粢豐衍。", "載絜彝俎，陳誠以薦。", "御扆合宮承寶曆，席圖重館奉明靈。", "偃武修文九圍泰，沈烽靜柝八荒寧。", "顧己誠虛薄，空慙億兆人。", "笙鏞合奏，文物維新。", "笙鏞間玉宇，文物昭清暉。", "睟影臨芳奠，休光下太微。", "冀延神鑒俯蘭罇，式表虔襟陳桂俎。", "朱鳥開辰，蒼龍啓映。", "大帝昭饗，羣生展敬。", "禮備懷柔，功宣舞詠。", "旬液應序，年祥協慶。", "紺筵分彩，珤圖吐絢。", "風管晨凝，雲歌曉囀。", "肅事蘭羞，虔申桂奠。", "百穀斯登，萬箱攸薦。", "鳳曲登歌調令序，龍雩集舞汎祥風。", "綵旞雲迴昭睿德，朱干電發表神功。", "鳥緯遷序，龍星見辰。", "純陽在律，明德崇禋。", "五方降帝，萬宇安人。", "恭以致享，肅以迎神。", "祀遵經設，享緣誠舉。", "獻畢于樽，徹臨于俎。", "舞止干戚，樂停柷敔。", "歌以送神，神還其所。", "黃中正位，含章居貞。", "既長六律，兼和五聲。", "畢陳萬舞，乃薦斯牲。", "神其下降，永祚休平。", "眇眇方輿，蒼蒼圜蓋。", "至哉樞紐，宅中圖大。", "氣調四序，風和萬籟。", "祚我明德，時雍道泰。", "金縣夕肆，玉俎朝陳。", "饗薦黃道，芬流紫宸。", "迺誠迺敬，載享載禋。", "崇薦斯在，惟皇是賓。", "御徵乘宮出郊甸，安歌率舞遞將迎。", "自有雲門符帝賞，猶持雷鼓答天成。", "鶴雲旦起，鳥星昏集。", "律候新風，陽開初蟄。", "至德可饗，行潦斯挹。", "錫以無疆，蒸人乃粒。", "玄鳥司春，蒼龍登歲。", "節物變柳，光風轉蕙。", "瑤席降神，朱弦饗帝。", "誠備祝嘏，禮殫珪幣。", "大樂稀音，至誠簡禮。", "文物棣棣，聲明濟濟。", "六變有成，三登無體。", "乃眷豐潔，恩覃愷悌。", "笙歌籥舞屬年韶，鷺鼓鳧鐘展時豫。", "調露初迎綺春節，承雲遽踐蒼霄馭。", "青陽告謝，朱明戒序。", "延長是祈，敬陳椒醑。", "博碩斯薦，笙鏞備舉。", "庶盡肅恭，非馨稷黍。", "離位克明，火中宵見。", "峰雲暮起，景風晨扇。", "木槿初榮，含桃可薦。", "芬馥百品，鏗鏘三變。", "昭昭丹陸，奕奕炎方。", "禮陳牲幣，樂備篪簧。", "瓊羞溢俎，玉醑浮觴。", "恭惟正直，歆此馨香。", "千里溫風飄絳羽，十枝炎景賸朱干。", "陳觴薦俎歌二獻，拊石摐金會七盤。", "白藏應節，天高氣清。", "歲功既阜，庶類收成。", "萬方靜謐，九土和平。", "馨香是薦，受祚聰明。", "金行在節，素靈居正。", "氣肅霜嚴，林彫草勁。", "豺祭隼擊，潦收川鏡。", "九穀已登，萬箱流詠。", "律應西成，氣躔南呂。", "珪幣咸列，笙竽備舉。", "苾苾蘭羞，芬芬桂醑。", "式資宴貺，用調霜序。", "璿儀氣爽驚緹籥，玉呂灰飛含素商。", "鳴鞞奏管芳羞薦，會舞安歌葆眊揚。", "嚴冬季月，星迴風厲。", "享祀報功，方祚來歲。", "律回玉琯，星周金度。", "次極陽烏，紀窮陰兔。", "火林霰雪，陽泉凝冱。", "八蜡已登，三農息務。", "陽月斯紀，應鍾在候。", "載潔牲牷，爰登俎豆。", "既高既遠，無聲無臭。", "靜言格思，惟神保祐。", "執籥持羽初終曲，朱干玉鏚始分行。", "七德九功咸已暢，明靈降福具穰穰。", "朱明季序，黃郊王辰。", "厚以載物，甘以養人。", "毓金爲體，稟火成身。", "宮音式奏，奏以迎神。", "春末冬暮，徂夏杪秋。", "土王四月，時季一周。", "黍稷已享，籩豆宜收。", "送神有樂，神其賜休。", "緹幕移候，青郊啓蟄。", "淑景遲遲，和風習習。", "璧玉宵備，旌旄曙立。", "張樂以迎，帝神其入。", "文物流彩，聲明動色。", "人竭其恭，靈昭其飭。", "歆薦不已，垂禎無極。", "送禮有章，惟神還軾。", "青陽節謝，朱明候改。", "靡草彫華，含桃流彩。", "虡列鐘磬，筵陳脯醢。", "樂以迎神，神其如在。", "炎精式降，蒼生攸仰。", "羞列豆籩，酒陳犧象。", "昭祀有應，冥期不爽。", "送樂張音，惟靈之往。", "序移玉律，節應金商。", "天嚴殺氣，吹警秋方。", "槱燎既積，稷奠並芳。", "樂以迎奏，庶降神光。", "祀遵五禮，時屬三秋。", "人懷肅敬，靈降禎休。", "奠歆旨酒，薦享珍羞。", "載張送樂，神其上遊。", "玄英戒序，黑郊臨候。", "掌禮陳彝，司筵執豆。", "寒氛斂色，沍泉凝漏。", "樂以迎神，八音斯奏。", "北郊時冽，南陸輝處。", "奠本虔誠，獻彌恭慮。", "上延祉福，下承歡豫。", "廣樂送神，神其整馭。", "惟聖格天，惟明饗日。", "帝郊肆類，王宮戒吉。", "珪奠春舒，鐘歌曉溢。", "禮云克備，斯文有秩。", "晨儀式薦，明祀惟光。", "神物爰止，靈暉載揚。", "玄端肅事，紫幄興祥。", "福履攸假，於昭允王。", "崇牙樹羽延調露，旋宮扣律掩承雲。", "誕敷懿德昭神武，載集豐功表睿文。", "太陽朝序，王宮有儀。", "蟠桃彩駕，細柳光馳。", "軒祥表合，漢曆彰奇。", "禮和樂備，神其降斯。", "五齊兼酌，百羞具陳。", "樂終廣奏，禮畢崇禋。", "明鑑萬宇，照臨兆人。", "永流洪慶，式動曦輪。", "測妙爲神，通微曰聖。", "坎祀貽則，郊禋展敬。", "璧薦登光，金歌動映。", "以載嘉德，以流曾慶。", "朏晨爭舉，天宗禮闢。", "夜典涼秋，陰明湛夕。", "有𨣧斯旨，有牲斯碩。", "穆穆其暉，穰穰是積。", "合吹八風金奏動，分容萬舞玉鞘驚。", "詞昭茂典光前列，夕曜乘功表盛明。", "於昭上穹，臨下有光。", "羽翼五佐，周流八荒。", "誰其饗之，時文對敭。", "虞經夏典，茲禮未遑。", "黑帝旋馭，青躔導日。", "金籙上玄，玉堂初吉。", "鉤陳夕次，鑾和先蹕。", "藹藹羣靈，昭昭咸秩。", "帝臨中壇，受釐元神。", "皇靈萃止，羽旄肅陳。", "攝提運衡，招搖移輪。", "光光宇宙，電耀雷震。", "夜如何其，明星煌煌。", "天清容衛，露結壇場。", "樹羽幢幢，佩玉鏘鏘。", "凝精駐目，瞻望神光。", "九位既肅，萬靈畢會。", "天門啓扄，日馭飛蓋。", "煥兮棽離，儐兮暗靄。", "如山之福，惟聖時對。", "崇崇泰壇，靈具臨兮。", "鏗鍠大樂，振動心兮。", "神之降矣，卿雲郁兮。", "神之至止，清風肅兮。", "帝在靈壇，大明登光。", "天回雲粹，穆穆皇皇。", "金奏九夏，圭陳八薌。", "曠哉動植，如熙春陽。", "歌工既奏，神位既秩。", "天符衆星，運行太一。", "聲和十管，氣應中律。", "肅肅明廷，介茲元吉。", "俎豆有踐，黃流在尊。", "九宮之祀，三代莫存。", "樂變六宮，壇開八門。", "聖皇昭對，祐我黎元。", "時文哲后，肅事嚴禋。", "馨我明德，享於貴神。", "大庖載盈，旨酒斯醇。", "精意所屬，期於利人。", "祀既云畢，明靈告旋。", "禮洽和應，神歆福延。", "動植咸若，陰陽不愆。", "錫茲純嘏，天子萬年。", "羽籥既闋干戚陳，八音克諧六變新。", "愉貴神兮般以樂，保皇祚兮萬斯春。", "盛德陳萬舞，威稜暢九垓。", "風雲交律候，日月麗昭回。", "行慶休祥發，乘和春氣來。", "百神肅臨享，蕩蕩天門開。", "精意嚴恭，明祠豐潔。", "獻酬既備，俎豆斯撤。", "日麗天儀，風和樂節。", "事光祀典，福覃有截。", "享申百禮，慶洽百靈。", "上排閶闔，洞入杳冥。", "奠玉高壇，燔柴廣庭。", "神之降福，萬國咸寧。", "太皞御氣，句芒肇功。", "蒼龍青旗，爰候祥風。", "律以和應，神以感通。", "鼎俎修蠁，時惟禮崇。", "旨酒告絜，青蘋應候。", "禮陳瑤幣，樂獻金奏。", "彈弦自昔，解凍惟舊。", "仰瞻肸蠁，羣祥來湊。", "德盛昭臨，迎拜巽方。", "爰候發生，式薦馨香。", "酌醴具舉，工歌載揚。", "神歆六律，恩降百祥。", "膋薌備，玉帛陳。", "風動物，樂感神。", "三獻終，百神臻。", "草木榮，天下春。", "微穆敷華能應節，飄揚發彩宜行慶。", "送迎靈駕神心享，跪拜靈壇禮容盛。", "氣和草木發萌芽，德暢禽魚遂翔泳。", "永望翠蓋逐流雲，自茲率土調春令。", "陟降左右，誠達幽圜。", "作解之功，樂惟有年。", "雲軿戾止，灑霧飄煙。", "惟馨展禮，爰列豆籩。", "歲正朱明，禮布元制。", "惟樂能感，與神合契。", "陰霧離翍，靈馭搖裔。", "膏澤之慶，期於稔歲。", "陽開幽蟄，躬奉鬱鬯。", "禮備節應，震來靈降。", "動植求聲，飛沈允望。", "時康氣茂，惟神之貺。", "奠既備，獻將終。", "神行令，瑞飛空。", "迎乾德，祈歲功。", "乘煙燎，儼從風。", "整駕昇車望寥廓，垂陰薦祉蕩昏氛。", "饗時靈貺僾如在，樂罷餘聲遙可聞。", "飲福陳誠禮容備，撤俎終獻曙光分。", "跪拜臨壇結空想，年年應節候油雲。", "萬方資以化，交泰屬昇平。", "易從業惟簡，得一道斯寧。", "具儀光玉帛，送舞變咸英。", "黍稷良非貴，明德信惟馨。", "至矣坤德，皇哉地祇。", "開元統紐，合大承規。", "九宮肅列，六典相儀。", "永言配命，長保無虧。", "柔而能方，直而能敬。", "載厚以德，大亨以正。", "有滌斯牷，有馨斯盛。", "介茲景福，祚我休慶。", "玉幣牲牷分薦享，羽旄干鏚遰成容。", "一德惟寧兩儀泰，三才保合四時邕。", "陰祇協贊，厚載方貞。", "牲幣具舉，簫管備成。", "其禮惟肅，其德惟明。", "神之聽矣，式鑒虔誠。", "奉承先旨，明臺畢功。", "靈睠遙行祕躅，嘉貺荐委殊珍。", "舒陰致養，合大資生。", "蘭俎既昇，蘋羞可薦。", "林澤斯總，山川是遍。", "既薦羽旌文化啓，還呈干鏚武威揚。", "夕惕司龍契，晨兢當鳳扆。", "靈降無兆，神凝有粹。", "奏夏登列，歌雍徹肆。", "言旋雲洞兮躡煙途，永寧中宇兮安下都。", "調雲闋兮神座興，驂雲駕兮儼將昇。", "騰絳霄兮垂景祐，翹丹懇兮荷休徵。", "坤厚載物，德柔垂祉。", "九域咸雍，四溟爲紀。", "敬因良節，虔修陰祀。", "廣樂式張，靈其降止。", "坤元至德，品物資生。", "神凝博厚，道協高明。", "列鎮五嶽，環流四瀛。", "于何不載，萬寶斯成。", "樂備金石，禮光尊俎。", "大享爰終，洪休是舉。", "雨零感節，雲飛應序。", "纓紱載辭，皇靈具舉。", "大樂和暢，殷薦明神。", "一降通感，八變必臻。", "有求斯應，無德不親。", "降靈醉止，休徵萬人。", "坤元載物，陽樂發生。", "播殖資始，品彙咸亨。", "列俎棋布，方壇砥平。", "神歆禋祀，后德惟明。", "大君出震，有事郊禋。", "齋戒既肅，馨香畢陳。", "樂和禮備，候暖風春。", "恭惟降福，實賴明神。", "於穆濬哲，維清緝熙。", "肅事昭配，永言孝思。", "滌濯靜嘉，馨香在茲。", "神之聽之，用受福釐。", "於穆聖皇，六葉重光。", "太原刻頌，后土疎場。", "寶鼎呈符，歊雲孕祥。", "禮樂備矣，降福穰穰。", "聿修嚴配，展事禋宗。", "祥符寶鼎，禮備黃琮。", "[祝]詞以信，明德惟聰。", "介茲景福，永永無窮。", "蠲我饎餴，絜我膋薌。", "有豆孔碩，爲羞既臧。", "至誠無昧，精意惟芳。", "神其醉止，欣欣樂康。", "禮物斯具，樂章乃陳。", "誰其作主，皇考聖真。", "對越在天，聖明佐神。", "窅然汾上，厚澤如春。", "樂奏云闋，禮章載虔。", "禋宗於地，昭假於天。", "惟馨薦矣，既醉歆焉。", "神之降福，永永萬年。", "維歲之吉，維辰之良。", "聖君紱冕，肅事壇場。", "大禮已備，大樂斯[張]。", "神其醉止，降福無疆。", "方丘既膳，嘉饗載謐。", "齊敬畢誠，陶匏貴質。", "秀畢豐薦，芳俎盈實。", "永永福流，其昇如日。", "至哉含柔德，萬物資以生。", "常順稱厚載，流謙通變盈。", "聖心事能察，增廣陳厥誠。", "黃祇僾如在，泰折俟咸亨。", "肅我成命，於昭黃祇。", "裘冕而祀，陟降在斯。", "五音克備，八音聿施。", "緝熙肆靖，厥心匪離。", "黃祇是[祗]，我其夙夜。", "寅畏誠絜，匪遑寧舍。", "禮以琮玉，薦厥茅藉。", "念茲降康，胡寧克暇。", "夙夜宥密，不敢寧宴。", "五齊既陳，八音在縣。", "粢盛以潔，房俎斯薦。", "惟德惟馨，尚茲克徧。", "惟以明發，有懷載殷。", "樂盈而反，禮順其禋。", "立清以獻，薦欲是親。", "於穆不已，裒對斯臻。", "穆穆天子，告成岱宗。", "大裘如濡，執珽有顒。", "樂以平志，禮以和容。", "上帝臨我，云胡肅邕。", "昭昭有唐，天俾萬國。", "列祖應命，四宗順則。", "申錫無疆，宗我同德。", "曾孫繼序，享神配極。", "靈具醉，杳熙熙。", "靈將往，眇禗禗。", "顧明德，吐正辭。", "爛遺光，流禎祺。", "大矣坤儀，至哉神縣。", "包含日域，牢籠月竁。", "露絜三清，風調六變。", "皇祇介祉，式歆恭薦。", "泰折嚴享，陰郊展敬。", "禮以導神，樂以和性。", "黝牲在列，黃琮俯暎。", "九土既平，萬邦貽慶。", "坤道降祥和庶品，靈心載德厚羣生。", "水土既調三極泰，文武畢備九區平。", "黃輿厚載，赤寰歸德。", "含育九區，保安萬國。", "誠敬無怠，禋祀有則。", "樂以迎神，其儀不忒。", "神州陰祀，洪恩廣濟。", "草樹霑和，飛沈沐惠。", "禮修鼎俎，奠歆瑤幣。", "送樂有章，靈軒其逝。", "后土凝德，神功協契。", "九域底平，兩儀交際。", "戊期應序，陰墉展幣。", "靈車少留，俯歆樽桂。", "美報崇本，嚴恭展事。", "受露疎壇，承風啓地。", "絜粢登俎，醇犧入饋。", "介福遠流，羣生畢遂。", "神道發生敷九稼，陰極乘仁暢八埏。", "緯武經文隆景化，登祥薦祉啓豐年。", "烈山有子，后土有臣。", "播種百穀，濟育兆人。", "春官緝禮，宗伯司禋。", "戊爲吉日，迎享茲辰。", "吉祥式就，酬功載畢。", "親地尊天，禮文經術。", "貺徵令序，福流初日。", "神馭爰歸，祠官其出。", "序迫歲陰，日躔星紀。", "爰稽茂典，聿崇清祀。", "綺幣霞舒，瑞珪虹起。", "百禩垂裕，萬靈薦祉。", "緹籥勁序，玄英晚候。", "姬蜡開儀，豳歌入奏。", "蕙馥雕俎，蘭芬玉酎。", "大享明祇，永綏多祐。", "經緯兩儀文化洽，削平方域武功成。", "瑤弦自樂乾坤泰，玉鏚長歡區宇寧。", "八蜡開祭，萬物合祀。", "上極天維，下窮坤紀。", "鼎俎流芬，罇彝薦美。", "有靈有祇，咸希來止。", "十旬歡洽，一日祠終。", "澄彝拂俎，報德酬功。", "慮虔容肅，禮縟儀豐。", "神其降祉，整馭隨風。", "粒食伊始，農之所先。", "古今攸賴，是曰人天。", "耕斯帝籍，播厥公田。", "式崇明祀，神其福焉。", "樽彝既列，瑚簋方薦。", "歌工載登，幣禮斯奠。", "肅肅享祀，顒顒纓弁。", "神之聽之，福流寰縣。", "前夕視牲，質明奉俎。", "沐芳整弁，其儀式序。", "盛禮畢陳，嘉樂備舉。", "歆我懿德，非馨稷黍。", "羽籥低昂文綴已，干戚蹈厲武行初。", "望歲祈農神所聽，延祥介福豈云虛。", "三推禮就，萬庾祈凝。", "夤賓志遠，藨衮惟興。", "降歆肅薦，垂祐祗膺。", "送神有樂，神其上昇。", "芳春開令序，韶苑暢和風。", "惟靈申廣祐，利物表神功。", "綺會周天宇，黼黻藻寰中。", "庶幾承慶節，歆奠下帷宮。", "明靈光至德，深功掩百神。", "祥源應節啓，福緒逐年新。", "萬宇承恩覆，七廟佇恭禋。", "于茲申至懇，方期遠慶臻。", "霞莊列寶衛，雲集動和聲。", "金卮薦綺席，玉幣委芳庭。", "因心罄丹款，先己勵蒼生。", "所冀延明福，於茲享至誠。", "桂筵開玉俎，蘭圃薦瓊芳。", "八音調鳳曆，三獻奉鸞觴。", "絜粢申大享，庭宇冀降祥。", "神其覃有慶，契福永無疆。", "仙壇禮既畢，神駕儼將昇。", "佇屬深祥起，方期庶績凝。", "虔誠資宇內，務本勖黎蒸。", "靈心昭備享，率土洽休徵。", "聖道日用，神幾不測。", "金石以陳，弦歌載陟。", "爰釋其菜，匪馨于稷。", "來顧來享，是宗是極。", "萬國以貞光上嗣，三善茂德表重輪。", "視膳寢門尊要道，高闢崇賢引正人。", "粤惟上聖，有縱自天。", "傍周萬物，俯應千年。", "舊章允著，嘉贄孔虔。", "王化茲首，儒風是宣。", "堂獻瑤篚，庭敷璆縣。", "禮備其容，樂和其變。", "肅肅親享，雍雍執奠。", "明德惟馨，蘋蘩可薦。", "隼集龜開昭聖烈，龍蹲鳳跱肅神儀。", "尊儒敬業宏圖闡，緯武經文盛德施。", "通吳表聖，問老探真。", "三千弟子，五百賢人。", "億齡規法，萬載嗣禋。", "潔誠以祭，奏樂迎神。", "醴溢犧象，羞陳俎豆。", "魯壁類聞，泗川入覯。", "里校覃福，胄筵承祐。", "雅樂清音，送神具奏。", "卜畋不從，兆發非熊。", "乃傾荒政，爰佐一戎。", "盛烈載垂，命祀惟崇。", "日練上戊，宿嚴閟宮。", "迎奏嘉至，感而遂通。", "管磬升，羶薌集。", "上公進，嘉幣執。", "信以通，僾如及。", "恢帝功，錫后邑。", "四維張，百度立。", "綿億載，邈難挹。", "五齊潔，九牢碩。", "梡橛循，罍斝滌。", "進具物，揚鴻績。", "和奏發，高靈寂。", "虔告終，繁祉錫。", "昭秩祀，永無易。", "貳觴以獻，三變其終。", "顧此非馨，尚達斯衷。", "茅縮可致，神歆載融。", "始神翊周，拯溺除凶。", "時維降祐，永絕興戎。", "明祀方終，備樂斯闋。", "黝纁就瘞，豆籩告撤。", "肸蠁尚餘，光景云滅。", "返歸虛極，神心則悅。", "恭聞帝里生靈沼，應報明君鼎業新。", "既協翠泉光寶命，還符白水出真人。", "此時舜海潛龍躍，此地堯河帶馬巡。", "獨有前池一小雁，叨承舊惠入天津。", "帝宅王家大道邊，神馬龍龜涌聖泉。", "昔日昔時經此地，看來看去漸成川。", "歌臺舞榭宜正月，柳岸梅洲勝往年。", "莫言波上春雲少，祗爲從龍直上天。", "龍池躍龍龍已飛，龍德[光]天天不違。", "池開天漢分黃道，龍向天門入紫微。", "邸第樓臺多氣色，君王鳧雁有光輝。", "爲報寰中百川水，來朝此地莫東歸。", "代邸東南龍躍泉，清漪碧浪遠浮天。", "樓臺影就波中出，日月光疑鏡裏懸。", "雁沼回流成舜海，龜書薦祉應堯年。", "大川既濟慙爲檝，報德空思奉細涓。", "龍池初出此龍山，常經此地謁龍顏。", "日日芙蓉生夏水，年年楊柳變春灣。", "堯壇寶匣餘煙霧，舜海漁舟尚往還。", "願似飄颻五雲影，從來從去九天間。", "龍興白水漢興符，聖主時乘運斗樞。", "岸上丰茸五花樹，波中的皪千金珠。", "操環昔聞迎夏啓，發匣先來瑞有虞。", "風色雲光隨隱見，赤雲神化象江湖。", "西京鳳邸躍龍泉，佳氣休光鎮在天。", "軒后霧圖今已得，秦王水劒昔常傳。", "恩魚不似昆明釣，瑞鶴長如太液仙。", "願侍巡游同舊里，更聞簫鼓濟樓船。", "星分邑里四人居，水洊源流萬頃餘。", "魏國君王稱象處，晉家藩邸化龍初。", "青蒲暫似遊梁馬，綠藻還疑宴鎬魚。", "自有神靈滋液地，年年雲物史官書。", "靈沼縈迴邸第前，浴日涵天寫曙天。", "始見龍臺昇鳳闕，應如霄漢起神泉。", "石匱渚傍還啓聖，桃李初生更有仙。", "欲化帝圖從此受，正同河變一千年。", "乾坤啓聖吐龍泉，泉水年年勝一年。", "始看魚躍方成海，即覩龍飛利在天。", "洲渚遙將銀漢接，樓臺直與紫微連。", "休氣榮光常不散，懸知此地是神仙。", "於穆烈祖，弘此丕基。", "永言配命，子孫保之。", "百神既洽，萬國在茲。", "是用孝享，神其格思。", "大哉至德，允茲明聖。", "格于上下，聿遵誠敬。", "嘉樂斯登，鳴球以詠。", "神其降止，式隆景命。", "崇茲享祀，誠敬兼至。", "樂以感靈，禮以昭事。", "粢盛咸絜，牲牷孔備。", "永言孝思，庶幾不匱。", "睿哲維唐，長發其祥。", "帝命斯祐，王業克昌。", "配天載德，就日重光。", "本支百代，申錫無疆。", "猗與祖業，皇矣帝先。", "翦商德厚，封唐慶延。", "在姬猶稷，方晉喻宣。", "基我鼎運，於萬斯年。", "周稱王季，晉美帝文。", "明明盛德，穆穆齊芬。", "藏用四履，屈道三分。", "鏗鏘鍾石，載紀鴻勳。", "五紀更運，三正遞升。", "勛華既沒，禹湯勃興。", "神武命代，靈睠是膺。", "望雲彰德，察緯告徵。", "上紐天維，下安地軸。", "徵師涿野，萬國咸服。", "偃伯靈臺，九官允穆。", "殊域委賮，懷生介福。", "大禮既飾，大樂已和。", "黑章擾囿，赤字浮河。", "功宣載籍，德被詠歌。", "克昌厥後，百祿是荷。", "聖敬通神光七廟，靈心薦祚和萬方。", "嚴禋克配鴻基遠，明德惟馨鳳曆昌。", "於穆清廟，聿修嚴祀。", "四縣載陳，三獻斯止。", "籩豆徹薦，人祇介祉。", "神維格思，錫祚不已。", "肅肅清祀，烝烝孝思。", "薦享昭備，虔恭在茲。", "雍歌徹俎，祝嘏陳辭。", "用光武志，永固鴻基。", "五運改卜，千齡啓聖。", "彤雲曉聚，黃星夜映。", "葉闡珠囊，基開玉鏡。", "下臨萬宇，上齊七政。", "霧開三象，塵清九服。", "海溓星暉，遠安邇肅。", "天地交泰，華夷輯睦。", "翔泳歸仁，中外禔福。", "績踰黜夏，勳高翦商。", "武陳七德，刑設三章。", "祥禽巢閣，仁獸遊梁。", "卜年惟永，景福無疆。", "承天撫籙，纂聖登皇。", "遐清萬宇，仰協三光。", "功成日用，道濟時康。", "璇圖載永，寶曆斯昌。", "日月揚暉，煙雲爛色。", "河嶽修貢，神祇効職。", "舜風攸偃，堯曦先就。", "睿感通寰，孝思浹宙。", "奉揚先德，虔遵曩狩。", "展義天扄，飛英雲岫。", "化逸王表，神凝帝先。", "乘雲厭俗，馭日登玄。", "廣樂既備，嘉薦既新。", "述先惟德，孝饗惟親。", "七獻具舉，五齊畢陳。", "錫茲祚福，於萬斯春。", "惟睿作聖，惟聖登皇。", "精感耀魄，時膺會昌。", "舜慙大孝，堯推讓王。", "能事斯極，振古誰方。", "文明履運，車書同軌。", "巍巍赫赫，盡善盡美。", "衢室凝旒，大庭端扆。", "釋負之寄，事光復子。", "脫屣高天，登遐上玄。", "龍湖超忽，象野芊綿。", "遊衣復道，薦果初年。", "新廟奕奕，明德配天。", "大業龍祉，徽音駿尊。", "潛居皇德，赫嗣天昆。", "展儀宗祖，重誠孝孫。", "春秋無極，享奏存存。", "七廟觀德，百靈攸仰。", "俗荷財成，物資含養。", "道光執契，化籠提象。", "肅肅雍雍，神其來饗。", "肅肅清廟，巍巍盛唐。", "配天立極，累聖重光。", "樂和管磬，禮備烝嘗。", "永惟來格，降福無疆。", "五聲備奏，三獻終祠。", "車移鳳輦，斾轉虹旗。", "禮周籩豆，誠效虔祗。", "皇靈徙蹕，簪紳拜辭。", "建清廟，贊玄功。", "擇吉日，展禋宗。", "樂已變，禮方崇。", "望神駕，降仙宮。", "隆周創業，寶命惟新。", "敬宗茂典，爰表虔禋。", "聲明已備，文物斯陳。", "肅容如在，懇志方申。", "肅敷大禮，上謁尊靈。", "敬[陳]筐幣，載表丹誠。", "敬奠蘋藻，式罄虔襟。", "潔誠斯展，佇降靈歆。", "爰陳玉醴，式奠瓊漿。", "靈心有穆，介福無疆。", "帝圖草創，皇業初開。", "功高佐命，業贊雲雷。", "赫赫玄功被穹壤，皇皇至德洽生靈。", "開基撥亂妖氛廓，佐命宣威海內清。", "登歌已闋，獻禮方周。", "欽承景福，肅奉鴻休。", "大禮言畢，仙衛將歸。", "莫申丹懇，空瞻紫微。", "肅肅清廟，赫赫玄猷。", "功高萬古，化奄十洲。", "中興丕業，上荷天休。", "祗奉先構，禮備懷柔。", "顧惟菲薄，纂曆應期。", "中外同軌，夷狄來思。", "樂用崇德，禮以陳詞。", "夕惕若厲，欽奉弘基。", "禮標薦鬯，肅事祠庭。", "敬申如在，敢託非馨。", "崇禋已備，粢盛聿修。", "潔誠斯展，鍾石方遒。", "金相載穆，玉裕重輝。", "養德清禁，承光紫微。", "乾宮候色，震象增威。", "監國方永，賓天不歸。", "孝友自衷，溫文性與。", "龍樓正啓，鶴駕斯舉。", "丹扆流念，鴻名式序。", "中興考室，永陳彝俎。", "巍巍累聖，穆穆重光。", "奄有區夏，祚啓隆唐。", "百蠻飲澤，萬國來王。", "本枝億載，鼎祚逾長。", "惟聖配天敷盛禮，惟天爲大闡洪名。", "恭禋展敬光先德，蘋藻申虔表志誠。", "炎馭失天綱，土德承天命。", "英猷被寰宇，懿躅隆邦政。", "七德已綏邊，九夷咸底定。", "景化覃遐邇，深仁洽翔泳。", "禮周三獻，樂闋九成。", "肅承靈福，悚惕兼盈。", "祠容既畢，仙座爰興。", "停停鳳舉，靄靄雲昇。", "長隆寶運，永錫休徵。", "福覃貽厥，恩被黎蒸。", "道洽二儀交泰，時休四宇和平。", "環珮肅於庭實，鍾石揚乎頌聲。", "顧惟菲質，忝位椒宮。", "虔奉蘋藻，肅事神宗。", "敢申誠絜，庶罄深衷。", "睟容有裕，靈享無窮。", "月禮已周，雲和將變。", "爰獻其醑，載遷其奠。", "明德逾隆，非馨是薦。", "澤霑動植，仁覃宇縣。", "鏗鏘韶濩，肅穆神容。", "洪規赫赫，祠典雍雍。", "已周三獻，將乘六龍。", "虔誠有託，懇志無從。", "肅九室，諧八音。", "歌皇慕，動神心。", "禮宿設，樂妙尋。", "聲明備，[祼]奠臨。", "律迓氣，音入玄。", "依玉几，御黼筵。", "聆愾息，僾周旋。", "九韶遍，百福傳。", "信工祝，永頌聲。", "來祖考，聽和平。", "相百辟，貢九瀛。", "神休委，帝孝成。", "時文聖后，清廟肅邕。", "致誠勤薦，在貌思恭。", "玉節肆夏，金鏘五鍾。", "繩繩雲步，穆穆天容。", "天子享孝，工歌溥將。", "躬[祼]鬱鬯，乃焚膋薌。", "臭以達陰，聲以求陽。", "奉時烝嘗，永代不忘。", "在滌嘉豢，麗碑敬牲。", "角握之牡，色純之騂。", "火傳陽燧，水溉陰精。", "太公胖俎，[傅]說和羹。", "俎豆有馥，粢盛絜豐。", "鼓鐘管磬，肅唱和鳴。", "聖謩九德，真言五千。", "慶集昌胄，符開帝先。", "高文杖鉞，克配彼天。", "三宗握鏡，六合渙然。", "帝其承祀，率禮罔愆。", "圖書霧出，日月清懸。", "舞形德類，詠諗功傳。", "黃龍蜿蟺，彩雲蹁躚。", "五行氣順，八佾風宣。", "介此百祿，於皇萬年。", "肅肅藝祖，滔滔濬源。", "有雄玉劍，作鎮金門。", "玄王貽緒，后稷謀孫。", "肇禋九廟，四海來尊。", "具禮崇德，備樂承風。", "魏推幢主，周贈司空。", "不行而至，無成有終。", "神興王業，天歸帝功。", "於赫元命，權輿帝文。", "天齊八柱，地半三分。", "宗廟觀德，笙鏞樂勳。", "封唐之兆，成天下君。", "帝舞季歷，龍聖生昌。", "后歌有蟜，胎炎孕黃。", "天地合德，日月齊光。", "肅雝孝享，祚我萬方。", "赤精亂德，四海困窮。", "黃旗舉義，三靈會同。", "旱望春雨，雲披大風。", "溥天來祭，高祖之功。", "皇合一德，朝宗百神。", "削平天地，大拯生人。", "上帝配食，單于入臣。", "戎歌陳舞，曄曄震震。", "高皇邁道，端拱無爲。", "化懷獯鬻，兵賦句驪。", "禮尊封禪，樂盛來儀。", "合位媧后，同稱伏羲。", "退居江水，鬱起丹陵。", "禮物還舊，朝章中興。", "龍圖友及，駿命恭膺。", "鳴球香瓚，大糦是承。", "景雲霏爛，告我帝符。", "噫帝沖德，與天爲徒。", "笙鏞遙遠，俎豆虛無。", "春秋孝獻，迴復此都。", "備禮用樂，崇親致尊。", "誠通慈降，敬徹愛存。", "獻懷稱壽，啐感承恩。", "皇帝孝德，子孫千億。", "大包天域，長亙不極。", "六鐘翕協六變成，八佾徜徉八風生。", "樂九韶兮人神感，美七德兮天地清。", "瑟彼瑤爵，亞惟上公。", "室如屏氣，門不容躬。", "禮殷其本，樂執其中。", "聖皇永慕，天地幽通。", "禮匝三獻，樂遍九成。", "降循軒陛，仰欷皇情。", "福與仁合，德因孝明。", "百年[神畏]，四海風行。", "總總干戚，填填鼓鐘。", "奮揚爭氣，坐作爲容。", "離若鷙鳥，合如戰龍。", "萬方觀德，肅肅雝雝。", "止笙磬，撤豆籩。", "廓無響，窅入玄。", "主在室，神在天。", "情餘慕，禮罔愆。", "喜黍稷，屢豐年。", "眇嘉樂，授靈爽。", "感若來，思如往。", "休氣散，迴風上。", "返寂寞，還惚恍。", "懷靈駕，結空想。", "於赫皇祖，昭明有融。", "惟文之德，惟武之功。", "河海靜謐，車書混同。", "虔恭孝饗，穆穆玄風。", "漢祚惟永，神功中興。", "風驅氛祲，天覆黎蒸。", "三光再朗，庶績其凝。", "重熙累洽，景命是膺。", "於穆文考，聖神昭章。", "肅勺羣慝，含光遠方。", "萬物茂遂，九夷賓王。", "愔愔雲韶，德音不忘。", "開邸除暴，時邁勛尊。", "三元告命，四極駿奔。", "金枝翠葉，輝燭瑤琨。", "象德億載，貽慶湯孫。", "於穆時文，受天明命。", "允恭玄默，化成理定。", "出震嗣德，應乾傳聖。", "猗歟緝熙，千億流慶。", "肅肅清廟，登顯至德。", "澤周八荒，兵定四極。", "生物咸遂，羣盜滅息。", "明聖欽承，子孫千億。", "湜湜頎頎，融昭德輝。", "不紐不舒，貫成九圍。", "武烈文經，敷施當宜。", "纂堯付啓，億萬熙熙。", "受天明命，敷佑下土。", "化時以儉，衛文以武。", "氛消夷夏，俗臻往古。", "億萬斯年，形于律呂。", "於鑠令主，聖祚重昌。", "興起教義，申明典章。", "俗尚素朴，人皆樂康。", "積德可報，流慶無疆。", "聖祚無疆，慶傳樂章。", "金枝繁茂，玉葉延長。", "海瀆常[晏]，波濤不揚。", "汪汪美化，垂範今王。", "於鑠丕嗣，惟帝之光。", "羽籥象德，金石薦祥。", "聖系無極，景命永昌。", "神降上哲，維天配長。", "煌煌道宮，肅肅太清。", "禮光尊祖，樂備充庭。", "罄竭誠至，希夷降靈。", "雲凝翠蓋，風燄紅旌。", "衆真以從，九奏初迎。", "永惟休祐，是錫和平。", "虛無結思，鐘磬和音。", "歌以頌德，香以達心。", "禮殊祼鬯，義感昭臨。", "雲車至止，慶垂愔愔。", "肅肅我祖，緜緜道宗。", "至感潛達，靈心暗通。", "雲軿御氣，芝蓋隨風。", "四時禋祀，萬國來同。", "仙宗績道，我李承天。", "慶深虛極，符光象先。", "俗登仁壽，化闡蟺涓。", "五千貽範，億萬斯年。", "不宰元功，無爲上聖。", "洪源長發，誕受天命。", "金奏迎真，璇宮展盛。", "備禮周樂，垂光儲慶。", "至道生元氣，重圓法混成。", "無爲觀大象，沖用體常名。", "仙樂臨丹闕，雲車出玉京。", "靈符百代應，瑞節九貞迎。", "寶運開皇極，天臨映太清。", "長垂一德慶，永庇萬方寧。", "真宗開妙理，沖教統清虛。", "化演無爲日，言昭有象初。", "瑤臺肅靈瑞，金闕映仙居。", "一奏三清樂，長回八景輿。", "虛極仙宗本，希夷象帝先。", "百靈朝太上，萬法祖重圓。", "善貸惟沖德，功成謂自然。", "雲門達和氣，思用合鈞天。", "元符傳紫極，寶祚啓高真。", "道德先垂裕，沖和已化淳。", "人風齊太古，天瑞叶惟新。", "仙樂清都上，長明交泰辰。", "嚴禋展事，理潔烝嘗。", "皇矣聖祖，德惟馨香。", "盛薦既撤，工歌載揚。", "大來之慶，降福穰穰。", "玉磬含香，金爐既馥。", "風馭泠泠，雲壇肅肅。", "杳歸大象，霈流嘉福。", "俾寧萬邦，無思不服。", "元尊九德，佐堯光宅。", "烈祖太宗，方周作伯。", "響懷霜露，樂變金石。", "白雲清風，髣髴來格。", "四時有典，百事來祭。", "尊祖奉宗，嚴禋大帝。", "禮先蒼璧，奠幣黝制。", "於斯萬年，熙成帝系。", "盛牲實俎，涓選休成。", "鼎煁陽燧，玉盥陰精。", "有飶嘉豆，既和大羹。", "侑以清樂，細齊人情。", "清廟奕奕，和樂雍雍。", "器尊犧象，禮屬宗公。", "白水方祼，黃流在中。", "謨明之德，萬古清風。", "閟宮靜謐，合樂周張。", "泰尊始獻，百末重觴。", "震澹存誠，庶幾迪嘗。", "遙源之祚，天漢靈長。", "惟清惟肅，靡聞靡見。", "舉備九成，俛終三獻。", "慶彰曼壽，胙徹嘉薦。", "瘞玉埋牲，禮神斯徧。", "元精回復，靈貺繁滋。", "風灑蘭路，雲搖桂旗。", "高丘緬邈，涼部逶遲。", "瞻望靡及，纏綿永思。", "猗若清廟，肅肅熒熒。", "國薦嚴祀，坤興淑靈。", "有几在室，有樂在庭。", "臨茲孝享，百祿惟寧。", "陰靈曜祉，軒曜降精。", "祥符淑氣，慶集柔明。", "瑤俎既列，雕桐發聲。", "徽猷永遠，比德皇英。", "孝哉我后，沖乎迺聖。", "道映重華，德輝文命。", "慕深視篋，情殷撫鏡。", "萬國移風，兆人承慶。", "祼圭既濯，鬱鬯既陳。", "畫幕雲舉，黃流玉醇。", "儀充獻酌，禮盛衆禋。", "地察惟孝，愉焉饗親。", "酌鬱既灌，薌蕭方爇。", "籩豆靜器，簠簋芬飶。", "魚腊薦美，牲牷表潔。", "是戢是將，載迎載列。", "陽靈配德，陰魄昭升。", "堯壇鳳下，漢室龍興。", "俔天作對，前旒是凝。", "化行南國，道盛西陵。", "造舟集灌，無德而稱。", "我粢既絜，我醴既澄。", "陰陰靈廟，光靈若憑。", "德馨惟享，孝思烝烝。", "乾道既亨，坤元以貞。", "肅雍攸在，輔佐斯成。", "外睦九族，內光一庭。", "克生睿哲，祚我休明。", "欽若徽範，悠哉淑靈。", "建茲清宮，于彼上京。", "縮茅以獻，絜秬惟馨。", "實受其福，期乎億齡。", "於穆清廟，肅雍嚴祀。", "合福受釐，介以繁[祉]。", "送文迎武遞參差，一始一終光聖儀。", "四海生人歌有慶，千齡孝享肅無虧。", "妙筭申帷幄，神謀及廟庭。", "兩階文物備，七德武功成。", "校獵長楊苑，屯軍細柳營。", "將軍獻凱入，歌舞溢重城。", "孝享云畢，惟徹有章。", "雲感玄羽，風悽素商。", "瞻望神座，祗戀匪遑。", "禮終樂闋，肅雍鏘鏘。", "閟宮實實，清廟微微。", "降格無象，馨香有依。", "式昭纂慶，方融嗣徽。", "明禋是享，神保聿歸。", "月靈降德，坤元授光。", "娥英比秀，任姒均芳。", "瑤臺薦祉，金屋延祥。", "迎神有樂，歆此嘉薌。", "玉帛儀大，金絲奏廣。", "靈應有孚，冥徵不爽。", "降彼休福，歆茲禋享。", "送樂有章，神麾其上。", "穆清廟，薦嚴禋。", "昭禮備，和樂新。", "望靈光，集元辰。", "祚無極，享萬春。", "誠心達，娛樂分。", "升簫膋，鬱氛氳。", "茅既縮，鬯既薰。", "后來思，福如雲。", "我將我享，盡明而誠。", "載芬黍稷，載滌犧牲。", "懿矣元良，萬邦以貞。", "心乎愛敬，若覩容聲。", "於穆先后，麗聖稱崇。", "母臨萬宇，道[被]六宮。", "昌時協慶，理內成功。", "殷薦明德，傳芳國風。", "工祝致告，徽音不遐。", "酒醴咸旨，馨香具嘉。", "受釐獻祉，永慶邦家。", "金枝羽部徹清歌，瑤臺肅穆笙磬羅。", "諧音遍響合明意，萬類昭融靈應多。", "辰位列四星，帝功參十亂。", "進賢勤內輔，扈蹕清多難。", "承天厚載均，並耀宵光璨。", "留徽藹前躅，萬古披圖煥。", "公尸既起，享禮載終。", "稱歌進徹，盡敬繇衷。", "澤流惠下，大小咸同。", "昭事終，幽享餘。", "移月御，返仙居。", "璇庭寂，靈幄虛。", "顧裴回，感皇儲。", "皇矣天宗，德先王季。", "因心則友，克讓以位。", "爰命有司，式遵前志。", "神其降靈，昭饗祀事。", "惟帝時若，去而上仙。", "祀用商舞，樂備宮懸。", "白璧加薦，玄纁告虔。", "子孫拜後，承茲吉蠲。", "祀盛體薦，禮協粢盛。", "方周假廟，用魯純牲。", "捧徹祗敬，擊拊和鳴。", "受釐歸胙，既戒而平。", "八音具舉，三壽既盥。", "潔茲宗彝，瑟彼圭瓚。", "蘭肴重錯，椒醑飄散。", "降胙維城，永爲藩翰。", "秩禮有序，和音既同。", "九儀不忒，三揖將終。", "孝感藩后，相維辟公。", "四時之典，永永無窮。", "奠獻已事，昏昕載分。", "風搖雨散，靈衛絪緼。", "龍駕帝服，上騰五雲。", "泮宮復閟，寂寞無聞。", "道閟鶴關，運纏鳩里。", "門集大命，俾歆嘉祀。", "禮亞六瑚，誠殫二簋。", "有誠顒若，神斯戾止。", "歲肇春宗，乾開震長。", "瑤山既寂，戾園斯享。", "玉肅其事，物昭其象。", "弦誦成風，笙歌合響。", "明典肅陳，神居邃啓。", "春伯聯事，秋官相禮。", "有來雍雍，登歌濟濟。", "緬維主鬯，庶歆芳醴。", "三縣已判歌鐘列，六佾將開羽鏚分。", "尚想燕飛來蔽日，終疑鶴影降凌雲。", "天步昔將開，商郊初欲踐。", "撫戎金陣廓，貳極瑤圖闡。", "雞戟遂崇儀，龍樓期好善。", "弄兵隳震業，啓聖隆嗣典。", "蒼震有位，黃離蔽明。", "江充禍結，戾據災成。", "銜冤昔痛，贈典今榮。", "享靈有秩，奉樂以迎。", "皇情悼往，祀議增設。", "鐘鼓鏗鏘，羽旄昭晰。", "掌禮云備，司筵告徹。", "樂以送神，靈其鑒闋。", "副君昭象，道應黃離。", "銅樓備德，玉裕成規。", "仙氣靄靄，靈從師師。", "前驅戾止，控鶴來儀。", "忠孝本著，羽翼先成。", "寢門昭德，馳道爲程。", "幣帛有典，容衛無聲。", "司存既肅，廟享惟清。", "通三錫胤，明兩承英。", "太山比赫，伊水聞笙。", "宗祧是寄，禮樂其亨。", "嘉辰薦俎，以發聲明。", "羽籥崇文禮以畢，干鏚奮武事將行。", "用舍繇來其有致，壯志宣威樂太平。", "綠林熾炎曆，黃虞格有苗。", "沙塵驚塞外，帷幄命嫖姚。", "七德干戈止，三邊雲霧消。", "寶祚長無極，歌舞盛今朝。", "甲觀昭祥，畫堂升位。", "禮絕羣后，望尊儲貳。", "啓誦慙德，莊丕掩粹。", "伊浦鳳翔，緱峰鶴至。", "譽闡元儲，寄崇明兩。", "玉裕雖晦，銅樓可想。", "弦誦輟音，笙歌罷響。", "幣帛言設，禮容無爽。", "雍雍盛典，肅肅靈祠。", "賓天有聖，對日無期。", "飄颻羽服，掣曳雲旗。", "眷言主鬯，心乎愴茲。", "八音協奏陳金石，六佾分行整禮容。", "滄溟赴海還稱少，素月開輪即是重。", "隋季昔云終，唐年初啓聖。", "纂戎將禁暴，崇儒更敷政。", "威略靜三邊，仁恩覃萬姓。", "儲后望崇，元良寄切。", "寢門是仰，馳道不絕。", "仙袂雲會，靈旗電晰。", "煌煌而來，禮物攸設。", "灼灼重明，仰承元首。", "既賢且哲，惟孝與友。", "惟孝雖遙，靈規不朽。", "禮因誠致，備絜玄酒。", "嘉薦有典，至誠莫騫。", "畫梁雲亙，雕俎星連。", "樂器周列，禮容備宣。", "依稀如在，若未賓天。", "邕邕闡化憑文德，赫赫宣威藉武功。", "既執羽旄先拂吹，還持玉鏚更揮空。", "武德諒雍雍，由來掃寇戎。", "劒光揮作電，旗影列成虹。", "霧廓三邊靜，波澄四海同。", "睿圖今已盛，相共舞皇風。", "觴牢具品，管磬有節。", "祝道夤恭，神儀昭晰。"];

    let ambientTimer = null;
    function stopAmbient() {
      if (ambientTimer !== null) { clearInterval(ambientTimer); ambientTimer = null; }
      const old = document.getElementById(AMBIENT_ID);
      if (old !== null) old.remove();
    }

    /** 取一句诗（poemLib: all | libai）。 */
    function pickPoem(lib) {
      const arr = lib === "libai" ? POEMS_LIBAI : POEMS_ALL;
      if (!arr || arr.length === 0) return "";
      return arr[Math.floor(Math.random() * arr.length)];
    }

    /** 竖排诗词层。
     *  不重叠的做法：把屏幕横向切成 N 条「泳道」，每条泳道同一时刻只放一首，
     *  且同一泳道的下一首要等前一首飘走一半才生成 —— 这样永远不会撞在一起。 */
    function renderAmbient(cfg) {
      stopAmbient();
      if (cfg.ambient === "off" || !cfg.enabled) return;

      const box = document.createElement("div");
      box.id = AMBIENT_ID;
      document.body.appendChild(box);

      const root = document.documentElement;
      root.style.setProperty("--dsh-dynbg-ambient-opacity", String(cfg.ambientOpacity ?? 18));
      // 颜色：跟随主题 or 自定义
      if (cfg.ambientColorMode === "custom" && cfg.ambientColor) {
        root.style.setProperty("--dsh-dynbg-ambient-color", cfg.ambientColor);
      } else {
        root.style.removeProperty("--dsh-dynbg-ambient-color");
      }

      const speed = Math.max(20, Number(cfg.ambientSpeed) || 100);
      const lanes = Math.max(3, Math.min(14, Number(cfg.ambientLanes) || 7));  // 泳道数
      const baseDur = 30;                                                      // 基准穿越时长（秒）
      const laneBusy = new Array(lanes).fill(0);                               // 每条泳道"空出来"的时间戳

      function spawn() {
        if (document.getElementById(AMBIENT_ID) === null) return;
        const now = Date.now();

        // 找一条空闲泳道；都忙就跳过这次（这就是"不重叠"的关键）
        const free = [];
        for (let i = 0; i < lanes; i++) if (laneBusy[i] <= now) free.push(i);
        if (free.length === 0) return;
        const lane = free[Math.floor(Math.random() * free.length)];

        const el = document.createElement("div");
        el.className = "dsh-dynbg-amb";

        if (cfg.ambient === "binary") {
          let t = "";
          const len = 12 + Math.floor(Math.random() * 24);
          for (let i = 0; i < len; i++) t += Math.random() > 0.5 ? "1" : "0";
          el.textContent = t;
          el.style.fontSize = (13 + Math.random() * 8) + "px";
          el.style.letterSpacing = "0.25em";
        } else {
          el.textContent = pickPoem(cfg.poemLib);
          el.style.fontSize = (15 + Math.random() * 10) + "px";
        }

        // 泳道定位：均匀铺在屏幕上，加一点随机抖动免得像排队
        const laneW = 100 / lanes;
        const jitter = laneW * 0.3;
        el.style.left = (lane * laneW + Math.random() * jitter) + "%";
        el.style.bottom = "-12%";

        // 旋转：从起始角转到终止角（飘的过程中一直在转）
        const from = (Math.random() * 24 - 12).toFixed(1);
        const to = (from - (8 + Math.random() * 14)).toFixed(1);   // 一边升一边逆时针微转
        el.style.setProperty("--dsh-tilt-from", from + "deg");
        el.style.setProperty("--dsh-tilt-to", to + "deg");

        const dur = (baseDur + Math.random() * 14) * (100 / speed);
        el.style.animationDuration = dur.toFixed(1) + "s";

        box.appendChild(el);
        // 这条泳道要等这一首飘走约 55% 才允许下一首
        laneBusy[lane] = now + dur * 1000 * 0.55;

        setTimeout(function () { try { el.remove(); } catch (e) {} }, dur * 1000 + 900);
      }

      // 首屏：每条泳道先铺一首（错开时间，有层次感）
      for (let i = 0; i < lanes; i++) setTimeout(spawn, i * 700);
      ambientTimer = setInterval(spawn, 700);
    }

    // ────────── 主题与字号 ──────────
    function applyThemeMode(mode) {
      const html = document.documentElement;
      let dark;
      if (mode === "dark") dark = true;
      else if (mode === "light") dark = false;
      else {
        try { dark = window.matchMedia("(prefers-color-scheme: dark)").matches; }
        catch { dark = html.hasAttribute("data-ds-dark-theme"); }
      }
      if (dark) html.setAttribute("data-ds-dark-theme", "");
      else html.removeAttribute("data-ds-dark-theme");
      try { html.style.colorScheme = dark ? "dark" : "light"; } catch {}
    }

    // ────────── 文件选择器 ──────────
    let pickerState = { cwd: "", dirs: [], files: [] };

    async function browse(path) {
      try {
        const r = await fetch(ROUTE_BROWSE + "?path=" + encodeURIComponent(path));
        const d = await r.json();
        if (!d.ok) { alert("打不开：" + d.msg); return; }
        pickerState = { cwd: d.path, dirs: d.dirs, files: d.files };
        renderPickerList();
      } catch (e) {
        alert("读取目录失败：" + e.message);
      }
    }

    function renderPickerList() {
      const list = document.getElementById("dsh-dynbg-picker-list");
      if (list === null) return;
      const { cwd, dirs, files } = pickerState;
      const pathEl = document.getElementById("dsh-dynbg-picker-path");
      if (pathEl !== null) pathEl.textContent = cwd || "（未选择）";

      const rows = [];
      rows.push(`<div data-nav="__home__" style="padding:6px 8px;cursor:pointer;border-radius:6px;color:#888;">⌂ 主目录</div>`);
      for (const dir of dirs) {
        rows.push(`<div data-nav="${encodeURIComponent(dir.path)}" style="padding:6px 8px;cursor:pointer;border-radius:6px;">📁 ${dir.name}</div>`);
      }
      for (const f of files) {
        const mb = (f.size / 1048576).toFixed(1);
        const icon = f.mime.startsWith("video/") ? "🎬" : "🖼";
        rows.push(`<div data-pick="${encodeURIComponent(f.path)}" style="padding:6px 8px;cursor:pointer;border-radius:6px;">${icon} ${f.name} <span style="color:#888;font-size:11px;">${mb}MB</span></div>`);
      }
      if (dirs.length === 0 && files.length === 0) {
        rows.push(`<div style="padding:8px;color:#888;">（这个文件夹里没有图片或视频）</div>`);
      }
      list.innerHTML = rows.join("");
      list.querySelectorAll("[data-nav]").forEach((el) => {
        el.onmouseenter = () => el.style.background = "rgba(127,127,127,.14)";
        el.onmouseleave = () => el.style.background = "";
        el.onclick = () => {
          const v = el.getAttribute("data-nav");
          browse(v === "__home__" ? "" : decodeURIComponent(v));
        };
      });
      list.querySelectorAll("[data-pick]").forEach((el) => {
        el.onmouseenter = () => el.style.background = "rgba(127,127,127,.14)";
        el.onmouseleave = () => el.style.background = "";
        el.onclick = () => {
          const p = decodeURIComponent(el.getAttribute("data-pick"));
          setConfig({ path: p, enabled: true, kind: kindOf(p) });
          const inp = document.getElementById("dsh-dynbg-path");
          if (inp !== null) inp.value = p;
          const msg = document.getElementById("dsh-dynbg-msg");
          if (msg !== null) msg.textContent = "✓ 已选用 " + p.split("/").pop();
          closePicker();
        };
      });
    }

    function openPicker() {
      if (document.getElementById("dsh-dynbg-picker") !== null) return;
      const veil = document.createElement("div");
      veil.id = "dsh-dynbg-picker";
      veil.style.cssText = "position:fixed;inset:0;z-index:2147483200;background:transparent;display:flex;align-items:center;justify-content:center;";
      veil.onclick = (e) => { if (e.target === veil) closePicker(); };

      const box = document.createElement("div");
      box.style.cssText = "width:min(620px,94vw);height:min(600px,84vh);display:flex;flex-direction:column;background:rgba(8,13,22,.72);-webkit-backdrop-filter:blur(26px) saturate(130%);backdrop-filter:blur(26px) saturate(130%);color:var(--dsw-alias-text-primary,#eee);border-radius:14px;padding:14px;box-shadow:0 18px 60px rgba(0,0,0,.4);font-size:13px;";
      box.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <b>选择背景文件</b>
          <button id="dsh-dynbg-picker-x" style="border:0;background:transparent;color:inherit;cursor:pointer;font-size:18px;">✕</button>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:8px;">
          <button id="dsh-dynbg-picker-up" style="padding:5px 10px;border:1px solid rgba(127,127,127,.34);border-radius:8px;background:transparent;color:inherit;cursor:pointer;">↑ 上一级</button>
          <div id="dsh-dynbg-picker-path" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#888;padding:5px 6px;font-size:12px;"></div>
        </div>
        <div id="dsh-dynbg-picker-list" style="flex:1;overflow:auto;border:1px solid rgba(127,127,127,.2);border-radius:10px;padding:4px;"></div>
      `;
      veil.appendChild(box);
      document.body.appendChild(veil);

      document.getElementById("dsh-dynbg-picker-x").onclick = closePicker;
      document.getElementById("dsh-dynbg-picker-up").onclick = () => {
        const cur = pickerState.cwd;
        if (!cur) return;
        const parent = cur.split("/").slice(0, -1).join("/") || "/";
        browse(parent);
      };
      browse(pickerState.cwd || "");
    }

    function closePicker() {
      const el = document.getElementById("dsh-dynbg-picker");
      if (el !== null) el.remove();
    }

    // ────────── 设置面板 ──────────
    function buildPanel() {
      const veil = document.createElement("div");
      veil.id = "dsh-dynbg-veil";
      veil.style.cssText = "position:fixed;inset:0;z-index:2147483100;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;";
      veil.addEventListener("click", (e) => { if (e.target === veil) close(); });

      const box = document.createElement("div");
      box.style.cssText = "width:min(880px,92vw);max-height:90vh;overflow:auto;background:rgba(8,13,22,.72);-webkit-backdrop-filter:blur(26px) saturate(130%);backdrop-filter:blur(26px) saturate(130%);color:var(--dsw-alias-text-primary,#eee);border-radius:14px;padding:18px;box-shadow:0 18px 60px rgba(0,0,0,.4);font-size:13px;line-height:1.6;font-family:inherit;";
      box.innerHTML = `
        <h3 style="margin:0 0 4px;font-size:15px;font-weight:600;">动态背景</h3>
        <p style="margin:0 0 14px;color:var(--dsw-alias-text-secondary,#999);font-size:12.5px;">
          支持 图片 / GIF 动图 / 视频
        </p>

        <div style="margin-bottom:12px;">
          <label style="display:block;margin-bottom:6px;font-weight:500;">背景文件</label>
          <div style="display:flex;gap:8px;">
            <input id="dsh-dynbg-path" type="text" placeholder="点右边按钮选文件"
              style="flex:1;box-sizing:border-box;padding:8px 10px;border:1px solid rgba(127,127,127,.34);border-radius:9px;background:transparent;color:inherit;font:inherit;font-size:12px;" />
            <button id="dsh-dynbg-choose" style="padding:8px 14px;border:0;border-radius:9px;background:#3B89C4;color:#fff;cursor:pointer;font:inherit;white-space:nowrap;">选文件</button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
          <label style="display:block;">
            <span style="display:block;margin-bottom:6px;">蒙版浓度 <b id="dsh-dynbg-veilv">46</b>%<span style="color:#888;font-weight:400;">（壁纸上铺一层底色）</span></span>
            <input id="dsh-dynbg-veilr" type="range" min="0" max="100" step="5" style="width:100%;" />
          </label>
          <label style="display:block;">
            <span style="display:block;margin-bottom:6px;">壁纸模糊 <b id="dsh-dynbg-blurv">0</b>px</span>
            <input id="dsh-dynbg-blurr" type="range" min="0" max="40" step="2" style="width:100%;" />
          </label>
          <label style="display:block;">
            <span style="display:block;margin-bottom:6px;">不透明度 <b id="dsh-dynbg-opv">100</b>%</span>
            <input id="dsh-dynbg-opr" type="range" min="10" max="100" step="5" style="width:100%;" />
          </label>
          <label style="display:block;">
            <span style="display:block;margin-bottom:6px;">填充方式</span>
            <select id="dsh-dynbg-fit" style="width:100%;padding:6px;border:1px solid rgba(127,127,127,.34);border-radius:9px;background:transparent;color:inherit;font:inherit;">
              <option value="cover">铺满（cover）</option>
              <option value="contain">完整显示（contain）</option>
            </select>
          </label>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:6px;">
          <label style="display:block;">
            <span style="display:block;margin-bottom:6px;">输入框模糊 <b id="dsh-dynbg-cpblurv">6</b>px</span>
            <input id="dsh-dynbg-cpblurr" type="range" min="0" max="24" step="2" style="width:100%;" />
          </label>
          <label style="display:block;">
            <span style="display:block;margin-bottom:6px;">输入框底色 <b id="dsh-dynbg-cptintv">38</b>%</span>
            <input id="dsh-dynbg-cptintr" type="range" min="0" max="60" step="2" style="width:100%;" />
          </label>
        </div>
        <p style="margin:0 0 12px;color:#888;font-size:11.5px;">只在「输入框聚焦打字时」生效 —— 空着时不糊，壁纸照样透出来。</p>

        <div style="border-top:1px solid rgba(127,127,127,.2);margin:14px 0 12px;"></div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
          <label style="display:block;">
            <span style="display:block;margin-bottom:6px;">主题</span>
            <select id="dsh-dynbg-theme" style="width:100%;padding:6px;border:1px solid rgba(127,127,127,.34);border-radius:9px;background:transparent;color:inherit;font:inherit;">
              <option value="auto">自动（白天亮 / 晚上暗）</option>
              <option value="dark">固定深色</option>
              <option value="light">固定浅色</option>
            </select>
          </label>
        </div>

        <div style="margin-bottom:12px;">
          <label style="display:block;">
            <span style="display:block;margin-bottom:6px;">文字增强 / 黑客风格</span>
            <select id="dsh-dynbg-textstyle" style="width:100%;padding:6px;border:1px solid rgba(127,127,127,.34);border-radius:9px;background:transparent;color:inherit;font:inherit;">
              <option value="off">关闭（原样）</option>
              <option value="readable">清晰：加描边，不改配色（最稳）</option>
              <option value="glass">玻璃底衬：读得清，保留配色</option>
              <option value="hacker-green">黑客 · 荧光绿（最显眼，推荐）</option>
              <option value="hacker-amber">黑客 · 琥珀（暖橙，对比强）</option>
              <option value="hacker-magenta">黑客 · 品红（紫粉，跳）</option>
              <option value="hacker-white">黑客 · 亮白（最清楚）</option>
              <option value="hacker-cyan">黑客 · 青（冷调，最不抢眼）</option>
            </select>
          </label>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
          <label style="display:block;">
            <span style="display:block;margin-bottom:6px;">氛围文字</span>
            <select id="dsh-dynbg-ambient" style="width:100%;padding:6px;border:1px solid rgba(127,127,127,.34);border-radius:9px;background:transparent;color:inherit;font:inherit;">
              <option value="off">关闭</option>
              <option value="poem">漂浮诗句</option>
              <option value="binary">01 数据流</option>
            </select>
          </label>
          <label style="display:block;">
            <span style="display:block;margin-bottom:6px;">氛围浓度 <b id="dsh-dynbg-ambv">18</b>%</span>
            <input id="dsh-dynbg-ambr" type="range" min="5" max="60" step="1" style="width:100%;" />
          </label>
          <label style="display:block;">
            <span style="display:block;margin-bottom:6px;">诗句库</span>
            <select id="dsh-dynbg-poemlib" style="width:100%;padding:6px;border:1px solid rgba(127,127,127,.34);border-radius:9px;background:transparent;color:inherit;font:inherit;">
              <option value="libai">李白（969 句）</option>
              <option value="all">全唐诗（3000 句）</option>
            </select>
          </label>
          <label style="display:block;">
            <span style="display:block;margin-bottom:6px;">横向密度 <b id="dsh-dynbg-lanev">7</b> 列</span>
            <input id="dsh-dynbg-laner" type="range" min="3" max="14" step="1" style="width:100%;" />
          </label>
          <label style="display:block;">
            <span style="display:block;margin-bottom:6px;">文字颜色</span>
            <select id="dsh-dynbg-ambcolor" style="width:100%;padding:6px;border:1px solid rgba(127,127,127,.34);border-radius:9px;background:transparent;color:inherit;font:inherit;">
              <option value="theme">跟随主题（推荐）</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          <label style="display:block;">
            <span style="display:block;margin-bottom:6px;">自定颜色</span>
            <input id="dsh-dynbg-ambhex" type="color" value="#e8f4fa"
              style="width:100%;height:32px;padding:2px;border:1px solid rgba(127,127,127,.34);border-radius:9px;background:transparent;cursor:pointer;" />
          </label>
        </div>

        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:12px;font-size:12.5px;">
          <label><input type="checkbox" id="dsh-dynbg-dim" /> 压暗壁纸本身（不铺色）</label>
          <label><input type="checkbox" id="dsh-dynbg-muted" checked /> 视频静音</label>
          <label><input type="checkbox" id="dsh-dynbg-loop" checked /> 视频循环</label>
          <label><input type="checkbox" id="dsh-dynbg-persession" /> 每个对话独立背景</label>
        </div>

        <div id="dsh-dynbg-msg" style="min-height:18px;font-size:12px;color:var(--dsw-alias-text-secondary,#999);margin-bottom:10px;"></div>

        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button id="dsh-dynbg-off" style="padding:7px 16px;border:1px solid rgba(127,127,127,.34);border-radius:9px;background:transparent;color:inherit;cursor:pointer;font:inherit;">关闭背景</button>
          <button id="dsh-dynbg-save" style="padding:7px 16px;border:0;border-radius:9px;background:#3B89C4;color:#fff;cursor:pointer;font:inherit;font-weight:500;">应用</button>
        </div>
      `;
      veil.appendChild(box);
      document.body.appendChild(veil);

      const $ = (id) => box.querySelector("#" + id);
      const cfg = loadConfig();
      $("dsh-dynbg-path").value = cfg.path || "";
      $("dsh-dynbg-veilr").value = cfg.veil; $("dsh-dynbg-veilv").textContent = cfg.veil;
      $("dsh-dynbg-blurr").value = cfg.blur; $("dsh-dynbg-blurv").textContent = cfg.blur;
      $("dsh-dynbg-opr").value = cfg.opacity; $("dsh-dynbg-opv").textContent = cfg.opacity;
      $("dsh-dynbg-fit").value = cfg.fit;
      const cpb = cfg.composerBlur === undefined ? 6 : cfg.composerBlur;
      const cpt = cfg.composerTint === undefined ? 38 : cfg.composerTint;
      $("dsh-dynbg-cpblurr").value = cpb; $("dsh-dynbg-cpblurv").textContent = cpb;
      $("dsh-dynbg-cptintr").value = cpt; $("dsh-dynbg-cptintv").textContent = cpt;
      $("dsh-dynbg-theme").value = cfg.themeMode;
      $("dsh-dynbg-textstyle").value = cfg.textStyle || "readable";
      $("dsh-dynbg-ambient").value = cfg.ambient;
      $("dsh-dynbg-ambr").value = cfg.ambientOpacity; $("dsh-dynbg-ambv").textContent = cfg.ambientOpacity;
      $("dsh-dynbg-poemlib").value = cfg.poemLib;
      $("dsh-dynbg-laner").value = cfg.ambientLanes; $("dsh-dynbg-lanev").textContent = cfg.ambientLanes;
      $("dsh-dynbg-ambcolor").value = cfg.ambientColorMode;
      $("dsh-dynbg-ambhex").value = cfg.ambientColor;
      $("dsh-dynbg-dim").checked = cfg.dim === true;
      $("dsh-dynbg-muted").checked = cfg.muted !== false;
      $("dsh-dynbg-loop").checked = cfg.loop !== false;
      $("dsh-dynbg-persession").checked = cfg.perSession === true;

      const live = () => {
        const p = $("dsh-dynbg-path").value.trim();
        setConfig({
          path: p,
          enabled: p !== "",
          kind: kindOf(p),
          veil: Number($("dsh-dynbg-veilr").value),
          blur: Number($("dsh-dynbg-blurr").value),
          opacity: Number($("dsh-dynbg-opr").value),
          fit: $("dsh-dynbg-fit").value,
          composerBlur: Number($("dsh-dynbg-cpblurr").value),
          composerTint: Number($("dsh-dynbg-cptintr").value),
          themeMode: $("dsh-dynbg-theme").value,
          textStyle: $("dsh-dynbg-textstyle").value,
          ambient: $("dsh-dynbg-ambient").value,
          ambientOpacity: Number($("dsh-dynbg-ambr").value),
          ambientDensity: 3,
          poemLib: $("dsh-dynbg-poemlib").value,
          ambientLanes: Number($("dsh-dynbg-laner").value),
          ambientColorMode: $("dsh-dynbg-ambcolor").value,
          ambientColor: $("dsh-dynbg-ambhex").value,
          dim: $("dsh-dynbg-dim").checked,
          muted: $("dsh-dynbg-muted").checked,
          loop: $("dsh-dynbg-loop").checked,
          perSession: $("dsh-dynbg-persession").checked,
        });
      };

      $("dsh-dynbg-choose").onclick = openPicker;
      const labelMap = { "dsh-dynbg-veilr": "dsh-dynbg-veilv", "dsh-dynbg-blurr": "dsh-dynbg-blurv",
                         "dsh-dynbg-opr": "dsh-dynbg-opv", "dsh-dynbg-ambr": "dsh-dynbg-ambv",
                         "dsh-dynbg-laner": "dsh-dynbg-lanev",
                         "dsh-dynbg-cpblurr": "dsh-dynbg-cpblurv", "dsh-dynbg-cptintr": "dsh-dynbg-cptintv" };
      for (const id of Object.keys(labelMap)) {
        $(id).addEventListener("input", (e) => {
          const lab = $(labelMap[id]); if (lab) lab.textContent = e.target.value;
          live();
        });
      }
      for (const id of ["dsh-dynbg-fit", "dsh-dynbg-theme", "dsh-dynbg-textstyle", "dsh-dynbg-ambient", "dsh-dynbg-poemlib", "dsh-dynbg-ambcolor"]) {
        $(id).addEventListener("change", live);
      }
      for (const id of ["dsh-dynbg-dim", "dsh-dynbg-muted", "dsh-dynbg-loop", "dsh-dynbg-persession"]) {
        $(id).addEventListener("change", live);
      }
      $("dsh-dynbg-path").addEventListener("change", live);
      $("dsh-dynbg-ambhex").addEventListener("input", live);

      $("dsh-dynbg-off").onclick = () => { setConfig({ enabled: false, path: "" }); close(); };
      $("dsh-dynbg-save").onclick = () => {
        const p = $("dsh-dynbg-path").value.trim();
        const msg = $("dsh-dynbg-msg");
        // 所有设置本来就是实时生效的（live），这里只负责给一个明确反馈。
        // ⚠️ 2026-10-03 修：原来 p==="" 时直接 close()，用户看起来像"点了没反应"。
        if (p === "") {
          live();
          if (msg !== null) msg.textContent = "✓ 已应用（未设背景图，只用了主题/字号/氛围设置）";
          setTimeout(() => { try { close(); } catch (e) {} }, 900);
          return;
        }
        fetch(ROUTE_PROBE + "?path=" + encodeURIComponent(p))
          .then((r) => r.json())
          .then((d) => {
            if (d.ok) {
              if (msg !== null) msg.textContent = "✓ 已应用（" + d.kind + "，" + (d.size / 1048576).toFixed(1) + "MB）";
              live();
              setTimeout(() => { try { close(); } catch (e) {} }, 900);
            } else {
              if (msg !== null) msg.textContent = "✗ " + d.msg;
            }
          })
          .catch(() => {
            live();
            if (msg !== null) msg.textContent = "✓ 已应用（探活失败，但设置已生效）";
            setTimeout(() => { try { close(); } catch (e) {} }, 900);
          });
      };
    }

    function openPanel() {
      if (document.getElementById("dsh-dynbg-veil") !== null) return;
      buildPanel();
    }
    function close() {
      const v = document.getElementById("dsh-dynbg-veil");
      if (v !== null) v.remove();
    }

    // ────────── 侧边栏入口（React）──────────
    const SLOT_STYLE_ID = "dsh-dynbg-slot-style";
    function ensureSlotStyle() {
      if (document.getElementById(SLOT_STYLE_ID) !== null) return;
      const el = document.createElement("style");
      el.id = SLOT_STYLE_ID;
      el.textContent =
        ".dsb2-pin{display:inline-flex;align-items:center;justify-content:center;" +
        "width:28px;height:28px;padding:0;border:0;border-radius:8px;cursor:pointer;" +
        "background:transparent;color:var(--dsw-alias-text-secondary,#888);" +
        "font-size:14px;line-height:1;font-family:inherit;}" +
        ".dsb2-pin:hover{background:rgba(127,127,127,.16);color:var(--dsw-alias-text-primary,#191919)}" +
        ".dsb2-pin.dsb2-on{color:#07c160;background:rgba(7,193,96,.14)}" +
        ".dsb2-wrap{display:inline-flex;align-items:center;gap:2px}";
      document.head.appendChild(el);
    }

    function DynBgEntry() {
      ensureSlotStyle();
      const [on, setOn] = react.useState(() => loadConfig().enabled === true);
      react.useEffect(() => {
        const t = setInterval(() => setOn(loadConfig().enabled === true), 1200);
        return () => clearInterval(t);
      }, []);
      const title = on ? "动态背景：已开启（点击设置）" : "动态背景：点击设置";
      const icon = react.createElement("svg", {
        width: 15, height: 15, viewBox: "0 0 16 16", fill: "none",
        style: { display: "block" }
      },
        react.createElement("rect", { x: 1.5, y: 2.5, width: 13, height: 11, rx: 1.5, stroke: "currentColor", strokeWidth: 1.3 }),
        react.createElement("circle", { cx: 5.4, cy: 6.2, r: 1.2, fill: "currentColor" }),
        react.createElement("path", { d: "M2 11.5l3.4-3.1 2.2 2 2.6-2.6L14.5 12", stroke: "currentColor", strokeWidth: 1.3, strokeLinejoin: "round" })
      );
      return react.createElement("span", { className: "dsb2-wrap" },
        react.createElement("button", {
          type: "button",
          className: on ? "dsb2-pin dsb2-on" : "dsb2-pin",
          title: title,
          "aria-label": title,
          onClick: () => openPanel()
        }, icon)
      );
    }

    // ────────── 对外 ──────────
    let ctxRef = null;
    let migrationToast = null;

    /** 当前生效配置（每会话模式下按 session id 覆盖）。 */
    function effectiveConfig() {
      const base = loadConfig();
      if (base.perSession === true) {
        const sid = currentSessionId();
        const per = loadPerSession();
        if (per[sid] && per[sid].path) return { ...base, ...per[sid] };
      }
      return base;
    }

    function apply2(cfg) {
      ensureStyle();
      renderLayer(cfg);
      renderAmbient(cfg);
      applyThemeMode(cfg.themeMode || "auto");
    }

    function setConfig(patch) {
      const cfg = { ...loadConfig(), ...patch };
      saveConfig(cfg);
      apply2(cfg);
      if (cfg.perSession === true && patch.path !== undefined) {
        const sid = currentSessionId();
        const per = loadPerSession();
        per[sid] = { path: cfg.path, kind: cfg.kind };
        savePerSession(per);
      }
      return cfg;
    }

    function getConfig() { return loadConfig(); }

    function applyEntry(ctx) {
      ctxRef = ctx;
      
      ensureStyle();
      apply2(effectiveConfig());

      // 素材迁移后弹一次提示（8 秒自动消失），让用户/用户一眼看到切换成功
      if (migrationToast !== null) {
        const nm = migrationToast; migrationToast = null;
        try {
          const t = document.createElement("div");
          t.textContent = "背景已切换为：" + nm;
          t.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147482002;padding:9px 13px;" +
            "border-radius:9px;font-size:12.5px;background:rgba(7,193,96,.95);color:#fff;" +
            "box-shadow:0 4px 16px rgba(0,0,0,.3);font-family:inherit;";
          document.body.appendChild(t);
          setTimeout(() => { try { t.remove(); } catch (e) {} }, 8000);
        } catch (e) {}
      }

      if (ctx !== null && ctx !== undefined && typeof ctx.inject === "function") {
        try {
          ctx.inject(["slots"], (ready) => {
            try {
              ready.slots.inject("sidebar.footer.action", () => ready.slots.register({
                name: "sidebar.footer.action",
                id: "dsh-dynamic-bg-entry",
                order: 60,
                label: () => "动态背景"
              }, () => react.createElement(DynBgEntry, null)));
            } catch (e) {}
          });
        } catch (e) {}
      }

      // 系统主题变化时重新应用（auto 模式）
      try {
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const onChange = () => apply2(effectiveConfig());
        if (mq.addEventListener) mq.addEventListener("change", onChange);
        else if (mq.addListener) mq.addListener(onChange);
      } catch {}

      // 切会话时重算（每会话模式）
      let lastSid = currentSessionId();
      setInterval(() => {
        const sid = currentSessionId();
        if (sid !== lastSid) { lastSid = sid; apply2(effectiveConfig()); }
      }, 1500);
    }

    function apply3(ctx) {
      try { applyEntry(ctx); } catch (e) {
        console.error("[dsh-dynamic-bg] apply 抛错（已吞掉，不影响启动）：", e && (e.stack || e));
      }
    }

    exports.apply = apply3;
    exports.inject = [];
    exports.setConfig = setConfig;
    exports.getConfig = getConfig;
    exports.__dshDynBg = { DEFAULT, IMAGE_EXT, VIDEO_EXT, kindOf, setConfig, getConfig };

    return module.exports;
  },
});

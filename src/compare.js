// compare.js — 对比合并页面入口与控制器（T1 骨架 + T2/T4/T4b 整合）
//
// 职责：
//   1. 读取 window.__compareMount 提供的挂载约定（root / mountPoints / fileSlots / imageDrop）。
//   2. 根据工具栏按钮切换「两栏 / 三栏」两种视图（对比/合并必为两栏或三栏，无单栏）。
//   3. 绑定文件选择、块导航、图片插入、导出结果 / 导出 diff 报告。
//
// 模块契约（静态 import，文件名固定，由对应 Agent 交付；统一 build 由测试 Agent 执行）：
//   - compare-merge.js        → createCompareMergeView        （本文件新建）
//   - compare-line-markers.js → applyCompareLineMarkers       （本文件新建）
//   - compare-nav.js          → bindChunkNavigation           （本文件新建）
//   - compare-files.js        → pickFiles                     （UI-B 交付）
//   - compare-images.js       → insertImagesAtCursor / bindCompareEditorView / bindImageToolbarButton （UI-B 交付）
//   - compare-export.js       → exportResult                  （逻辑 Agent 交付）
//   - compare-diff-export.js  → buildDiffText                 （逻辑 Agent 交付，导出 diff 文本）
//
// 禁用类名闸门：
//   严禁使用方案列明的禁用类名。本文件按钮统一用 compare-toolbar-btn。

import { createCompareMergeView } from "./compare-merge.js";
import { applyCompareLineMarkers } from "./compare-line-markers.js";
import { bindChunkNavigation, bindChunkNavigationKeys } from "./compare-nav.js";
import { pickSingleFile, readCompareFiles } from "./compare-files.js";
import { resolvePickTarget, resolveDropTargets } from "./compare/pick-target.js";
import {
  bindCompareEditorView,
  bindImageToolbarButton,
  createImageUploadArea,
} from "./compare-images.js";
import { exportResult } from "./compare-export.js";
import { buildDiffText } from "./compare-diff-export.js";
// 共享编辑器扩展工厂（编辑页 / 对比·合并页共用同一套 CM6 内核，见设计文档 §8.1/§8.2）
import { createEditorExtensions } from "./editor-extensions.js";
// 保存轮询 + 另存为弹窗（§5）
import { runSavePoll, showSaveAsDialog } from "./save-poll.js";
// 可复用多栏滚动同步（§9）；控制器由 createCompareMergeView 内部创建并挂到 instance.scrollSync，
// 本文件只消费、不再自建（修复 H1：避免三栏下重复监听 / 按钮失效）。
// 文件读写桥（导出 diff 写盘走 ioBridge.saveAs）
import { ioBridge } from "./compare/io-bridge.js";
// 活动栏（用户最后聚焦的栏）状态与保存链路
import {
  setActivePane,
  getActivePane,
} from "./compare/save.js";
// 批量接受块（chunk-ops 纯函数层）：应用所有非冲突块，单次 dispatch 不漂移
import { applyNonConflicting } from "./compare/chunk-ops.js";
// 活动栏描边：必须走 CodeMirror 的 editorAttributes facet，不能手工 classList。
// 详见 pane-active.js 顶部说明（CM 会在焦点变化时整体覆写 .cm-editor 的 class）。
import {
  paneActiveExtension,
  setPaneActiveClass,
  PANE_ACTIVE_CLASS,
} from "./compare/pane-active.js";
// 位置概览侧栏（第三期）：差异缩略条 + 移动连线 + 文档大纲
import { createLocationPane } from "./compare/location-pane.js";
// 主题同步复用主编辑器的权威函数，保证对比页 data-theme/data-editor-theme/data-skin
// 与「编辑器主题预设 kind」完全一致（而非 light/dark 开关键），缺省回退默认预设/经典配色。
import {
  applyEditorThemePreset,
  getStoredEditorTheme,
  getThemeKind,
} from "./theme-presets.js";
import { getColorScheme } from "./md-theme-tokens.js";
import { initToolbarScroll } from "./toolbar-scroll.js";

(function bootstrapCompare() {
  // 挂载点直接取自 compare.html 中定义的 DOM 节点（不再依赖 window.__compareMount，
  // 该约定在 compare.html 中并未注入，否则会导致整页无法初始化）。
  const root = document.getElementById("compareRoot");
  const mountPoints = {
    two: document.getElementById("viewTwo"),
    three: document.getElementById("viewThree"),
  };
  const fileSlots = {
    a: document.getElementById("fileSlotA"),
    b: document.getElementById("fileSlotB"),
  };
  if (!root || !mountPoints.two || !mountPoints.three) {
    console.error(
      "[compare] 未找到必要的挂载节点（#compareRoot / #viewTwo / #viewThree）"
    );
    return;
  }

  // ── 运行时状态 ──
  /** @type {{a:?{name:string,content:string,target?:?object}, b:?{name:string,content:string,target?:?object}, c?:?{name:string,content:string,target?:?object}, result?:?string}} */
  const files = { a: null, b: null, c: null, result: null };
  /** @type {{a:?string, b:?string, c:?string, result:?string}} 各栏初始内容快照（D8 脏检查：相对载入内容是否改动） */
  const loadedContent = { a: null, b: null, c: null, result: null };
  let mode = "compare"; // 'compare' | 'merge'（§3）
  let colCount = 2;     // compare 模式下 2|3；merge 模式固定 3
  let scrollSyncEnabled = true; // 滚动同步开关（§9，默认开）
  /** @type {object|null} 多栏滚动同步控制器（消费 instance.scrollSync，见 §6/#9，修复 H1） */
  let scrollSync = null;
  let instance = null; // 当前视图实例
  // 跳过下一次 render 的「编辑回写」：仅在「重新载入文件（onPickFiles / 拖拽）」时置位，
  // 避免 render() 顶部的 saveCurrentEdit 用陈旧/空的编辑器文档覆盖刚载入的文件内容
  // （否则两栏/三栏编辑器恒为空，差异高亮/导航/折叠/接受块全部失效）。
  let skipSaveOnNextRender = false;
  // 图片插入 / 光标坐标所用的活动编辑器视图（与 bindCompareEditorView 绑定的视图同源）
  let activeView = null;
  // ── 位置概览侧栏（第三期）──
  /** @type {{update:()=>void, destroy:()=>void}|null} */
  let locationPane = null;
  /** @type {(()=>void)|null} 解绑 instance.onRefresh 的句柄 */
  let unsubscribeLocationPane = null;
  /** @type {(()=>void)|null} 解绑 instance.onRefresh(状态计数/方向按钮) 的句柄 */
  let unsubscribeStatus = null;
  /** 各栏关闭（隐藏）状态，跨 render 保留（关掉某栏后切换两/三栏再切回仍保持） */
  const paneOffState = { a: false, b: false, c: false };
  const LOCATION_PANE_KEY = "md-compare-location-pane";
  // 默认开启：概览是第三期的核心增量，首次进入应能直接看到；用户关掉后经 localStorage 记住。
  let locationPaneVisible = (() => {
    try {
      return localStorage.getItem(LOCATION_PANE_KEY) !== "0";
    } catch (_) {
      return true; // 隐私模式 / storage 被禁：退回默认开启
    }
  })();

  // ── 主题同步：复用主编辑器的权威主题应用函数，使对比页与主 UI 主题/配色/皮肤完全一致（修复已知问题4）──
  // 关键事实：主编辑器 data-theme 由「编辑器主题预设的 kind」决定（editor.js:2178 → applyEditorThemePreset，
  // 其内部 data-theme = kind==='dark'?'dark':'light'），而非 light/dark 开关键；且 data-editor-theme /
  // data-color-scheme 在缺省时用默认预设/经典配色。直接复用同一组函数，可保证默认配置与暗色预设下均一致。
  let currentTheme = 'light';
  function applyCompareTheme() {
    const t = getThemeKind(getStoredEditorTheme());
    currentTheme = t;                       // 供 baseExtensions() 决定 CM6 oneDark 轴（与主编辑器同一开关键）
    applyEditorThemePreset(getStoredEditorTheme());   // data-theme(预设kind) / data-editor-theme / data-skin=glass
    document.documentElement.setAttribute('data-color-scheme', getColorScheme());  // 与主编辑器同一读取键，缺省 classic
    return t;
  }
  applyCompareTheme();
  // 主 UI 切换主题后（同源 localStorage 变更）实时同步对比页
  window.addEventListener('storage', (e) => {
    if (e.key && /md-editor-(theme|editor-theme|color-scheme|skin)/.test(e.key)) {
      applyCompareTheme();
      try { render(); } catch (_) {}
    }
  });

  // 公共扩展：复用编辑页同款内核（语法高亮彩色 / 查找替换 / / 面板 / 块拖拽 + 选区拖拽）
  // + 对照/合并专属 diff 行标记 + 活动栏跟踪。Callout 不做盒子渲染（仅源码语法高亮，见 §D12）。
  function baseExtensions() {
    return [
      ...createEditorExtensions({ theme: currentTheme }), // 替换原 markdown()+lineWrapping 裸装
      applyCompareLineMarkers(),   // diff 行标记（对照/合并专属，保留）
      ...paneActiveExtension(),    // 活动栏跟踪（保留）
    ];
  }

  // ── DOM 查询 ──
  const $ = (id) => document.getElementById(id);
  // 模式切换：对照 / 合并（按钮由 C3 在 compare.html 注入，此处做 null 保护）
  const btnModeCompare = $("btnModeCompare");
  const btnModeMerge = $("btnModeMerge");
  // 列数切换（仅对照模式出现，动态文案「两栏」/「三栏」，由 C3 显隐）
  const btnColToggle = $("btnColToggle");
  // 滚动同步开关
  const btnScroll = $("btnScroll");
  const btnPrevChunk = $("btnPrevChunk");
  const btnNextChunk = $("btnNextChunk");
  const btnPickFiles = $("btnPickFiles");
  const btnExportResult = $("btnExportResult");
  const btnExportDiff = $("btnExportDiff");
  const btnAddImages = $("btnAddImages");
  const btnToggleCollapse = $("btnToggleCollapse");
  const btnAcceptTheirs = $("btnAcceptTheirs");
  const btnToggleLocationPane = $("btnToggleLocationPane");
  const locationPaneEl = $("locationPane");
  const locationPaneResizerEl = $("locationPaneResizer");
  // 「保存」按钮由 compare.html 提供；该按钮可能尚未上线，必须做 null 保护
  const btnSave = $("btnSave");

  // ── 批量合并相关元素（对齐 JetBrains Merge Revisions 顶部栏）──
  const btnApplyNonConflicting = $("btnApplyNonConflicting");
  const btnAcceptLeft = $("btnAcceptLeft");
  const btnAcceptAll = $("btnAcceptAll");
  const btnAcceptRight = $("btnAcceptRight");
  const selHighlightWords = $("selHighlightWords");
  const statusCountEl = $("compareStatusCount");
  const compareViewHeader = $("compareViewHeader");
  const comparePanes = $("comparePanes");
  // B↔C 栏间逐块采纳列已迁移至 compare-merge.js（mountBcRevertColumn），本文件不再持有静态按钮组。
  const paneTitles = {
    a: $("paneTitleA"),
    b: $("paneTitleB"),
    c: $("paneTitleC"),
  };
  const paneToggles = {
    a: $("paneToggleA"),
    b: $("paneToggleB"),
    c: $("paneToggleC"),
  };

  // 注入扩展版本戳：版本唯一事实源 = package.json，Vite 构建时经 __APP_VERSION__ 注入，
  // 运行时兜底 1.9.5（与 editor.js 保持一致，避免 compare 页版本戳写死漂移）。
  const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.9.5";
  const verEl = $("compareVersion");
  if (verEl) verEl.textContent = `v${APP_VERSION}`;

  // ── 文件槽 UI 更新 ──
  function setSlotText(slot, file) {
    if (!slot) return;
    const nameEl = slot.querySelector(".compare-file-name");
    if (nameEl) {
      nameEl.textContent = file
        ? file.name
        : (slot.dataset.slot === "a" ? "本地文件" : "对方文件") + "（未选择）";
    }
  }

  // ── 销毁旧实例并清空挂载点 ──
  function teardown() {
    // 概览侧栏必须【先于】视图实例销毁：它持有 instance.a / instance.b 的引用与
    // scroll 监听，若等视图先毁再毁它，中间任何一次 update() 都会摸到已销毁的 view。
    if (unsubscribeLocationPane) {
      try {
        unsubscribeLocationPane();
      } catch (_) {}
      unsubscribeLocationPane = null;
    }
    // 状态计数 / 方向按钮的 onRefresh 订阅必须【先于】视图实例销毁，否则回调会摸到已销毁的 view。
    if (unsubscribeStatus) {
      try {
        unsubscribeStatus();
      } catch (_) {}
      unsubscribeStatus = null;
    }
    if (locationPane) {
      try {
        locationPane.destroy();
      } catch (e) {
        console.error("[compare] 销毁位置概览失败:", e);
      }
      locationPane = null;
    }
    if (instance) {
      try {
        instance.destroy();
      } catch (e) {
        console.error("[compare] 销毁旧视图失败:", e);
      }
      instance = null;
    }
    // 滚动同步控制器必须随视图销毁（解绑 scroll/focus 监听，避免对已销毁视图空转）
    if (scrollSync) {
      try {
        scrollSync.destroy();
      } catch (_) {
        /* 忽略 */
      }
      scrollSync = null;
    }
    bindCompareEditorView(null);
    activeView = null;
    for (const el of Object.values(mountPoints)) {
      if (!el) continue;
      el.innerHTML = "";
      el.hidden = true;
    }
  }

  // ── 活动栏视觉标识 ──
  // Ctrl+S /「保存」写回的是【当前活动栏】，这是【写盘】操作：用户必须能一眼确认
  // 「现在会存进哪个文件」，否则极易覆盖错文件。因此活动栏不能只是 save.js 里的一个
  // 模块变量，必须在 DOM 上有对应描边。类名打在 view.dom（即 .cm-editor）上，
  // 由 compare.css 的 #compareRoot 提权规则着色。
  //
  // 【实现要点】类名由 pane-active.js 经 EditorView.editorAttributes facet 交给
  // CodeMirror 自行渲染。绝不可退回 view.dom.classList.add()：CM 在焦点变化时会
  // 整体覆写 .cm-editor 的 class 属性，手工加的类会在用户点一下编辑器时被抹掉
  // （真机实测：render 后类在，点击 .cm-content 后类消失 → 描边丢失、写盘目标不可见）。
  // PANE_ACTIVE_CLASS 从 pane-active.js 导入，保持类名单一事实源。

  // pane 键 → view 的映射与 currentPanes() 严格一致：
  //   两栏 a=Yours, b=Theirs；三栏 a=Yours, b=Result, c=Theirs(theirsView)。
  // 若二者错位，会出现「描边在 A、实际存到 B」这类最危险的不一致。
  function paneViewMap() {
    if (!instance) return {};
    return { a: instance.a, b: instance.b, c: instance.theirsView };
  }

  function applyActivePaneClass() {
    if (!instance) return;
    let active = "a";
    try {
      active = getActivePane();
    } catch (_) {
      /* 取值异常：退回默认 'a'，宁可描边保守也不能无描边 */
    }
    for (const [pane, view] of Object.entries(paneViewMap())) {
      if (!view || !view.dom) continue;
      const shouldBeActive = pane === active;
      // 首选路径：经 editorAttributes 由 CodeMirror 渲染，能扛住 CM 对 class 的整体覆写。
      if (setPaneActiveClass(view, shouldBeActive)) continue;
      // 兜底路径：该 view 未挂载 pane-active 扩展（例如被外部直接构造的视图）。
      // 此路径下的类仍可能被 CM 在下次焦点变化时抹掉，属已知降级，不作为主依赖。
      view.dom.classList.toggle(PANE_ACTIVE_CLASS, shouldBeActive);
    }
  }

  // ── 活动栏跟踪：哪一栏最后获得焦点，Ctrl+S / 「保存」就落到哪一栏 ──
  // 每次 render 都会 teardown 重建 view，DOM 节点是全新的，监听器随旧 DOM 一起被丢弃，
  // 因此这里无需手动解绑，也不会泄漏。
  function bindPaneFocus(view, pane) {
    if (!view || !view.dom) return;
    view.dom.addEventListener("focusin", () => {
      try {
        setActivePane(pane);
      } catch (_) {
        /* 非法 pane 值：忽略，保持上一次活动栏，且不刷新描边（避免与实际保存目标错位） */
        return;
      }
      // M6：图片插入/落图目标跟随实际聚焦的栏（a→instance.a、b→instance.b、c→instance.theirsView），
      // 否则永远写在 b 栏，与用户聚焦的 a/c 栏不一致。
      const target = paneViewMap()[pane];
      if (target) {
        activeView = target;
        bindCompareEditorView(target);
      }
      applyActivePaneClass();
    });
  }

  // ── 模式 / 列数 → DOM 类（供 CSS 依据 .mode-compare / .mode-merge 切显隐）──
  function applyModeClasses() {
    const body = document.body;
    // 模式类切在 document.body 上（而非 #compareRoot/main）。<header> 内的 .merge-only
    // 组与 <main> 均为 body 的后代，.mode-compare .merge-only / .compare-mode-compare
    // .merge-only 后代选择器才能匹配，从而对照模式下隐藏合并专用控件（§3 / D1 / D10）。
    // 同时兼容旧命名 .mode-* 与注释约定的 .compare-mode-* 双前缀。
    // 注：三栏真实类由 compare-merge.js 加在 parent 上的 .compare-three-layout 承担，
    // 本文件不再写死任何 .three-col 死类（L6）。
    body.classList.toggle("mode-compare", mode === "compare");
    body.classList.toggle("mode-merge", mode === "merge");
    body.classList.toggle("compare-mode-compare", mode === "compare");
    body.classList.toggle("compare-mode-merge", mode === "merge");
  }

  // 列数切换按钮文案（对照模式动态：两栏 ↔ 三栏）
  function updateColToggleLabel() {
    if (btnColToggle) btnColToggle.textContent = colCount === 2 ? "三栏" : "两栏";
  }

  // 滚动同步按钮状态
  function updateScrollButton() {
    if (btnScroll) {
      btnScroll.classList.toggle("active", scrollSyncEnabled);
      btnScroll.title = scrollSyncEnabled
        ? "滚动同步：开（点击关闭）"
        : "滚动同步：关（点击开启）";
    }
  }

  // 取实例各栏视图（优先 C2 暴露的 getPanes，失败兜底按 files/instance 构造）
  function instanceViews() {
    if (instance && typeof instance.getPanes === "function") {
      try {
        return instance.getPanes().map((p) => p.view).filter(Boolean);
      } catch (_) {
        /* 退回兜底 */
      }
    }
    return [instance && instance.a, instance && instance.b, instance && instance.theirsView].filter(
      Boolean
    );
  }

  // 构建保存轮询用的 panes 数组（形状对齐 save-poll.js：[{ key, view, target, content }]）。
  // 优先用 C2 在实例上暴露的 getPanes()（§10.2 / 共享契约）；不可用时按本文件状态兜底构造。
  function buildPanes() {
    if (instance && typeof instance.getPanes === "function") {
      try {
        return instance.getPanes();
      } catch (_) {
        /* 退回兜底 */
      }
    }
    const out = [];
    if (instance && instance.a) {
      out.push({
        key: "a",
        view: instance.a,
        target: files.a ? files.a.target : null,
        content: instance.a.state.doc.toString(),
      });
    }
    if (instance && instance.b) {
      // 合并模式 b=合并结果（无源，target 为 null）；对照模式 b=真实文件（带 target）
      const bTarget = mode === "merge" ? null : files.b ? files.b.target : null;
      out.push({
        key: "b",
        view: instance.b,
        target: bTarget,
        content: instance.b.state.doc.toString(),
      });
    }
    if (instance && instance.theirsView) {
      out.push({
        key: "c",
        view: instance.theirsView,
        target: files.c ? files.c.target : null,
        content: instance.theirsView.state.doc.toString(),
      });
    }
    return out;
  }

  // 保存轮询顺序（从左到右）：compare 2 栏 [a,b]；merge / compare 3 栏 [a,b,c]
  function buildOrder() {
    return mode === "merge" ? ["a", "b", "c"] : colCount === 3 ? ["a", "b", "c"] : ["a", "b"];
  }

  // D8 脏检查：任一可见栏当前内容相对其载入快照是否改动
  function isAnyPaneDirty() {
    const check = (view, key) => {
      if (!view) return false;
      const snap = loadedContent[key];
      if (snap == null) return false; // 未记录初始内容（如空初始），视为无改动
      return view.state.doc.toString() !== snap;
    };
    if (!instance) return false;
    if (mode === "merge") {
      return (
        check(instance.a, "a") ||
        check(instance.b, "result") ||
        check(instance.theirsView, "b")
      );
    }
    if (colCount === 3) {
      return (
        check(instance.a, "a") ||
        check(instance.b, "b") ||
        check(instance.theirsView, "c")
      );
    }
    return check(instance.a, "a") || check(instance.b, "b");
  }

  // 保存成功后刷新初始内容快照，使 D8 脏检查复位为「干净」
  function refreshLoadedSnapshots() {
    if (!instance) return;
    if (instance.a) loadedContent.a = instance.a.state.doc.toString();
    if (instance.b) loadedContent[mode === "merge" ? "result" : "b"] = instance.b.state.doc.toString();
    if (instance.theirsView) loadedContent[mode === "merge" ? "b" : "c"] = instance.theirsView.state.doc.toString();
  }

  function paneFullPath(p) {
    // 合并模式：中栏 b=合并结果（无源，无路径）；右栏 c 实际展示 files.b（对方）内容
    let f;
    if (p === "b" && mode === "merge") f = null;
    else if (p === "c" && mode === "merge") f = files.b;
    else f = files[p];
    if (!f) return "";
    const t = f.target;
    if (t && typeof t.path === "string" && t.path) return t.path;
    if (t && t.handle && t.handle.name) return t.handle.name;
    return f.name || "";
  }

  // 块对齐未对齐弹窗（§9.2 / createScrollSync.onMisalign）：选项 A 跳到激活栏光标处 / B 维持当前位置
  function showMisalignDialog() {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);font-family:system-ui,-apple-system,'Segoe UI',sans-serif;";
    const box = document.createElement("div");
    box.style.cssText =
      "min-width:300px;max-width:90vw;background:#1e1e22;color:#e8e8ea;border:1px solid #3a3a40;border-radius:10px;padding:16px 18px;";
    const title = document.createElement("div");
    title.textContent = "各栏光标段落未对齐";
    title.style.cssText = "font-size:14px;font-weight:600;margin-bottom:8px;";
    const hint = document.createElement("div");
    hint.textContent =
      "是否把各栏滚动并移动光标到激活栏所在段落（强制对齐后再联动），还是维持各栏当前位置直接联动？";
    hint.style.cssText = "font-size:12px;color:#b0b0b8;margin-bottom:12px;line-height:1.5;";
    const bar = document.createElement("div");
    bar.style.cssText = "display:flex;gap:8px;";
    const mk = (label, fn) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText =
        "flex:1;padding:8px;border:1px solid #4a4a52;border-radius:6px;background:#33333a;color:#e8e8ea;cursor:pointer;font-size:13px;";
      b.onclick = () => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        fn();
      };
      return b;
    };
    bar.appendChild(
      mk("跳到激活栏光标处", () => {
        if (scrollSync) scrollSync.alignToActive();
      })
    );
    bar.appendChild(
      mk("维持当前位置", () => {
        if (scrollSync) scrollSync.keepAsIs();
      })
    );
    box.appendChild(title);
    box.appendChild(hint);
    box.appendChild(bar);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  // ── 渲染当前模式 ──
  function render() {
    // 保存当前编辑内容，避免模式切换 / 重渲染丢失（修复 E1-01/02：无声数据丢失）
    // 但「重新载入文件」场景（onPickFiles / 拖拽）会先置 skipSaveOnNextRender，
    // 跳过本次回写，否则会用陈旧编辑器文档覆盖刚载入的文件内容。
    if (!skipSaveOnNextRender && instance) {
      try {
        if (mode === "merge") {
          // 合并：a=本地 / b=合并结果(可编辑) / c=对方，三者均可编辑，全部回写
          if (instance.a)
            files.a = files.a
              ? { ...files.a, content: instance.a.state.doc.toString() }
              : { name: "本地", content: instance.a.state.doc.toString() };
          files.result = instance.b ? instance.b.state.doc.toString() : (files.result || "");
          if (instance.theirsView)
            files.b = files.b
              ? { ...files.b, content: instance.theirsView.state.doc.toString() }
              : { name: "对方", content: instance.theirsView.state.doc.toString() };
        } else if (colCount === 3) {
          // 对照三栏：a/b/c 三个真实文件
          if (instance.a)
            files.a = files.a
              ? { ...files.a, content: instance.a.state.doc.toString() }
              : { name: "本地", content: instance.a.state.doc.toString() };
          if (instance.b)
            files.b = files.b
              ? { ...files.b, content: instance.b.state.doc.toString() }
              : { name: "对方", content: instance.b.state.doc.toString() };
          if (instance.theirsView)
            files.c = files.c
              ? { ...files.c, content: instance.theirsView.state.doc.toString() }
              : { name: "文件三", content: instance.theirsView.state.doc.toString() };
        } else {
          // 对照两栏：a/b 两个真实文件
          if (instance.a)
            files.a = files.a
              ? { ...files.a, content: instance.a.state.doc.toString() }
              : { name: "本地", content: instance.a.state.doc.toString() };
          if (instance.b)
            files.b = files.b
              ? { ...files.b, content: instance.b.state.doc.toString() }
              : { name: "对方", content: instance.b.state.doc.toString() };
        }
      } catch (e) {
        console.error("[compare] 保存编辑内容失败:", e);
      }
    }
    skipSaveOnNextRender = false; // 一次性跳过已消费，后续 render（模式切换等）恢复回写
    teardown();
    // 重置栏隐藏类（切换两/三栏时避免残留），随后按 paneOffState 重新应用
    if (comparePanes) {
      comparePanes.classList.remove("pane-off-a", "pane-off-b", "pane-off-c");
      for (const p of ["a", "b", "c"]) {
        if (paneOffState[p]) comparePanes.classList.add("pane-off-" + p);
      }
    }
    applyModeClasses();
    const aFile = files.a || { name: "本地", content: "" };
    const bFile = files.b || { name: "对方", content: "" };
    const target = colCount === 3 ? mountPoints.three : mountPoints.two;
    if (!target) return;
    target.hidden = false;

    try {
      if (mode === "merge") {
        instance = createCompareMergeView({
          mode: "merge",
          layout: "three",
          a: aFile, // 本地
          b: { name: "合并结果", content: files.result || "" }, // 合并结果（无源，target:null）
          c: bFile, // 对方
          extensions: baseExtensions(),
          parent: target,
          onMisalign: () => showMisalignDialog(),
        });
        // M6：图片插入/落图目标不再硬绑 instance.b，改为跟随活动栏
        // （见 bindPaneFocus 的 focusin 与下方 setActivePane 复位后的绑定）。
        bindPaneFocus(instance.a, "a");
        bindPaneFocus(instance.b, "b");
        bindPaneFocus(instance.theirsView, "c");
      } else if (colCount === 3) {
        const cFile = files.c || { name: "文件三", content: "" };
        instance = createCompareMergeView({
          mode: "compare",
          layout: "three",
          a: aFile, // 文件一
          b: bFile, // 文件二
          c: cFile, // 文件三（真实文件，可编辑、可保存）
          extensions: baseExtensions(),
          parent: target,
          onMisalign: () => showMisalignDialog(),
        });
        // M6：图片插入/落图目标不再硬绑 instance.b，改为跟随活动栏
        // （见 bindPaneFocus 的 focusin 与下方 setActivePane 复位后的绑定）。
        bindPaneFocus(instance.a, "a");
        bindPaneFocus(instance.b, "b");
        bindPaneFocus(instance.theirsView, "c");
      } else {
        instance = createCompareMergeView({
          mode: "compare",
          layout: "two",
          a: aFile, // 文件一
          b: bFile, // 文件二
          extensions: baseExtensions(),
          parent: target,
          onMisalign: () => showMisalignDialog(),
        });
        // M6：图片插入/落图目标不再硬绑 instance.b，改为跟随活动栏
        // （见 bindPaneFocus 的 focusin 与下方 setActivePane 复位后的绑定）。
        bindPaneFocus(instance.a, "a");
        bindPaneFocus(instance.b, "b");
      }
    } catch (e) {
      console.error("[compare] 渲染视图失败:", e);
      target.innerHTML = "";
      const hint = document.createElement("div");
      hint.className = "compare-empty-hint";
      hint.textContent = "渲染失败：" + (e && e.message ? e.message : String(e));
      target.appendChild(hint);
    }

    // 高亮当前模式按钮
    if (btnModeCompare) btnModeCompare.classList.toggle("active", mode === "compare");
    if (btnModeMerge) btnModeMerge.classList.toggle("active", mode === "merge");
    updateColToggleLabel();

    // 滚动同步：控制器由 createCompareMergeView 内部创建并挂在 instance.scrollSync，
    // 本文件只消费、不再自建（修复 H1：避免三栏下重复监听 / 按钮失效）。
    // 重建实例后重新取引用，并按当前本地开关态同步控制器（setEnabled 写回实例内部开关）。
    if (instance) {
      try {
        scrollSync = instance.scrollSync || null;
      } catch (e) {
        console.error("[compare] 初始化滚动同步失败:", e);
        scrollSync = null;
      }
    }
    // M5（补充）：重建后控制器内部开关被重置为默认开，需用 compare.js 的本地开关态覆盖，
    // 保证「滚动」按钮的高亮与真实生效状态一致。
    if (scrollSync) {
      if (scrollSyncEnabled) scrollSync.enable();
      else scrollSync.disable();
    }
    updateScrollButton();

    // 同步折叠状态与按钮文案（跨模式切换保持一致）
    if (instance && typeof instance.setCollapse === "function") {
      instance.setCollapse(collapsed);
    }
    if (btnToggleCollapse) {
      btnToggleCollapse.textContent = collapsed ? "展开未改" : "折叠未改";
    }

    // M3：「接受 Theirs 块」仅在三栏模式可用（两栏实例返回 false）
    if (btnAcceptTheirs) {
      btnAcceptTheirs.disabled = colCount !== 3;
      btnAcceptTheirs.classList.toggle("disabled", colCount !== 3);
      // M5：文案随模式变化（合并=并入结果；对照=插入中栏文件二），避免语义误导。
      // 启用逻辑保持不变（仅三栏启用）。
      btnAcceptTheirs.title =
        mode === "merge"
          ? "把光标所在的对方块并入合并结果"
          : "把光标所在的对方块插入到中栏（文件二）";
    }

    // 活动栏复位：旧视图已随 teardown 销毁，若沿用上次的活动栏（如三栏切两栏后仍指向 'c'），
    // 保存时会取到不存在的栏。统一复位到 'a'，等用户实际聚焦后再更新。
    try {
      setActivePane("a");
    } catch (_) {}
    // 视图刚重建，描边随旧 DOM 一起消失了，必须按复位后的活动栏重新打上，
    // 否则重渲染后会出现「没有任何栏带描边、但 Ctrl+S 仍会写 A 栏」的静默不一致。
    applyActivePaneClass();

    // M6：图片插入/落图目标跟随活动栏。render 后活动栏已复位为 'a'，故初始绑定 instance.a；
    // 用户聚焦 a/b/c 时由 bindPaneFocus 的 focusin 实时改写 activeView 与 bindCompareEditorView。
    {
      const map = paneViewMap();
      activeView = (instance && (map[getActivePane()] || instance.b)) || null;
      if (activeView) bindCompareEditorView(activeView);
    }

    // 补齐 UI：刷新 per-pane 标题（Yours / Result / Theirs）与差异/冲突计数。
    // 首帧 diff 尚未落定，计数可能为 0；onRefresh 订阅后会在 diff 算完时再刷一次。
    updatePaneHeader();
    syncDirectionTooltips();
    // 修复 R5：createCompareMergeView 内部默认 wordDiffMode='word'，而 #selHighlightWords
    // 是页面级静态控件，其值在 render 间不会重置。若不回填，用户选「关闭 / 按字符」后
    // 一旦重渲染（切换视图模式、重新载入文件），装饰会悄悄退回「按词」，
    // 造成「下拉显示 A、实际行为 B」的静默不一致。
    onHighlightWordsChange();
    updateStatusCount();
    if (instance && typeof instance.onRefresh === "function") {
      instance.onRefresh(() => {
        updateStatusCount();
      });
    }

    // 位置概览侧栏：随视图一同重建（旧实例已在 teardown 中销毁）。
    // 首帧刷新同样推到下一帧：此刻视图 DOM 刚插入，CM 尚未完成首次 measure，
    // 同帧调 update() 量到的视口尺寸是无效的。
    mountLocationPane();
    scheduleAfterLayout(() => {
      if (locationPane) locationPane.update();
      if (instance && typeof instance.redrawConnectors === "function") {
        instance.redrawConnectors();
      }
    });
  }

  // ── 位置概览侧栏：挂载 / 可见性 ──
  function mountLocationPane() {
    if (!locationPaneEl) return;
    // 幂等保护：本函数会覆盖 locationPane 引用，若进来时旧面板还在，
    // 旧面板与它的 onRefresh 订阅就再也无人 destroy —— 泄漏一个持有 instance.a/b 引用
    // 与 scroll 监听的僵尸面板。当前两个调用点恰好都先清理了，但那是【调用方纪律】而非
    // 【函数保证】，这里补上函数自身的保证。
    // 顺序与 teardown() 一致：必须【先 unsubscribe 再 destroy】——
    // 反过来的话，destroy 与退订之间若恰好触发一次 refresh，回调会摸到已销毁的面板。
    if (unsubscribeLocationPane) {
      try {
        unsubscribeLocationPane();
      } catch (_) {}
      unsubscribeLocationPane = null;
    }
    if (locationPane) {
      try {
        locationPane.destroy();
      } catch (e) {
        console.error("[compare] 销毁旧位置概览失败:", e);
      }
      locationPane = null;
    }
    locationPaneEl.hidden = !locationPaneVisible;
    // 分隔条与侧栏同生共死：侧栏隐藏时留一根可拖拽的空条会让人误以为侧栏还在。
    if (locationPaneResizerEl) locationPaneResizerEl.hidden = !locationPaneVisible;
    if (btnToggleLocationPane) {
      btnToggleLocationPane.classList.toggle("active", locationPaneVisible);
    }
    if (!locationPaneVisible || !instance) return;
    try {
      locationPane = createLocationPane({
        container: locationPaneEl,
        instance,
        getConnectorLayers:
          typeof instance.getConnectorLayers === "function"
            ? instance.getConnectorLayers
            : () => [],
      });
      // 注意：这里【不】立即 update()。首帧刷新的时机由调用方决定 ——
      // 侧栏出现/消失会改变编辑器宽度，同帧尚未 reflow，此刻量出来的视口是旧宽度下的值
      // （详见 toggleLocationPane 的 rAF 说明）。render() 路径下由本函数末尾同步刷一次即可。
      // diff 是异步落定的：构造瞬间 chunks 往往还是空的，此时画出来的概览是空条。
      // 订阅实例的装饰刷新事件，等 diff 真正算完再重画（无需自己另起轮询）。
      if (typeof instance.onRefresh === "function") {
        unsubscribeLocationPane = instance.onRefresh(() => {
          if (locationPane) locationPane.update();
        });
      }
    } catch (e) {
      console.error("[compare] 位置概览初始化失败:", e);
      locationPane = null;
    }
  }

  /**
   * 把回调推到下一帧执行（无 rAF 环境降级为同步）。
   *
   * 【为何布局相关的量取必须等下一帧】侧栏 176px 的出现/消失会改变编辑器可用宽度，
   * 进而触发软换行重排；CM6 的高度重测是异步 measure cycle，同帧读到的仍是旧宽度下的值。
   * 概览刷新（updateViewport 要量可见区）与连线重绘（要量栏边缘 x）依赖的是同一份布局，
   * 因此调用方应把两者放进【同一个】本函数回调里，而不是各推各的帧。
   */
  function scheduleAfterLayout(fn) {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn);
    else fn();
  }

  function toggleLocationPane() {
    locationPaneVisible = !locationPaneVisible;
    try {
      localStorage.setItem(LOCATION_PANE_KEY, locationPaneVisible ? "1" : "0");
    } catch (_) {
      /* storage 不可用：仅本次会话生效 */
    }
    // 按新状态重建概览（旧概览与其订阅由 mountLocationPane 自身保证清理），
    // 随后把「概览刷新 + 连线重绘」放进【同一个】下一帧回调 —— 侧栏出现/消失会改变栏宽，
    // 连线端点 x 坐标与概览视口指示器依赖的是同一份 reflow 后的尺寸，分开推帧会不自洽。
    mountLocationPane(); // 只建骨架
    scheduleAfterLayout(() => {
      if (locationPane) locationPane.update();
      if (instance && typeof instance.redrawConnectors === "function") {
        instance.redrawConnectors();
      }
    });
  }

  // ── 差异概览侧栏：拖拽调整宽度 ──
  // 宽度写在 #locationPane 自身的 --lp-width 上（compare.css 里 flex-basis 读它），
  // 并持久化到 localStorage，刷新/重开对比页后保持用户设定。
  const LP_WIDTH_KEY = "md-compare-location-pane-width";
  const LP_WIDTH_DEFAULT = 176;
  const LP_WIDTH_MIN = 120;
  // 上限不写死像素：窄窗口下 560px 会把编辑区挤没。取「视图容器宽度的 60%」与 560 的较小值。
  const LP_WIDTH_MAX_ABS = 560;

  function lpMaxWidth() {
    const host = locationPaneEl && locationPaneEl.parentElement;
    const avail = host ? host.clientWidth : 0;
    if (!avail) return LP_WIDTH_MAX_ABS;
    return Math.max(LP_WIDTH_MIN, Math.min(LP_WIDTH_MAX_ABS, Math.round(avail * 0.6)));
  }

  function clampLpWidth(px) {
    const n = Number(px);
    if (!Number.isFinite(n)) return LP_WIDTH_DEFAULT;
    return Math.round(Math.min(lpMaxWidth(), Math.max(LP_WIDTH_MIN, n)));
  }

  function applyLpWidth(px, { persist = false } = {}) {
    if (!locationPaneEl) return;
    const w = clampLpWidth(px);
    locationPaneEl.style.setProperty("--lp-width", `${w}px`);
    if (persist) {
      try {
        localStorage.setItem(LP_WIDTH_KEY, String(w));
      } catch (_) {
        /* storage 不可用：仅本次会话生效 */
      }
    }
    return w;
  }

  function initLocationPaneResizer() {
    if (!locationPaneEl || !locationPaneResizerEl) return;

    // 恢复持久化宽度（无记录则沿用 CSS 默认 176px，不写内联样式）
    let saved = null;
    try {
      saved = localStorage.getItem(LP_WIDTH_KEY);
    } catch (_) {
      /* 忽略 */
    }
    if (saved != null && saved !== "") applyLpWidth(saved);

    let dragging = false;

    // 用 Pointer Capture：捕获到分隔条本身，拖出窗口再松手也能收到 pointerup/pointercancel，
    // 不会卡在拖拽态（差异概览拖宽是新增交互，必须稳健）。
    locationPaneResizerEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      locationPaneResizerEl.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const startX = e.clientX;
      const startWidth = locationPaneEl.getBoundingClientRect().width;

      const onPointerMove = (ev) => {
        if (!dragging) return;
        // 侧栏在右侧：鼠标左移（dx<0）变宽，故取 startX - clientX。
        applyLpWidth(startWidth + (startX - ev.clientX));
      };

      const onPointerUp = (ev) => {
        if (!dragging) return;
        dragging = false;
        locationPaneResizerEl.classList.remove("dragging");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        locationPaneResizerEl.removeEventListener("pointermove", onPointerMove);
        locationPaneResizerEl.removeEventListener("pointerup", onPointerUp);
        locationPaneResizerEl.removeEventListener("pointercancel", onPointerUp);
        try { locationPaneResizerEl.releasePointerCapture(ev.pointerId); } catch (_) { /* 未捕获则忽略 */ }
        applyLpWidth(locationPaneEl.getBoundingClientRect().width, { persist: true });
        // 宽度变了 ⇒ 编辑区可用宽度变了 ⇒ 软换行重排。概览视口指示器与移动块连线
        // 依赖同一份布局，必须等下一帧 reflow 完再一起重算（与 toggleLocationPane 同规则）。
        scheduleAfterLayout(() => {
          if (locationPane) locationPane.update();
          if (instance && typeof instance.redrawConnectors === "function") {
            instance.redrawConnectors();
          }
        });
      };

      try { locationPaneResizerEl.setPointerCapture(e.pointerId); } catch (_) { /* 指针不可用则忽略 */ }
      locationPaneResizerEl.addEventListener("pointermove", onPointerMove);
      locationPaneResizerEl.addEventListener("pointerup", onPointerUp);
      locationPaneResizerEl.addEventListener("pointercancel", onPointerUp);
    });

    // 双击分隔条恢复默认宽度
    locationPaneResizerEl.addEventListener("dblclick", () => {
      applyLpWidth(LP_WIDTH_DEFAULT, { persist: true });
      scheduleAfterLayout(() => {
        if (locationPane) locationPane.update();
        if (instance && typeof instance.redrawConnectors === "function") {
          instance.redrawConnectors();
        }
      });
    });
  }

  // ── 视图切换（模式状态机，§3）──
  //   'compare' → 对照模式（colCount 保持或默认 2，显示 btnColToggle，隐藏 .merge-only）
  //   'merge'   → 合并模式（固定三栏 a=本地 / b=合并结果 / c=对方，隐藏 btnColToggle，显示 .merge-only）
  function switchMode(next) {
    if (next !== "compare" && next !== "merge") return;
    if (next === mode) {
      render();
      return;
    }
    mode = next;
    if (mode === "merge") colCount = 3;
    else colCount = colCount || 2; // 对照模式保持上次列数，默认 2
    render();
  }

  // ── 块导航（增量 B）：用当前实例的 navView ──
  function navNext() {
    if (instance && instance.navView) bindChunkNavigation(instance.navView).next();
  }
  function navPrev() {
    if (instance && instance.navView) bindChunkNavigation(instance.navView).prev();
  }

  // ── 记录初始内容快照（D8 脏检查）──
  function snapshotLoaded() {
    loadedContent.a = files.a ? files.a.content : null;
    loadedContent.b = files.b ? files.b.content : null;
    loadedContent.c = files.c ? files.c.content : null;
    loadedContent.result = mode === "merge" ? (files.result || null) : null;
  }

  // ── 文件选择 ──
  // 载入到「当前活动栏」（鼠标最后聚焦的栏，由 bindPaneFocus 的 focusin 写入，
  // getActivePane() 读取）。这样无论激活哪一栏，「选择文件」都把 MD 载入该栏，
  // 用户可逐栏分别载入 2/3 个文件（修复 BUG 3：此前固定 picked[0]→a 永远覆盖最左栏）。
  // 合并模式：中栏 b=合并结果（无源、不可直接载入文件），活动栏落到 b 时回退到 a（本地）。
  async function onPickFiles() {
    try {
      // 先记录点击「选择文件」瞬间的活动栏：避免文件框（系统原生对话框）关闭后
      // 焦点漂移导致读取到的活动栏错位，从而把 MD 载入错误栏（BUG 3 边界风险）。
      const active = getActivePane(); // 'a' | 'b' | 'c'
      const picked = await pickSingleFile(); // 单文件，载入当前活动栏
      if (!picked) return;
      // 按活动栏路由到目标栏键（纯函数，见 src/compare/pick-target.js）：
      // 合并模式的中栏(合并结果)不可作源 → 按"从左到右找第一个空栏"处理
      // （BUG 6）：本地未载→落本地 a；本地已载→落对方(files.b)。
      const target = resolvePickTarget(active, mode, files); // 'a' | 'b' | 'c'
      if (target === "a") files.a = picked; // 文件一 / 本地
      else if (target === "b") files.b = picked; // 文件二 / 对方
      else if (target === "c") files.c = picked; // 文件三（仅对照三栏）
      if (mode === "merge") files.result = null; // 重新选源 → 重置合并结果
      snapshotLoaded(); // 记录初始内容快照（D8）
      setSlotText(fileSlots.a, files.a);
      setSlotText(fileSlots.b, files.b);
      skipSaveOnNextRender = true; // 重新载入：跳过 render 的编辑回写，保留刚载入的文件内容
      render();
      // 让「激活栏描边」跟随用户实际选择的目标栏（render 末尾会把活动栏复位为 'a'）
      try {
        setActivePane(active);
        applyActivePaneClass();
      } catch (_) {}
    } catch (e) {
      // 用户取消选择：忽略 AbortError
      if (!(e && e.name === "AbortError")) {
        console.error("[compare] 选择文件失败:", e);
      }
    }
  }

  // ── 导出结果 ──
  async function onExportResult() {
    if (!instance) return;
    const content = instance.getResult();
    try {
      await exportResult(content, "merged.md");
    } catch (e) {
      // 用户取消保存：忽略 AbortError
      if (!(e && e.name === "AbortError")) {
        console.error("[compare] 导出结果失败:", e);
      }
    }
  }

  // ── 导出 diff 报告（D17）：生成 git 风格统一 diff 文本，经「另存为」弹窗写盘（非逐栏轮询）──
  async function onExportDiff() {
    if (!instance) return;
    try {
      const panes = buildPanes();
      const getContent = (k) => {
        const p = panes.find((x) => x.key === k);
        return p ? p.content : "";
      };
      // a=首栏；b=第二栏（合并模式下为合并结果），缺则取 c
      const a = getContent("a");
      const b = getContent("b") || getContent("c") || "";
      const diffText = buildDiffText(a, b);
      const target = await showSaveAsDialog({ suggestedName: "diff.txt" });
      if (target) await ioBridge.saveAs(target, diffText); // 写入新文件，不覆盖源
    } catch (e) {
      // 用户取消保存：忽略 AbortError
      if (!(e && e.name === "AbortError")) {
        console.error("[compare] 导出 diff 失败:", e);
      }
    }
  }

  // ── 保存轮询（D6/D8）：Ctrl/Cmd+S 或工具栏「保存」→ 从左到右逐栏弹窗（保存/另存为/不保存/取消）──
  // panes 形状对齐 save-poll.js：[{ key, view, target, content }]；order 决定从左到右顺序。
  // L4：currentPanes() 统一为与 instance.getPanes() 一致的 [{key,view,target,content}] 形状，
  // 直接委托实例；c 栏始终映射到 instance.theirsView（与 paneViewMap 保持一致）。
  function currentPanes() {
    if (instance && typeof instance.getPanes === "function") {
      return instance.getPanes();
    }
    // 兜底（实例尚未就绪）：构造最小 [{key,view,target,content}] 列表，
    // c 栏用 instance.theirsView 映射，保持与 paneViewMap 一致。
    const out = [];
    if (instance && instance.a)
      out.push({ key: "a", view: instance.a, target: files.a && files.a.target });
    if (instance && instance.b)
      out.push({ key: "b", view: instance.b, target: null });
    if (instance && instance.theirsView)
      out.push({ key: "c", view: instance.theirsView, target: files.b && files.b.target });
    return out;
  }

  async function onSave() {
    if (!instance) return;
    const panes = buildPanes();
    const order = buildOrder();
    try {
      const r = await runSavePoll(panes, order); // 逐栏弹窗（§5）
      if (r && !r.aborted) refreshLoadedSnapshots(); // 保存成功 → 复位 D8 脏检查
    } catch (e) {
      // 用户取消保存框：忽略 AbortError
      if (!(e && e.name === "AbortError")) console.error("[compare] 保存失败:", e);
    }
  }

  // ── 折叠 / 展开未改（增量 E） ──
  // 默认【展开】：一进页面就折叠会让用户先看到大片折叠占位、看不见正文，
  // 反而要多点一次才能读全文。需要精简视图时再手动点「折叠未改」。
  let collapsed = false;
  function onToggleCollapse() {
    collapsed = !collapsed;
    if (!instance) return;
    if (typeof instance.setCollapse === "function") {
      instance.setCollapse(collapsed);
    }
    if (btnToggleCollapse) {
      btnToggleCollapse.textContent = collapsed ? "展开未改" : "折叠未改";
    }
  }

  // ── 接受 Theirs 块（三栏专用，增量 T4 逐块 Accept） ──
  function onAcceptTheirs() {
    if (instance && typeof instance.acceptTheirsAt === "function") {
      instance.acceptTheirsAt();
    }
  }

  // ── 状态计数：实时反映当前差异块 / 冲突块数量（对齐 "6 changes, 2 conflicts"）──
  function updateStatusCount() {
    if (!statusCountEl) return;
    let changes = 0;
    let conflicts = 0;
    try {
      if (instance && typeof instance.getChunks === "function") {
        const chunks = instance.getChunks() || [];
        changes = chunks.length;
        // 冲突去重：三栏的一处物理冲突，在 compare-merge.js buildChunkModel() 中会被
        // **双侧各标记一次**（相交的 ab 块与 bc 块同时置 conflict=true），若直接对全量
        // filter 统计，1 处冲突会显示成「2 处冲突」。按 ab 层计数即等于冲突区域数。
        // 注意：去重只作用于计数维度，getChunks() 源头必须保留两侧标记 —— 块级 revert
        // 按钮要依据各自的 conflict 决定渲染单按钮还是双按钮（采纳左 / 采纳右）。
        // 两栏模式 conflict 恒为 false（无三方冲突），该式自然归零，不受影响。
        conflicts = chunks.filter((c) => c.conflict && c.layer === "ab").length;
      }
    } catch (err) {
      console.error("[compare] 统计差异块失败:", err);
    }
    statusCountEl.textContent = `${changes} 处变更，${conflicts} 处冲突`;
    statusCountEl.classList.toggle("has-conflict", conflicts > 0);
  }

  // ── per-pane 标题栏：根据当前模式与文件动态设置标题（§4）──
  // 标题语义（按用户 BUG 4 要求，覆盖文档 §4.2 的「显示路径」约定）：
  //   对照两栏  → 文件一 / 文件二
  //   对照三栏  → 文件一 / 文件二 / 文件三
  //   合并三栏  → 文件一 / 合并结果 / 文件二
  // 完整绝对路径保留为标题 tooltip（titleEl.title），方便用户确认真实位置。
  function updatePaneHeader() {
    if (!compareViewHeader || !comparePanes) return;
    // 修复中-1：#compareViewHeader 在 compare.html 中初始带 hidden，必须显式解除，
    // 否则整条标题栏被 CSS `.compare-view-header[hidden]{display:none}` 永久隐藏，
    // 三栏的 Yours / Result / Theirs 标题永不显示。
    compareViewHeader.hidden = false;
    // 三栏 / 合并显示三份标题，两栏显示两份；c 栏在两栏下隐藏
    const visiblePanes = mode === "merge" || colCount === 3 ? ["a", "b", "c"] : ["a", "b"];
    // 标题固定为语义标签（文件一/文件二/文件三 + 合并结果），与模式/列数严格对应。
    const titles =
      mode === "merge"
        ? { a: "文件一", b: "合并结果", c: "文件二" }
        : colCount === 3
          ? { a: "文件一", b: "文件二", c: "文件三" }
          : { a: "文件一", b: "文件二" };
    for (const p of ["a", "b", "c"]) {
      const el = document.querySelector(`.pane-header[data-pane="${p}"]`);
      if (!el) continue;
      const isVisible = visiblePanes.includes(p);
      el.hidden = !isVisible;
      // 修复 R6：跨 render 重放关闭态视觉（.pane-header 是静态 DOM，但 paneOffState
      // 可能在上一轮 render 前就被改过，这里统一以状态为准，保证幂等）
      el.classList.toggle("is-off", !!paneOffState[p]);
      const titleEl = paneTitles[p];
      if (titleEl) {
        titleEl.textContent = titles[p];
        // tooltip 显示完整绝对路径（不省略），方便用户确认真实位置
        const full = paneFullPath(p);
        if (full) titleEl.title = full;
      }
    }
  }

  // ── 关闭态视觉同步（修复 R6）：CSS 已定义 .pane-header.is-off，此前无人添加该类 ──
  function syncPaneOffClass(p) {
    const el = document.querySelector(`.pane-header[data-pane="${p}"]`);
    if (el) el.classList.toggle("is-off", !!paneOffState[p]);
  }

  // ── 方向选择器文案（按模式动态，修复低-1：两栏 left/right 实为 Yours↔Theirs）──
  // 合并/三栏：left=Yours→结果、right=Theirs→结果；对照两栏：left=Yours→Theirs、right=Theirs→Yours。
  function syncDirectionTooltips() {
    const isTwo = mode === "compare" && colCount === 2;
    if (btnAcceptLeft)
      btnAcceptLeft.title = isTwo
        ? "采纳左侧全部块（本地 → 对方）"
        : "采纳左侧全部块（本地 → 合并结果）";
    if (btnAcceptAll)
      btnAcceptAll.title = isTwo
        ? "用左栏覆盖全部（本地优先）"
        : "两侧全部采纳（先左后右，右侧覆盖冲突处）";
    if (btnAcceptRight)
      btnAcceptRight.title = isTwo
        ? "采纳右侧全部块（对方 → 本地）"
        : "采纳右侧全部块（对方 → 合并结果）";
  }

  // ── 关闭某栏：仅视觉隐藏该栏（display:none）+ 触发重绘 ──
  // 简单方案：给 compare-panes 加 pane-off-<p> 类，CSS 收缩为该栏宽度 0；
  // 不能用 CSS 隐藏整列（会破坏 MergeView 的滚动联动），故仅收缩宽度。
  function closePane(p) {
    if (!comparePanes) return;
    comparePanes.classList.add(`pane-off-${p}`);
    paneOffState[p] = true; // 跨 render 保留关闭状态
    if (paneToggles[p]) paneToggles[p].checked = false;
    syncPaneOffClass(p); // 修复 R6：标题格压暗 + 删除线，否则关栏后无任何视觉反馈
    scheduleAfterLayout(() => {
      if (instance && typeof instance.redrawConnectors === "function") {
        instance.redrawConnectors();
      }
    });
  }
  function reopenPane(p) {
    if (!comparePanes) return;
    comparePanes.classList.remove(`pane-off-${p}`);
    paneOffState[p] = false; // 跨 render 保留关闭状态
    if (paneToggles[p]) paneToggles[p].checked = true;
    syncPaneOffClass(p); // 修复 R6：撤下压暗 + 删除线
    scheduleAfterLayout(() => {
      if (instance && typeof instance.redrawConnectors === "function") {
        instance.redrawConnectors();
      }
    });
  }

  // ── 应用所有非冲突变更（一键解决无冲突区，冲突块留给人工裁决）──
  // 三栏：ab 层（Yours→Result）与 bc 层（Theirs→Result）共用同一个 Result 文档。
  // 若分两次 dispatch，ab 层改动后 Result 内容已变，bc 层会把这些区域重新识别为
  // 「Result 与 Theirs 的差异」并覆盖回去，导致 ab 层改动丢失（实测：只有 Theirs 生效）。
  // 正确做法：一次性收集两层的 changes（均基于 dispatch 前的同一 Result 坐标），
  // 按 dstFrom 排序后合并为单次 dispatch；层间区间重叠则中止，避免静默损坏。
  // 两栏：只有一层，走原有路径。
  function applyNonConflictingChunks() {
    if (!instance || typeof instance.getChunks !== "function") return;
    const chunks = instance.getChunks() || [];
    const nonConf = chunks.filter((c) => !c.conflict);
    if (!nonConf.length) return;
    if (colCount === 3) {
      const abViews = instance.getLayerViews("ab");
      const bcViews = instance.getLayerViews("bc");
      const ab = nonConf.filter((c) => c.layer === "ab");
      const bc = nonConf.filter((c) => c.layer === "bc");
      const changes = [];
      const pushChanges = (srcView, dstView, list) => {
        if (!srcView || !dstView || !list.length) return;
        const dstLen = dstView.state.doc.length;
        const srcLen = srcView.state.doc.length;
        for (const c of list) {
          changes.push({
            from: Math.min(c.dstFrom, dstLen),
            to: Math.min(c.dstTo, dstLen),
            insert: srcView.state.doc.sliceString(
              Math.min(c.srcFrom, srcLen),
              Math.min(c.srcTo, srcLen)
            ),
          });
        }
      };
      pushChanges(abViews.srcView, abViews.dstView, ab);
      pushChanges(bcViews.srcView, bcViews.dstView, bc);
      changes.sort((a, b) => a.from - b.from);
      for (let i = 1; i < changes.length; i++) {
        if (changes[i - 1].to > changes[i].from) {
          console.error(
            "[compare] 三栏非冲突块跨层区间重叠，已中止以免损坏 Result"
          );
          return;
        }
      }
      abViews.dstView.dispatch({ changes });
    } else {
      const views = instance.getLayerViews("ab");
      applyNonConflicting({
        chunks: nonConf,
        srcView: views.srcView,
        dstView: views.dstView,
      });
    }
    updateStatusCount();
  }

  // ── 方向选择器：<< 左 / 全部 / 右 >> 批量接受某一侧全部块（含冲突块）──
  // 关键正确性：向同一 dstView 写入多个块必须合并为【单次 dispatch】，
  // 否则后续块 dstFrom/dstTo 仍基于原始文档、从第 2 个起写错位置（漂移）。
  // 收集每一块的 changes（from/to/insert），按 dstFrom 升序排序后整批 dispatch。
  function acceptAllDir(dir) {
    if (!instance || typeof instance.getChunks !== "function") return;
    const chunks = instance.getChunks() || [];
    const isTwo = colCount === 2;

    function bulkTo(srcView, dstView, layerChunks) {
      if (!srcView || !dstView || !layerChunks.length) return;
      const len = dstView.state.doc.length;
      const sorted = [...layerChunks].sort((a, b) => a.dstFrom - b.dstFrom);
      // 防御：相邻块区间重叠则中止，避免静默损坏文档（同 applyNonConflicting）
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i - 1].dstTo > sorted[i].dstFrom) {
          console.error(
            `[compare] 批量接受 ${dir} 检测到重叠块区间，已中止以免损坏文档`
          );
          return;
        }
      }
      const changes = sorted.map((c) => ({
        from: Math.min(c.dstFrom, len),
        to: Math.min(c.dstTo, len),
        insert: srcView.state.doc.sliceString(c.srcFrom, c.srcTo),
      }));
      dstView.dispatch({ changes });
    }

    if (dir === "left" || dir === "all") {
      if (isTwo) {
        const views = instance.getLayerViews("ab");
        bulkTo(views.srcView, views.dstView, chunks.filter((c) => c.layer === "ab"));
      } else if (dir === "left") {
        const views = instance.getLayerViews("ab"); // a→b (Yours→Result)
        bulkTo(views.srcView, views.dstView, chunks.filter((c) => c.layer === "ab"));
      }
      // dir === "all" 三栏：与下方 right 阶段合并为单次 dispatch，避免 ab 层被 bc 层覆盖。
    }
    if (dir === "right" || dir === "all") {
      if (isTwo) {
        // 两栏右：b→a（Theirs→Yours）。
        // ① dir==='all' 时上面的 left 阶段刚改写过 b，快照里的 dstFrom/dstTo 已过期，必须重取；
        // ② 把 src/dst 角色对调后交给 bulkTo，从而复用同一套「按 dstFrom 排序 + 重叠区间校验
        //    + 越界钳制」防御。此前这里是手写 dispatch，缺重叠校验，相邻块接触时 CM6 会直接
        //    抛 Overlapping changes，导致后续 syncRevertControls / updateStatusCount 都不执行。
        const srcChunks = dir === "all" ? instance.getChunks() || [] : chunks;
        const rightChunks = srcChunks
          .filter((c) => c.layer === "ab")
          .map((c) => ({
            ...c,
            srcFrom: c.dstFrom, // 取 b（Theirs）的内容
            srcTo: c.dstTo,
            dstFrom: c.srcFrom, // 写回 a（Yours）的区间
            dstTo: c.srcTo,
          }));
        // getLayerViews('right') 即 { srcView: mv.b, dstView: mv.a }，两栏实例已提供该反向端点
        const views = instance.getLayerViews("right");
        bulkTo(views.srcView, views.dstView, rightChunks);
      } else if (dir === "right") {
        // 三栏单独右：Theirs→Result（bc 层）
        const views = instance.getLayerViews("bc"); // theirsView→b
        bulkTo(views.srcView, views.dstView, chunks.filter((c) => c.layer === "bc"));
      }
      // dir === "all" 三栏：在下面统一处理。
    }

    // 三栏「全部」：把 ab + bc 两层 changes 合并为单次 dispatch（同 applyNonConflictingChunks）。
    // 关键修复（H1）：冲突块在 ab 层与 bc 层都映射到【同一个 Result 区域】；若两层都压入，
    // 区间重叠会触发下方重叠守卫整轮 return，导致冲突文档点「全部」完全无反应（合并核心失效）。
    // 按 tooltip「右侧覆盖冲突处」语义：ab 层只压【非冲突】块，冲突块改由 bc 层（右/Theirs）压入并覆盖，
    // 使每个 Result 区域仅被表示一次，单次 dispatch 满足 CM6 非重叠约束。
    if (!isTwo && dir === "all") {
      const abViews = instance.getLayerViews("ab");
      const bcViews = instance.getLayerViews("bc");
      const allChanges = [];
      const pushAll = (srcView, dstView, list) => {
        if (!srcView || !dstView || !list.length) return;
        const dstLen = dstView.state.doc.length;
        const srcLen = srcView.state.doc.length;
        for (const c of list) {
          allChanges.push({
            from: Math.min(c.dstFrom, dstLen),
            to: Math.min(c.dstTo, dstLen),
            insert: srcView.state.doc.sliceString(
              Math.min(c.srcFrom, srcLen),
              Math.min(c.srcTo, srcLen)
            ),
          });
        }
      };
      pushAll(abViews.srcView, abViews.dstView, chunks.filter((c) => c.layer === "ab" && !c.conflict));
      pushAll(bcViews.srcView, bcViews.dstView, chunks.filter((c) => c.layer === "bc"));
      allChanges.sort((a, b) => a.from - b.from);
      for (let i = 1; i < allChanges.length; i++) {
        if (allChanges[i - 1].to > allChanges[i].from) {
          console.error("[compare] 三栏「全部」块区间重叠，已中止");
          return;
        }
      }
      abViews.dstView.dispatch({ changes: allChanges });
    }
    if (instance.syncRevertControls) instance.syncRevertControls();
    updateStatusCount();
  }

  // ── 行内字词高亮粒度切换 ──
  function onHighlightWordsChange() {
    if (!selHighlightWords || !instance) return;
    const modeVal = selHighlightWords.value || "word";
    if (typeof instance.setWordDiffMode !== "function") return;
    // 本函数已被 render() 复用作「重建后回填」（修复 R5）。render 尾部还要挂载概览侧栏，
    // 若此处抛出会连带掐断后续初始化，故就地兜住：粒度失败只是装饰降级，不该拖垮整页。
    try {
      instance.setWordDiffMode(modeVal);
    } catch (e) {
      console.error("[compare] 设置行内高亮粒度失败:", e);
    }
  }

  // ── 绑定工具栏按钮 ──
  // 模式切换（§3）：对照 / 合并；列数切换（仅对照模式）；滚动同步开关
  if (btnModeCompare)
    btnModeCompare.addEventListener("click", () => switchMode("compare"));
  if (btnModeMerge) btnModeMerge.addEventListener("click", () => switchMode("merge"));
  if (btnColToggle)
    btnColToggle.addEventListener("click", () => {
      if (mode !== "compare") return; // 合并模式不出现该按钮
      colCount = colCount === 2 ? 3 : 2;
      updateColToggleLabel();
      render();
    });
  if (btnScroll)
    btnScroll.addEventListener("click", () => {
      // M5（补充）：compare.js 持有本地开关态 scrollSyncEnabled，按钮翻转它并推给唯一控制器
      // instance.scrollSync（含三栏 B↔C / A↔C）；不再直接 toggle 控制器内部态，否则按钮高亮
      // （updateScrollButton 只读 compare.js 的 scrollSyncEnabled）会与真实开关脱钩。
      scrollSyncEnabled = !scrollSyncEnabled;
      if (scrollSync) {
        if (scrollSyncEnabled) scrollSync.enable();
        else scrollSync.disable();
      }
      updateScrollButton();
    });
  if (btnPrevChunk) btnPrevChunk.addEventListener("click", navPrev);
  if (btnNextChunk) btnNextChunk.addEventListener("click", navNext);

  // ── 块导航快捷键：复用按钮点击的同一组 navNext / navPrev（B / ] 下一块，Shift+B / [ 上一块） ──
  bindChunkNavigationKeys({ next: navNext, prev: navPrev });
  if (btnPickFiles) btnPickFiles.addEventListener("click", onPickFiles);
  if (btnExportResult) btnExportResult.addEventListener("click", onExportResult);
  if (btnExportDiff) btnExportDiff.addEventListener("click", onExportDiff);
  if (btnToggleCollapse) btnToggleCollapse.addEventListener("click", onToggleCollapse);
  if (btnAcceptTheirs) btnAcceptTheirs.addEventListener("click", onAcceptTheirs);
  if (btnToggleLocationPane)
    btnToggleLocationPane.addEventListener("click", toggleLocationPane);
  if (btnSave) btnSave.addEventListener("click", onSave);

  // ── 批量合并（对齐 JetBrains Merge Revisions 顶部栏）──
  // 注：以下控件归属 .merge-only 组，对照模式下由 C3 的 CSS 控制 display:none（§11）。
  if (btnApplyNonConflicting)
    btnApplyNonConflicting.addEventListener("click", applyNonConflictingChunks);
  // 修复 R7：CSS 已定义 .compare-dir-btn.active（选中态压在相邻按钮之上），此前无人添加该类，
  // 属死代码。方向选择器是【即时动作】而非持久模式，故不做持久选中态，
  // 改为点击后短暂点亮 —— 批量合并的文档变化常在视口外，缺少反馈时用户无法确认「点中了哪个」。
  const DIR_FLASH_MS = 700;
  const dirFlashTimers = new WeakMap();
  function flashDirBtn(btn) {
    if (!btn) return;
    btn.classList.add("active");
    const prev = dirFlashTimers.get(btn);
    if (prev) clearTimeout(prev); // 连点时重置计时，避免前一次的定时器提前熄灯
    dirFlashTimers.set(
      btn,
      setTimeout(() => {
        btn.classList.remove("active");
        dirFlashTimers.delete(btn);
      }, DIR_FLASH_MS)
    );
  }

  // B↔C 逐块采纳已迁移至 compare-merge.js（acceptBcChunkAt + mountBcRevertColumn），
  // 本文件不再持有 bulk 采纳逻辑；工具栏顶部「批量采纳方向」仍走 getLayerViews('bc')。

  if (btnAcceptLeft)
    btnAcceptLeft.addEventListener("click", () => {
      flashDirBtn(btnAcceptLeft);
      acceptAllDir("left");
    });
  if (btnAcceptAll)
    btnAcceptAll.addEventListener("click", () => {
      flashDirBtn(btnAcceptAll);
      acceptAllDir("all");
    });
  if (btnAcceptRight)
    btnAcceptRight.addEventListener("click", () => {
      flashDirBtn(btnAcceptRight);
      acceptAllDir("right");
    });
  if (selHighlightWords)
    selHighlightWords.addEventListener("change", onHighlightWordsChange);

  // ── 返回主界面（D8）：有未保存改动 → 先走保存轮询；取消则留页内；否则关闭/返回 ──
  // compare 页由 editor 经 window.open 打开，可脚本关闭；若部分环境禁止
  // window.close（页面未真正关闭），则降级跳转到 editor.html，避免用户被困。
  const btnBackToEditor = document.getElementById('btnBackToEditor');
  if (btnBackToEditor) {
    btnBackToEditor.addEventListener("click", async () => {
      // 任一栏相对初始内容 dirty → 必须先走保存轮询（§5.1 / D8）
      if (instance && isAnyPaneDirty()) {
        const panes = buildPanes();
        const order = buildOrder();
        try {
          const r = await runSavePoll(panes, order);
          if (r && r.aborted) return; // 用户「取消」→ 中止返回、留页内（不关窗）
          if (r && !r.aborted) refreshLoadedSnapshots();
        } catch (e) {
          if (!(e && e.name === "AbortError")) console.error("[compare] 返回前保存失败:", e);
          return; // 出错也留在页内，避免丢失改动
        }
      }
      // 全部处理完（或本就无改动）→ 关闭 / 返回主界面
      try { window.close(); } catch (_) {}
      window.location.href = 'editor.html';
    });
  }

  // ── per-pane 标题栏：勾选框（关闭/恢复栏）与关闭按钮 ──
  for (const p of ["a", "b", "c"]) {
    const toggle = paneToggles[p];
    const closeBtn = document.querySelector(
      `.pane-header-close[data-pane="${p}"]`
    );
    if (toggle) {
      toggle.addEventListener("change", () => {
        if (toggle.checked) reopenPane(p);
        else closePane(p);
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", () => closePane(p));
    }
  }

  // ── 概览侧栏快捷键 L（不带修饰键，且不能在编辑器内触发，否则会吞掉字母输入） ──
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (typeof e.key !== "string" || e.key.toLowerCase() !== "l") return;
    // isComposing：中文输入法组合期内的按键属于候选词交互，不是快捷键。
    // repeat：长按 L 会以系统重复速率高频 teardown/rebuild 整个侧栏（实测可复现的卡顿源）。
    // defaultPrevented：已被更内层的处理器消费掉，不再重复响应。
    if (e.isComposing || e.repeat || e.defaultPrevented) return;
    const t = e.target;
    // 在编辑区 / 输入控件内一律放行，L 就是普通字符。
    // select 与 [role='textbox'] 同样会吃字母键（前者用于首字母跳选项）；
    // contenteditable 用 :not([contenteditable='false']) 匹配，覆盖 contenteditable=""
    // 与 contenteditable="plaintext-only" 这两种同样可编辑、但旧写法漏判的形态。
    if (t && typeof t.closest === "function") {
      if (
        t.closest(
          ".cm-content, input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"
        )
      ) {
        return;
      }
    }
    e.preventDefault();
    toggleLocationPane();
  });

  // 窗口尺寸变化：连线端点依赖栏宽/栏高，必须重绘；概览条同理需重算比例。
  // 【rAF 合并】拖动窗口边框时 resize 会以远高于帧率的频率连续派发，而每次回调都要
  // 全量重算连线几何 + 重建概览色块/弧线/大纲，同步跑必然掉帧。同一帧内只保留最后一次，
  // 视觉结果完全等价（中间帧根本来不及呈现）。
  let resizeRaf = 0;
  window.addEventListener("resize", () => {
    const run = () => {
      if (instance && typeof instance.redrawConnectors === "function") {
        instance.redrawConnectors();
      }
      if (locationPane) locationPane.update();
    };
    if (typeof requestAnimationFrame !== "function") {
      run(); // 无 rAF 环境：退回同步执行，宁可卡也不能不刷新
      return;
    }
    if (resizeRaf) return; // 本帧已排队，丢弃后续事件
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      run();
    });
  });

  // ── 保存快捷键 Ctrl+S / Cmd+S（不含 Shift/Alt 组合，留给「另存为」等后续扩展） ──
  document.addEventListener("keydown", (e) => {
    if (
      (e.ctrlKey || e.metaKey) &&
      !e.shiftKey &&
      !e.altKey &&
      typeof e.key === "string" &&
      e.key.toLowerCase() === "s"
    ) {
      e.preventDefault(); // 阻止浏览器「保存网页」
      onSave();
    }
  });

  // v1.8.5：工具栏横向溢出滚动按钮（已知问题3，对比页同源）
  initToolbarScroll("#compareToolbar");

  // ── 图片插入（T5）：绑定「图片」按钮到当前活动编辑器 ──
  if (btnAddImages) {
    bindImageToolbarButton(btnAddImages, {
      // NEW-2：取当前活动编辑器视图的光标，确保与 activeEditorView（图片插入目标）同源
      getCursor: () => {
        if (activeView && activeView.state) {
          return activeView.state.selection.main.head;
        }
        return 0;
      },
    });
  }

  // ── 图片拖拽区（CMPX-08 修复）：把占位 #compareImageDrop 替换为真实拖拽上传区 ──
  const imageDropPlaceholder = document.getElementById("compareImageDrop");
  if (imageDropPlaceholder) {
    const area = createImageUploadArea({
      // 与「图片」按钮同源：取当前活动编辑器视图的光标作为插入位置
      getCursor: () => {
        if (activeView && activeView.state) {
          return activeView.state.selection.main.head;
        }
        return 0;
      },
    });
    imageDropPlaceholder.replaceWith(area);
  }

  // ── 文件拖拽（E4-01）：拖入 Markdown/文本文件即载入本页对应栏，无需走文件框 ──
  // 改为在整页（document 捕获阶段）拦截文件拖放：原 #compareFiles 拖拽区因子 slot 被
  // display:none、容器近乎零高度，拖放几乎必然落空，浏览器默认会把文件在【新标签页】打开
  // （即 BUG 2 报的「自动打开新编辑/预览页而对比页不载入」）。这里在捕获阶段 preventDefault
  // 阻止浏览器默认行为，并把 .md/.txt 文件载入本页栏位；非 Markdown 文件（如图片）放行，
  // 交给图片拖拽区处理。内部文本拖拽（块拖拽 / 选区拖拽）的 dataTransfer.types 不含
  // "Files"，不会误拦截，编辑器内拖拽不受影响。
  {
    const MD_ACCEPT_RE = /\.(md|markdown|mdown|mkd|mkdn|txt)$/i;
    const dragHasFiles = (e) =>
      !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files"));
    const onPageDragOver = (e) => {
      if (dragHasFiles(e)) {
        e.preventDefault(); // 允许 drop（否则 drop 事件不会触发）
        e.stopPropagation(); // 先于 CodeMirror 编辑器处理，避免其插入/游标干扰
      }
    };
    const onPageDrop = async (e) => {
      if (!dragHasFiles(e)) return; // 非文件（如图片）：放行给图片拖拽区
      const all = Array.from(e.dataTransfer.files || []);
      const md = all.filter((f) => MD_ACCEPT_RE.test(f.name || ""));
      if (!md.length) return; // 非 Markdown/文本：不拦截，交给浏览器默认（或图片区）
      e.preventDefault();
      e.stopPropagation();
      const dropped = await readCompareFiles(md);
      if (!dropped.length) return;
      // 拖拽多文件路由（BUG 5）：按活动栏优先填入 + 其余按 a→b→c 顺序填入空栏。
      // 先记录活动栏：drop 事件期间焦点可能受 drop 自身影响漂移，使用 drop 事件触发瞬间的活动栏。
      const active = getActivePane();
      const targets = resolveDropTargets(active, mode, files, dropped.length);
      // 按目标键填入；同一栏多次出现（拖入多于栏位的文件）→ 覆盖前一份。
      // 注：仅当 colCount===3 才写 files.c（对照两栏禁用 files.c，避免污染三栏视图）。
      for (let i = 0; i < dropped.length; i++) {
        const t = targets[i];
        if (t === "a") files.a = dropped[i];
        else if (t === "b") files.b = dropped[i];
        else if (t === "c") {
          if (mode === "compare" && colCount === 3) {
            files.c = dropped[i]; // 仅对照三栏启用 files.c
          } else {
            // 合并模式：c 栏 UI 显示「对方」，对应 files.b。防御兜底（resolveDropTargets
            // 已合理映射，正常走不到这里）；对照两栏丢弃多余文件。
            if (mode === "merge") files.b = dropped[i];
            // 对照两栏：丢弃（不污染 files.c）
          }
        }
      }
      if (mode === "merge") {
        files.result = null; // 新载入 → 重置合并结果
      }
      snapshotLoaded(); // 记录初始内容快照（D8）
      setSlotText(fileSlots.a, files.a);
      setSlotText(fileSlots.b, files.b);
      skipSaveOnNextRender = true; // 拖入新文件：跳过 render 编辑回写，保留刚拖入的文件内容
      render();
    };
    document.addEventListener("dragover", onPageDragOver, true); // 捕获阶段
    document.addEventListener("drop", onPageDrop, true);
  }

  // ── 调试钩子（仅当 cmp-debug=1 时暴露，生产默认不暴露，便于自动化探针读取真实状态） ──
  if (localStorage.getItem("cmp-debug") === "1") {
    window.__cmp = {
      get instance() {
        return instance;
      },
      get files() {
        return files;
      },
      get mode() {
        return mode;
      },
      get colCount() {
        return colCount;
      },
      get activePane() {
        return getActivePane();
      },
      // BUG 5/6 端到端测试钩子（仅 cmp-debug=1 暴露）：暴露路由纯函数供 CDP 验证。
      // onPickFiles / onPageDrop 在浏览器内是闭包私有，无法直接 mock 文件框；
      // 但它们的「路由决策」全部收敛到 resolvePickTarget / resolveDropTargets，
      // 故验证纯函数+files 状态变更 即可锁定 BUG 5/6 是否修复。
      resolvePickTarget,
      resolveDropTargets,
      currentPanes,
      render,
      switchMode,
      // 自动化探针专用：绕过「编辑回写」逻辑直接注入文件并切栏，避免被旧 instance 空文档覆盖。
      applyFiles: (obj) => {
        if (obj && typeof obj === "object") Object.assign(files, obj);
        skipSaveOnNextRender = true; // 注入文件视为「重新载入」，跳过本次回写
        render();
      },
      setColCount: (n) => {
        if (n === 2 || n === 3) {
          colCount = n;
          render();
        }
      },
    };
  }

  // 差异概览侧栏宽度拖拽（必须在首次 render 前恢复宽度，避免首帧按默认宽度量错布局）
  initLocationPaneResizer();

  // 默认渲染两栏（空文档），保证页面有可见内容
  render();
})();

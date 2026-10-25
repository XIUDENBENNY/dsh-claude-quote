/**
 * dsh-client-ui-claude-quote: Claude Code Desktop 的选区引用，搬到 DSH。
 *
 *   选中对话文字 → 浮动工具条「开始侧边对话 | 回复」
 *     回复         → 320px 回复弹窗（Enter 添加到输入框，Ctrl/⌘+Enter 直接发送，Esc 关闭）
 *     侧边对话     → fork 当前会话，在右侧栏打开，并把选区作为引用放进它的输入框
 *   输入框里的引用渲染成 120×120 卡片（右上角 × 移除，点击预览）
 *   发送格式与 Claude 一致：<!-- reply -->\n> 引用\n\n评论 / <!-- attach -->\n> 引用
 *   已发送的用户消息里，这些块重新渲染成左侧竖线的引用块（超过 6 行折叠，点击展开）
 */
window.__ModuleLoader__.load({
  id: "dsh-client-ui-claude-quote",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const jsx = require("react/jsx-runtime");
    const ui = require("@deepseek-ai/dsh-client-ui-primitives");
    // react-dom 是平台种子模块；拿不到时退回不隐藏原生 chip 的方案。
    let reactDom = null;
    try {
      reactDom = require("react-dom");
    } catch (error) {
      reactDom = null;
    }
    const h = jsx.jsx;
    const hs = jsx.jsxs;
    const Fragment = jsx.Fragment;

    const NS = "ui-claude-quote";
    const SOURCE_NAME = "claude-quote";
    const SOURCE_TRIGGER = "#";
    const RULE_ID = "claude-quote";
    const SIDECHAT_STORE = "dsh-claude-quote.sidechats";
    const HIGHLIGHT = "claude-quote-reply-selection";
    const MIN_SELECTION = 2;
    const MAX_QUOTE = 1500;
    const DEBOUNCE_MS = 250;
    const TOOLBAR_GAP = 8;
    const EDGE = 12;
    const SCROLL_HIDE = 100;
    const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
    const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";

    const zh = {
      startSideChat: "开始侧边对话",
      sendToSideChat: "发送到侧边对话",
      reply: "回复",
      replyLabel: "回复",
      replyPlaceholder: "回复 DSH",
      addToPrompt: "添加到输入框",
      sendReply: "发送回复",
      remove: "移除",
      quote: "引用",
      replyName: "你对“{quote}”的回复：{comment}",
      quoteName: "引用：“{quote}”",
      busyComposer: "消息发送中，暂时无法添加到输入框，请稍后再试。",
      noComposer: "输入框不在，暂时无法添加。",
      sendFailed: "回复发送失败。",
      sideChatFailed: "侧边对话打开失败。",
      sideChatDraftFailed: "侧边对话已打开，但引用没能放进它的输入框。",
      sideChatTitle: "侧边对话 · {quote}",
      sideChat: "侧边对话"
    };
    const en = {
      startSideChat: "Start a side chat",
      sendToSideChat: "Send to side chat",
      reply: "Reply",
      replyLabel: "Reply",
      replyPlaceholder: "Reply to DSH",
      addToPrompt: "Add to prompt",
      sendReply: "Send reply",
      remove: "Remove",
      quote: "Quote",
      replyName: "Your reply to “{quote}”: {comment}",
      quoteName: "Quote: “{quote}”",
      busyComposer: "Can’t add to your prompt while it’s sending. Try again in a moment.",
      noComposer: "Can’t add to your prompt until the message box is back.",
      sendFailed: "The reply could not be sent.",
      sideChatFailed: "The side chat could not be opened.",
      sideChatDraftFailed: "The side chat opened, but the quote did not reach its prompt.",
      sideChatTitle: "Side chat · {quote}",
      sideChat: "Side chat"
    };

    /** 已绑定命名空间的翻译函数；locale 服务不可用时退回中文表。 */
    let boundT = null;
    function tr(key, vars) {
      let text = null;
      if (typeof boundT === "function") {
        try {
          const out = boundT(key, vars);
          if (typeof out === "string" && out !== "" && out !== key && !out.endsWith("." + key)) text = out;
        } catch (error) {
          text = null;
        }
      }
      if (text === null) text = zh[key] === undefined ? key : zh[key];
      if (vars !== undefined) text = text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] === undefined ? m : String(vars[name])));
      return text;
    }

    /* ---------------- 文本工具（对应 Claude 的 yi / jn / zn） ---------------- */

    /** 选区文字：统一换行、去掉不换行空格与行尾空白。 */
    function cleanText(text) {
      return String(text)
        .replace(/\u00A0/g, " ")
        .replace(/\r\n?|[\u2028\u2029]/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .trim();
    }

    /** 按 code point 截断，超出时补 “…”，不会切开代理对。 */
    function truncate(text, max) {
      const chars = Array.from(text);
      if (chars.length <= max) return text;
      return chars.slice(0, max).join("").replace(/[\uD800-\uDBFF]$/, "") + "…";
    }

    /** 第一条非空行，最长 40 字（Claude 的 zn）。 */
    function firstLine(text) {
      const line = String(text).split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
      return truncate(line, 40);
    }

    /* ---------------- 发送格式（Claude 的 w / Ee / attach） ---------------- */

    const REPLY_MARK = "<!-- reply -->";
    const ATTACH_MARK = "<!-- attach -->";

    function quoteLines(text) {
      return String(text)
        .split("\n")
        .map((line) => (line === "" ? ">" : "> " + line))
        .join("\n");
    }

    /** 评论里形似标记的行转义掉，免得被当成下一块；3 个以上换行压成 2 个（Claude 的 ke）。 */
    function escapeComment(text) {
      return String(text)
        .trim()
        .replace(/^<!-- (reply(?: [0-9]+)?|attach(?::[^\n]*)?) -->$/gm, (m) => "&lt;" + m.slice(1))
        .replace(/<!-- reply [0-9]+ -->/g, (m) => "&lt;" + m.slice(1))
        .replace(/\n{3,}/g, "\n\n");
    }

    function replyBlock(quote, comment) {
      return REPLY_MARK + "\n" + quoteLines(quote) + "\n\n" + escapeComment(comment);
    }

    function attachBlock(quote) {
      return ATTACH_MARK + "\n" + quoteLines(quote);
    }

    /**
     * chip 的序列化文本：块 + 三个换行。块之后的三个换行是 Claude 用来分隔
     * “回复块”和“用户自己写的话”的边界；多个块连在一起时解析器也认。
     */
    function chipText(block) {
      return block + "\n\n\n";
    }

    /* ---------------- 解析：把消息开头的回复/引用块读回来 ---------------- */

    const MARK_RE = /<!-- (reply(?: [1-9][0-9]?)?|attach(?::[^\n]*?)?) -->\n(?=>(?: |\n|$))/y;
    const QUOTE_RUN_RE = /(?:>(?: [^\n]*)?(?:\n|$))+/y;

    function unquote(run) {
      return run
        .replace(/\n$/, "")
        .split("\n")
        .map((line) => (line === ">" ? "" : line.slice(2)))
        .join("\n");
    }

    function unescapeComment(text) {
      return text.replace(/&lt;!-- /g, "<!-- ");
    }

    /**
     * 从 from 开始连续解析块。返回 { blocks, end }，end 停在“用户自己写的话”之前
     * （块后面的空白都吞掉）；from 处不是块则返回 null。
     */
    function parseBlocks(text, from) {
      const blocks = [];
      let at = from;
      for (;;) {
        MARK_RE.lastIndex = at;
        const mark = MARK_RE.exec(text);
        if (mark === null) break;
        QUOTE_RUN_RE.lastIndex = MARK_RE.lastIndex;
        const run = QUOTE_RUN_RE.exec(text);
        if (run === null) break;
        const quote = unquote(run[0]);
        let cursor = QUOTE_RUN_RE.lastIndex;
        const kind = mark[1].startsWith("reply") ? "reply" : "attach";
        let comment = "";
        if (kind === "reply") {
          // 评论从引用后的空行之后开始，到下一个块标记或三连换行为止。
          let start = cursor;
          while (text.charAt(start) === "\n") start += 1;
          let end = text.length;
          const boundary = text.indexOf("\n\n\n", start);
          if (boundary !== -1) end = boundary;
          const next = /\n\n(?=<!-- (?:reply(?: [1-9][0-9]?)?|attach(?::[^\n]*?)?) -->\n>)/g;
          next.lastIndex = start;
          const hit = next.exec(text);
          if (hit !== null && hit.index < end) end = hit.index;
          comment = unescapeComment(text.slice(start, end).trim());
          cursor = end;
        }
        blocks.push({ kind, quote, comment });
        // 块之间（以及块和正文之间）的空白归块所有；下一处不是块标记时循环自然结束。
        while (cursor < text.length && /\s/.test(text.charAt(cursor))) cursor += 1;
        at = cursor;
      }
      return blocks.length === 0 ? null : { blocks, end: at };
    }

    /** UserText 规则：块必须从行首开始（Claude 也只在开头放）。 */
    const quoteRule = {
      id: RULE_ID,
      order: 5,
      match(text, from) {
        for (let at = text.indexOf("<!-- ", from); at !== -1; at = text.indexOf("<!-- ", at + 1)) {
          if (at > 0 && text.charAt(at - 1) !== "\n") continue;
          const parsed = parseBlocks(text, at);
          if (parsed === null) continue;
          return {
            id: RULE_ID,
            start: at,
            end: parsed.end,
            data: { blocks: parsed.blocks, rest: parsed.end < text.length }
          };
        }
        return undefined;
      }
    };

    /* ---------------- 小型 store ---------------- */

    function createStore(initial) {
      let value = initial;
      const listeners = new Set();
      return {
        get: () => value,
        set(next) {
          const resolved = typeof next === "function" ? next(value) : next;
          if (Object.is(resolved, value)) return;
          value = resolved;
          for (const listener of [...listeners]) listener();
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      };
    }

    function useStore(store) {
      return react.useSyncExternalStore(store.subscribe, store.get, store.get);
    }

    /** toolbar / reply / preview / toast 都是文档级单例，由“领头”的 overlay 渲染。 */
    const uiStore = createStore({ toolbar: null, reply: null, preview: null, toast: null });
    function patchUi(patch) {
      uiStore.set((state) => ({ ...state, ...(typeof patch === "function" ? patch(state) : patch) }));
    }
    const layerStore = createStore([]);
    /** 滚动/缩放时自增，浮层据此重新测量位置。 */
    const tickStore = createStore(0);

    /* ---------------- 宿主服务 ---------------- */

    let pluginCtx = null;

    function service(name) {
      if (pluginCtx === null) return null;
      try {
        const value = pluginCtx.get(name);
        if (value !== undefined && value !== null) return value;
      } catch (error) {
        // 退回属性形式
      }
      try {
        const value = pluginCtx[name];
        return value === undefined ? null : value;
      } catch (error) {
        return null;
      }
    }

    function shellOf(sessionId) {
      if (typeof sessionId !== "string" || sessionId === "") return null;
      const conversation = service("conversation");
      const hub = conversation === null ? null : conversation.input;
      if (hub === null || hub === undefined || typeof hub.shell !== "function") return null;
      try {
        return hub.shell(sessionId) ?? null;
      } catch (error) {
        return null;
      }
    }

    function snapshotOf(shell) {
      try {
        const snap = shell.state.getSnapshot();
        return snap !== null && typeof snap === "object" ? snap : null;
      } catch (error) {
        return null;
      }
    }

    function sessionCtx(sessionId) {
      const sessions = service("sessions");
      if (sessions === null) return null;
      try {
        const binding = typeof sessions.binding === "function" ? sessions.binding(sessionId) : undefined;
        if (binding !== undefined && binding !== null && binding.ctx) return binding.ctx;
      } catch (error) {
        // 忽略
      }
      try {
        return typeof sessions.scope === "function" ? sessions.scope(sessionId) ?? null : null;
      } catch (error) {
        return null;
      }
    }

    /* ---------------- 引用 chip 的 reference source ---------------- */

    // chip 的 ref 就是它要发出去的整段文本；发送时宿主按 serialize 原样拼回草稿。
    const quoteSource = {
      trigger: SOURCE_TRIGGER,
      name: SOURCE_NAME,
      showGroupTitle: false,
      candidates: () => [],
      codec: {
        clipboardText: (ref) => String(ref),
        serialize: (ref) => Promise.resolve(String(ref))
      }
    };
    let sourceHolders = 0;
    let sourceRegistered = false;
    let sourceDisposer = null;

    function ensureSource() {
      if (sourceRegistered) return true;
      const triggers = service("inputTriggers");
      if (triggers === null || typeof triggers.registerSource !== "function") return false;
      try {
        const off = triggers.registerSource(quoteSource);
        sourceDisposer = typeof off === "function" ? off : null;
      } catch (error) {
        // 插件被挂载多次时，别的实例已经注册过同一个无状态 source，直接复用。
        sourceDisposer = null;
      }
      sourceRegistered = true;
      return true;
    }

    function holdSource() {
      sourceHolders += 1;
      ensureSource();
      return () => {
        sourceHolders = Math.max(0, sourceHolders - 1);
        if (sourceHolders > 0) return;
        const off = sourceDisposer;
        sourceDisposer = null;
        sourceRegistered = false;
        try {
          off?.();
        } catch (error) {
          // 宿主已经忘了它
        }
      };
    }

    /* ---------------- 每个输入框的登记 ---------------- */

    /** sessionId → { marker }；marker 是 overlay 里的隐藏 span，用来把选区归到对应会话。 */
    const composers = new Map();

    /** 从选区所在的元素往上找，第一个“包含某个输入框标记”的祖先决定会话。 */
    function sessionForNode(node) {
      if (composers.size === 0) return null;
      let el = node instanceof Element ? node : node?.parentElement ?? null;
      while (el !== null) {
        for (const [sessionId, entry] of composers) {
          if (entry.marker !== null && entry.marker.isConnected && el.contains(entry.marker)) return sessionId;
        }
        el = el.parentElement;
      }
      return null;
    }

    function cardOf(sessionId) {
      const entry = composers.get(sessionId);
      return entry?.marker?.closest?.("[data-composer-card]") ?? null;
    }

    /* ---------------- 往输入框加/删引用 ---------------- */

    function blockLabel(block) {
      const parsed = parseBlocks(block, 0);
      const first = parsed === null ? null : parsed.blocks[0];
      if (first === null) return tr("quote");
      return firstLine(first.comment !== "" ? first.comment : first.quote) || tr("quote");
    }

    /** 本插件 chip 在 detect 坐标（每个 chip 记 1 个字符）里的位置。 */
    function ownSpans(snap) {
      const spans = [];
      const occurrences = Array.isArray(snap?.occurrences) ? snap.occurrences : [];
      let shift = 0;
      for (const occ of occurrences) {
        const offset = Number(occ?.offset);
        const length = Number(occ?.length);
        if (!Number.isFinite(offset) || !Number.isFinite(length)) continue;
        const start = offset - shift;
        shift += length - 1;
        if (occ.source === SOURCE_NAME) spans.push({ occ, start, offset, length });
      }
      return spans;
    }

    /**
     * 把一个块作为 chip 放进会话输入框。chip 永远排在已有引用之后、用户正文之前，
     * 和 Claude 一样“引用在前，正文在后”。
     */
    function addToPrompt(sessionId, block, options) {
      const silent = options?.silent === true;
      const shell = shellOf(sessionId);
      if (shell === null) {
        if (!silent) toast(tr("noComposer"));
        return false;
      }
      const snap = snapshotOf(shell);
      if (snap !== null && snap.phase !== undefined && snap.phase !== "plain" && snap.phase !== "claimed") {
        if (!silent) toast(tr("busyComposer"));
        return false;
      }
      if (!ensureSource()) {
        if (!silent) toast(tr("noComposer"));
        return false;
      }
      const text = chipText(block);
      const attachment = {
        source: SOURCE_NAME,
        ref: text,
        label: blockLabel(block),
        appearance: "session",
        clipboardText: text
      };
      const own = ownSpans(snap);
      const at = own.length === 0 ? 0 : own[own.length - 1].start + 1;
      let rev = snap?.draftRev;
      try {
        const captured = shell.actions?.captureInsertion?.();
        if (captured !== undefined && captured !== null) rev = captured.draftRev;
      } catch (error) {
        // 用快照里的版本号
      }
      const span = { start: at, end: at, draftRev: rev };
      let applied = false;
      try {
        applied = typeof shell.insertReference === "function" && shell.insertReference(attachment, span) === true;
      } catch (error) {
        applied = false;
      }
      if (!applied) {
        const actx = sessionCtx(sessionId);
        try {
          applied = actx !== null && typeof actx.bail === "function" && actx.bail(actx, "slash/input-insert-reference", { reference: attachment, span }) === true;
        } catch (error) {
          applied = false;
        }
      }
      if (!applied) {
        if (!silent) toast(tr("noComposer"));
        return false;
      }
      if (options?.focus !== false) {
        try {
          shell.focus?.();
        } catch (error) {
          // 焦点不是必须的
        }
      }
      return true;
    }

    /** 移除第 index 个本插件 chip（连同它后面那个自动补的空格）。 */
    function removeChip(sessionId, index) {
      const shell = shellOf(sessionId);
      const snap = shell === null ? null : snapshotOf(shell);
      if (snap === null) return false;
      const own = ownSpans(snap);
      const target = own[index];
      if (target === undefined) return false;
      const draft = typeof snap.draft === "string" ? snap.draft : "";
      const end = target.start + 1 + (draft.charAt(target.offset + target.length) === " " ? 1 : 0);
      let rev = snap.draftRev;
      try {
        const captured = shell.actions?.captureInsertion?.();
        if (captured !== undefined && captured !== null) rev = captured.draftRev;
      } catch (error) {
        // 用快照里的版本号
      }
      let done = false;
      try {
        done = typeof shell.consumeToken === "function" && shell.consumeToken({ kind: "span", span: { start: target.start, end, draftRev: rev } }) === true;
      } catch (error) {
        done = false;
      }
      if (!done) done = rebuildWithout(shell, snap, target.occ);
      try {
        shell.focus?.();
      } catch (error) {
        // 忽略
      }
      return done;
    }

    /** 兜底：按结构化草稿重建，去掉一个 chip。会丢撤销历史，只在精确删除失败时用。 */
    function rebuildWithout(shell, snap, drop) {
      if (typeof shell.setDraft !== "function") return false;
      const draft = typeof snap.draft === "string" ? snap.draft : "";
      let text = "";
      let cursor = 0;
      const references = [];
      for (const occ of snap.occurrences ?? []) {
        text += draft.slice(cursor, occ.offset);
        cursor = occ.offset + occ.length;
        if (occ === drop) {
          if (draft.charAt(cursor) === " ") cursor += 1;
          continue;
        }
        references.push({
          source: occ.source,
          ref: String(occ.ref),
          offset: text.length,
          length: occ.length,
          label: occ.label,
          clipboardText: occ.clipboardText ?? draft.slice(occ.offset, occ.offset + occ.length),
          ...(occ.appearance === undefined ? {} : { appearance: occ.appearance })
        });
        text += draft.slice(occ.offset, occ.offset + occ.length);
      }
      text += draft.slice(cursor);
      try {
        shell.setDraft(references.length === 0 ? text : { text, references });
        return true;
      } catch (error) {
        return false;
      }
    }

    /** Ctrl/⌘+Enter：不碰草稿，直接把这条回复作为一条消息发出去。 */
    async function sendReply(sessionId, quote, comment) {
      const conversation = service("conversation");
      const sessions = service("sessions");
      const binding = sessions !== null && typeof sessions.binding === "function" ? sessions.binding(sessionId) : undefined;
      if (conversation === null || typeof conversation.sendSession !== "function" || binding === undefined || binding === null) {
        throw new Error("conversation.sendSession is unavailable");
      }
      const result = await conversation.sendSession(binding.session, replyBlock(quote, comment), [], "queue");
      if (result !== undefined && result !== null && result.kind === "error") throw new Error("send failed");
    }

    /* ---------------- 侧边对话 ---------------- */

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function readSideChats() {
      try {
        const raw = window.localStorage.getItem(SIDECHAT_STORE);
        const parsed = raw === null ? {} : JSON.parse(raw);
        return parsed !== null && typeof parsed === "object" ? parsed : {};
      } catch (error) {
        return {};
      }
    }

    function writeSideChats(map) {
      try {
        window.localStorage.setItem(SIDECHAT_STORE, JSON.stringify(map));
      } catch (error) {
        // 存不下就只在本次会话里有效
      }
    }

    function sessionExists(id) {
      const sessions = service("sessions");
      try {
        const byId = sessions?.list?.getSnapshot?.()?.byId;
        if (byId === undefined || byId === null) return true;
        return byId[id] !== undefined;
      } catch (error) {
        return true;
      }
    }

    function sideChatOf(sessionId) {
      const child = readSideChats()[sessionId];
      return typeof child === "string" && child !== "" && sessionExists(child) ? child : null;
    }

    /** 侧边对话自己不再提供“开始侧边对话”。 */
    function isSideChat(sessionId) {
      return Object.values(readSideChats()).includes(sessionId);
    }

    // fork 出来的是普通会话，subagentchat 资源会按父子关系拒绝它，所以用自己的资源类型。
    const SIDECHAT_PROTOCOL = "claudesidechat";
    const SIDECHAT_PREFIX = "dsh-resource://" + SIDECHAT_PROTOCOL + "/session/";
    const SIDECHAT_TAB_ID = "dsh-client-ui-claude-quote/sidechat";

    function sideChatAddress(parent, child) {
      return SIDECHAT_PREFIX + encodeURIComponent(child) + "?" + new URLSearchParams({ parent }).toString();
    }

    function parseSideChatAddress(value) {
      let url;
      try {
        url = new URL(value);
      } catch (error) {
        return undefined;
      }
      if (url.protocol !== "dsh-resource:" || url.hostname.toLowerCase() !== SIDECHAT_PROTOCOL) return undefined;
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length !== 2 || parts[0] !== "session") return undefined;
      try {
        return { sessionId: decodeURIComponent(parts[1]), parent: url.searchParams.get("parent") };
      } catch (error) {
        return undefined;
      }
    }

    function sessionTitle(id) {
      try {
        const entry = service("sessions")?.list?.getSnapshot?.()?.byId?.[id];
        const title = entry?.displayTitle ?? entry?.projectionValues?.title;
        return typeof title === "string" && title !== "" ? title : null;
      } catch (error) {
        return null;
      }
    }

    async function renameSession(id, title) {
      const sessions = service("sessions");
      for (const target of [sessions, sessions?.manager]) {
        if (target === null || target === undefined || typeof target.rename !== "function") continue;
        try {
          await target.rename(id, title);
          return;
        } catch (error) {
          // 试下一个
        }
      }
    }

    const sideChatPending = new Map();

    /**
     * Claude 的“开始侧边对话”：带着当前上下文开一个旁支，选区作为引用放进旁支输入框，
     * 主对话不受影响。DSH 里用 fork（继承历史）+ 右侧栏的 subagentchat 页实现；
     * 同一个会话再次发送时复用已有旁支。
     */
    function openSideChat(sessionId, text) {
      if (sideChatPending.has(sessionId)) return sideChatPending.get(sessionId);
      const job = (async () => {
        const sessions = service("sessions");
        const right = service("sidebarRight");
        if (sessions === null || right === null || typeof right.openResource !== "function") {
          toast(tr("sideChatFailed"));
          return;
        }
        let child = sideChatOf(sessionId);
        if (child === null) {
          try {
            child = await sessions.fork({ sessionId, increaseTitle: true });
          } catch (error) {
            console.warn("[claude-quote] fork failed:", error);
            child = null;
          }
          if (typeof child !== "string" || child === "") {
            toast(tr("sideChatFailed"));
            return;
          }
          writeSideChats({ ...readSideChats(), [sessionId]: child });
          await renameSession(child, tr("sideChatTitle", { quote: truncate(firstLine(text), 20) }));
        }
        try {
          right.openResource(sideChatAddress(sessionId, child), { kind: SIDECHAT_PROTOCOL, preferNewPane: true });
        } catch (error) {
          console.warn("[claude-quote] open side chat failed:", error);
          toast(tr("sideChatFailed"));
          return;
        }
        const block = attachBlock(truncate(text, MAX_QUOTE));
        // 旁支的输入框要等右侧栏挂载后才有；先等它的 overlay 登记，再退回直接写 shell。
        for (let attempt = 0; attempt < 30; attempt += 1) {
          if (composers.has(child) && addToPrompt(child, block, { silent: true })) return;
          await sleep(200);
        }
        if (!addToPrompt(child, block, { silent: true })) toast(tr("sideChatDraftFailed"));
      })().finally(() => sideChatPending.delete(sessionId));
      sideChatPending.set(sessionId, job);
      return job;
    }

    /* ---------------- 侧边对话的右侧栏页 ---------------- */

    function waitAbort(signal) {
      if (signal.aborted) return Promise.resolve();
      return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    }

    /** 资源：持有子会话引用直到页签关闭（和 subagentchat 一样的生命周期）。 */
    function sideChatResource(sessions) {
      return {
        protocol: SIDECHAT_PROTOCOL,
        async *open(address, { signal }) {
          const parsed = parseSideChatAddress(address);
          if (parsed === undefined) throw new Error('claude-quote: invalid side chat address "' + address + '"');
          if (signal.aborted) return;
          const reference = sessions.retain(parsed.sessionId, { source: "sidebarChat", signal });
          try {
            yield { ok: true, value: { address: parsed, reference } };
            await waitAbort(signal);
          } finally {
            reference.release();
          }
        }
      };
    }

    function SideChatView(props) {
      return h(Fragment, { children: props.renderSlot("conversation.session", { view: "chat" }) });
    }

    /** 嵌入式对话：复用宿主的 conversation.content，固定为聊天视图。 */
    function SideChatPanel({ renderFactorySlot }) {
      return renderFactorySlot(
        "conversation.content",
        { variant: "embedded", phase: "active", hero: false },
        { slots: { views: SideChatView } }
      );
    }

    function SideChatTab({ useResource, useTabInfo, SessionProvider, renderSlot }) {
      const { tab } = useTabInfo();
      const resource = useResource(tab.contentId);
      return h("div", {
        className: "cq-sidechat",
        "data-sidebar-chat": "",
        children:
          resource.value === undefined
            ? null
            : h(SessionProvider, { session: resource.value.reference, children: renderSlot("claude-quote.sidechat.conversation", {}) })
      });
    }

    function registerSideChat(ctx) {
      ctx.effect(() => ctx.resources.register(sideChatResource(ctx.sessions ?? service("sessions"))));
      ctx.effect(() =>
        ctx.sidebarRightTabs.register({
          id: SIDECHAT_TAB_ID,
          kind: SIDECHAT_PROTOCOL,
          patterns: [SIDECHAT_PREFIX + "**"],
          canOpen: (address) => parseSideChatAddress(address) !== undefined,
          title: (address) => {
            const id = parseSideChatAddress(address)?.sessionId;
            return (id === undefined ? null : sessionTitle(id)) ?? tr("sideChat");
          }
        })
      );
      ctx.effect(() =>
        ctx.slots.inject("sidebar.right.pane.tab", () =>
          ctx.slots.register(
            {
              name: "sidebar.right.pane.tab",
              key: SIDECHAT_TAB_ID,
              children: { "claude-quote.sidechat.conversation": { kind: "single", scope: "session" } }
            },
            SideChatTab
          )
        )
      );
      ctx.effect(() =>
        ctx.slots.inject("claude-quote.sidechat.conversation", () =>
          ctx.slots.register({ name: "claude-quote.sidechat.conversation" }, SideChatPanel)
        )
      );
    }

    /* ---------------- 选区（Claude 的 xV） ---------------- */

    const ENTRY_SELECTOR = "[data-chat-flow-kind]";

    function isOurUi(target) {
      return target instanceof Element && target.closest("[data-cq-ui]") !== null;
    }

    function isEditable(el) {
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }

    /** 选区端点所在的对话条目；输入框、我们自己的浮层和回合尾部都不算。 */
    function entryOf(node) {
      const el = node instanceof Element ? node : node?.parentElement ?? null;
      if (el === null) return null;
      if (el.closest("[data-composer-card], [data-cq-ui], textarea, input, [contenteditable='true']") !== null) return null;
      const entry = el.closest(ENTRY_SELECTOR);
      if (entry === null) return null;
      return entry.getAttribute("data-chat-flow-kind") === "turn-tail" ? null : entry;
    }

    function entryKey(entry) {
      return entry.getAttribute("data-chat-node-key") ?? entry.getAttribute("data-chat-flow-key") ?? "";
    }

    /** 读当前选区；不满足 Claude 的显示条件时返回 null。 */
    function readSelection() {
      const selection = document.getSelection();
      if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
      const text = cleanText(selection.toString());
      if (text.length < MIN_SELECTION) return null;
      const range = selection.getRangeAt(0);
      const startEntry = entryOf(range.startContainer);
      const endEntry = entryOf(range.endContainer);
      // 起点或终点至少有一个落在对话条目里。
      const anchor = startEntry ?? endEntry;
      if (anchor === null) return null;
      const sessionId = sessionForNode(anchor);
      if (sessionId === null) return null;
      const rect = rangeRect(range);
      if (rect === null) return null;
      const sameEntry = startEntry !== null && endEntry !== null && entryKey(startEntry) === entryKey(endEntry);
      return {
        sessionId,
        text,
        range: range.cloneRange(),
        rect,
        scroller: scrollerOf(anchor),
        scrollY: scrollerTop(scrollerOf(anchor)),
        canReply: sameEntry,
        canSideChat: !isSideChat(sessionId),
        sideChatStarted: sideChatOf(sessionId) !== null
      };
    }

    function scrollerOf(el) {
      let node = el;
      while (node !== null && node !== document.body) {
        if (node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)) return node;
        node = node.parentElement;
      }
      return null;
    }

    function scrollerTop(scroller) {
      return scroller === null ? window.scrollY : scroller.scrollTop;
    }

    /** 选区第一行的矩形（工具条居中于此），以及整体的上下边界。 */
    function rangeRect(range) {
      let rects = [];
      try {
        rects = [...range.getClientRects()].filter((r) => r.width > 0 || r.height > 0);
      } catch (error) {
        rects = [];
      }
      if (rects.length === 0) return null;
      const first = rects[0];
      const last = rects[rects.length - 1];
      return { left: first.left, right: first.right, top: first.top, bottom: last.bottom };
    }

    /* ---------------- 选区高亮（CSS Highlight API） ---------------- */

    function setHighlight(range) {
      try {
        if (typeof CSS !== "undefined" && CSS.highlights && typeof Highlight === "function") CSS.highlights.set(HIGHLIGHT, new Highlight(range));
      } catch (error) {
        // 不支持就算了
      }
    }

    function clearHighlight() {
      try {
        if (typeof CSS !== "undefined" && CSS.highlights) CSS.highlights.delete(HIGHLIGHT);
      } catch (error) {
        // 忽略
      }
    }

    /* ---------------- 动作 ---------------- */

    let replySeq = 0;

    function startReply() {
      const bar = uiStore.get().toolbar;
      if (bar === null || !bar.canReply) return;
      replySeq += 1;
      const reply = {
        id: replySeq,
        sessionId: bar.sessionId,
        quote: truncate(bar.text, MAX_QUOTE),
        range: bar.range,
        rect: bar.rect,
        comment: "",
        busy: false
      };
      setHighlight(bar.range);
      // 焦点要进回复框，原生选区让给 Highlight 来画。
      document.getSelection()?.removeAllRanges();
      patchUi({ toolbar: null, reply, preview: null });
    }

    function startSideChat() {
      const bar = uiStore.get().toolbar;
      if (bar === null || !bar.canSideChat) return;
      patchUi({ toolbar: null });
      document.getSelection()?.removeAllRanges();
      void openSideChat(bar.sessionId, bar.text);
    }

    function closeReply(id) {
      clearHighlight();
      patchUi((state) => (state.reply !== null && state.reply.id === id ? { reply: null } : {}));
    }

    function commitReply(reply, value) {
      const comment = value.trim();
      const block = comment === "" ? attachBlock(reply.quote) : replyBlock(reply.quote, comment);
      if (addToPrompt(reply.sessionId, block)) closeReply(reply.id);
    }

    async function sendDirect(reply, value) {
      const comment = value.trim();
      if (comment === "" || reply.busy) return;
      patchUi((state) => (state.reply?.id === reply.id ? { reply: { ...state.reply, busy: true, comment: value } } : {}));
      try {
        await sendReply(reply.sessionId, reply.quote, comment);
        closeReply(reply.id);
      } catch (error) {
        console.warn("[claude-quote] send reply failed:", error);
        patchUi((state) => (state.reply?.id === reply.id ? { reply: { ...state.reply, busy: false } } : {}));
        toast(tr("sendFailed"));
      }
    }

    let toastSeq = 0;
    function toast(text) {
      toastSeq += 1;
      patchUi({ toast: { id: toastSeq, text } });
    }

    /* ---------------- 文档级监听（所有挂载共享，引用计数） ---------------- */

    let runtimeHolders = 0;
    let runtimeOff = null;

    function installRuntime() {
      let dragging = false;
      let timer = null;
      let frame = 0;

      const evaluate = () => {
        timer = null;
        if (uiStore.get().reply !== null) return;
        patchUi({ toolbar: readSelection() });
      };
      const schedule = () => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(evaluate, DEBOUNCE_MS);
      };
      const onPointerDown = (event) => {
        if (isOurUi(event.target)) return;
        if (event.button === 0) dragging = true;
        if (uiStore.get().toolbar !== null) patchUi({ toolbar: null });
      };
      const onPointerUp = (event) => {
        if (!dragging) return;
        dragging = false;
        if (isOurUi(event.target)) return;
        // 双击选词时浏览器稍后才扩展选区，所以统一走去抖。
        schedule();
      };
      // 在窗口外松开鼠标时收不到 pointerup，别让 dragging 卡住。
      const onPointerCancel = () => {
        dragging = false;
      };
      const onSelectionChange = () => {
        if (isOurUi(document.activeElement)) return;
        if (dragging) {
          if (uiStore.get().toolbar !== null) patchUi({ toolbar: null });
          return;
        }
        const selection = document.getSelection();
        if (selection === null || selection.isCollapsed) {
          if (timer !== null) clearTimeout(timer);
          timer = null;
          if (uiStore.get().toolbar !== null) patchUi({ toolbar: null });
          return;
        }
        // 键盘扩选（Shift+方向键、Ctrl+A）也要出工具条。
        schedule();
      };
      const onScroll = () => {
        if (frame !== 0) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const bar = uiStore.get().toolbar;
          if (bar !== null && Math.abs(scrollerTop(bar.scroller) - bar.scrollY) > SCROLL_HIDE) patchUi({ toolbar: null });
          tickStore.set((n) => n + 1);
        });
      };
      const onKeyDown = (event) => {
        const bar = uiStore.get().toolbar;
        if (bar === null || event.isComposing) return;
        if (event.key === "Escape") {
          patchUi({ toolbar: null });
          return;
        }
        if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
        if (!bar.canReply || isEditable(document.activeElement)) return;
        event.preventDefault();
        event.stopPropagation();
        startReply();
      };

      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("pointerup", onPointerUp, true);
      document.addEventListener("pointercancel", onPointerCancel, true);
      window.addEventListener("blur", onPointerCancel);
      document.addEventListener("selectionchange", onSelectionChange);
      document.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", onScroll);
      document.addEventListener("keydown", onKeyDown, true);
      const style = document.createElement("style");
      style.setAttribute("data-claude-quote", "");
      style.textContent = CSS_TEXT + (reactDom !== null && typeof reactDom.createPortal === "function" ? HIDE_CHIP_CSS : "");
      document.head.appendChild(style);
      return () => {
        if (timer !== null) clearTimeout(timer);
        if (frame !== 0) cancelAnimationFrame(frame);
        document.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("pointerup", onPointerUp, true);
        document.removeEventListener("pointercancel", onPointerCancel, true);
        window.removeEventListener("blur", onPointerCancel);
        document.removeEventListener("selectionchange", onSelectionChange);
        document.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", onScroll);
        document.removeEventListener("keydown", onKeyDown, true);
        style.remove();
        clearHighlight();
        patchUi({ toolbar: null, reply: null, preview: null, toast: null });
      };
    }

    function holdRuntime() {
      runtimeHolders += 1;
      if (runtimeHolders === 1) runtimeOff = installRuntime();
      return () => {
        runtimeHolders = Math.max(0, runtimeHolders - 1);
        if (runtimeHolders > 0) return;
        const off = runtimeOff;
        runtimeOff = null;
        off?.();
      };
    }

    /* ---------------- 定位（Claude 的 El：优先在上方，放不下就在下方） ---------------- */

    function place(rect, width, height) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const center = (rect.left + rect.right) / 2;
      const left = Math.max(EDGE, Math.min(center - width / 2, vw - EDGE - width));
      const above = rect.top - TOOLBAR_GAP - height;
      const below = rect.bottom + TOOLBAR_GAP;
      const top = above >= EDGE ? above : below;
      return { left, top: Math.max(EDGE, Math.min(top, vh - EDGE - height)) };
    }

    function toRect(r) {
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }

    /** 每次渲染（含滚动 tick）按锚点重新摆放浮层。 */
    function useFloating(getRect) {
      const ref = react.useRef(null);
      useStore(tickStore);
      react.useLayoutEffect(() => {
        const el = ref.current;
        if (el === null) return;
        const rect = getRect();
        if (rect === null) return;
        const pos = place(rect, el.offsetWidth, el.offsetHeight);
        el.style.left = Math.round(pos.left) + "px";
        el.style.top = Math.round(pos.top) + "px";
        el.style.visibility = "visible";
      });
      return ref;
    }

    function liveRect(range, fallback) {
      try {
        if (range.startContainer.isConnected && range.endContainer.isConnected) return rangeRect(range) ?? fallback;
      } catch (error) {
        // 区间失效
      }
      return fallback;
    }

    const prevent = (event) => event.preventDefault();

    function IconAdd() {
      return hs("svg", {
        width: 16,
        height: 16,
        viewBox: "0 0 16 16",
        fill: "none",
        "aria-hidden": true,
        children: [
          h("circle", { cx: 8, cy: 8, r: 6.25, stroke: "currentColor", strokeWidth: 1.25 }),
          h("path", { d: "M8 5.25v5.5M5.25 8h5.5", stroke: "currentColor", strokeWidth: 1.25, strokeLinecap: "round" })
        ]
      });
    }

    function IconClose() {
      return h("svg", {
        width: 10,
        height: 10,
        viewBox: "0 0 10 10",
        fill: "none",
        "aria-hidden": true,
        children: h("path", { d: "M2.5 2.5l5 5M7.5 2.5l-5 5", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" })
      });
    }

    /** 有 Tooltip 原语就用它，没有就退回原生 title。 */
    function withTip(label, keys, child, side) {
      if (typeof ui.Tooltip !== "function" && typeof ui.Tooltip !== "object") return child;
      return h(ui.Tooltip, { label, shortcutKeys: keys, side: side ?? "top", delayMs: 400, children: child });
    }

    /* ---------------- 选区工具条 ---------------- */

    function Toolbar({ bar }) {
      const ref = useFloating(() => liveRect(bar.range, bar.rect));
      const items = [];
      if (bar.canSideChat) {
        items.push(
          h(
            "button",
            {
              type: "button",
              className: "cq-tool",
              onClick: startSideChat,
              children: bar.sideChatStarted ? tr("sendToSideChat") : tr("startSideChat")
            },
            "side"
          )
        );
      }
      if (bar.canSideChat && bar.canReply) items.push(h("span", { className: "cq-sep", "aria-hidden": true }, "sep"));
      if (bar.canReply) {
        items.push(
          h(
            react.Fragment,
            {
              children: withTip(
                tr("reply"),
                ["Enter"],
                h("button", { type: "button", className: "cq-tool", onClick: startReply, children: tr("reply") })
              )
            },
            "reply"
          )
        );
      }
      if (items.length === 0) return null;
      return h("div", {
        ref,
        "data-cq-ui": "",
        role: "toolbar",
        className: "cq-surface cq-toolbar",
        style: { visibility: "hidden" },
        onMouseDown: prevent,
        children: items
      });
    }

    /* ---------------- 回复浮层 ---------------- */

    function keyHint(keys) {
      return h("span", {
        className: "cq-keys",
        children: keys.map((key) => h("kbd", { className: "cq-key", children: key === "Enter" ? "↵" : key }, key))
      });
    }

    const FIELD_SIZING = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");

    function ReplyPopover({ reply }) {
      const [value, setValue] = react.useState(reply.comment);
      const valueRef = react.useRef(value);
      valueRef.current = value;
      const rootRef = useFloating(() => liveRect(reply.range, reply.rect));
      const inputRef = react.useRef(null);
      const buttonRef = react.useRef(null);

      react.useLayoutEffect(() => {
        const input = inputRef.current;
        if (input === null || FIELD_SIZING) return;
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 8 * 20) + "px";
      }, [value]);

      react.useEffect(() => {
        inputRef.current?.focus({ preventScroll: true });
        const onDown = (event) => {
          const root = rootRef.current;
          if (root !== null && root.contains(event.target)) return;
          const current = valueRef.current.trim();
          // 写了东西就不因点外面而丢掉。
          if (current === "" || current === reply.comment.trim()) closeReply(reply.id);
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => document.removeEventListener("pointerdown", onDown, true);
      }, [reply.id]);

      const onKeyDown = (event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeReply(reply.id);
          return;
        }
        if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          if (event.ctrlKey || event.metaKey) void sendDirect(reply, valueRef.current);
          else commitReply(reply, valueRef.current);
          return;
        }
        if (event.key === "Tab") {
          const order = [inputRef.current, buttonRef.current].filter(Boolean);
          const at = order.indexOf(document.activeElement);
          if (order.length === 0) return;
          event.preventDefault();
          const next = (at + (event.shiftKey ? order.length - 1 : 1)) % order.length;
          order[next < 0 ? 0 : next].focus();
        }
      };

      const onCopy = (event) => {
        const input = inputRef.current;
        if (input !== null && input.selectionStart !== input.selectionEnd) return;
        if (event.clipboardData === null) return;
        event.preventDefault();
        event.clipboardData.setData("text/plain", reply.quote);
      };

      const empty = value.trim() === "";
      const tipLabel = hs("span", {
        className: "cq-tip-rows",
        children: [
          hs("span", { className: "cq-tip-row", children: [h("span", { children: tr("addToPrompt") }), keyHint(["Enter"])] }),
          hs("span", {
            className: "cq-tip-row cq-tip-dim",
            children: [h("span", { children: tr("sendReply") }), keyHint([MOD_KEY, "Enter"])]
          })
        ]
      });

      return h("div", {
        ref: rootRef,
        "data-cq-ui": "",
        role: "dialog",
        "aria-label": tr("replyLabel"),
        className: "cq-surface cq-reply",
        style: { visibility: "hidden" },
        onKeyDown,
        onCopy,
        children: hs("div", {
          className: "cq-reply-body",
          children: [
            h("blockquote", { className: "cq-reply-quote", children: reply.quote }),
            hs("div", {
              className: "cq-reply-row",
              children: [
                h("textarea", {
                  ref: inputRef,
                  className: "cq-reply-input",
                  rows: 1,
                  value,
                  disabled: reply.busy,
                  placeholder: tr("replyPlaceholder"),
                  "aria-label": tr("replyPlaceholder"),
                  onChange: (event) => setValue(event.target.value)
                }),
                withTip(
                  tipLabel,
                  undefined,
                  h("button", {
                    ref: buttonRef,
                    type: "button",
                    className: "cq-reply-add",
                    "data-empty": empty ? "" : undefined,
                    disabled: reply.busy,
                    "aria-label": tr("addToPrompt"),
                    onMouseDown: prevent,
                    onClick: () => commitReply(reply, valueRef.current),
                    children: h(IconAdd, {})
                  })
                )
              ]
            })
          ]
        })
      });
    }

    /* ---------------- 卡片预览 / 提示 / 浮层宿主 ---------------- */

    function QuotePreview({ preview }) {
      const ref = useFloating(() => (preview.anchor.isConnected ? toRect(preview.anchor.getBoundingClientRect()) : null));
      react.useEffect(() => {
        const close = () => patchUi((state) => (state.preview?.id === preview.id ? { preview: null } : {}));
        const onDown = (event) => {
          const root = ref.current;
          if (root !== null && root.contains(event.target)) return;
          if (preview.anchor.contains(event.target)) return;
          close();
        };
        const onKey = (event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          close();
          preview.anchor.focus?.({ preventScroll: true });
        };
        const timer = setInterval(() => {
          if (!preview.anchor.isConnected) close();
        }, 500);
        document.addEventListener("pointerdown", onDown, true);
        document.addEventListener("keydown", onKey, true);
        return () => {
          clearInterval(timer);
          document.removeEventListener("pointerdown", onDown, true);
          document.removeEventListener("keydown", onKey, true);
        };
      }, [preview.id]);
      const block = preview.block;
      return h("div", {
        ref,
        "data-cq-ui": "",
        role: "dialog",
        "aria-label": blockName(block),
        className: "cq-surface cq-preview",
        style: { visibility: "hidden" },
        children: hs("div", {
          className: "cq-preview-body",
          children: [
            h("blockquote", { className: "cq-preview-quote", children: block.quote }),
            block.kind === "reply" && block.comment !== ""
              ? h("div", { className: "cq-preview-comment", children: block.comment })
              : null
          ]
        })
      });
    }

    function ToastHost({ item }) {
      const done = () => patchUi((state) => (state.toast?.id === item.id ? { toast: null } : {}));
      if (typeof ui.Toast === "function" || typeof ui.Toast === "object") {
        return h(ui.Toast, { text: item.text, tone: "default", holdMs: 3200, onDone: done }, item.id);
      }
      return h(FallbackToast, { item, onDone: done }, item.id);
    }

    function FallbackToast({ item, onDone }) {
      react.useEffect(() => {
        const timer = setTimeout(onDone, 3200);
        return () => clearTimeout(timer);
      }, [item.id]);
      return h("div", { className: "cq-surface cq-toast", role: "status", children: item.text });
    }

    function FloatingLayer() {
      const state = useStore(uiStore);
      const children = [
        state.toolbar !== null ? h(Toolbar, { bar: state.toolbar }, "toolbar") : null,
        state.reply !== null ? h(ReplyPopover, { reply: state.reply }, "reply-" + state.reply.id) : null,
        state.preview !== null ? h(QuotePreview, { preview: state.preview }, "preview-" + state.preview.id) : null,
        state.toast !== null ? h(ToastHost, { item: state.toast }, "toast-" + state.toast.id) : null
      ];
      const layer = h("div", { className: "cq-layer", "data-cq-ui": "", children });
      if (reactDom !== null && typeof reactDom.createPortal === "function") return reactDom.createPortal(layer, document.body);
      return layer;
    }

    /* ---------------- 引用卡片 ---------------- */

    function blockName(block) {
      const quote = truncate(block.quote.replace(/\s+/g, " "), 80);
      if (block.kind === "reply" && block.comment !== "") return tr("replyName", { quote, comment: truncate(block.comment, 80) });
      return tr("quoteName", { quote });
    }

    let previewSeq = 0;
    function togglePreview(anchor, block) {
      patchUi((state) => {
        if (state.preview !== null && state.preview.anchor === anchor) return { preview: null };
        previewSeq += 1;
        return { preview: { id: previewSeq, anchor, block } };
      });
    }

    /**
     * 120×120 的方形卡片：左侧色条 + 五行截断的引用。回复卡片右下角有“回复”角标；
     * 输入框里的卡片悬停出现 ×。所有元素都是 span，因为已发送消息里它们处在 span 内。
     */
    function QuoteTile({ block, onRemove }) {
      const ref = react.useRef(null);
      const isReply = block.kind === "reply" && block.comment !== "";
      const open = () => {
        if (ref.current !== null) togglePreview(ref.current, block);
      };
      return hs("span", {
        ref,
        role: "button",
        tabIndex: 0,
        "data-cq-ui": "",
        className: "cq-tile",
        "data-reply": isReply ? "" : undefined,
        "aria-label": blockName(block),
        onClick: open,
        onKeyDown: (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open();
          }
        },
        children: [
          h("span", { className: "cq-tile-bar", "aria-hidden": true }),
          h("span", { className: "cq-tile-text", "aria-hidden": true, children: block.quote }),
          isReply ? h("span", { className: "cq-tile-badge", "aria-hidden": true, children: tr("reply") }) : null,
          typeof onRemove === "function"
            ? h("button", {
                type: "button",
                className: "cq-tile-remove",
                "aria-label": tr("remove"),
                onMouseDown: prevent,
                onClick: (event) => {
                  event.stopPropagation();
                  patchUi((state) => (state.preview?.anchor === ref.current ? { preview: null } : {}));
                  onRemove();
                },
                children: h(IconClose, {})
              })
            : null
        ]
      });
    }

    /* ---------------- 输入框里的卡片 ---------------- */

    const noopSubscribe = () => () => {};

    function useShell(sessionId) {
      const [shell, setShell] = react.useState(() => shellOf(sessionId));
      react.useEffect(() => {
        const found = shellOf(sessionId);
        setShell(found);
        if (found !== null) return undefined;
        const timer = setInterval(() => {
          const next = shellOf(sessionId);
          if (next === null) return;
          clearInterval(timer);
          setShell(next);
        }, 300);
        return () => clearInterval(timer);
      }, [sessionId]);
      return shell;
    }

    function useShellSnapshot(shell) {
      const subscribe = react.useMemo(
        () => (shell !== null && typeof shell.state?.subscribe === "function" ? shell.state.subscribe.bind(shell.state) : noopSubscribe),
        [shell]
      );
      const getSnapshot = () => (shell === null ? null : snapshotOf(shell));
      return react.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    }

    function tileItems(snap) {
      return ownSpans(snap).map((span, index) => {
        const raw = String(span.occ.ref ?? span.occ.clipboardText ?? "");
        const parsed = parseBlocks(raw, 0);
        const block = parsed === null ? { kind: "attach", quote: raw.trim(), comment: "" } : parsed.blocks[0];
        return { key: index + ":" + raw.length + ":" + span.offset, index, block };
      });
    }

    function ComposerTiles({ sessionId, host }) {
      const shell = useShell(sessionId);
      const snap = useShellSnapshot(shell);
      const items = react.useMemo(() => tileItems(snap), [snap]);
      react.useLayoutEffect(() => {
        if (host !== null) host.hidden = items.length === 0;
      }, [host, items.length]);
      if (host === null || items.length === 0 || reactDom === null || typeof reactDom.createPortal !== "function") return null;
      const row = h("span", {
        className: "cq-tiles",
        children: items.map((item) =>
          h(QuoteTile, { block: item.block, onRemove: () => removeChip(sessionId, item.index) }, item.key)
        )
      });
      return reactDom.createPortal(row, host);
    }

    /* ---------------- 已发送消息里的卡片 ---------------- */

    function compactText(blocks) {
      return blocks
        .map((block) => {
          const quote = "“" + truncate(block.quote.replace(/\s+/g, " "), 60) + "”";
          return block.kind === "reply" && block.comment !== "" ? quote + " " + block.comment.replace(/\s+/g, " ") : quote;
        })
        .join(" ");
    }

    /** 宿主只给 interactive；本地回显也是 false，所以按容器是否单行截断来判断要不要退成一行。 */
    function inEllipsis(el) {
      for (let node = el?.parentElement ?? null, depth = 0; node !== null && depth < 4; node = node.parentElement, depth += 1) {
        const style = getComputedStyle(node);
        if (style.textOverflow === "ellipsis" || style.whiteSpace === "nowrap") return true;
      }
      return false;
    }

    function QuoteMessage(props) {
      const data = props?.node?.data;
      const blocks = Array.isArray(data?.blocks) ? data.blocks : [];
      const probeRef = react.useRef(null);
      const [compact, setCompact] = react.useState(false);
      react.useLayoutEffect(() => {
        if (props?.interactive === true) return;
        const next = inEllipsis(probeRef.current);
        if (next !== compact) setCompact(next);
      });
      if (blocks.length === 0) return h(Fragment, { children: props?.raw ?? "" });
      if (props.interactive !== true && compact) {
        // 队列预览等单行场景：退成一行纯文字，末尾补空格隔开正文。
        return h("span", { ref: probeRef, className: "cq-compact", children: compactText(blocks) + (data.rest ? " " : "") });
      }
      // 和 Claude 的已发送气泡一样：左侧竖线 + 次级色引用文字，评论作为正文跟在下面。
      return h("span", {
        ref: probeRef,
        className: "cq-sent" + (data.rest ? " cq-sent-rest" : ""),
        children: blocks.map((block, index) =>
          hs(
            "span",
            {
              className: "cq-sent-item",
              children: [
                h(SentQuote, { text: block.quote }),
                block.kind === "reply" && block.comment !== ""
                  ? h("span", { className: "cq-sent-comment", children: block.comment })
                  : null
              ]
            },
            index
          )
        )
      });
    }

    /** 引用超过 6 行时折叠，点击展开/收起。 */
    function SentQuote({ text }) {
      const ref = react.useRef(null);
      const [open, setOpen] = react.useState(false);
      const [overflow, setOverflow] = react.useState(false);
      react.useLayoutEffect(() => {
        const el = ref.current;
        if (el !== null && !open) setOverflow(el.scrollHeight > el.clientHeight + 1);
      }, [text, open]);
      const toggle =
        overflow || open
          ? () => {
              // 拖选引用文字时不要顺手折叠/展开。
              if (document.getSelection()?.isCollapsed === false) return;
              setOpen((value) => !value);
            }
          : undefined;
      return h("span", {
        ref,
        className: "cq-sent-quote",
        "data-open": open ? "" : undefined,
        "data-clickable": toggle === undefined ? undefined : "",
        role: toggle === undefined ? undefined : "button",
        tabIndex: toggle === undefined ? undefined : 0,
        "aria-expanded": toggle === undefined ? undefined : open,
        onClick: toggle,
        onKeyDown:
          toggle === undefined
            ? undefined
            : (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggle();
                }
              },
        children: text
      });
    }

    /* ---------------- 输入框 overlay：登记会话、放卡片宿主、选出浮层领队 ---------------- */

    let layerSeq = 0;

    /** 卡片宿主放在卡片里编辑器那一行的前面，和 Claude 一样位于输入区上方。 */
    function placeHost(card, host) {
      const editor = card.querySelector("[data-lexical-editor]");
      let row = editor;
      while (row !== null && row.parentElement !== card) row = row.parentElement;
      if (row === null) {
        if (host.parentElement !== card) card.insertBefore(host, card.firstChild);
        return;
      }
      if (host.parentElement !== card || host.nextSibling !== row) card.insertBefore(host, row);
    }

    function QuoteOverlay(props) {
      const sessionId = props?.sessionId;
      const markerRef = react.useRef(null);
      const [host, setHost] = react.useState(null);
      if (typeof props?.t === "function" && boundT === null) boundT = props.t;

      const leader = useStore(layerStore);
      const tokenRef = react.useRef(null);
      if (tokenRef.current === null) {
        layerSeq += 1;
        tokenRef.current = layerSeq;
      }
      react.useEffect(() => {
        const token = tokenRef.current;
        layerStore.set((list) => [...list, token]);
        return () => layerStore.set((list) => list.filter((item) => item !== token));
      }, []);

      react.useLayoutEffect(() => {
        if (typeof sessionId !== "string") return undefined;
        const entry = { marker: markerRef.current };
        composers.set(sessionId, entry);
        ensureSource();
        const card = markerRef.current?.closest?.("[data-composer-card]") ?? null;
        if (card === null) {
          return () => {
            if (composers.get(sessionId) === entry) composers.delete(sessionId);
          };
        }
        const node = document.createElement("div");
        node.className = "cq-tiles-host";
        node.hidden = true;
        placeHost(card, node);
        card.setAttribute("data-cq-card", "");
        const observer = new MutationObserver(() => placeHost(card, node));
        observer.observe(card, { childList: true });
        setHost(node);
        return () => {
          observer.disconnect();
          node.remove();
          if (card.querySelector(".cq-tiles-host") === null) card.removeAttribute("data-cq-card");
          setHost(null);
          if (composers.get(sessionId) === entry) composers.delete(sessionId);
        };
      }, [sessionId]);

      return hs(Fragment, {
        children: [
          h("span", { ref: markerRef, "data-cq-session": sessionId ?? "", hidden: true }),
          h(ComposerTiles, { sessionId, host }),
          leader[0] === tokenRef.current ? h(FloatingLayer, {}) : null
        ]
      });
    }

    /* ---------------- 样式（全部走宿主主题变量） ---------------- */

    const CSS_TEXT = [
      "::highlight(" + HIGHLIGHT + "){background-color:var(--dsw-alias-bg-document-selection,rgba(80,140,255,.35));}",
      ".cq-layer{position:fixed;left:0;top:0;width:0;height:0;z-index:2147483000;}",
      ".cq-surface{position:fixed;box-sizing:border-box;background:var(--dsw-alias-bg-layer-3,#353638);color:var(--dsw-alias-label-primary,#f2f2f2);" +
        "border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));border-radius:var(--dsw-radius-md,12px);" +
        "box-shadow:var(--dsw-shadow-lv2,0 8px 24px rgba(0,0,0,.35));font:var(--dsw-font-xs-13,13px/18px system-ui,sans-serif);}",
      ".cq-toolbar{display:flex;align-items:center;gap:2px;padding:3px;border-radius:var(--dsw-radius-sm,8px);white-space:nowrap;user-select:none;}",
      ".cq-tool{appearance:none;border:0;background:transparent;color:inherit;font:inherit;padding:4px 8px;border-radius:6px;cursor:pointer;}",
      ".cq-tool:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));}",
      ".cq-tool:active{background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.12));}",
      ".cq-tool:focus-visible,.cq-reply-add:focus-visible,.cq-tile:focus-visible,.cq-tile-remove:focus-visible{outline:2px solid var(--dsw-alias-border-l4,#6b8cff);outline-offset:1px;}",
      ".cq-sep{width:1px;height:16px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.12));margin:0 2px;}",
      ".cq-reply{width:320px;max-width:calc(100vw - 24px);padding:10px 10px 8px 12px;}",
      ".cq-reply-body{display:flex;flex-direction:column;gap:6px;}",
      ".cq-reply-quote,.cq-preview-quote{margin:0;padding:0 0 0 9px;border-left:3px solid var(--dsw-alias-border-l3,rgba(255,255,255,.22));" +
        "color:var(--dsw-alias-label-secondary,#b9b9bb);white-space:pre-wrap;word-break:break-word;}",
      ".cq-reply-quote{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;}",
      ".cq-reply-row{display:flex;align-items:flex-end;gap:6px;}",
      ".cq-reply-input{flex:1;min-width:0;resize:none;border:0;outline:0;background:transparent;color:inherit;font:inherit;line-height:20px;" +
        "padding:4px 0;margin:0;field-sizing:content;min-height:28px;max-height:8lh;overflow-y:auto;}",
      ".cq-reply-input::placeholder{color:var(--dsw-alias-label-tertiary,#7c7c80);}",
      ".cq-reply-add{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:50%;" +
        "background:transparent;color:var(--dsw-alias-label-primary,#f2f2f2);cursor:pointer;}",
      ".cq-reply-add[data-empty]{color:var(--dsw-alias-label-tertiary,#7c7c80);}",
      ".cq-reply-add:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));}",
      ".cq-reply-add:disabled{opacity:.5;cursor:default;}",
      ".cq-tip-rows{display:flex;flex-direction:column;gap:4px;}",
      ".cq-tip-row{display:flex;align-items:center;justify-content:space-between;gap:12px;}",
      ".cq-tip-dim{opacity:.7;}",
      ".cq-keys{display:inline-flex;gap:3px;}",
      ".cq-key{font:inherit;font-size:11px;line-height:16px;min-width:16px;padding:0 4px;text-align:center;border-radius:4px;" +
        "background:rgba(255,255,255,.12);}",
      ".cq-preview{width:360px;max-width:calc(100vw - 24px);max-height:min(420px,calc(100vh - 24px));overflow:auto;padding:12px;}",
      ".cq-preview-body{display:flex;flex-direction:column;gap:10px;}",
      ".cq-preview-comment{white-space:pre-wrap;word-break:break-word;}",
      ".cq-toast{left:50%;bottom:24px;transform:translateX(-50%);padding:8px 14px;max-width:420px;}",
      ".cq-tiles-host{padding:4px 12px 0;}",
      ".cq-tiles-host[hidden]{display:none;}",
      ".cq-tiles{display:flex;flex-wrap:wrap;gap:8px;}",
      ".cq-tile{position:relative;display:block;box-sizing:border-box;width:120px;height:120px;flex:none;overflow:hidden;cursor:pointer;" +
        "padding:10px 10px 10px 15px;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-layer-3,#353638);" +
        "border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));color:var(--dsw-alias-label-secondary,#b9b9bb);" +
        "font:var(--dsw-font-xxs-12,12px/17px system-ui,sans-serif);white-space:normal;text-align:left;user-select:none;}",
      ".cq-tile:hover{border-color:var(--dsw-alias-border-l3,rgba(255,255,255,.18));}",
      ".cq-tile-bar{position:absolute;left:6px;top:10px;bottom:10px;width:3px;border-radius:2px;background:var(--dsw-alias-border-l3,rgba(255,255,255,.22));}",
      ".cq-tile-text{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:5;overflow:hidden;white-space:pre-wrap;word-break:break-word;}",
      ".cq-tile[data-reply] .cq-tile-text{-webkit-line-clamp:4;}",
      ".cq-tile-badge{position:absolute;right:8px;bottom:7px;padding:0 6px;border-radius:999px;font-size:11px;line-height:16px;" +
        "background:var(--dsw-alias-bg-layer-2,#2c2c2e);color:var(--dsw-alias-label-tertiary,#8c8c90);}",
      ".cq-tile-remove{position:absolute;top:5px;right:5px;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;" +
        "padding:0;border:0;border-radius:50%;cursor:pointer;opacity:0;transition:opacity .12s;" +
        "background:var(--dsw-alias-tooltip-bg,#111);color:var(--dsw-alias-label-primary,#f2f2f2);}",
      ".cq-tile:hover .cq-tile-remove,.cq-tile:focus-within .cq-tile-remove,.cq-tile-remove:focus-visible{opacity:1;}",
      ".cq-sent{display:flex;flex-direction:column;gap:4px;}",
      ".cq-sent-item{display:flex;flex-direction:column;gap:4px;min-width:0;}",
      ".cq-sent-rest{margin-bottom:4px;}",
      ".cq-sent-quote{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:6;overflow:hidden;min-width:0;" +
        "border-inline-start:2px solid var(--dsw-alias-label-caption,#81858c);padding-inline-start:10px;" +
        "color:var(--dsw-alias-label-tertiary,#adb2b8);white-space:pre-wrap;overflow-wrap:anywhere;}",
      ".cq-sent-quote[data-open]{display:block;-webkit-line-clamp:unset;}",
      ".cq-sent-quote[data-clickable]{cursor:pointer;}",
      ".cq-sent-comment{display:block;white-space:pre-wrap;overflow-wrap:anywhere;}",
      ".cq-compact{white-space:nowrap;}",
      ".cq-sidechat{width:100%;min-width:0;height:100%;min-height:0;display:flex;}"
    ].join("\n");

    // 有卡片宿主时，编辑器里的 chip 只作为数据载体，视觉上收起来。
    const HIDE_CHIP_CSS =
      "\n[data-cq-card] [data-composer-chip=\"" + SOURCE_NAME + "\"]{display:inline-block!important;width:0!important;max-width:0!important;" +
      "height:0!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important;padding:0!important;margin:0!important;border:0!important;}";

    /* ---------------- 插件入口 ---------------- */

    const inject = ["slots", "locale"];

    function apply(ctx) {
      pluginCtx = ctx;
      try {
        ctx.effect(() => {
          const off = ctx.locale.register(NS, { zh, en });
          return () => off?.();
        });
      } catch (error) {
        console.warn("[claude-quote] locale register failed:", error);
      }
      try {
        const bound = ctx.locale.bind?.(NS);
        if (typeof bound === "function") boundT = bound;
      } catch (error) {
        // 用内置中文表
      }
      ctx.effect(holdSource);
      ctx.effect(holdRuntime);

      const registerRule = (uiConversation) => {
        const off = uiConversation?.userText?.register?.(quoteRule);
        return () => {
          if (typeof off === "function") off();
        };
      };
      if (typeof ctx.inject === "function") {
        ctx.inject(["uiConversation"], (scope) => {
          scope.effect(() => registerRule(scope.uiConversation ?? scope.get?.("uiConversation")));
        });
      } else {
        ctx.effect(() => registerRule(service("uiConversation")));
      }

      if (typeof ctx.inject === "function") {
        ctx.inject(["resources", "sidebarRightTabs", "sessions"], (scope) => registerSideChat(scope));
      }

      ctx.slots.inject("conversation.user.text.node", function* () {
        yield ctx.slots.register(
          { name: "conversation.user.text.node", key: RULE_ID, priority: 100, locale: NS },
          QuoteMessage
        );
      });
      ctx.slots.inject("conversation.input.overlay", () =>
        ctx.slots.register(
          { name: "conversation.input.overlay", id: "claude-quote", order: 6, locale: NS, inject: () => ({}) },
          QuoteOverlay
        )
      );

      if (typeof window !== "undefined") {
        window.__claudeQuote = { uiStore, layerStore, composers, parseBlocks, addToPrompt, removeChip, shellOf, sideChatOf, service };
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.__testing = { parseBlocks, replyBlock, attachBlock, chipText, quoteRule, escapeComment };
    return module.exports;
  }
});

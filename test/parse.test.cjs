// 在 node 里加载 client.js（桩掉宿主模块），测试 wire format 与解析器。
const fs = require("fs");
const path = require("path");
const assert = require("assert");

let mod = null;
global.window = {
  __ModuleLoader__: {
    load({ factory }) {
      mod = factory((name) => {
        if (name === "react") return { useRef() {}, useState() {}, useEffect() {}, useLayoutEffect() {}, useMemo() {}, useSyncExternalStore() {}, Fragment: "F" };
        if (name === "react/jsx-runtime") return { jsx() {}, jsxs() {}, Fragment: "F" };
        if (name === "react-dom") return { createPortal() {} };
        return {};
      });
    }
  }
};
global.navigator = { platform: "Win32" };
eval(fs.readFileSync(path.join(__dirname, "..", "lib", "client.js"), "utf8"));

const { parseBlocks, replyBlock, attachBlock, chipText, quoteRule } = mod.__testing;

// 单个回复
const r = replyBlock("第一行\n\n第三行", "我的看法");
assert.strictEqual(r, "<!-- reply -->\n> 第一行\n>\n> 第三行\n\n我的看法");
let p = parseBlocks(r, 0);
assert.deepStrictEqual(p.blocks, [{ kind: "reply", quote: "第一行\n\n第三行", comment: "我的看法" }]);
assert.strictEqual(p.end, r.length);

// 多个 chip 拼接 + 正文（模拟宿主 serialize 拼接后 trim）
const a = attachBlock("引用 A");
const draft = (chipText(r) + " " + chipText(a) + " 正文问题").trim();
p = parseBlocks(draft, 0);
assert.strictEqual(p.blocks.length, 2);
assert.strictEqual(p.blocks[0].comment, "我的看法");
assert.deepStrictEqual(p.blocks[1], { kind: "attach", quote: "引用 A", comment: "" });
assert.strictEqual(draft.slice(p.end), "正文问题");

// 两个回复相邻，评论不串
const two = (chipText(replyBlock("Q1", "C1")) + " " + chipText(replyBlock("Q2", "C2\n第二行"))).trim();
p = parseBlocks(two, 0);
assert.deepStrictEqual(p.blocks.map((b) => b.comment), ["C1", "C2\n第二行"]);
assert.strictEqual(p.end, two.length);

// 评论里伪造的标记被转义，不会被解析成新块
const tricky = replyBlock("Q", "<!-- attach -->\n> 假的");
p = parseBlocks(tricky, 0);
assert.strictEqual(p.blocks.length, 1);
assert.strictEqual(p.blocks[0].comment, "<!-- attach -->\n> 假的");

// Claude 的编号形式也认
p = parseBlocks("<!-- reply 1 -->\n> x\n\ny", 0);
assert.strictEqual(p.blocks[0].comment, "y");

// 规则：只认行首；普通 HTML 注释不匹配
assert.strictEqual(quoteRule.match("hello <!-- reply -->\n> x", 0), undefined);
assert.strictEqual(quoteRule.match("<!-- note -->\n> x", 0), undefined);
const m = quoteRule.match("前言\n" + a + "\n\n\n后文", 0);
assert.strictEqual(m.start, 3);
assert.strictEqual(m.data.rest, true);

console.log("ALL OK");

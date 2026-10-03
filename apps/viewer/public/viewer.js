(() => {
  "use strict";
  const session = JSON.parse(document.getElementById("session-data").textContent);
  const byId = (id) => document.getElementById(id);
  const text = (id, value) => { byId(id).textContent = value; };
  const statusNames = { open: "未確定", selected: "選択中", collapsed: "収束", rejected: "却下", active: "有効", latent: "保留", frozen: "凍結", retired: "終了" };
  const origins = { user: "ユーザーの訂正", system: "システム", audit: "監査", inferred: "推定" };
  let position = 0;
  let phase = "after";

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function changeLabel(item, priorItems) {
    const old = priorItems.find((prior) => prior.id === item.id);
    return old ? (same(old, item) ? "前の状態から保持" : "このターンで更新") : "このターンで追加";
  }
  function stateItem(item, heading, description, meta, extra) {
    const node = element("article", "state-item");
    node.append(element("span", "state-meta", `${item.id} · ${meta}`), element("h4", "", heading), element("p", "", description));
    if (extra) node.append(element("p", "", extra));
    return node;
  }
  function fill(id, nodes, emptyMessage) {
    byId(id).replaceChildren(...(nodes.length ? nodes : [element("p", "empty", emptyMessage)]));
  }
  function readPosition() {
    const match = /^#turn=(\d+)$/.exec(location.hash);
    const number = match ? Number(match[1]) : 1;
    return Math.min(session.turns.length - 1, Math.max(0, number - 1));
  }
  function navigate(index) {
    if (index < 0 || index >= session.turns.length) return;
    const hash = `#turn=${index + 1}`;
    if (location.hash === hash) render(); else location.hash = hash;
  }
  function render() {
    position = readPosition();
    const turn = session.turns[position];
    const state = phase === "before" ? turn.stateBefore : turn.stateAfter;
    const before = turn.stateBefore;
    const after = turn.stateAfter;
    document.querySelectorAll(".turn").forEach((button, index) => {
      if (index === position) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
    byId("previous").disabled = position === 0;
    byId("next").disabled = position === session.turns.length - 1;
    byId("before").setAttribute("aria-pressed", String(phase === "before"));
    byId("after").setAttribute("aria-pressed", String(phase === "after"));
    text("turn-status", `${position + 1} / ${session.turns.length} · ${turn.label}`);
    text("user", turn.user);
    text("answer", turn.answer);
    text("audit", `audit: ${turn.audit}`);
    text("snapshot-label", `${phase === "before" ? "入力前" : "応答後"} · state.turn = ${state.turn}`);
    const openings = state.interpretation_openings.filter((item) => ["open", "selected"].includes(item.status));
    const openCount = openings.filter((item) => item.status === "open").length;
    const selectedCount = openings.length - openCount;
    text("opening-count", `未確定 ${openCount} / 選択 ${selectedCount}`);
    fill("openings", openings.map((item) => stateItem(item, item.label, item.reading, statusNames[item.status], `選ぶと変わること: ${item.changes_if_selected}`)), "この時点で開いている解釈はありません。");
    text("rejected-count", String(state.rejected_variants.length));
    fill("rejections", state.rejected_variants.map((item) => stateItem(item, item.label, item.summary,
      `${origins[item.rejected_by] || item.rejected_by} · Turn ${item.turn}`, `理由: ${item.reason}`)), "まだ否定された前提はありません。");
    const voids = state.voids.filter((item) => item.status === "open");
    text("void-count", String(voids.length));
    fill("voids", voids.map((item) => stateItem(item, item.question, "解決が必要な事実の不足", "open")), "未解決の事実の不足はありません。解釈の選択とは別の状態です。");

    const carryNodes = [];
    function carry(item, list, title, description, rejected = false) {
      const node = element("article", `carry-item${rejected ? " rejected-item" : ""}`);
      node.append(element("span", "change", `${item.id} · ${changeLabel(item, list)}`), element("h3", "", title), element("p", "", description));
      carryNodes.push(node);
    }
    after.sections.filter((item) => item.status !== "retired").forEach((item) => carry(item, before.sections, item.label, `${item.domain_mode} / ${statusNames[item.status]} · ${item.gist}`));
    after.interpretation_openings.filter((item) => ["open", "selected"].includes(item.status)).forEach((item) => carry(item, before.interpretation_openings, item.label, `${statusNames[item.status]} · ${item.reading}`));
    after.rejected_variants.forEach((item) => carry(item, before.rejected_variants, item.label, item.summary, true));
    after.voids.filter((item) => item.status !== "resolved").forEach((item) => carry(item, before.voids, item.question, `void / ${item.status}`));
    fill("carry-list", carryNodes, "持ち越す表示対象の状態はありません。");
    const next = session.turns[position + 1];
    text("continuity", next
      ? (same(after, next.stateBefore) ? "応答後の表示対象の状態は、次のターンの入力前と一致しています。" : "次のターンの入力前とは差分があります。保存された状態をそのまま表示しています。")
      : "ここが最後の保存済みターンです。この応答後の状態を、次回の入力に渡せます。");
    text("json", JSON.stringify(state, null, 2));
  }

  text("title", session.title);
  text("description", session.description);
  text("source", session.source);
  session.turns.forEach((turn, index) => {
    const button = element("button", "turn");
    button.type = "button";
    button.append(element("span", "turn-number", `TURN ${turn.stateAfter.turn}`), element("span", "", turn.label));
    button.addEventListener("click", () => navigate(index));
    byId("timeline").append(button);
  });
  byId("previous").addEventListener("click", () => navigate(position - 1));
  byId("next").addEventListener("click", () => navigate(position + 1));
  for (const name of ["before", "after"]) byId(name).addEventListener("click", () => { phase = name; render(); });
  addEventListener("hashchange", render);
  render();
})();

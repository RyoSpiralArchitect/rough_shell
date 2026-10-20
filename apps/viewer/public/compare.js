(() => {
  "use strict";
  const data = JSON.parse(document.getElementById("session-data").textContent);
  const byId = (id) => document.getElementById(id);
  const setText = (id, value) => { byId(id).textContent = value; };
  const turns = [...new Set([...data.left.turns, ...data.right.turns].map((turn) => turn.stateAfter.turn))].sort((a, b) => a - b);
  const defaultTurn = data.sharedStartTurns[0] ?? turns[0];
  const names = { open: "未確定", selected: "選択中", collapsed: "保留", rejected: "却下", active: "有効", latent: "保留", frozen: "凍結", retired: "終了", resolved: "解決済み" };
  const groups = { sections: "セクション", interpretation_openings: "解釈", rejected_variants: "却下された前提", voids: "事実の不足" };
  let current = defaultTurn;
  let phase = "after";
  function node(tag, className, value) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value !== undefined) el.textContent = value;
    return el;
  }
  function stateOf(turn) { return phase === "before" ? turn.stateBefore : turn.stateAfter; }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function describe(item) {
    return `${item.status ? `${names[item.status] || item.status} · ` : ""}${item.gist ?? item.reading ?? item.summary ?? item.question}`;
  }
  function memoryLine(label, values, empty) {
    const row = node("div", "memory-line");
    row.append(node("h3", "", label), node("p", "", values.length ? values.join(" / ") : empty));
    return row;
  }
  function renderBranch(side, turn) {
    const container = byId(`${side}-dialogue`);
    const memory = byId(`${side}-memory`);
    container.replaceChildren();
    memory.replaceChildren();
    setText(`${side}-audit`, turn ? `audit: ${turn.audit}` : "記録なし");
    if (!turn) {
      container.append(node("p", "missing-turn", "この枝には、このターンの記録がありません。"));
      return;
    }
    container.append(node("p", "speaker", "YOU"), node("p", "message user", turn.user),
      node("p", "speaker", "ASSISTANT"), node("p", "message answer", turn.answer));
    const state = stateOf(turn);
    memory.append(node("p", "state-meta", `${phase === "before" ? "入力前" : "応答後"}の記憶 · Turn ${state.turn}`),
      memoryLine("選んだ解釈", state.interpretation_openings.filter((item) => item.status === "selected").map((item) => item.label), "まだ選んでいません"),
      memoryLine("退けた前提", state.rejected_variants.map((item) => item.label), "記録はありません"));
  }
  function stateRows(state) {
    return new Map(Object.keys(groups).flatMap((group) => state[group].map((item) => [`${group}:${item.id}`, { group, item }])));
  }
  function differenceRow(group, left, right) {
    const item = left ?? right;
    const row = node("article", "difference-row");
    row.append(node("span", "state-meta", `${groups[group]} · ${item.id}`), node("h3", "", item.label ?? item.question));
    const columns = node("div", "difference-values");
    for (const [label, value] of [["A", left], ["B", right]]) {
      const column = node("div", "");
      column.append(node("span", "branch-tag", label), node("p", "", value ? describe(value) : "この枝にはありません"));
      columns.append(column);
    }
    row.append(columns);
    // Every changed allowlisted field remains inspectable, including reasons
    // and changes_if_selected that do not fit the compact description.
    const details = node("details", "field-details");
    details.append(node("summary", "", "フィールドを比べる"), node("pre", "", JSON.stringify({ A: left ?? null, B: right ?? null }, null, 2)));
    row.append(details);
    return row;
  }
  function renderDifferences(left, right) {
    byId("differences").replaceChildren();
    byId("shared-items").replaceChildren();
    byId("shared-details").hidden = !left || !right;
    if (!left || !right) {
      setText("comparison-summary", "両方の記録がそろったターンで、状態を比較できます。記録がない枝を空の状態として扱いません。");
      return;
    }
    const a = stateRows(stateOf(left));
    const b = stateRows(stateOf(right));
    const shared = [];
    const changed = [];
    const onlyA = [];
    const onlyB = [];
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      const l = a.get(key);
      const r = b.get(key);
      if (l && r && same(l.item, r.item)) shared.push(l);
      else if (l && r) changed.push([l.group, l.item, r.item]);
      else if (l) onlyA.push([l.group, l.item, undefined]);
      else onlyB.push([r.group, undefined, r.item]);
    }
    setText("comparison-summary", `${phase === "before" ? "入力前" : "応答後"} · 共通 ${shared.length} / 内容が異なる ${changed.length} / A のみ ${onlyA.length} / B のみ ${onlyB.length}（表示対象の項目）`);
    for (const [title, rows] of [["内容が変わった状態", changed], ["A にだけある状態", onlyA], ["B にだけある状態", onlyB]]) {
      if (!rows.length) continue;
      const section = node("section", "difference-group");
      section.append(node("h3", "difference-heading", title), ...rows.map((row) => differenceRow(...row)));
      byId("differences").append(section);
    }
    if (!changed.length && !onlyA.length && !onlyB.length) byId("differences").append(node("p", "empty", "表示対象の状態は、二つの枝で一致しています。"));
    setText("shared-summary", `両方に残った状態を見る · ${shared.length}`);
    for (const { group, item } of shared) {
      const row = node("article", "shared-item");
      row.append(node("span", "state-meta", `${groups[group]} · ${item.id}`), node("h3", "", item.label ?? item.question), node("p", "muted", describe(item)));
      byId("shared-items").append(row);
    }
  }
  function navigate(turn) { if (turn !== undefined) location.hash = `turn=${turn}`; }
  function render() {
    const match = /^#turn=(\d+)$/.exec(location.hash);
    const requested = match ? Number(match[1]) : defaultTurn;
    current = turns.includes(requested) ? requested : defaultTurn;
    const left = data.left.turns.find((turn) => turn.stateAfter.turn === current);
    const right = data.right.turns.find((turn) => turn.stateAfter.turn === current);
    document.querySelectorAll(".turn").forEach((button) => {
      if (Number(button.dataset.turn) === current) {
        button.setAttribute("aria-current", "step");
        const timeline = byId("comparison-timeline");
        timeline.scrollLeft = button.offsetLeft + button.offsetWidth / 2 - timeline.clientWidth / 2;
      }
      else button.removeAttribute("aria-current");
    });
    const index = turns.indexOf(current);
    byId("previous").disabled = index === 0;
    byId("next").disabled = index === turns.length - 1;
    for (const name of ["before", "after"]) byId(name).setAttribute("aria-pressed", String(phase === name));
    setText("turn-status", `Turn ${current} · ${left && right ? "二つの続きを比較" : "片方の枝だけに記録があります"}`);
    const sharedStart = data.sharedStartTurns.includes(current);
    setText("origin-status", !left || !right ? "このターンは片方の記録のみ" : sharedStart ? "入力前の保存状態は、同じ。" : "入力前の保存状態にも違いがあります。");
    setText("origin-detail", sharedStart
      ? "同じ状態から続けた二つの対話です。どの解釈を選び、どの訂正を覚えているかを比べられます。"
      : "同じターン番号の記録を並べています。共通の出発点や、親子関係を推定してはいません。");
    renderBranch("left", left);
    renderBranch("right", right);
    renderDifferences(left, right);
    setText("json", JSON.stringify({ A: left ? stateOf(left) : null, B: right ? stateOf(right) : null }, null, 2));
  }
  for (const turn of turns) {
    const button = node("button", "turn");
    button.type = "button";
    button.dataset.turn = turn;
    const both = data.left.turns.some((item) => item.stateAfter.turn === turn) && data.right.turns.some((item) => item.stateAfter.turn === turn);
    button.append(node("span", "turn-number", `TURN ${turn}`), node("span", "", both ? "二つの続き" : "記録をたどる"));
    button.addEventListener("click", () => navigate(turn));
    byId("comparison-timeline").append(button);
  }
  setText("left-source", `A · ${data.left.title}\n${data.left.description}\n${data.left.source}`);
  setText("right-source", `B · ${data.right.title}\n${data.right.description}\n${data.right.source}`);
  setText("provenance-note", `A: ${data.left.source} / B: ${data.right.source}`);
  byId("previous").addEventListener("click", () => navigate(turns[turns.indexOf(current) - 1]));
  byId("next").addEventListener("click", () => navigate(turns[turns.indexOf(current) + 1]));
  for (const name of ["before", "after"]) byId(name).addEventListener("click", () => { phase = name; render(); });
  addEventListener("hashchange", render);
  render();
})();

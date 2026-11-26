// 북마크 저장소 (크롬처럼 폴더가 있는 트리)
// 항목: { id, type: "url", title, url } 또는 { id, type: "folder", title, children: [...] }
// 맨 위 배열 = 북마크 막대. 파일: 사용자 데이터 폴더의 bookmarks.json
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULTS = [
  { type: "url", title: "네이버", url: "https://www.naver.com/" },
  { type: "url", title: "네이버 부동산", url: "https://land.naver.com/" },
  { type: "url", title: "네이버 광고", url: "https://searchad.naver.com/" },
];

const newId = () => "b" + crypto.randomBytes(5).toString("hex");
const sameUrl = (a, b) => String(a || "").replace(/\/$/, "") === String(b || "").replace(/\/$/, "");
const clean = (t, max = 80) => String(t || "").trim().slice(0, max);

function createStore(filePath, onChange = () => {}) {
  // 예전 형식([{title,url}])도 읽고, 모든 항목에 id를 붙인다
  function normalize(list) {
    return (Array.isArray(list) ? list : []).map((n) => {
      if (!n || typeof n !== "object") return null;
      if (n.type === "folder" || Array.isArray(n.children)) {
        return { id: n.id || newId(), type: "folder", title: clean(n.title) || "새 폴더", children: normalize(n.children) };
      }
      if (!/^https?:/i.test(n.url || "")) return null;
      return { id: n.id || newId(), type: "url", title: clean(n.title) || n.url, url: n.url };
    }).filter(Boolean);
  }
  function load() {
    try { return normalize(JSON.parse(fs.readFileSync(filePath(), "utf8"))); }
    catch { return normalize(DEFAULTS); }
  }
  function save(tree) {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true });
    fs.writeFileSync(filePath(), JSON.stringify(tree, null, 2));
    onChange(tree);
    return tree;
  }

  // 트리 탐색: fn(node, parentArray, index, folderPathTitles)
  function walk(list, fn, trail = []) {
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (fn(n, list, i, trail) === false) return false;
      if (n.type === "folder" && walk(n.children, fn, [...trail, n.title]) === false) return false;
    }
    return true;
  }
  function find(tree, pred) {
    let hit = null;
    walk(tree, (n, parent, index, trail) => { if (pred(n)) { hit = { node: n, parent, index, trail }; return false; } return true; });
    return hit;
  }
  const findId = (tree, id) => find(tree, (n) => n.id === id);
  const findUrl = (tree, url) => find(tree, (n) => n.type === "url" && sameUrl(n.url, url));
  const childrenOf = (tree, folderId) => {
    if (!folderId) return tree;
    const f = findId(tree, folderId);
    if (!f || f.node.type !== "folder") throw new Error("폴더를 찾지 못했습니다.");
    return f.node.children;
  };

  const api = {
    load,
    sameUrl,
    // 모든 북마크를 한 줄로 (폴더 경로 포함): 자동완성·Claude용
    flatten() {
      const out = [];
      walk(load(), (n, _p, _i, trail) => { if (n.type === "url") out.push({ id: n.id, title: n.title, url: n.url, folder: trail.join("/") }); });
      return out;
    },
    // 폴더 목록 (들여쓰기용 깊이 포함)
    folders() {
      const out = [];
      walk(load(), (n, _p, _i, trail) => { if (n.type === "folder") out.push({ id: n.id, title: n.title, path: [...trail, n.title].join("/"), depth: trail.length }); });
      return out;
    },
    get(id) { const f = findId(load(), id); return f ? f.node : null; },
    findUrl(url) { const f = findUrl(load(), url); return f ? { ...f.node, folder: f.trail.join("/") } : null; },

    // 같은 주소가 이미 있으면 이름만 바꾸고(폴더를 주면 그 폴더로 옮김), 없으면 폴더(기본: 북마크 막대) 끝에 추가
    add(title, url, folderId = null) {
      if (!/^https?:/i.test(url || "")) throw new Error("http/https 주소만 북마크할 수 있습니다.");
      const tree = load();
      const hit = findUrl(tree, url);
      if (hit) {
        if (title) hit.node.title = clean(title);
        if (folderId !== null && folderId !== undefined) {
          const dest = childrenOf(tree, folderId);
          hit.parent.splice(hit.index, 1);
          dest.push(hit.node);
        }
        save(tree);
        return hit.node.id;
      }
      const node = { id: newId(), type: "url", title: clean(title) || url, url };
      childrenOf(tree, folderId).push(node);
      save(tree);
      return node.id;
    },
    addFolder(title, parentId = null) {
      const tree = load();
      const node = { id: newId(), type: "folder", title: clean(title) || "새 폴더", children: [] };
      childrenOf(tree, parentId).push(node);
      save(tree);
      return node.id;
    },
    // "업무/광고" 같은 경로의 폴더를 찾고, 없으면 만든다
    ensureFolderPath(folderPath) {
      const parts = String(folderPath || "").split("/").map((s) => clean(s)).filter(Boolean);
      if (!parts.length) return null;
      const tree = load();
      let list = tree, id = null, created = false;
      for (const p of parts) {
        let f = list.find((n) => n.type === "folder" && n.title === p);
        if (!f) { f = { id: newId(), type: "folder", title: p, children: [] }; list.push(f); created = true; }
        id = f.id; list = f.children;
      }
      if (created) save(tree);
      return id;
    },
    rename(id, title) {
      const tree = load(), f = findId(tree, id);
      if (f && clean(title)) { f.node.title = clean(title); save(tree); }
      return tree;
    },
    remove(id) {
      const tree = load(), f = findId(tree, id);
      if (f) { f.parent.splice(f.index, 1); save(tree); }
      return tree;
    },
    removeUrl(url) {
      const tree = load();
      let hit;
      while ((hit = findUrl(tree, url))) hit.parent.splice(hit.index, 1);
      save(tree);
      return tree;
    },
    // 다른 폴더로 옮기기 (folderId 없으면 북마크 막대). 폴더를 자기 안으로 옮기는 것은 막는다.
    move(id, folderId = null) {
      const tree = load(), f = findId(tree, id);
      if (!f) return tree;
      if (folderId && f.node.type === "folder" && (folderId === id || find(f.node.children, (n) => n.id === folderId))) {
        throw new Error("폴더를 자기 안으로 옮길 수 없습니다.");
      }
      const dest = childrenOf(tree, folderId);
      f.parent.splice(f.index, 1);
      dest.push(f.node);
      save(tree);
      return tree;
    },
    count(id) { // 폴더 안 북마크 수
      const n = api.get(id);
      if (!n || n.type !== "folder") return 0;
      let c = 0; walk(n.children, (x) => { if (x.type === "url") c++; });
      return c;
    },
    // 크롬 북마크 트리 합치기: 같은 위치의 같은 이름 폴더는 합치고, 이미 있는 주소는 건너뜀
    mergeChrome(roots) {
      const tree = load();
      let found = 0, added = 0;
      const createdHere = new Set(); // 이번 가져오기에서 만든 폴더만 나중에 비었으면 정리
      const mergeInto = (destList, chromeChildren) => {
        for (const c of chromeChildren || []) {
          if (c.type === "folder") {
            let f = destList.find((n) => n.type === "folder" && n.title === clean(c.name));
            if (!f) { f = { id: newId(), type: "folder", title: clean(c.name) || "폴더", children: [] }; destList.push(f); createdHere.add(f.id); }
            mergeInto(f.children, c.children);
          } else if (c.type === "url" && /^https?:/i.test(c.url || "")) {
            found++;
            if (findUrl(tree, c.url)) continue;
            destList.push({ id: newId(), type: "url", title: clean(c.name) || c.url, url: c.url });
            added++;
          }
        }
      };
      const folderFor = (title) => {
        let f = tree.find((n) => n.type === "folder" && n.title === title);
        if (!f) { f = { id: newId(), type: "folder", title, children: [] }; tree.push(f); createdHere.add(f.id); }
        return f.children;
      };
      for (const r of roots) {
        if (r.bookmark_bar) mergeInto(tree, r.bookmark_bar.children);                                  // 북마크바 → 북마크 막대
        if (r.other && (r.other.children || []).length) mergeInto(folderFor("기타 북마크"), r.other.children);
        if (r.synced && (r.synced.children || []).length) mergeInto(folderFor("모바일 북마크"), r.synced.children);
      }
      // 이번에 만든 폴더 중 가져올 것이 없어 비어 있는 폴더는 지운다 (사용자가 만든 빈 폴더는 그대로)
      const prune = (list) => { for (let i = list.length - 1; i >= 0; i--) { const n = list[i]; if (n.type === "folder") { prune(n.children); if (!n.children.length && createdHere.has(n.id)) list.splice(i, 1); } } };
      if (added) { prune(tree); save(tree); }
      return { found, added };
    },
  };
  return api;
}

module.exports = { createStore, sameUrl };

// 拾光集 — a small hash-routed SPA.
//   #/                              home: collection + album cards
//   #/collection/<collection>       an article collection's list
//   #/article/<collection>/<slug>   the markdown viewer
//   #/album/<album>                 the picture viewer

const app = document.getElementById("app");
let MANIFEST = null;

// Language-neutral count labels: a small inline icon + the number.
const ICON = {
  article:
    '<svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/></svg>',
  photo:
    '<svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-7 7"/></svg>',
};
const countLabel = (type, n) => `${ICON[type]}${n}`;

// Encode each segment of a root-relative path (filenames may be non-ASCII).
const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function loadManifest() {
  if (MANIFEST) return MANIFEST;
  const res = await fetch("content.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("无法读取 content.json，请先运行 `node build.mjs` 生成内容索引。");
  MANIFEST = await res.json();
  return MANIFEST;
}

/* ---------------- Views ---------------- */

// A card cover: a real image if one exists, otherwise a colored placeholder
// (deterministic earthy gradient derived from the name) so collections and
// albums share the same look even when a collection has no picture.
function coverHtml(src, name) {
  if (src) return `<div class="card-cover"><img loading="lazy" src="${src}" alt="${esc(name)}" /></div>`;
  let h = 0;
  for (const ch of name) h = (h + ch.charCodeAt(0) * 7) % 360;
  const style = `background:linear-gradient(135deg,hsl(${h},28%,60%),hsl(${(h + 24) % 360},32%,40%))`;
  return `<div class="card-cover placeholder" style="${style}"><span>${esc(name)}</span></div>`;
}

function renderHome(m) {
  const collections = m.collections
    .map((c) => {
      const cover = c.cover ? encodePath(c.cover.thumb) : null;
      return `
      <a class="card" href="#/collection/${encodeURIComponent(c.name)}">
        ${coverHtml(cover, c.name)}
        <div class="card-body">
          <h3 class="card-title">${esc(c.name)}</h3>
          <p class="card-meta">${countLabel("article", c.count)}</p>
        </div>
      </a>`;
    })
    .join("");

  const albums = m.albums
    .map(
      (a) => `
      <a class="card" href="#/album/${encodeURIComponent(a.name)}">
        ${coverHtml(encodePath(a.cover.thumb), a.name)}
        <div class="card-body">
          <h3 class="card-title">${esc(a.name)}</h3>
          <p class="card-meta">${countLabel("photo", a.count)}</p>
        </div>
      </a>`
    )
    .join("");

  const sections = [];
  if (collections) sections.push(`<section class="block"><div class="grid">${collections}</div></section>`);
  if (albums) sections.push(`<section class="block"><div class="grid">${albums}</div></section>`);
  app.innerHTML =
    sections.join("") || `<p class="empty">还没有内容，往 docs/ 里建个文件夹放点东西吧。</p>`;
}

function renderCollection(m, name) {
  const c = m.collections.find((x) => x.name === name);
  if (!c) {
    app.innerHTML = `<p class="error">找不到这个合集。</p>`;
    return;
  }
  app.innerHTML = `
    <a class="back-link" href="#/" aria-label="返回首页">←</a>
    <div class="collection">
      <div class="collection-head"><h3>${esc(c.name)}</h3><span class="count">${countLabel("article", c.count)}</span></div>
      <ul class="post-list">
        ${c.articles
          .map(
            (a) => `<li><a href="#/article/${encodeURIComponent(c.name)}/${encodeURIComponent(a.slug)}">
              <span class="p-title">${esc(a.title)}</span><span class="p-date">${esc(a.date)}</span></a></li>`
          )
          .join("")}
      </ul>
    </div>`;
}

async function renderArticle(m, collName, slug) {
  const coll = m.collections.find((c) => c.name === collName);
  const art = coll && coll.articles.find((a) => a.slug === slug);
  if (!art) {
    app.innerHTML = `<p class="error">找不到这篇文章。</p>`;
    return;
  }
  app.innerHTML = `<div class="article"><p class="loading">正在展开字句…</p></div>`;

  const path = `docs/${encodeURIComponent(collName)}/${encodeURIComponent(art.file)}`;
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) {
    app.innerHTML = `<p class="error">无法读取文章文件：${esc(path)}</p>`;
    return;
  }
  let raw = await res.text();
  raw = raw.replace(/^---\n[\s\S]*?\n---\n?/, ""); // strip frontmatter

  // Resolve relative ![](image) paths against the article's folder, before
  // parsing. (Done as a string pass so we never mutate marked's global state.)
  const resolveImg = (href) => {
    if (!href || /^(https?:|\/|data:|docs\/)/i.test(href)) return href;
    const rel = href.replace(/^\.\//, "").split("/").map(encodeURIComponent).join("/");
    return `docs/${encodeURIComponent(collName)}/${rel}`;
  };
  raw = raw.replace(/(!\[[^\]]*\]\(\s*)([^)\s]+)/g, (_, pre, href) => pre + resolveImg(href));

  app.innerHTML = `
    <article class="article">
      <a class="back-link" href="#/collection/${encodeURIComponent(collName)}" aria-label="返回${esc(collName)}">←</a>
      <header class="article-header">
        <h1>${esc(art.title)}</h1>
        <p class="meta">${esc(collName)} · ${esc(art.date)}</p>
      </header>
      <div class="markdown-body">${marked.parse(raw)}</div>
    </article>`;
}

function renderAlbum(m, albumName) {
  const album = m.albums.find((a) => a.name === albumName);
  if (!album) {
    app.innerHTML = `<p class="error">找不到这个相册。</p>`;
    return;
  }
  app.innerHTML = `
    <a class="back-link" href="#/" aria-label="返回首页">←</a>
    <header class="album-header"><h1>${esc(albumName)}</h1><p class="meta">${countLabel("photo", album.count)}</p></header>
    <div class="gallery">
      ${album.images
        .map(
          (img, i) => `<figure data-index="${i}"><img loading="lazy" src="${encodePath(img.thumb)}" alt="${esc(albumName)} ${i + 1}" /></figure>`
        )
        .join("")}
    </div>`;
  setupLightbox(album.images.map((img) => encodePath(img.full)), albumName);
}

/* ---------------- Lightbox (picture viewer) ---------------- */

const lb = document.getElementById("lightbox");
const lbImg = lb.querySelector(".lb-image");
const lbCaption = lb.querySelector(".lb-caption");
let lbList = [];
let lbIndex = 0;

function setupLightbox(list, caption) {
  lbList = list;
  document.querySelectorAll(".gallery figure").forEach((fig) => {
    fig.addEventListener("click", () => openLightbox(Number(fig.dataset.index), caption));
  });
}
function openLightbox(i, caption) {
  lbIndex = i;
  lbImg.src = lbList[i];
  lbCaption.textContent = `${caption} · ${i + 1} / ${lbList.length}`;
  lb.hidden = false;
  document.body.style.overflow = "hidden";
}
function closeLightbox() {
  lb.hidden = true;
  document.body.style.overflow = "";
}
function step(dir) {
  if (!lbList.length) return;
  lbIndex = (lbIndex + dir + lbList.length) % lbList.length;
  lbImg.src = lbList[lbIndex];
  lbCaption.textContent = lbCaption.textContent.replace(/\d+ \/ \d+$/, `${lbIndex + 1} / ${lbList.length}`);
}
lb.querySelector(".lb-close").addEventListener("click", closeLightbox);
lb.querySelector(".lb-prev").addEventListener("click", () => step(-1));
lb.querySelector(".lb-next").addEventListener("click", () => step(1));
lb.addEventListener("click", (e) => { if (e.target === lb) closeLightbox(); });
document.addEventListener("keydown", (e) => {
  if (lb.hidden) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") step(-1);
  if (e.key === "ArrowRight") step(1);
});

/* ---------------- Router ---------------- */

async function route() {
  closeLightbox();
  const hash = location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/").filter(Boolean).map(decodeURIComponent);
  try {
    const m = await loadManifest();
    if (parts[0] === "collection" && parts.length >= 2) renderCollection(m, parts[1]);
    else if (parts[0] === "article" && parts.length >= 3) await renderArticle(m, parts[1], parts[2]);
    else if (parts[0] === "album" && parts.length >= 2) renderAlbum(m, parts[1]);
    else renderHome(m);
    window.scrollTo({ top: 0 });
  } catch (err) {
    app.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

window.addEventListener("hashchange", route);
route(); // module scripts run after the DOM is parsed, so this is safe

#!/usr/bin/env node
// Scans docs/ and writes content.json — the manifest the front-end reads
// (browsers can't list directories on their own).
//
// Every sub-folder of docs/ is classified by what's inside it:
//   contains .md files   -> an article collection
//   only images, no .md  -> a photo album
//
//   docs/<collection>/<article>.md   -> an article inside a collection
//   docs/<album>/<image>.jpg         -> a photo inside an album
//
// Run it whenever you add or rename content:  node build.mjs

import { readdir, readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const IMG_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".svg"]);

// Thumbnails: raster images get a small webp; vector/animated stay as-is.
const THUMB_DIR = "thumbs";
const THUMB_MAX = 800;
const NO_THUMB = new Set([".svg", ".gif"]);

// Make a thumbnail for docs/<folder>/<file> and return { full, thumb, w, h }
// as root-relative URL paths plus intrinsic pixel dimensions (so the gallery
// can lay photos out justified). On anything unexpected, thumb falls back to
// full and w/h are omitted.
async function makeImage(folder, file) {
  const full = `docs/${folder}/${file}`;
  const ext = path.extname(file).toLowerCase();
  const srcPath = path.join(ROOT, "docs", folder, file);

  // Probe intrinsic dimensions — works for rasters and most SVGs.
  let dims = {};
  try {
    const meta = await sharp(srcPath).metadata();
    if (meta.width && meta.height) dims = { w: meta.width, h: meta.height };
  } catch {}

  if (NO_THUMB.has(ext)) return { full, thumb: full, ...dims };

  const base = file.slice(0, -ext.length);
  const relThumb = `${THUMB_DIR}/${folder}/${base}.webp`;
  try {
    await mkdir(path.join(ROOT, THUMB_DIR, folder), { recursive: true });
    await sharp(srcPath)
      .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 72 })
      .toFile(path.join(ROOT, relThumb));
    return { full, thumb: relThumb, ...dims };
  } catch {
    return { full, thumb: full, ...dims };
  }
}

async function listDirs(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
  } catch {
    return [];
  }
}

async function listFiles(dir, filter) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && !e.name.startsWith(".") && filter(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// Pull a few fields out of optional YAML-ish frontmatter and the first heading.
function parseMarkdownMeta(raw, fallbackTitle) {
  const meta = { title: fallbackTitle, date: "", excerpt: "", cover: "" };
  let body = raw;

  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    body = raw.slice(fm[0].length);
    for (const line of fm[1].split("\n")) {
      const m = line.match(/^(\w+)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (key in meta) meta[key] = val;
    }
  }

  if (!meta.title || meta.title === fallbackTitle) {
    const h1 = body.match(/^#\s+(.+)$/m);
    if (h1) meta.title = h1[1].trim();
  }
  if (!meta.excerpt) {
    const para = body
      .replace(/^#.*$/gm, "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    if (para) meta.excerpt = para.replace(/[#>*_`\[\]]/g, "").slice(0, 80);
  }
  return meta;
}

// A bare local image filename (no slashes, not a URL) sitting in the
// collection folder — used as a cover candidate.
function localImageName(href) {
  if (!href) return null;
  const clean = href.replace(/^\.\//, "");
  if (/^(https?:|\/)/.test(clean) || clean.includes("/")) return null;
  if (!IMG_EXT.has(path.extname(clean).toLowerCase())) return null;
  return clean;
}

async function buildArticles() {
  const collections = [];
  for (const dir of await listDirs(path.join(ROOT, "docs"))) {
    const collPath = path.join(ROOT, "docs", dir.name);
    const mdFiles = await listFiles(collPath, (n) => n.toLowerCase().endsWith(".md"));
    const imgFiles = await listFiles(collPath, (n) => IMG_EXT.has(path.extname(n).toLowerCase()));

    // Cover priority: a cover.* file in the folder, else discovered below.
    let cover = imgFiles.find((n) => /^cover\./i.test(n)) || null;

    const articles = [];
    for (const file of mdFiles) {
      const full = path.join(collPath, file);
      const raw = await readFile(full, "utf8");
      const info = await stat(full);
      const meta = parseMarkdownMeta(raw, file.replace(/\.md$/i, ""));

      // …else a `cover:` in frontmatter, …else the first inline image.
      if (!cover) {
        const fmCover = localImageName(meta.cover);
        const firstImg = localImageName((raw.match(/!\[[^\]]*\]\(([^)\s]+)\)/) || [])[1]);
        cover = (imgFiles.includes(fmCover) && fmCover) || (imgFiles.includes(firstImg) && firstImg) || null;
      }

      articles.push({
        slug: file.replace(/\.md$/i, ""),
        file,
        title: meta.title,
        date: meta.date || info.mtime.toISOString().slice(0, 10),
        excerpt: meta.excerpt,
      });
    }
    articles.sort((a, b) => (a.date < b.date ? 1 : -1));
    if (articles.length) {
      const coverImg = cover ? await makeImage(dir.name, cover) : null;
      collections.push({ name: dir.name, count: articles.length, cover: coverImg, articles });
    }
  }
  return collections;
}

async function buildAlbums() {
  const albums = [];
  for (const dir of await listDirs(path.join(ROOT, "docs"))) {
    const albumPath = path.join(ROOT, "docs", dir.name);
    // A folder with any markdown is a collection, not an album — skip it here.
    const hasMarkdown = (await listFiles(albumPath, (n) => n.toLowerCase().endsWith(".md"))).length > 0;
    if (hasMarkdown) continue;
    const files = (await listFiles(albumPath, (n) => IMG_EXT.has(path.extname(n).toLowerCase()))).sort();
    if (files.length) {
      const images = [];
      for (const file of files) images.push(await makeImage(dir.name, file));
      albums.push({ name: dir.name, count: files.length, cover: images[0], images });
    }
  }
  return albums;
}

const manifest = {
  generatedAt: new Date().toISOString(),
  collections: await buildArticles(),
  albums: await buildAlbums(),
};

await writeFile(path.join(ROOT, "content.json"), JSON.stringify(manifest, null, 2) + "\n");

const nArt = manifest.collections.reduce((s, c) => s + c.count, 0);
const nPic = manifest.albums.reduce((s, a) => s + a.count, 0);
console.log(
  `content.json written — ${manifest.collections.length} collections / ${nArt} articles, ` +
    `${manifest.albums.length} albums / ${nPic} images`
);

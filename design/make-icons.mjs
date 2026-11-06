// 从 design/icon.svg 生成各处要用的图标：png（各尺寸）+ ico（Windows / 浏览器）。
// 只用本机已有的 Edge 无头截图 + Node 自拼 ICO，不引第三方依赖。
//
//   node design/make-icons.mjs
//
// 产出：
//   design/out/icon-{16,32,48,64,128,180,192,256,512}.png
//   design/out/favicon.ico        （16/32/48）
//   design/out/app.ico            （16/32/48/64/128/256，给宿主 exe）
//   board-web/ 与 publish-api/public/ 里的同名文件
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const svg = path.join(here, "icon.svg");
// 16 / 32 用简化版（去次要元素、加粗外框），否则小尺寸会糊成一团
const svgSmall = path.join(here, "icon-small.svg");
const out = path.join(here, "out");
const EDGE = process.env.EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const SMALL_SIZES = [16, 32];
const SIZES = [48, 64, 128, 180, 192, 256, 512];

function render(size, target, source = svg) {
  const page = path.join(tmpdir(), `icon-${size}-${process.pid}.html`);
  writeFileSync(
    page,
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="${new URL(`file:///${source.replace(/\\/g, "/")}`).href}">`,
    "utf8",
  );
  const profile = path.join(tmpdir(), `icon-profile-${size}-${process.pid}`);
  execFileSync(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--default-background-color=00000000",
      "--user-data-dir=" + profile,
      `--window-size=${size},${size}`,
      "--virtual-time-budget=1500",
      "--screenshot=" + target,
      "file:///" + page.replace(/\\/g, "/"),
    ],
    { stdio: "ignore" },
  );
  rmSync(page, { force: true });
  rmSync(profile, { recursive: true, force: true });
}

// ICO 容器：每个尺寸塞一张 PNG（Vista 之后都认），省得自己写 BMP/调色板
function buildIco(sizes, target) {
  const frames = sizes.map((size) => ({ size, png: readFileSync(path.join(out, `icon-${size}.png`)) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = 6 + frames.length * 16;
  const entries = frames.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  writeFileSync(target, Buffer.concat([header, ...entries, ...frames.map((f) => f.png)]));
}

mkdirSync(out, { recursive: true });
for (const size of SMALL_SIZES) render(size, path.join(out, `icon-${size}.png`), svgSmall);
for (const size of SIZES) render(size, path.join(out, `icon-${size}.png`));
buildIco([16, 32, 48], path.join(out, "favicon.ico"));
buildIco([16, 32, 48, 64, 128, 256], path.join(out, "app.ico"));
console.log("png:", [...SMALL_SIZES, ...SIZES].join(", "));
console.log("ico: favicon.ico (16/32/48), app.ico (16…256)");

// 分发给网页与宿主：网页要 favicon.ico + 可缩放的 svg + 主屏图标（iOS 不吃 manifest 的 icon）
const web = [
  ["board-web", ["favicon.ico", "icon.svg", "apple-touch-icon.png"]],
  ["publish-api/public", ["favicon.ico", "icon.svg", "apple-touch-icon.png"]],
];
for (const [dir, files] of web) {
  for (const name of files) {
    const from = name === "icon.svg" ? svg : path.join(out, name === "apple-touch-icon.png" ? "icon-180.png" : name);
    copyFileSync(from, path.join(root, dir, name));
  }
}
copyFileSync(path.join(out, "app.ico"), path.join(root, "host-m0", "app.ico"));
console.log("已分发到 board-web/、publish-api/public/、host-m0/app.ico");

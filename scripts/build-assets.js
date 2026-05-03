import { existsSync, mkdirSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const SOURCE_DIR = "assets/source";
const TARGET_DIR = "assets";
const ICON_SOURCE = join(SOURCE_DIR, "icon.svg");
const HERO_SOURCE = join(SOURCE_DIR, "readme-hero.svg");
const ICON_SIZES = [16, 32, 48, 128];

const renderer = findRenderer();
if (!renderer) {
  throw new Error(
    "No SVG renderer found. Install one of: sharp CLI, rsvg-convert, magick, or convert. "
    + "Then rerun `npm run build:assets`."
  );
}

if (!existsSync(TARGET_DIR)) mkdirSync(TARGET_DIR, { recursive: true });

await renderSvg(HERO_SOURCE, join(TARGET_DIR, "readme-hero.png"), 1200, 560);
for (const size of ICON_SIZES) {
  await renderSvg(ICON_SOURCE, join(TARGET_DIR, `icon-${size}.png`), size, size);
}

// Keep the SVG sources visible as browser-friendly assets too.
await copyFile(ICON_SOURCE, join(TARGET_DIR, "icon.svg"));
await copyFile(HERO_SOURCE, join(TARGET_DIR, "readme-hero.svg"));

console.log("assets/readme-hero.png");
for (const size of ICON_SIZES) console.log(`assets/icon-${size}.png`);
console.log("assets/icon.svg");
console.log("assets/readme-hero.svg");

function findRenderer() {
  const candidates = [
    { name: "sharp", args: (input, output, width, height) => ["-i", input, "-o", output, "resize", width, height] },
    { name: "rsvg-convert", args: (input, output, width, height) => ["-w", String(width), "-h", String(height), "-o", output, input] },
    { name: "magick", args: (input, output, width, height) => [input, "-resize", `${width}x${height}!`, output] },
    { name: "convert", args: (input, output, width, height) => [input, "-resize", `${width}x${height}!`, output] }
  ];

  for (const candidate of candidates) {
    const result = spawnSync(candidate.name, ["--version"], { encoding: "utf8" });
    if (result.status === 0) return candidate;
  }
  return null;
}

async function renderSvg(input, output, width, height) {
  assertSvg(input);
  const args = renderer.args(input, output, width, height);
  const result = spawnSync(renderer.name, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${renderer.name} failed for ${input}:\n${result.stderr || result.stdout}`);
  }
  await assertPng(output);
}

function assertSvg(path) {
  if (!existsSync(path) || extname(path) !== ".svg") {
    throw new Error(`Missing SVG source: ${path}`);
  }
}

async function assertPng(path) {
  const bytes = await readFile(path);
  const pngSignature = "89504e470d0a1a0a";
  if (bytes.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error(`Renderer did not create a valid PNG: ${path}`);
  }
  await writeFile(path, bytes);
}

#!/usr/bin/env node
/**
 * NCHU Pickleball V5 - 單檔自動合成工具 (Single-file HTML Packager)
 * 用途：將模組化的 css/ 與 js/ 自動打包回獨立的 v14-single.html
 * 執行：node scripts/build-single.js
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const modularHtmlPath = path.join(rootDir, 'v14.html');
const singleHtmlPath = path.join(rootDir, 'v14-single.html');

console.log('📦 開始將模組化檔案合成單一 HTML...');

let html = fs.readFileSync(modularHtmlPath, 'utf8');

// 1. 合併 CSS
const cssFiles = ['style.css', 'hud.css', 'nav.css', 'modals.css'];
let combinedCss = '';
for (const file of cssFiles) {
  const cssPath = path.join(rootDir, 'css', file);
  if (fs.existsSync(cssPath)) {
    combinedCss += `\n/* ─── ${file} ─── */\n` + fs.readFileSync(cssPath, 'utf8') + '\n';
  }
}

// 替換 CSS <link> 標籤為單一 <style>
html = html.replace(
  /\s*<!-- ═══════ NCHU Pickleball V5 模組化樣式表 ═══════ -->[\s\S]*?<link rel="stylesheet" href="\.\/css\/modals\.css">/,
  `\n    <style>\n${combinedCss}\n    </style>`
);

// 2. 合併 JS
const jsFiles = [
  'config.js',
  'audio.js',
  'physics.js',
  'referee.js',
  'motion.js',
  'ui.js',
  'social.js',
  'fly_connectome.js',
  'game.js'
];

let combinedJs = '';
for (const file of jsFiles) {
  const jsPath = path.join(rootDir, 'js', file);
  if (fs.existsSync(jsPath)) {
    combinedJs += `\n/* ─── ${file} ─── */\n` + fs.readFileSync(jsPath, 'utf8') + '\n';
  }
}

// 替換 JS <script> 標籤為單一 <script>
html = html.replace(
  /\s*<!-- ═══════ NCHU Pickleball V5 模組化 JavaScript 核心 ═══════ -->[\s\S]*?<script src="\.\/js\/game\.js"><\/script>/,
  `\n    <script>\n${combinedJs}\n    </script>`
);

fs.writeFileSync(singleHtmlPath, html, 'utf8');
console.log(`✅ 單檔合成成功！已輸出至: v14-single.html (共 ${html.split('\n').length} 行)`);


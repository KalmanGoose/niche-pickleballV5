#!/usr/bin/env node
/**
 * NCHU Pickleball V5 - 單檔打包工具
 * 將 v14.html（模板）+ css/ + js/ 合成 v14-single.html，並同步輸出 index.html
 * 執行：node scripts/build-single.js            （輸出 single + index）
 *       node scripts/build-single.js --no-index （只輸出 single）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'v14.html');
const OUT_SINGLE = path.join(ROOT, 'v14-single.html');
const OUT_INDEX = path.join(ROOT, 'index.html');

const CSS_FILES = ['style.css', 'hud.css', 'nav.css', 'modals.css'];
const JS_FILES = ['config.js', 'audio.js', 'physics.js', 'referee.js', 'motion.js',
    'ui.js', 'social.js', 'fly_connectome.js', 'fun_mode.js', 'game.js'];

const CSS_BLOCK = /\s*<!-- ═══════ NCHU Pickleball V5 模組化樣式表 ═══════ -->[\s\S]*?<link rel="stylesheet" href="\.\/css\/modals\.css">/;
const JS_BLOCK = /\s*<!-- ═══════ NCHU Pickleball V5 模組化 JavaScript 核心 ═══════ -->[\s\S]*?<script src="\.\/js\/game\.js"><\/script>/;

function fail(msg) {
    console.error('❌ ' + msg);
    process.exit(1);
}

function readAll(dir, files) {
    return files.map(f => {
        const p = path.join(ROOT, dir, f);
        if (!fs.existsSync(p)) fail(`找不到 ${dir}/${f}`);
        return { name: f, src: fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '') };
    });
}

function warnDuplicateFunctions(parts) {
    const seen = new Map();
    for (const { name, src } of parts) {
        for (const m of src.matchAll(/^[ \t]{0,8}function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
            const fn = m[1];
            if (seen.has(fn) && seen.get(fn) !== name) {
                console.warn(`⚠️  函式 ${fn}() 同時定義在 ${seen.get(fn)} 與 ${name}，後者會覆蓋前者`);
            } else seen.set(fn, name);
        }
    }
}

function replaceOnce(html, re, content, label) {
    if (!re.test(html)) fail(`模板中找不到 ${label} 標記區塊，請檢查 v14.html 的註解是否被修改`);
    return html.replace(re, () => content);
}

console.log('📦 開始打包…');
let html = fs.readFileSync(TEMPLATE, 'utf8');

const cssParts = readAll('css', CSS_FILES);
const jsParts = readAll('js', JS_FILES);

const css = cssParts.map(p => `\n/* ─── ${p.name} ─── */\n${p.src}\n`).join('');
const js = jsParts.map(p => `\n/* ─── ${p.name} ─── */\n${p.src}\n`).join('');

if (/<\/script/i.test(js)) fail('JS 內容含有 "</script"，請改寫為 "<\\/script"');
if (/<\/style/i.test(css)) fail('CSS 內容含有 "</style"');

try {
    new vm.Script(js, { filename: 'combined.js' });
} catch (e) {
    const line = (e.stack || '').match(/combined\.js:(\d+)/);
    let where = '';
    if (line) {
        let n = +line[1], acc = 0;
        for (const p of jsParts) {
            const len = p.src.split('\n').length + 2;
            if (n <= acc + len) { where = ` → ${p.name} 約第 ${n - acc - 1} 行`; break; }
            acc += len;
        }
    }
    fail(`合併後的 JS 有語法錯誤：${e.message}${where}`);
}
warnDuplicateFunctions(jsParts);

html = replaceOnce(html, CSS_BLOCK, `\n    <style>\n${css}\n    </style>`, 'CSS');
html = replaceOnce(html, JS_BLOCK, `\n    <script>\n${js}\n    </script>`, 'JS');

if (/<link rel="stylesheet" href="\.\/css\//.test(html) || /<script src="\.\/js\//.test(html)) {
    fail('輸出中仍有未內嵌的本地 css/js 參照');
}

fs.writeFileSync(OUT_SINGLE, html, 'utf8');
console.log(`✅ v14-single.html（${html.split('\n').length} 行）`);
if (!process.argv.includes('--no-index')) {
    fs.writeFileSync(OUT_INDEX, html, 'utf8');
    console.log('✅ index.html 已同步');
}

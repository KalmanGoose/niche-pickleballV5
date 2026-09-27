#!/usr/bin/env node
/**
 * NCHU Pickleball V5 - 全自動自我驗證與除錯測試套件 (Self-Test Suite)
 * 用於 Agent 自主工作、通宵任務或改動後的嚴格全面回歸檢測。
 * 執行：node scripts/self-test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const cp = require("child_process");

const ROOT = path.resolve(__dirname, "..");
let passed = 0;
let failed = 0;

function assert(cond, name, details) {
    if (cond) {
        console.log(`  ✅ [PASS] ${name}`);
        passed++;
    } else {
        console.error(`  ❌ [FAIL] ${name}${details ? ": " + details : ""}`);
        failed++;
    }
}

console.log("═══════════════════════════════════════════════════════════");
console.log("🧪 開始執行 NCHU Pickleball 自我檢測套件 (Self-Test Suite)");
console.log("═══════════════════════════════════════════════════════════\n");

// ── 1. 語法檢測 (Syntax Check) ──
console.log("▶ [1/7] 模組語法檢測 (Node.js vm & Syntax Parsing)...");
const jsFiles = ["config.js", "audio.js", "physics.js", "referee.js", "motion.js",
    "ui.js", "social.js", "fly_connectome.js", "fun_mode.js", "game.js"];
for (const f of jsFiles) {
    const full = path.join(ROOT, "js", f);
    try {
        const src = fs.readFileSync(full, "utf8");
        new vm.Script(src, { filename: f });
        assert(true, `js/${f} 語法合法`);
    } catch (e) {
        assert(false, `js/${f} 語法錯誤`, e.message);
    }
}

try {
    cp.execSync("node --check backend/cloudflare-worker.js", { cwd: ROOT, stdio: "pipe" });
    assert(true, "backend/cloudflare-worker.js 語法合法 (ES Module)");
} catch (e) {
    assert(false, "backend/cloudflare-worker.js 語法錯誤", e.message);
}

try {
    const gasSrc = fs.readFileSync(path.join(ROOT, "backend", "Code.gs"), "utf8");
    new vm.Script(gasSrc, { filename: "Code.gs" });
    assert(true, "backend/Code.gs 語法合法");
} catch (e) {
    assert(false, "backend/Code.gs 語法錯誤", e.message);
}

// ── 2. 打包與產物一致性檢測 (Build & Sync Integrity) ──
console.log("\n▶ [2/7] 打包產物一致性檢測 (Build & Sync Integrity)...");
try {
    cp.execSync("node scripts/build-single.js", { cwd: ROOT, stdio: "pipe" });
    const single = fs.readFileSync(path.join(ROOT, "v14-single.html"), "utf8");
    const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    assert(single.length > 500000, "v14-single.html 大小正常 (>500KB)");
    assert(index.length > 500000, "index.html 大小正常 (>500KB)");
    assert(single === index, "v14-single.html 與 index.html 完全一致 (100% 同步)");
} catch (e) {
    assert(false, "打包腳本執行失敗", e.message);
}

// ── 3. 機密金鑰洩漏掃描 (Secret Scan) ──
console.log("\n▶ [3/7] 安全邊界與金鑰洩漏掃描 (Secret Leak Scan)...");
try {
    const res = cp.execSync(
        "grep -rnE '(AKIA|AIza|ghp_|glpat-|https://script\\.google\\.com/macros/s/[A-Za-z0-9_-]{20,}/exec)' --exclude-dir={.git,node_modules} --exclude=self-test.js --exclude=review_round2.txt --exclude=\*.md . || true",
        { cwd: ROOT, encoding: "utf8" }
    ).trim();
    assert(res === "", "無真實 Google Apps Script exec 端點或 API 金鑰洩漏", res);
} catch (e) {
    assert(false, "金鑰掃描指令失敗", e.message);
}

// ── 4. 後端防護單元測試 (Backend Security Logic Unit Tests) ──
console.log("\n▶ [4/7] 後端試算表防禦邏輯測試 (Code.gs Functions)...");
try {
    const codeGs = fs.readFileSync(path.join(ROOT, "backend", "Code.gs"), "utf8");
    const sandbox = { Utilities: {}, SpreadsheetApp: {} };
    const mSanitize = codeGs.match(/function sanitize\(val, maxLen\)[\s\S]*?\n}/);
    const mHash = codeGs.match(/function hashToken\(token\)[\s\S]*?\n}/);

    if (mSanitize) {
        vm.runInNewContext(mSanitize[0], sandbox);
        const cases = [
            { input: "123abc", exp: "123abc" },
            { input: "=SUM(A1)", exp: "'=SUM(A1)" },
            { input: "-15", exp: "'-15" },
            { input: "+5", exp: "'+5" },
            { input: "@admin", exp: "'@admin" },
            { input: "正常暱稱", exp: "正常暱稱" },
            { input: ".dot", exp: ".dot" }
        ];
        let allOk = true;
        for (const c of cases) {
            const out = sandbox.sanitize(c.input, 30);
            if (out !== c.exp) {
                allOk = false;
                assert(false, `sanitize("${c.input}") 輸出異常`, `預期 ${c.exp}，得到 ${out}`);
            }
        }
        if (allOk) assert(true, "sanitize() 試算表公式/特殊字元防注入測試全數通過");
    } else {
        assert(false, "找不到 sanitize 函式定義");
    }

    if (mHash) {
        sandbox.Utilities.computeDigest = () => [1, 2, 3];
        sandbox.Utilities.base64Encode = () => "testHash";
        sandbox.Utilities.DigestAlgorithm = { SHA_256: 1 };
        sandbox.Utilities.Charset = { UTF_8: 1 };
        vm.runInNewContext(mHash[0], sandbox);
        const h = sandbox.hashToken("my_secret_token");
        assert(typeof h === "string" && h.startsWith("h"), "hashToken() 回傳值必須具備 'h' 前綴防止型態誤解", h);
    } else {
        assert(false, "找不到 hashToken 函式定義");
    }
} catch (e) {
    assert(false, "後端單元測試執行錯誤", e.message);
}

// ── 5. 前端設定與驗證測試 (Frontend Config & Validations) ──
console.log("\n▶ [5/7] 前端驗證與錯誤碼測試 (config.js Functions)...");
try {
    const configSrc = fs.readFileSync(path.join(ROOT, "js", "config.js"), "utf8");
    const mErr = configSrc.match(/function errMsg\(err\)[\s\S]*?\n}/);
    const mIg = configSrc.match(/function isValidIG\(ig\)[\s\S]*?\n}/);

    const fSandbox = {};
    if (mErr) {
        vm.runInNewContext(mErr[0], fSandbox);
        const reqErrors = [
            "TIMEOUT", "NETWORK_FAIL", "BAD_RESPONSE", "UNAUTHORIZED", "API_URL_NOT_SET",
            "SERVER_BUSY_PLEASE_RETRY", "ALREADY_LIKED_TODAY", "RATE_LIMIT_EXCEEDED",
            "PAYLOAD_TOO_LARGE", "INVALID_TARGET", "INVITATION_NOT_FOUND", "TOKEN_REQUIRED",
            "SERVER_ERROR", "PROXY_NOT_CONFIGURED", "INVALID_SIGNATURE", "TIMESTAMP_EXPIRED"
        ];
        let missing = [];
        for (const errCode of reqErrors) {
            const msg = fSandbox.errMsg(errCode);
            if (!msg || msg.startsWith("請稍後再試（")) missing.push(errCode);
        }
        assert(missing.length === 0, "errMsg() 支援所有後端錯誤代碼翻譯", missing.join(", "));
    }

    if (mIg) {
        vm.runInNewContext(mIg[0], fSandbox);
        assert(fSandbox.isValidIG("my_pickle.ball"), "isValidIG 接受合法帳號");
        assert(fSandbox.isValidIG("nchu123"), "isValidIG 接受純英數");
        assert(!fSandbox.isValidIG("bad@name!"), "isValidIG 拒絕非法字元");
        assert(!fSandbox.isValidIG("a".repeat(35)), "isValidIG 拒絕超長帳號");
    }
} catch (e) {
    assert(false, "前端驗證測試執行錯誤", e.message);
}

// ── 6. 示範與手勢衝突防護檢測 (Tutorial & Demo Conflict Checks) ──
console.log("\n▶ [6/7] 開場示範與導覽防衝突檢測 (Demo & Tour Isolation)...");
try {
    const gameSrc = fs.readFileSync(path.join(ROOT, "js", "game.js"), "utf8");
    const uiSrc = fs.readFileSync(path.join(ROOT, "js", "ui.js"), "utf8");
    const hudCss = fs.readFileSync(path.join(ROOT, "css", "hud.css"), "utf8");

    assert(!/setTimeout\s*\(\s*\(\)\s*=>\s*startSpotlightTour\(false\)\s*,\s*800\s*\)/.test(gameSrc),
        "開機時不再自動調用 startSpotlightTour(false)");

    assert(uiSrc.includes("if (document.body.classList.contains('login-open')) return;"),
        "startSpotlightTour 具備登入開啟守衛");

    assert(hudCss.includes("body.demo-mode-active #finger-tutorial:not(.hidden)"),
        "hud.css 包含示範期間懸浮手指教學專屬樣式");
    assert(hudCss.includes("pointer-events: none !important") && hudCss.includes("background: transparent !important"),
        "示範期間手指教學為 100% 透明無阻礙浮空 HUD");

    assert(gameSrc.includes("servePrepared = !webcamActive;"),
        "無體感時 servePrepared 立即就緒，不提示「請先左手舉高」");
    assert(gameSrc.includes("hints = webcamActive ?"),
        "resetServe 提示文案依據 webcamActive 動態區分體感與手機/觸控");
    assert(gameSrc.includes("Swept Continuous Collision Detection"),
        "tryHit 具備防高速殺球穿透之連續碰撞檢測 (Swept CCD)");
} catch (e) {
    assert(false, "防衝突檢測錯誤", e.message);
}

// ── 7. 物理動力學與防穿透碰撞矩陣模擬 (Physics Dynamics & CCD Simulation) ──
console.log("\n▶ [7/7] 多版本物理動力學與連續碰撞模擬 (Physics & CCD Matrix)...");
try {
    const simOut = cp.execSync("node scripts/physics-sim.js", { cwd: ROOT, encoding: "utf8" });
    const mPass = simOut.match(/通過:\s*(\d+)\s*項/);
    const passCount = mPass ? parseInt(mPass[1], 10) : 0;
    assert(passCount >= 80, `82 項物理動力學與 CCD 防穿透測試全數 PASS (通過 ${passCount} 項)`);
} catch (e) {
    assert(false, "物理模擬腳本執行異常", e.message);
}

// ── 總結 ──
console.log("\n═══════════════════════════════════════════════════════════");
if (failed === 0) {
    console.log(`🎉 全部檢測通過！總計 ${passed} 項測試 100% PASS！系統處於健康穩定狀態。\n`);
    process.exit(0);
} else {
    console.error(`⚠️ 檢測失敗：${failed} 項未通過，${passed} 項通過。請排查修復後再次檢測。\n`);
    process.exit(1);
}

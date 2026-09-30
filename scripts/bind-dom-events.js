const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../v14.html'), 'utf8');

const regex = /on[a-z]+\s*=\s*["']([a-zA-Z_$][0-9a-zA-Z_$]*)\s*\(/g;
let match;
const fns = new Set();
while ((match = regex.exec(html)) !== null) {
    fns.add(match[1]);
}

const jsCode = [
    'config.js', 'audio.js', 'physics.js', 'referee.js', 'motion.js',
    'hub_sandbox.js', 'profile_card.js', 'ui.js', 'social.js',
    'fly_connectome.js', 'pickle_neural_policy.js', 'fun_mode.js', 'game.js'
].map(f => fs.readFileSync(path.join(__dirname, '../js', f), 'utf8')).join('\n');

const missing = [];
for (const fn of fns) {
    if (fn === 'if') continue;
    if (
        jsCode.includes(`window.${fn}`) ||
        jsCode.includes(`window['${fn}']`) ||
        jsCode.includes(`window["${fn}"]`)
    ) {
        // ok
    } else {
        missing.push(fn);
    }
}

if (missing.length > 0) {
    let toInject = "\n        // --- 自動補齊 HTML 事件綁定 (防止 Safari Early-Click ReferenceError) ---\n";
    for(const fn of missing) {
        toInject += `        if (typeof ${fn} === 'function') window.${fn} = ${fn};\n`;
    }
    
    const configPath = path.join(__dirname, '../js/config.js');
    let configStr = fs.readFileSync(configPath, 'utf8');
    // Inject near the end of config.js
    configStr = configStr.replace(/window\.onEditSidInput = onEditSidInput;/, "window.onEditSidInput = onEditSidInput;\n" + toInject);
    fs.writeFileSync(configPath, configStr);
    console.log("Injected", missing.length, "bindings into js/config.js");
}

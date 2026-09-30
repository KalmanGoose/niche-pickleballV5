const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../v14.html'), 'utf8');

const regex = /on[a-z]+\s*=\s*["']([a-zA-Z_$][0-9a-zA-Z_$]*)\s*\(/g;
let match;
const fns = new Set();
const JS_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'void', 'typeof', 'function', 'var', 'let', 'const']);
while ((match = regex.exec(html)) !== null) {
    if (!JS_KEYWORDS.has(match[1])) {
        fns.add(match[1]);
    }
}
console.log("Found DOM event handlers:", Array.from(fns));

const jsCode = [
    'config.js', 'audio.js', 'physics.js', 'referee.js', 'motion.js',
    'hub_sandbox.js', 'profile_card.js', 'ui.js', 'social.js',
    'fly_connectome.js', 'pickle_neural_policy.js', 'fun_mode.js', 'game.js'
].map(f => fs.readFileSync(path.join(__dirname, '../js', f), 'utf8')).join('\n');

const missing = [];
for (const fn of fns) {
    // Need to check if it's explicitly assigned to window.fn, or window['fn'], or in the early-click stub
    if (
        jsCode.includes(`window.${fn}`) ||
        jsCode.includes(`window['${fn}']`) ||
        jsCode.includes(`window["${fn}"]`)
    ) {
        // OK
    } else {
        missing.push(fn);
    }
}

if (missing.length > 0) {
    console.error("Functions used in HTML but not explicitly bound to window in JS:", missing);
    process.exit(1);
} else {
    console.log("All DOM event handlers are properly bound to window.");
}

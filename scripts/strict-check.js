const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const jsFiles = [
    'config.js',
    'audio.js',
    'physics.js',
    'referee.js',
    'motion.js',
    'hub_sandbox.js',
    'profile_card.js',
    'ui.js',
    'social.js',
    'fly_connectome.js',
    'pickle_neural_policy.js',
    'fun_mode.js',
    'game.js'
];

let allCode = '"use strict";\n';
jsFiles.forEach(f => {
    allCode += `// --- ${f} ---\n`;
    allCode += fs.readFileSync(path.join(root, 'js', f), 'utf8') + '\n';
});

const createMock = (name) => {
    const handler = {
        get: function(target, prop) {
            if (prop === 'then') return undefined; 
            if (prop === Symbol.toPrimitive) return () => 0;
            if (prop === Symbol.iterator) return function*(){ yield createMock('iter1'); yield createMock('iter2'); };
            if (prop === 'prototype') return {};
            if (typeof prop === 'string' && prop !== 'constructor') {
                if (prop === 'call') return function(thisArg, ...args) { return createMock(name + '.call'); };
                if (prop === 'apply') return function(thisArg, args) { return createMock(name + '.apply'); };
                return createMock(name + '.' + prop);
            }
            return Reflect.get(target, prop);
        },
        set: function(target, prop, value) { return true; },
        apply: function(target, thisArg, argumentsList) { return createMock(name + '()'); },
        construct: function(target, args) { return createMock('new ' + name); }
    };
    const fn = function(){};
    fn.valueOf = () => 0;
    fn.toString = () => "0";
    return new Proxy(fn, handler);
};

const sandboxHandler = {
    get: function(target, prop) {
        if (prop in target) return target[prop];
        // Only return mock if not explicitly handled
        if (typeof prop === 'string') return createMock('global.' + prop);
        return undefined;
    },
    has: function(target, prop) {
        return true; // Pretend it has everything
    }
};

const sandboxBase = {
    Math, setTimeout: ()=>{}, setInterval: ()=>{}, clearTimeout: ()=>{}, clearInterval: ()=>{},
    requestAnimationFrame: ()=>{}, cancelAnimationFrame: ()=>{},
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    Promise, Date, Set, Map, Float32Array, Int32Array, Uint8Array,
    Array, Object, String, Number, Boolean, RegExp, Error, JSON,
    Infinity, NaN, undefined, parseInt, parseFloat, isNaN, isFinite,
    decodeURI, decodeURIComponent, encodeURI, encodeURIComponent,
    console: { log: ()=>{}, warn: ()=>{}, error: ()=>{} },
    performance: require('perf_hooks').performance,
    document: createMock('document'),
    navigator: createMock('navigator'),
    THREE: createMock('THREE'),
    localStorage: createMock('localStorage'),
    location: createMock('location'),
    Image: createMock('Image'),
    Audio: createMock('Audio'),
    AudioContext: createMock('AudioContext'),
    webkitAudioContext: createMock('webkitAudioContext'),
    File: createMock('File'),
    FileReader: createMock('FileReader'),
    Blob: createMock('Blob'),
    FormData: createMock('FormData'),
    URL: createMock('URL'),
    URLSearchParams: createMock('URLSearchParams'),
    Event: createMock('Event'),
    CustomEvent: createMock('CustomEvent'),
    DOMParser: createMock('DOMParser'),
    addEventListener: () => {},
    removeEventListener: () => {},
    getComputedStyle: () => createMock('CSSStyleDeclaration')
};

const sandbox = new Proxy(sandboxBase, sandboxHandler);
sandboxBase.window = sandbox;
sandboxBase.globalThis = sandbox;

try {
    vm.runInNewContext(allCode, sandbox);
    console.log("Strict Mode Evaluation passed. No undeclared variables encountered during init!");
} catch (e) {
    if (e instanceof ReferenceError) {
        console.error("UNDECLARED VARIABLE DETECTED:");
        console.error(e.message);
        const stack = e.stack.split('\n');
        const match = stack[1].match(/evalmachine\.<anonymous>:(\d+)/);
        if (match) {
            const lineNum = parseInt(match[1]);
            const lines = allCode.split('\n');
            console.error("Line " + lineNum + ": " + lines[lineNum - 1].trim());
            let lastFile = "unknown";
            for(let i=0; i<lineNum; i++) {
                if(lines[i].startsWith('// --- ')) lastFile = lines[i];
            }
            console.error("File: " + lastFile);
        }
    } else {
        console.error("Error during execution:", e.message);
        console.error(e.stack);
    }
    process.exit(1);
}

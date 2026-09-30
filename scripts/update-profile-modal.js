const fs = require('fs');
const path = require('path');
const configPath = path.join(__dirname, '../js/config.js');
let configStr = fs.readFileSync(configPath, 'utf8');

// Find openProfileModal
const toInject = `
            // Update Passport UI
            const avDisp = document.getElementById('passport-avatar-display');
            const nmDisp = document.getElementById('passport-name-display');
            const dpDisp = document.getElementById('passport-dept-display');
            const lvDisp = document.getElementById('passport-level-num');
            if(avDisp) avDisp.innerText = playerProfile.avatar || '😎';
            if(nmDisp) nmDisp.innerText = playerProfile.nickname || '興大匹克球神';
            if(dpDisp) dpDisp.innerText = (playerProfile.department || '未設定系所') + ' · 國立中興大學';
            if(lvDisp) {
                // simple mock level based on score/hits (if they exist)
                let hits = (playerProfile.totalHits || 0);
                lvDisp.innerText = 1 + Math.floor(hits / 50);
            }
`;

configStr = configStr.replace(/function openProfileModal\(\) {/, "function openProfileModal() {" + toInject);
fs.writeFileSync(configPath, configStr);
console.log("Updated config.js");

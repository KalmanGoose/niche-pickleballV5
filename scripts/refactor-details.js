const fs = require('fs');
const path = require('path');
const htmlPath = path.join(__dirname, '../v14.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// The pattern is:
// <div class="science-box">
//     <div style="font-weight:800;..."> TITLE </div>
//     <div style="..."> CONTENT </div>
// </div>

// We can replace `<div class="science-box">` with `<details class="science-box" style="cursor:pointer;">`
html = html.replace(/<div class="science-box">/g, '<details class="science-box" style="cursor:pointer; transition: all 0.2s;">');

// Then replace the first `<div style="font-weight:800...` inside with `<summary style="font-weight:800...`
// Since all of them are styled with `font-weight:800;color:#2b1d14;font-size:13px;margin-bottom:4px;`, we can just replace that specific line:
html = html.replace(/<div (style="font-weight:800;color:#2b1d14;font-size:13px;margin-bottom:4px;")>/g, '<summary $1 outline:none;">');

// Wait, the closing `</div>` for the summary needs to be `</summary>`
// We can use a regex:
html = html.replace(/(<summary[^>]*>[\s\S]*?)<\/div>/g, '$1</summary>');

// Finally, we need to change the closing `</div>` of the outer `<div class="science-box">` to `</details>`
// The structure is `<details...><summary>...</summary><div...>...</div></div>`
// Let's just fix it by replacing the sequence `</div>\n                                </div>` with `</div>\n                                </details>`
// Actually, it's safer to use DOMParser, but we don't have JSDOM. 

// Let's use string split and stack to parse HTML correctly.
let lines = html.split('\n');
let stack = [];
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('<details class="science-box"')) {
        stack.push(i);
    }
    // if we find a closing div and stack has elements, we might need to change it to </details>
    // but there are inner divs.
}

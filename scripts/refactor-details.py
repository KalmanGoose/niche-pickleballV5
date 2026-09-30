import re

with open('v14.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Replace <div class="science-box"> with <details class="science-box">
# Then inside it, the first <div> becomes <summary> and its matching </div> becomes </summary>
# The matching </div> of the <details> becomes </details>

def process_box(match):
    inner = match.group(1)
    # find the first <div>
    first_div_start = inner.find('<div')
    first_div_close = inner.find('>', first_div_start) + 1
    
    # find the matching </div> for the first <div>
    # Assuming no nested divs inside the title
    first_div_end = inner.find('</div>', first_div_close)
    
    summary = '<summary' + inner[first_div_start+4:first_div_close] + inner[first_div_close:first_div_end] + '</summary>'
    
    rest = inner[first_div_end+6:]
    return f'<details class="science-box" style="cursor:pointer; margin-bottom: 8px;">\n{summary}{rest}\n</details>'

# Regex to match the outer div
html = re.sub(r'<div class="science-box">\n(.*?)\n\s*</div>(?=\n\s*<!--|\n\s*<div|\n\s*</div)', process_box, html, flags=re.DOTALL)

with open('v14.html', 'w', encoding='utf-8') as f:
    f.write(html)

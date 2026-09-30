import re

with open('v14.html', 'r', encoding='utf-8') as f:
    html = f.read()

def process_box(match):
    inner = match.group(1)
    
    # Check if this box is the special one with gold class or normal
    
    # We want to replace the first <div style="..."> with <summary style="..."> ... </summary>
    # and the rest remains
    first_div_start = inner.find('<div')
    if first_div_start == -1: return match.group(0) # something went wrong
    
    first_div_close = inner.find('>', first_div_start) + 1
    # Find matching </div> by counting open/close divs (assuming it's just one line, actually let's just find the next </div>)
    first_div_end = inner.find('</div>', first_div_close)
    
    # Replace <div with <summary and </div> with </summary>
    summary = '<summary' + inner[first_div_start+4:first_div_close] + inner[first_div_close:first_div_end] + '</summary>'
    
    rest = inner[first_div_end+6:]
    
    # Return wrapped in <details>
    return f'<details class="science-box" style="cursor:pointer; margin-bottom:10px;">\n{summary}{rest}\n</details>'

# Regex to match exactly `<div class="science-box"> \n INNER \n </div>`
# Using non-greedy `.*?` to match everything up to the matching `</div>`
# To avoid matching across multiple boxes, we assume no nested `<div class="science-box">`
html = re.sub(r'<div class="science-box">\n(.*?)\n\s*</div>(?=\n\s*<!--|\n\s*<div|\n\s*</div)', process_box, html, flags=re.DOTALL)

with open('v14.html', 'w', encoding='utf-8') as f:
    f.write(html)

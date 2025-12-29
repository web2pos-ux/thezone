import re
css_path = 'src/styles/scrollbar.css'
with open(css_path, 'r', encoding='utf-8') as f:
    css = f.read()
css = re.sub(r'}\s*"', '}', css)
css = re.sub(r'"\s*$', '', css)
with open(css_path, 'w', encoding='utf-8') as f:
    f.write(css)

ts_path = 'src/pages/OrderPage.tsx'
with open(ts_path, 'r', encoding='utf-8') as f:
    s = f.read()
start = s.find('// ?? ?? ?? ??')
if start != -1:
    i = s.find('const getButtonClasses', start)
    if i != -1:
        j = s.find('};', i)
        if j != -1:
            s = s[:start] + s[j+2:]
with open(ts_path, 'w', encoding='utf-8') as f:
    f.write(s)
print('fixed')

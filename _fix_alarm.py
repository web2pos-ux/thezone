import sys
sys.stdout.reconfigure(encoding='utf-8')

path = r'c:\Users\User\Thezone\web2pos\frontend\src\pages\SalesPage.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.split('\n')

# Line 1942 (index 1941): empty line
# Line 1943 (index 1942): comment about OnlineOrderPanel SSE -> replace with playOnlineOrderSound()
# Line 1944 (index 1943): console.log -> replace with new log

lines[1941] = ''
lines[1942] = '        playOnlineOrderSound();'
lines[1943] = "        console.log('[loadOnlineOrders] New order alarm played:', newOrder.id);"

with open(path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print('Done - SalesPage alarm call connected')

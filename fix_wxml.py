import os

path = r'D:\Software\shengji-miniprogram\frontend\miniprogram\pages\index\index.wxml'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix: self-closing view with wx:if followed by wx:elif is invalid in WXML.
# Change the self-closing <view .../> to a proper <view>...</view>
old = '<view class="waiting-hint" wx:if="{{!allReady && roomPlayerCount < 4}}"/>'
new = '<view class="waiting-hint" wx:if="{{!allReady && roomPlayerCount < 4}}">\n        <text>等待其他玩家加入...</text>\n      </view>'

if old in content:
    content = content.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('Fixed index.wxml - self-closing view with wx:if')
else:
    print('Pattern not found in index.wxml')

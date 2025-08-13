#!/bin/bash

# Chrome局域网测试启动脚本
# 此脚本允许Chrome在HTTP局域网环境下访问麦克风

echo "🔧 正在关闭现有Chrome进程..."
pkill -f "Google Chrome" 2>/dev/null
sleep 2

echo "🚀 启动Chrome用于局域网测试..."
echo "📍 局域网地址: http://192.168.31.89:3001"
echo "⚠️  注意：此为开发测试模式，已禁用部分安全功能"

# 启动Chrome并允许局域网麦克风访问
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
    --unsafely-treat-insecure-origin-as-secure=http://192.168.31.89:3001 \
    --user-data-dir=/tmp/chrome_dev_session \
    --disable-web-security \
    --allow-running-insecure-content \
    --disable-features=VizDisplayCompositor \
    --autoplay-policy=no-user-gesture-required \
    http://192.168.31.89:3001 &

echo "✅ Chrome已启动！"
echo ""
echo "📋 测试步骤："
echo "1. 等待页面加载完成"
echo "2. 创建房间并尝试启动语音通话"
echo "3. 浏览器应该正常弹出麦克风权限请求"
echo "4. 允许麦克风权限后即可正常使用"
echo ""
echo "🔍 如果仍有问题，请查看浏览器控制台错误信息"

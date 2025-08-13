#!/bin/bash

# 局域网HTTP启动脚本（无证书问题的临时方案）
# 当HTTPS证书信任有问题时使用此脚本

echo "🌐 启动Vibe Meeting局域网HTTP服务..."
echo "⚠️  注意：此为HTTP模式，无加密传输"

# 获取本机IP地址
LOCAL_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n1)

echo "📍 本地IP地址: $LOCAL_IP"
echo "🔓 启用HTTP模式（无加密）"
echo "🌐 访问地址:"
echo "   - 本地: http://localhost:3001"
echo "   - 局域网: http://$LOCAL_IP:3001"
echo ""
echo "💡 HTTP模式优势："
echo "   ✅ 无证书问题"
echo "   ✅ 图标正常显示"
echo "   ✅ 连接更稳定"
echo "   ⚠️  但数据传输未加密"
echo ""

# HTTP启动命令
NODE_ENV=production \
LOG_LEVEL=info \
PORT=3001 \
npm start

echo "🛑 HTTP服务已停止"

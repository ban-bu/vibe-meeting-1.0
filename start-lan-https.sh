#!/bin/bash

# 局域网HTTPS启动脚本
# 修复版本 - 解决连接循环问题

echo "🚀 启动Vibe Meeting局域网HTTPS服务..."

# 检查证书文件
if [ ! -f "certs/key.pem" ] || [ ! -f "certs/cert.pem" ]; then
    echo "❌ 错误：未找到SSL证书文件"
    echo "请先运行以下命令生成证书："
    echo "mkdir -p certs"
    echo "openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes -subj '/CN=localhost'"
    exit 1
fi

# 获取本机IP地址
LOCAL_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n1)

echo "📍 本地IP地址: $LOCAL_IP"
echo "🔒 启用HTTPS模式"
echo "🌐 访问地址:"
echo "   - 本地: https://localhost:3443"
echo "   - 局域网: https://$LOCAL_IP:3443"
echo ""

# 正确的启动命令（修复拼写错误）
ENABLE_HTTPS=true \
SSL_KEY_PATH=$(pwd)/certs/key.pem \
SSL_CERT_PATH=$(pwd)/certs/cert.pem \
HTTPS_PORT=3443 \
NODE_ENV=production \
LOG_LEVEL=info \
npm start

echo "🛑 服务已停止"

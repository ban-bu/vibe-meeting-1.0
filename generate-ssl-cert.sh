#!/bin/bash

# SSL证书生成脚本
# 为局域网HTTPS访问生成自签名证书

echo "🔐 Vibe Meeting SSL证书生成工具"
echo "=================================="

# 创建certs目录
mkdir -p certs

# 获取本机IP地址
LOCAL_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n1)

if [ -z "$LOCAL_IP" ]; then
    echo "❌ 无法获取本机IP地址"
    exit 1
fi

echo "📍 检测到本机IP: $LOCAL_IP"

# 创建证书配置文件
cat > certs/cert.conf << EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_req

[dn]
C=CN
ST=Local
L=Local
O=Vibe Meeting
OU=Development
CN=localhost

[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = *.local
IP.1 = 127.0.0.1
IP.2 = $LOCAL_IP
EOF

echo "📝 证书配置文件已创建"

# 生成私钥和证书
echo "🔑 生成SSL证书..."

openssl req -new -x509 -days 365 -nodes \
    -out certs/cert.pem \
    -keyout certs/key.pem \
    -config certs/cert.conf \
    -extensions v3_req

if [ $? -eq 0 ]; then
    echo "✅ SSL证书生成成功！"
    echo ""
    echo "📁 证书文件位置:"
    echo "   - 证书: $(pwd)/certs/cert.pem"
    echo "   - 私钥: $(pwd)/certs/key.pem"
    echo ""
    echo "🚀 现在可以使用以下命令启动HTTPS服务:"
    echo "   ./start-lan-https.sh"
    echo ""
    echo "🌐 访问地址:"
    echo "   - 本地: https://localhost:3443"
    echo "   - 局域网: https://$LOCAL_IP:3443"
    echo ""
    echo "⚠️  重要提醒:"
    echo "   1. 首次访问时浏览器会显示证书警告"
    echo "   2. 点击'高级' -> '继续访问' 来信任证书"
    echo "   3. 证书有效期为365天"
    echo ""
    echo "🔧 如果遇到连接问题，请运行调试工具:"
    echo "   在浏览器控制台执行: debugLanConnection()"
else
    echo "❌ 证书生成失败"
    echo "请检查是否安装了 OpenSSL"
    exit 1
fi

# 设置适当的权限
chmod 600 certs/key.pem
chmod 644 certs/cert.pem

echo "🔒 证书权限已设置"

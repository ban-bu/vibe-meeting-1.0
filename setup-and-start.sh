#!/usr/bin/env bash
set -euo pipefail

echo "====================================="
echo " Vibe Meeting 一键部署 (macOS/Linux) "
echo "====================================="

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

# 1) 检查 Node 与 npm
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未检测到 Node.js，请先安装 Node.js 16+"
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "❌ 未检测到 npm，请先安装 npm 8+"
  exit 1
fi

echo "📦 安装依赖..."
npm install

CERT_DIR="$ROOT_DIR/certs"
mkdir -p "$CERT_DIR"

# 2) 生成自签名证书（如可用）
USE_HTTPS=0
if command -v openssl >/dev/null 2>&1; then
  echo "🔐 检测到 OpenSSL，准备生成自签名证书"
  # 获取本机局域网IP
  if command -v ifconfig >/dev/null 2>&1; then
    LOCAL_IP=$(ifconfig | awk '/inet / && $2 != "127.0.0.1" {print $2; exit}')
  else
    LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  fi
  LOCAL_IP=${LOCAL_IP:-127.0.0.1}

  cat > "$CERT_DIR/cert.conf" <<EOF
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
IP.1 = 127.0.0.1
IP.2 = $LOCAL_IP
EOF

  echo "🔑 生成证书..."
  openssl req -new -x509 -days 365 -nodes \
    -out "$CERT_DIR/cert.pem" \
    -keyout "$CERT_DIR/key.pem" \
    -config "$CERT_DIR/cert.conf" \
    -extensions v3_req >/dev/null 2>&1 || true

  if [[ -s "$CERT_DIR/cert.pem" && -s "$CERT_DIR/key.pem" ]]; then
    echo "✅ 证书生成成功"
    USE_HTTPS=1
  else
    echo "⚠️  证书生成失败，将回退到HTTP"
  fi
else
  echo "ℹ️ 未检测到 OpenSSL，将使用HTTP模式"
fi

echo "🚀 启动服务..."
export LOG_LEVEL=info
export NODE_ENV=production

if [[ "$USE_HTTPS" == "1" ]]; then
  export ENABLE_HTTPS=true
  export SSL_KEY_PATH="$CERT_DIR/key.pem"
  export SSL_CERT_PATH="$CERT_DIR/cert.pem"
  export HTTPS_PORT=3443
  npm start
else
  export PORT=3001
  npm start
fi

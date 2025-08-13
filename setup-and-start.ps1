Write-Host "====================================="
Write-Host " Vibe Meeting 一键部署 (Windows) "
Write-Host "====================================="

$ErrorActionPreference = 'Stop'

# 切换到脚本所在目录
Set-Location -Path (Split-Path -Parent $MyInvocation.MyCommand.Path)

# 1) 检查 Node 与 npm
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "❌ 未检测到 Node.js，请先安装 Node.js 16+" -ForegroundColor Red
  exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "❌ 未检测到 npm，请先安装 npm 8+" -ForegroundColor Red
  exit 1
}

Write-Host "📦 安装依赖..."
npm install

$CertDir = Join-Path (Get-Location) 'certs'
if (-not (Test-Path $CertDir)) { New-Item -ItemType Directory -Path $CertDir | Out-Null }

# 2) 生成自签名证书（仅在系统有 openssl 时）
$UseHttps = $false
if (Get-Command openssl -ErrorAction SilentlyContinue) {
  Write-Host "🔐 检测到 OpenSSL，准备生成自签名证书"

  # 获取本机局域网IP
  $LocalIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*'} | Select-Object -First 1 -ExpandProperty IPAddress)
  if (-not $LocalIp) { $LocalIp = '127.0.0.1' }

  $conf = @"
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
IP.2 = $LocalIp
"@

  $confPath = Join-Path $CertDir 'cert.conf'
  Set-Content -Path $confPath -Value $conf -Encoding ascii

  Write-Host "🔑 生成证书..."
  try {
    & openssl req -new -x509 -days 365 -nodes -out (Join-Path $CertDir 'cert.pem') -keyout (Join-Path $CertDir 'key.pem') -config $confPath -extensions v3_req | Out-Null
  } catch {}

  if ((Test-Path (Join-Path $CertDir 'cert.pem')) -and (Test-Path (Join-Path $CertDir 'key.pem'))) {
    Write-Host "✅ 证书生成成功"
    $UseHttps = $true
  } else {
    Write-Host "⚠️  证书生成失败，将回退到HTTP"
  }
} else {
  Write-Host "ℹ️ 未检测到 OpenSSL，将使用HTTP模式"
}

Write-Host "🚀 启动服务..."
$env:LOG_LEVEL = 'info'
$env:NODE_ENV = 'production'

if ($UseHttps) {
  $env:ENABLE_HTTPS = 'true'
  $env:SSL_KEY_PATH = (Join-Path $CertDir 'key.pem')
  $env:SSL_CERT_PATH = (Join-Path $CertDir 'cert.pem')
  $env:HTTPS_PORT = '3443'
  npm start
} else {
  $env:PORT = '3001'
  npm start
}



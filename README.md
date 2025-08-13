## 一键部署

macOS / Linux:
```bash
./setup-and-start.sh
```

Windows (PowerShell):
```powershell
./setup-and-start.ps1
```

脚本会自动：
- 安装依赖
- 尝试生成自签名HTTPS证书（如可用）
- 自动选择HTTPS(3443) 或回退HTTP(3001)
- 启动服务

启动代码：
ENABLE_HTTPS=true SSL_KEY_PATH=$(pwd)/certs/key.pem SSL_CERT_PATH=$(pwd)/certs/cert.pem HTTPS_PORT=3443 LOG_LEVEL=debug npm start | cat

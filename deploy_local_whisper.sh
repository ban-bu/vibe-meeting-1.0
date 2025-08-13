#!/bin/bash

# Railway本地Whisper部署脚本
echo "🚀 开始部署Railway本地Whisper转录服务..."

# 检查Railway CLI
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI未安装，请先安装："
    echo "npm install -g @railway/cli"
    exit 1
fi

# 检查登录状态
if ! railway whoami &> /dev/null; then
    echo "🔐 请先登录Railway："
    railway login
fi

echo "📁 当前目录: $(pwd)"

# 部署Node.js主服务
echo "🌐 部署Node.js主服务..."
railway init --name vibe-meeting-main 2>/dev/null || true
railway up

# 获取主服务URL
MAIN_SERVICE_URL=$(railway domain)
echo "✅ Node.js主服务部署完成: $MAIN_SERVICE_URL"

# 部署Python转录服务
echo "🐍 部署Python转录服务..."
cd python-transcription-service

railway init --name transcription-service 2>/dev/null || true
railway up

# 获取转录服务URL
TRANSCRIPTION_SERVICE_URL=$(railway domain)
echo "✅ Python转录服务部署完成: $TRANSCRIPTION_SERVICE_URL"

# 返回主目录
cd ..

# 配置环境变量
echo "⚙️ 配置环境变量..."

# 为主服务设置转录服务URL
railway variables set TRANSCRIPTION_SERVICE_URL="$TRANSCRIPTION_SERVICE_URL" --service vibe-meeting-main

# 为转录服务设置模型大小
railway variables set WHISPER_MODEL_SIZE=tiny --service transcription-service

echo "🎉 部署完成！"
echo ""
echo "📋 部署信息:"
echo "   主服务URL: $MAIN_SERVICE_URL"
echo "   转录服务URL: $TRANSCRIPTION_SERVICE_URL"
echo ""
echo "🔧 下一步操作:"
echo "1. 在Railway控制台配置MONGODB_URI环境变量"
echo "2. 配置DEEPBRICKS_API_KEY环境变量"
echo "3. 访问 $MAIN_SERVICE_URL 测试应用"
echo ""
echo "🧪 验证部署:"
echo "   健康检查: curl $MAIN_SERVICE_URL/health"
echo "   转录服务: curl $MAIN_SERVICE_URL/api/transcription/health"
echo ""
echo "📚 更多信息请查看: LOCAL_WHISPER_DEPLOYMENT.md"
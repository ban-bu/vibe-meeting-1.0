#!/bin/bash

# Vibe Meeting 连接问题一键修复脚本
# 解决SSL证书、连接循环、图标显示等问题

echo "🔧 Vibe Meeting 连接问题修复工具"
echo "=================================="

# 获取本机IP地址
LOCAL_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n1)

echo "📍 检测到本机IP: $LOCAL_IP"
echo ""

# 选择修复方案
echo "请选择修复方案："
echo "1. 🔒 修复HTTPS模式（推荐 - 安全但需信任证书）"
echo "2. 🌐 使用HTTP模式（简单 - 无证书问题）"
echo "3. 🔧 生成新SSL证书"
echo "4. 📋 查看详细修复指南"
echo "5. 🧪 运行连接诊断"
echo ""

read -p "请输入选项 (1-5): " choice

case $choice in
    1)
        echo ""
        echo "🔒 启动HTTPS修复模式..."
        echo ""
        
        # 检查证书是否存在
        if [ ! -f "certs/cert.pem" ] || [ ! -f "certs/key.pem" ]; then
            echo "❌ 未找到SSL证书，正在生成..."
            ./generate-ssl-cert.sh
        fi
        
        echo "🚀 启动HTTPS服务..."
        echo ""
        echo "⚠️  重要提醒:"
        echo "1. 首次访问 https://$LOCAL_IP:3443 时会看到证书警告"
        echo "2. 点击'高级' -> '继续访问' 来信任证书"
        echo "3. 如果图标不显示，刷新页面（Ctrl+F5）"
        echo "4. 如果连接一直显示'连接中'，等待20秒让重连稳定"
        echo ""
        read -p "按回车键继续启动HTTPS服务..."
        
        # 启动HTTPS服务
        ./start-lan-https.sh
        ;;
        
    2)
        echo ""
        echo "🌐 启动HTTP模式..."
        echo ""
        echo "✅ HTTP模式优势："
        echo "   - 无证书问题"
        echo "   - 图标正常显示"
        echo "   - 连接更稳定"
        echo ""
        echo "⚠️  访问地址: http://$LOCAL_IP:3001"
        echo ""
        read -p "按回车键继续启动HTTP服务..."
        
        # 启动HTTP服务
        ./start-lan-http.sh
        ;;
        
    3)
        echo ""
        echo "🔧 生成新SSL证书..."
        ./generate-ssl-cert.sh
        echo ""
        echo "✅ 证书生成完成！现在可以选择方案1启动HTTPS服务"
        ;;
        
    4)
        echo ""
        echo "📋 查看详细修复指南..."
        if [ -f "LAN_FIX_GUIDE.md" ]; then
            cat LAN_FIX_GUIDE.md
        else
            echo "❌ 修复指南文件未找到"
        fi
        ;;
        
    5)
        echo ""
        echo "🧪 运行连接诊断..."
        echo ""
        echo "请在浏览器中打开以下地址："
        echo "- HTTPS: https://$LOCAL_IP:3443"
        echo "- HTTP: http://$LOCAL_IP:3001"
        echo ""
        echo "然后按F12打开开发者工具，在控制台中运行："
        echo ""
        echo "// 加载调试工具"
        echo "var script = document.createElement('script');"
        echo "script.src = './debug-lan-connection.js';"
        echo "document.head.appendChild(script);"
        echo ""
        echo "// 运行诊断（加载后执行）"
        echo "setTimeout(() => debugLanConnection(), 1000);"
        echo ""
        echo "诊断完成后，根据建议进行修复。"
        ;;
        
    *)
        echo "❌ 无效选项，请重新运行脚本"
        exit 1
        ;;
esac

echo ""
echo "🎯 修复完成！"
echo ""
echo "💡 如果问题仍然存在："
echo "1. 尝试不同的浏览器（Chrome/Firefox/Safari）"
echo "2. 清除浏览器缓存和Cookie"
echo "3. 检查防火墙设置"
echo "4. 使用调试工具（选项5）获取详细诊断"

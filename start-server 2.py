#!/usr/bin/env python3
"""
Railway优化启动脚本
用于减少日志输出和优化性能
"""

import os
import sys
import subprocess
import time

def setup_environment():
    """设置环境变量"""
    env_vars = {
        'NODE_ENV': 'production',
        'LOG_LEVEL': 'warn',  # 减少日志输出
        'RAILWAY_HEALTH_CHECK_PATH': '/health',
        'RAILWAY_HEALTH_CHECK_TIMEOUT': '300'
    }
    
    for key, value in env_vars.items():
        os.environ[key] = value
        print(f"设置环境变量: {key}={value}")

def check_dependencies():
    """检查依赖"""
    try:
        import subprocess
        result = subprocess.run(['node', '--version'], capture_output=True, text=True)
        print(f"Node.js版本: {result.stdout.strip()}")
        
        result = subprocess.run(['npm', '--version'], capture_output=True, text=True)
        print(f"npm版本: {result.stdout.strip()}")
        
        return True
    except Exception as e:
        print(f"依赖检查失败: {e}")
        return False

def install_dependencies():
    """安装依赖"""
    try:
        print("安装服务器依赖...")
        subprocess.run(['npm', 'install'], cwd='server', check=True)
        print("服务器依赖安装完成")
        
        print("安装根目录依赖...")
        subprocess.run(['npm', 'install'], check=True)
        print("根目录依赖安装完成")
        
        return True
    except subprocess.CalledProcessError as e:
        print(f"依赖安装失败: {e}")
        return False

def start_server():
    """启动服务器"""
    try:
        print("启动Vibe Meeting服务器...")
        print("环境: production")
        print("日志级别: warn")
        print("健康检查路径: /health")
        
        # 启动服务器
        subprocess.run(['npm', 'start'], check=True)
    except subprocess.CalledProcessError as e:
        print(f"服务器启动失败: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n收到中断信号，正在关闭服务器...")
        sys.exit(0)

def main():
    """主函数"""
    print("🚀 Vibe Meeting Railway启动脚本")
    print("=" * 50)
    
    # 设置环境
    setup_environment()
    
    # 检查依赖
    if not check_dependencies():
        print("❌ 依赖检查失败")
        sys.exit(1)
    
    # 安装依赖
    if not install_dependencies():
        print("❌ 依赖安装失败")
        sys.exit(1)
    
    # 启动服务器
    start_server()

if __name__ == "__main__":
    main()
#!/usr/bin/env node

/**
 * Railway部署检查脚本
 * 用于验证部署配置和诊断问题
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Railway部署检查工具');
console.log('=' * 50);

// 检查必需文件
const requiredFiles = [
    'package.json',
    'server/server.js',
    'index.html',
    'railway.toml'
];

console.log('\n📁 检查必需文件...');
let missingFiles = [];

requiredFiles.forEach(file => {
    if (fs.existsSync(file)) {
        console.log(`✅ ${file}`);
    } else {
        console.log(`❌ ${file} - 缺失`);
        missingFiles.push(file);
    }
});

if (missingFiles.length > 0) {
    console.log(`\n⚠️ 缺失文件: ${missingFiles.join(', ')}`);
} else {
    console.log('\n✅ 所有必需文件都存在');
}

// 检查package.json
console.log('\n📦 检查package.json...');
try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    
    // 检查scripts
    if (packageJson.scripts && packageJson.scripts.start) {
        console.log('✅ start脚本已配置');
    } else {
        console.log('❌ start脚本缺失');
    }
    
    // 检查dependencies
    const requiredDeps = ['express', 'socket.io', 'cors'];
    const missingDeps = requiredDeps.filter(dep => !packageJson.dependencies?.[dep]);
    
    if (missingDeps.length === 0) {
        console.log('✅ 所有必需依赖都已安装');
    } else {
        console.log(`❌ 缺失依赖: ${missingDeps.join(', ')}`);
    }
    
    // 检查engines
    if (packageJson.engines && packageJson.engines.node) {
        console.log(`✅ Node.js版本要求: ${packageJson.engines.node}`);
    } else {
        console.log('⚠️ 未指定Node.js版本要求');
    }
    
} catch (error) {
    console.log('❌ package.json解析失败:', error.message);
}

// 检查railway.toml
console.log('\n🚂 检查railway.toml...');
try {
    const railwayConfig = fs.readFileSync('railway.toml', 'utf8');
    
    if (railwayConfig.includes('healthcheckPath')) {
        console.log('✅ 健康检查路径已配置');
    } else {
        console.log('⚠️ 健康检查路径未配置');
    }
    
    if (railwayConfig.includes('NODE_ENV')) {
        console.log('✅ 环境变量已配置');
    } else {
        console.log('⚠️ 环境变量未配置');
    }
    
} catch (error) {
    console.log('❌ railway.toml读取失败:', error.message);
}

// 检查服务器代码
console.log('\n🔧 检查服务器代码...');
try {
    const serverCode = fs.readFileSync('server/server.js', 'utf8');
    
    // 检查关键功能
    const checks = [
        { name: 'Express服务器', pattern: /const express = require/ },
        { name: 'Socket.IO', pattern: /const socketIo = require/ },
        { name: 'CORS配置', pattern: /app\.use\(cors/ },
        { name: '健康检查端点', pattern: /app\.get\('\/health'/ },
        { name: '速率限制', pattern: /RateLimiterMemory/ },
        { name: '日志控制', pattern: /LOG_LEVEL/ }
    ];
    
    checks.forEach(check => {
        if (check.pattern.test(serverCode)) {
            console.log(`✅ ${check.name}`);
        } else {
            console.log(`❌ ${check.name} - 未找到`);
        }
    });
    
} catch (error) {
    console.log('❌ 服务器代码检查失败:', error.message);
}

// 环境变量建议
console.log('\n🌍 环境变量建议...');
const envSuggestions = [
    'NODE_ENV=production',
    'LOG_LEVEL=warn',
    'MONGODB_URI=your_mongodb_connection_string',
    'ALLOWED_ORIGINS=https://your-app.railway.app'
];

console.log('请在Railway控制台中设置以下环境变量:');
envSuggestions.forEach(env => {
    console.log(`  ${env}`);
});

// 部署建议
console.log('\n📋 部署建议...');
console.log('1. 确保所有文件都已提交到Git');
console.log('2. 在Railway控制台中设置环境变量');
console.log('3. 部署后检查健康检查端点: /health');
console.log('4. 监控日志输出，确保没有速率限制');

// 检查当前环境
console.log('\n🔍 当前环境信息...');
console.log(`Node.js版本: ${process.version}`);
console.log(`平台: ${process.platform}`);
console.log(`架构: ${process.arch}`);
console.log(`工作目录: ${process.cwd()}`);

// 检查端口
const port = process.env.PORT || 3001;
console.log(`默认端口: ${port}`);

console.log('\n✅ 检查完成！');
console.log('\n如果发现问题，请参考RAILWAY_DEPLOY 2.md文件中的解决方案。');
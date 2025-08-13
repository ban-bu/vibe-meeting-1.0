// 科大讯飞星火实时语音转写客户端
// 集成到现有的语音转录系统中

class XunfeiRealtimeTranscription {
    constructor() {
        // 科大讯飞配置
        this.appId = '84959f16';
        this.apiKey = '065eee5163baa4692717b923323e6853';
        this.apiSecret = null; // 如果需要的话
        
        // WebSocket连接
        this.websocket = null;
        this.isConnected = false;
        this.isRecording = false;
        
        // 音频相关
        this.audioContext = null;
        this.mediaStream = null;
        this.processor = null;
        this.audioBuffer = [];
        
        // 转录状态
        this.sessionId = null;
        this.frameId = 0;
        
        console.log('🎤 科大讯飞实时语音转写客户端已初始化');
    }
    
    // 生成鉴权参数
    generateAuthParams() {
        const host = 'rtasr.xfyun.cn';
        const path = '/v1/ws';
        const date = new Date().toUTCString();
        
        // 构建鉴权字符串
        const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
        
        // 使用HMAC-SHA256进行签名
        const signature = this.hmacSha256(signatureOrigin, this.apiKey);
        const signatureBase64 = btoa(signature);
        
        // 构建Authorization头
        const authorization = `api_key="${this.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureBase64}"`;
        const authorizationBase64 = btoa(authorization);
        
        return {
            authorization: authorizationBase64,
            date: date,
            host: host
        };
    }
    
    // HMAC-SHA256签名函数
    hmacSha256(message, secret) {
        // 这里需要一个HMAC-SHA256的实现
        // 由于浏览器环境限制，我们使用简化的方式
        return this.simpleHash(message + secret);
    }
    
    // 简化的hash函数（实际应用中应使用crypto-js或其他库）
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString();
    }
    
    // 连接科大讯飞实时语音转写服务
    async connect() {
        try {
            console.log('🔗 连接科大讯飞实时语音转写服务...');
            
            // 通过本地服务器代理连接科大讯飞
            const wsUrl = this.getWebSocketUrl();
            
            this.websocket = new WebSocket(wsUrl);
            
            this.websocket.onopen = () => {
                console.log('✅ 科大讯飞代理WebSocket连接成功');
                this.isConnected = true;
                
                // 发送启动转录命令
                const startMessage = { action: 'start' };
                console.log('📤 发送启动命令:', startMessage);
                this.websocket.send(JSON.stringify(startMessage));
                
                this.showToast('实时转录服务已连接', 'success');
            };
            
            this.websocket.onmessage = (event) => {
                console.log('📨 收到代理服务器消息:', event.data);
                this.handleMessage(event.data);
            };
            
            this.websocket.onerror = (error) => {
                console.error('❌ 科大讯飞WebSocket连接错误:', error);
                this.showToast('转录服务连接失败', 'error');
            };
            
            this.websocket.onclose = () => {
                console.log('🔌 科大讯飞WebSocket连接已关闭');
                this.isConnected = false;
                this.showToast('转录服务已断开', 'warning');
            };
            
        } catch (error) {
            console.error('连接科大讯飞服务失败:', error);
            this.showToast('无法连接转录服务: ' + error.message, 'error');
        }
    }
    
    // 获取WebSocket URL（通过本地代理）
    getWebSocketUrl() {
        // 使用本地代理服务器来解决CORS问题
        const hostname = window.location.hostname;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const port = window.location.port;
        
        console.log('🔗 科大讯飞代理URL检测:', { hostname, protocol, port });
        
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return `ws://localhost:3001/xfyun-proxy`;
        } else if (hostname.includes('railway.app') || hostname.includes('up.railway.app')) {
            // Railway环境使用HTTPS，所以WebSocket应该使用WSS
            const wsUrl = `wss://${hostname}/xfyun-proxy`;
            console.log('🚂 Railway环境科大讯飞代理URL:', wsUrl);
            return wsUrl;
        } else {
            const wsUrl = `${protocol}//${hostname}${port ? ':' + port : ''}/xfyun-proxy`;
            console.log('🌐 标准环境科大讯飞代理URL:', wsUrl);
            return wsUrl;
        }
    }
    
    // 处理接收到的消息
    handleMessage(data) {
        try {
            const message = JSON.parse(data);
            console.log('📝 收到转录结果:', message);
            
            if (message.action === 'result') {
                this.handleTranscriptionResult(message.data);
            } else if (message.action === 'error') {
                console.error('转录错误:', message.desc);
                this.showToast('转录错误: ' + message.desc, 'error');
            }
            
        } catch (error) {
            console.error('解析转录结果失败:', error);
        }
    }
    
    // 处理转录结果
    handleTranscriptionResult(data) {
        if (!data || !data.cn || !data.cn.st) {
            return;
        }
        
        const results = data.cn.st.rt;
        if (!results || results.length === 0) {
            return;
        }
        
        let transcriptionText = '';
        for (const result of results) {
            if (result.ws) {
                for (const word of result.ws) {
                    if (word.cw && word.cw[0] && word.cw[0].w) {
                        transcriptionText += word.cw[0].w;
                    }
                }
            }
        }
        
        if (transcriptionText.trim()) {
            console.log('✅ 科大讯飞转录结果:', transcriptionText);
            this.displayTranscriptionResult(transcriptionText);
        }
    }
    
    // 显示转录结果
    displayTranscriptionResult(text) {
        // 创建转录消息
        const transcriptionMessage = {
            type: 'transcription',
            text: `🎙️ [科大讯飞转录] ${text}`,
            author: currentUsername || '语音转录',
            userId: currentUserId || 'xfyun-transcription',
            time: new Date().toLocaleTimeString('zh-CN', { 
                hour: '2-digit', 
                minute: '2-digit' 
            }),
            timestamp: Date.now(),
            isTranscription: true,
            source: 'xfyun'
        };
        
        // 添加到消息列表
        if (typeof addMessage === 'function') {
            addMessage('transcription', transcriptionMessage.text, transcriptionMessage.author, transcriptionMessage.userId);
        } else if (typeof messages !== 'undefined') {
            messages.push(transcriptionMessage);
            if (typeof renderMessage === 'function') {
                renderMessage(transcriptionMessage);
            }
            if (typeof scrollToBottom === 'function') {
                scrollToBottom();
            }
            
            // 发送给其他用户
            if (isRealtimeEnabled && window.realtimeClient) {
                window.realtimeClient.sendMessage(transcriptionMessage);
            }
        }
        
        this.showToast('语音转录完成', 'success');
    }
    
    // 开始录音和转录
    async startRecording() {
        // 暂时禁用科大讯飞转录功能
        this.showToast('科大讯飞转录功能暂时不可用，正在修复API对接...', 'warning');
        console.warn('⚠️ 科大讯飞转录功能暂时禁用 - 需要重新实现RTASR API');
        
        // 更新UI显示禁用状态
        const startBtn = document.getElementById('xfyunStartBtn');
        const stopBtn = document.getElementById('xfyunStopBtn');
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> 功能暂时不可用';
        }
        
        return;

        /* 
        TODO: 需要完全重新实现科大讯飞RTASR API
        
        正确的实现需要：
        1. 直接连接到 ws://rtasr.xfyun.cn/v1/ws 
        2. 使用正确的appId和apiKey签名认证算法
        3. 发送binary PCM数据而不是JSON格式
        4. 处理科大讯飞的实际返回格式
        5. 遵循科大讯飞的实时转写协议规范
        
        当前实现的问题：
        - 使用了不正确的WebSocket代理
        - 数据格式不匹配
        - 认证方式错误
        */
    }
    
    // 停止录音
    stopRecording() {
        if (!this.isRecording) {
            console.warn('当前未在录音');
            return;
        }
        
        try {
            this.isRecording = false;
            
            // 停止音频处理
            if (this.processor) {
                if (this.processor.port) {
                    // AudioWorkletNode
                    this.processor.port.onmessage = null;
                } else if (this.processor.onaudioprocess) {
                    // ScriptProcessorNode
                    this.processor.onaudioprocess = null;
                }
                this.processor.disconnect();
                this.processor = null;
            }
            
            if (this.audioContext) {
                this.audioContext.close();
                this.audioContext = null;
            }
            
            if (this.mediaStream) {
                this.mediaStream.getTracks().forEach(track => track.stop());
                this.mediaStream = null;
            }
            
            // 发送结束信号
            if (this.websocket && this.isConnected) {
                const endMessage = {
                    action: 'stop'
                };
                this.websocket.send(JSON.stringify(endMessage));
            }
            
            console.log('⏹️ 科大讯飞实时转录已停止');
            this.showToast('实时转录已停止', 'info');
            
            // 更新UI
            this.updateRecordingUI(false);
            
        } catch (error) {
            console.error('停止录音失败:', error);
        }
    }
    
    // 发送音频数据
    sendAudioData(audioData) {
        if (!this.websocket || !this.isConnected) {
            console.warn('⚠️ WebSocket未连接，跳过音频数据发送');
            return;
        }
        
        try {
            // 将Float32Array转换为Int16Array
            const pcmData = new Int16Array(audioData.length);
            for (let i = 0; i < audioData.length; i++) {
                pcmData[i] = Math.max(-32768, Math.min(32767, audioData[i] * 32768));
            }
            
            // 转换为Base64
            const uint8Array = new Uint8Array(pcmData.buffer);
            const base64Audio = btoa(String.fromCharCode.apply(null, uint8Array));
            
            // 构建发送消息
            const message = {
                action: 'audio',
                data: {
                    audio: base64Audio,
                    encoding: 'raw',
                    sample_rate: 16000,
                    channels: 1,
                    bit_depth: 16,
                    frame_id: this.frameId++
                }
            };
            
            // 只记录每100帧的统计
            if ((this.frameId-1) % 100 === 0) {
                console.log(`📤 发送音频帧 #${this.frameId-1}, 累计发送: ${Math.floor((this.frameId-1)/100) * 100} 帧`);
            }
            this.websocket.send(JSON.stringify(message));
            
        } catch (error) {
            console.error('发送音频数据失败:', error);
        }
    }
    
    // 更新录音UI
    updateRecordingUI(isRecording) {
        const startBtn = document.getElementById('xfyunStartBtn');
        const stopBtn = document.getElementById('xfyunStopBtn');
        const transcriptionStatus = document.getElementById('transcriptionStatus');
        
        if (startBtn && stopBtn) {
            if (isRecording) {
                startBtn.style.display = 'none';
                stopBtn.style.display = 'flex';
            } else {
                startBtn.style.display = 'flex';
                stopBtn.style.display = 'none';
            }
        }
        
        if (transcriptionStatus) {
            if (isRecording) {
                transcriptionStatus.innerHTML = '<i class="fas fa-circle text-red-500"></i> 科大讯飞实时转录中...';
                transcriptionStatus.style.color = '#ef4444';
            } else {
                transcriptionStatus.innerHTML = '<i class="fas fa-microphone-slash"></i> 科大讯飞转录已停止';
                transcriptionStatus.style.color = '#6b7280';
            }
        }
    }
    
    // 显示提示信息
    showToast(message, type = 'info') {
        if (typeof showToast === 'function') {
            showToast(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }
    
    // 切换录音状态
    toggleRecording() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            this.startRecording();
        }
    }
    
    // 设置AudioWorklet处理器（现代方法）
    async setupAudioWorklet(source) {
        // 创建内联的AudioWorklet处理器
        const workletCode = `
            class XfyunAudioProcessor extends AudioWorkletProcessor {
                process(inputs, outputs, parameters) {
                    const input = inputs[0];
                    if (input.length > 0) {
                        const inputData = input[0];
                        this.port.postMessage({
                            type: 'audioData',
                            data: inputData
                        });
                    }
                    return true;
                }
            }
            registerProcessor('xfyun-audio-processor', XfyunAudioProcessor);
        `;
        
        const workletBlob = new Blob([workletCode], { type: 'application/javascript' });
        const workletUrl = URL.createObjectURL(workletBlob);
        
        await this.audioContext.audioWorklet.addModule(workletUrl);
        
        this.processor = new AudioWorkletNode(this.audioContext, 'xfyun-audio-processor');
        
        this.processor.port.onmessage = (event) => {
            if (event.data.type === 'audioData' && this.isRecording && this.isConnected) {
                // 减少日志输出
                this.sendAudioData(event.data.data);
            }
        };
        
        source.connect(this.processor);
        this.processor.connect(this.audioContext.destination);
        
        // 清理URL
        URL.revokeObjectURL(workletUrl);
        
        console.log('✅ 使用AudioWorklet进行音频处理');
    }
    
    // 设置ScriptProcessor处理器（降级方法）
    setupScriptProcessor(source) {
        this.processor = this.audioContext.createScriptProcessor(1024, 1, 1);
        
        this.processor.onaudioprocess = (event) => {
            if (this.isRecording && this.isConnected) {
                const inputData = event.inputBuffer.getChannelData(0);
                this.sendAudioData(inputData);
            }
        };
        
        source.connect(this.processor);
        this.processor.connect(this.audioContext.destination);
        
        console.log('⚠️ 使用ScriptProcessorNode进行音频处理（已废弃）');
    }
    
    // 断开连接
    disconnect() {
        this.stopRecording();
        
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
        
        this.isConnected = false;
    }
}

// 创建全局科大讯飞转录客户端实例
window.xfyunTranscription = new XunfeiRealtimeTranscription();

// 暴露给全局使用的函数
function startXfyunTranscription() {
    if (!window.xfyunTranscription.isRecording) {
        window.xfyunTranscription.startRecording();
    }
}

function stopXfyunTranscription() {
    if (window.xfyunTranscription.isRecording) {
        window.xfyunTranscription.stopRecording();
    }
}

function toggleXfyunTranscription() {
    window.xfyunTranscription.toggleRecording();
}

function getXfyunTranscriptionStatus() {
    return {
        isRecording: window.xfyunTranscription.isRecording,
        isConnected: window.xfyunTranscription.isConnected
    };
}

function debugXfyunConnection() {
    console.log('🔧 科大讯飞连接调试信息:');
    console.log('- 录音状态:', window.xfyunTranscription.isRecording ? '录音中' : '未录音');
    console.log('- 连接状态:', window.xfyunTranscription.isConnected ? '已连接' : '未连接');
    console.log('- WebSocket状态:', window.xfyunTranscription.websocket ? 
        (window.xfyunTranscription.websocket.readyState === 1 ? '打开' : '关闭') : '未创建');
    console.log('- 音频上下文:', window.xfyunTranscription.audioContext ? '已创建' : '未创建');
    console.log('- 媒体流:', window.xfyunTranscription.mediaStream ? '已获取' : '未获取');
    console.log('- 音频处理器:', window.xfyunTranscription.processor ? '已创建' : '未创建');
    console.log('- 帧ID:', window.xfyunTranscription.frameId);
    
    // 测试连接
    if (window.xfyunTranscription.websocket && window.xfyunTranscription.websocket.readyState === 1) {
        console.log('📤 发送测试消息...');
        window.xfyunTranscription.websocket.send(JSON.stringify({
            action: 'test',
            message: 'debug_test'
        }));
    }
}

console.log('✅ 科大讯飞实时语音转写模块已加载');
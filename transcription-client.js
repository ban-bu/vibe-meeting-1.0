// AI语音转录客户端
// 集成到现有的app.js中，提供语音转录功能

class TranscriptionClient {
    constructor() {
        this.isRecording = false;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.websocket = null;
        this.transcriptionServiceUrl = this.getTranscriptionServiceUrl();
        this.isConnected = false;
        this.currentRoomId = null;
        this.recordingStartTime = null;
        this.isStreamingMode = true; // 默认使用流式模式
        this.audioContext = null;
        
        // 音频缓冲机制
        this.audioBuffer = [];
        this.lastSendTime = 0;
        this.sendInterval = 100; // 每100ms发送一次音频数据，减少频率
        
        // 中文转录支持
        this.language = 'zh_cn'; // 支持中文 - 与服务器端保持一致
        
        // 累积转录内容
        this.fullTranscriptionText = '';
        this.transcriptionStartTime = null;
        this.processor = null;
        this.stream = null;
        
        // 录音配置
        this.recordingConfig = {
            mimeType: 'audio/webm;codecs=opus',
            audioBitsPerSecond: 16000
        };
        
        // 初始化
        this.init();
    }
    
    getTranscriptionServiceUrl() {
        // 根据部署环境自动检测转录服务地址
        const hostname = window.location.hostname;
        const protocol = window.location.protocol;
        const port = window.location.port;
        
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return 'http://localhost:8000';
        } else if (hostname.includes('railway.app')) {
            // Railway环境 - 通过Node.js服务代理转录请求
            return `${protocol}//${hostname}/api/transcription`;
        } else {
            // 在局域网或其他生产环境，优先使用当前页面协议与端口的代理路径
            const currentOrigin = `${protocol}//${hostname}${port ? ':' + port : ''}`;
            return localStorage.getItem('transcription_service_url') || `${currentOrigin}/api/transcription`;
        }
    }
    
    async init() {
        try {
            console.log('🎤 初始化语音转录客户端');
            console.log('🔗 转录服务URL:', this.transcriptionServiceUrl);
            
            // 检查浏览器支持
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                console.warn('浏览器不支持录音功能');
                this.showToast('浏览器不支持录音功能', 'error');
                return;
            }
            
            // 检查麦克风权限
            await this.checkMicrophonePermission();
            
            // 设置Socket.IO事件监听
            this.setupSocketListeners();
            
            // 初始化房间ID
            this.currentRoomId = this.getCurrentRoomId();
            
            // 测试转录服务连接
            const connected = await this.testConnection();
            if (!connected) {
                console.warn('⚠️ 转录服务连接失败，将使用降级模式');
            }
            
            console.log('✅ 语音转录客户端初始化完成');
        } catch (error) {
            console.error('语音转录客户端初始化失败:', error);
        }
    }
    
    setupSocketListeners() {
        if (!window.realtimeClient || !window.realtimeClient.socket) {
            console.warn('⚠️ Socket.IO客户端未找到，流式转录功能可能不可用');
            return;
        }
        
        const socket = window.realtimeClient.socket;
        
        // 监听流式转录启动成功
        socket.on('streamingTranscriptionStarted', (data) => {
            console.log('✅ 流式转录已启动:', data);
            this.showToast('实时转录已启动', 'success');
        });
        
        // 监听流式转录结果
        socket.on('streamingTranscriptionResult', (data) => {
            console.log('📝 流式转录结果:', data);
            this.handleStreamingTranscriptionResult(data);
        });
        
        // 监听流式转录停止
        socket.on('streamingTranscriptionStopped', (data) => {
            console.log('⏹️ 流式转录已停止:', data);
            this.showToast('实时转录已停止', 'info');
        });
        
        // 监听流式转录错误
        socket.on('streamingTranscriptionError', (data) => {
            console.error('❌ 流式转录错误:', data);
            this.showToast('转录服务错误: ' + data.error, 'error');
        });
        
        // 监听其他用户的转录结果
        socket.on('transcriptionReceived', (data) => {
            if (data.isStreaming) {
                console.log('📝 收到其他用户的转录:', data);
                this.displayTranscriptionFromOthers(data);
            }
        });
    }
    
    async checkMicrophonePermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log('✅ 麦克风权限已获取');
            stream.getTracks().forEach(track => track.stop());
            return true;
        } catch (error) {
            console.error('❌ 麦克风权限获取失败:', error);
            this.showToast('需要麦克风权限才能使用语音转录', 'warning');
            return false;
        }
    }
    
    async testConnection() {
        try {
            // 根据URL结构调整健康检查路径
            let healthUrl;
            if (this.transcriptionServiceUrl.includes('/api/transcription')) {
                healthUrl = `${this.transcriptionServiceUrl}/health`;
            } else {
                healthUrl = `${this.transcriptionServiceUrl}/health`;
            }
            
            console.log('🔍 测试转录服务连接:', healthUrl);
            const response = await fetch(healthUrl);
            const data = await response.json();
            
            if (data.status === 'ok') {
                console.log('✅ 转录服务连接正常');
                this.isConnected = true;
                return true;
            } else {
                throw new Error('转录服务不可用');
            }
        } catch (error) {
            console.warn('⚠️ 转录服务连接失败:', error);
            console.warn('将使用降级模式（本地语音识别）');
            this.isConnected = false;
            return false;
        }
    }
    
    async startRecording(roomId) {
        if (this.isRecording) {
            console.warn('已在录音中');
            return;
        }
        
        try {
            this.currentRoomId = roomId;
            
            // 获取麦克风权限
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000
                }
            });
            
            // 创建媒体录制器
            this.mediaRecorder = new MediaRecorder(stream, this.recordingConfig);
            this.audioChunks = [];
            
            // 录音事件处理
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };
            
            this.mediaRecorder.onstop = async () => {
                await this.processRecording();
            };
            
            // 开始录音
            this.mediaRecorder.start(1000); // 每秒收集一次数据
            this.isRecording = true;
            this.recordingStartTime = Date.now();
            
            // 建立WebSocket连接进行实时转录
            if (this.isConnected) {
                await this.connectWebSocket(roomId);
            }
            
            console.log('🎙️ 开始录音和转录');
            this.showToast('开始语音转录', 'info');
            
            // 更新UI
            this.updateRecordingUI(true);
            
        } catch (error) {
            console.error('开始录音失败:', error);
            this.showToast('无法开始录音: ' + error.message, 'error');
        }
    }
    
    async stopRecording() {
        if (!this.isRecording) {
            console.warn('当前未在录音');
            return;
        }
        
        try {
            // 停止录音
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
            }
            
            // 停止媒体流
            if (this.mediaRecorder && this.mediaRecorder.stream) {
                this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
            }
            
            // 关闭WebSocket连接
            if (this.websocket) {
                this.websocket.close();
                this.websocket = null;
            }
            
            this.isRecording = false;
            const duration = this.recordingStartTime ? 
                Math.round((Date.now() - this.recordingStartTime) / 1000) : 0;
            
            console.log(`🎙️ 录音结束，时长: ${duration}秒`);
            this.showToast(`录音结束，时长: ${duration}秒`, 'success');
            
            // 更新UI
            this.updateRecordingUI(false);
            
        } catch (error) {
            console.error('停止录音失败:', error);
            this.showToast('停止录音失败: ' + error.message, 'error');
        }
    }
    
    async connectWebSocket(roomId) {
        try {
            // 暂时禁用WebSocket功能，因为Railway代理不支持WebSocket转发
            console.log('ℹ️ WebSocket转录暂时禁用，使用HTTP轮询模式');
            return;
            
            /* 
            const wsUrl = this.transcriptionServiceUrl.replace('http', 'ws') + `/ws/transcribe/${roomId}`;
            this.websocket = new WebSocket(wsUrl);
            
            this.websocket.onopen = () => {
                console.log('✅ 转录WebSocket连接建立');
            };
            */
            
            /*
            this.websocket.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleTranscriptionResult(data);
            };
            
            this.websocket.onerror = (error) => {
                console.error('转录WebSocket错误:', error);
            };
            
            this.websocket.onclose = () => {
                console.log('转录WebSocket连接关闭');
            };
            */
            
        } catch (error) {
            console.error('WebSocket连接失败:', error);
        }
    }
    
    async processRecording() {
        if (this.audioChunks.length === 0) {
            console.warn('没有录音数据');
            return;
        }
        
        try {
            // 合并音频数据
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
            
            // 如果没有WebSocket连接，使用HTTP API转录
            if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
                await this.transcribeAudioFile(audioBlob);
            }
            
        } catch (error) {
            console.error('处理录音失败:', error);
            this.showToast('处理录音失败: ' + error.message, 'error');
        }
    }
    
    async transcribeAudioFile(audioBlob) {
        try {
            this.showToast('正在转录语音...', 'info');
            
            // 准备表单数据
            const formData = new FormData();
            formData.append('audio_file', audioBlob, 'recording.webm');
            
            // 添加房间ID和用户ID
            if (this.currentRoomId) {
                formData.append('roomId', this.currentRoomId);
            }
            if (typeof currentUserId !== 'undefined') {
                formData.append('userId', currentUserId);
            }
            
            // 确定转录请求URL
            let transcribeUrl;
            if (this.transcriptionServiceUrl.includes('/api/transcription')) {
                transcribeUrl = `${this.transcriptionServiceUrl}/audio`;
            } else {
                transcribeUrl = `${this.transcriptionServiceUrl}/transcribe/audio`;
            }
            
            console.log('📤 发送转录请求到:', transcribeUrl);
            
            // 发送转录请求
            const response = await fetch(transcribeUrl, {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                throw new Error(`转录请求失败: ${response.status}`);
            }
            
            const result = await response.json();
            
            console.log('🔍 转录API响应:', result);
            
            if (result.success && result.text) {
                console.log('✅ 转录成功，文本:', result.text);
                // 显示转录结果
                this.handleTranscriptionResult({
                    type: 'transcription',
                    text: result.text,
                    language: result.language,
                    timestamp: Date.now() / 1000
                });
            } else {
                console.warn('⚠️ 转录响应格式异常:', result);
                throw new Error('转录返回空结果或格式错误');
            }
            
        } catch (error) {
            console.error('转录失败:', error);
            this.showToast('云端转录失败，尝试本地识别...', 'warning');
            
            // 降级到本地语音识别
            await this.fallbackToLocalRecognition(audioBlob);
        }
    }
    
    // 降级本地语音识别
    async fallbackToLocalRecognition(audioBlob) {
        try {
            if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
                throw new Error('浏览器不支持语音识别');
            }
            
            this.showToast('使用浏览器本地语音识别...', 'info');
            
            // 使用Web Speech API
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            const recognition = new SpeechRecognition();
            
            recognition.continuous = false;
            recognition.interimResults = false;
            recognition.lang = 'zh-CN';
            
            recognition.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                const confidence = event.results[0][0].confidence;
                
                this.handleTranscriptionResult({
                    type: 'transcription',
                    text: transcript,
                    language: 'zh_cn',
                    timestamp: Date.now() / 1000,
                    source: 'local',
                    confidence: confidence
                });
                
                this.showToast('本地转录完成', 'success');
            };
            
            recognition.onerror = (event) => {
                console.error('本地语音识别失败:', event.error);
                this.showToast('语音识别不可用: ' + event.error, 'error');
            };
            
            recognition.onend = () => {
                console.log('本地语音识别结束');
            };
            
            // 注意：Web Speech API无法直接处理音频文件
            // 这里只是提供一个框架，实际需要实时录音
            console.log('ℹ️ 本地识别需要重新录音');
            this.showToast('请重新开始录音以使用本地识别', 'info');
            
        } catch (error) {
            console.error('本地语音识别失败:', error);
            this.showToast('语音识别功能不可用: ' + error.message, 'error');
        }
    }
    
    handleTranscriptionResult(data) {
        if (!data.text || data.text.trim() === '') {
            return;
        }
        
        console.log('📝 转录结果:', data.text);
        
        // 创建转录消息
        const transcriptionMessage = {
            type: 'transcription',
            text: `🎙️ [语音转录] ${data.text}`,
            author: currentUsername || '语音转录',
            userId: currentUserId || 'transcription-system',
            time: new Date().toLocaleTimeString('zh-CN', { 
                hour: '2-digit', 
                minute: '2-digit' 
            }),
            timestamp: Date.now(),
            isTranscription: true,
                            language: data.language || 'zh_cn'
        };
        
        // 添加到消息列表
        if (typeof addMessage === 'function') {
            addMessage('transcription', transcriptionMessage.text, transcriptionMessage.author, transcriptionMessage.userId);
        } else {
            // 兼容现有消息系统
            messages.push(transcriptionMessage);
            renderMessage(transcriptionMessage);
            scrollToBottom();
            
            // 发送给其他用户
            if (isRealtimeEnabled && window.realtimeClient) {
                window.realtimeClient.sendMessage(transcriptionMessage);
            }
        }
        
        this.showToast('语音转录完成', 'success');
    }
    
    updateRecordingUI(isRecording) {
        const recordBtn = document.getElementById('recordBtn');
        const transcriptionStatus = document.getElementById('transcriptionStatus');
        
        if (recordBtn) {
            if (isRecording) {
                recordBtn.classList.add('recording');
                recordBtn.innerHTML = '<i class="fas fa-stop"></i> 停止录音';
                recordBtn.style.background = '#ef4444';
            } else {
                recordBtn.classList.remove('recording');
                recordBtn.innerHTML = '<i class="fas fa-microphone"></i> 开始Assembly转录';
                recordBtn.style.background = '#10b981';
            }
        }
        
        if (transcriptionStatus) {
            if (isRecording) {
                transcriptionStatus.innerHTML = '<i class="fas fa-circle text-red-500"></i> 正在录音转录...';
                transcriptionStatus.style.color = '#ef4444';
            } else {
                transcriptionStatus.innerHTML = '<i class="fas fa-microphone-slash"></i> 转录已停止';
                transcriptionStatus.style.color = '#6b7280';
            }
        }
    }
    
    showToast(message, type = 'info') {
        // 使用现有的toast系统
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
            if (roomId && currentUsername) {
                this.startRecording(roomId);
            } else {
                this.showToast('请先加入房间', 'warning');
            }
        }
    }
    
    // 获取录音状态
    getRecordingStatus() {
        return {
            isRecording: this.isRecording,
            isConnected: this.isConnected,
            duration: this.recordingStartTime ? 
                Math.round((Date.now() - this.recordingStartTime) / 1000) : 0
        };
    }
}

// 创建全局转录客户端实例
window.transcriptionClient = new TranscriptionClient();

// 暴露给全局使用的函数
function toggleTranscription() {
    window.transcriptionClient.toggleRecording();
}

function getTranscriptionStatus() {
    return window.transcriptionClient.getRecordingStatus();
}

// =============== 流式转录扩展方法 ===============

// 为TranscriptionClient类添加流式转录方法
Object.assign(TranscriptionClient.prototype, {
    async startStreamingTranscription(roomId) {
        if (!window.realtimeClient || !window.realtimeClient.socket) {
            throw new Error('Socket.IO客户端未连接');
        }
        
        const socket = window.realtimeClient.socket;
        socket.emit('startStreamingTranscription', { roomId });
    },
    
    async stopStreamingTranscription() {
        // 发送剩余的音频缓冲数据
        this.flushAudioBuffer();
        
        // 清空音频缓冲区
        this.audioBuffer = [];
        this.lastSendTime = 0;
        
        // 显示下载按钮（如果有内容）
        const downloadBtn = document.getElementById('downloadBtn');
        if (downloadBtn && this.fullTranscriptionText.length > 0) {
            downloadBtn.style.display = 'block';
        }
        
        if (!window.realtimeClient || !window.realtimeClient.socket) {
            return;
        }
        
        const socket = window.realtimeClient.socket;
        socket.emit('stopStreamingTranscription');
    },
    
    sendAudioData(pcmData) {
        if (!window.realtimeClient || !window.realtimeClient.socket) {
            console.warn('⚠️ Socket.IO客户端未连接，无法发送音频数据');
            return;
        }
        
        // 添加到缓冲区
        this.audioBuffer.push(new Uint8Array(pcmData));
        
        // 检查是否应该发送数据（基于时间间隔）
        const now = Date.now();
        if (now - this.lastSendTime >= this.sendInterval) {
            this.flushAudioBuffer();
            this.lastSendTime = now;
        }
    },
    
    flushAudioBuffer() {
        if (this.audioBuffer.length === 0) return;
        
        // 合并所有缓冲的音频数据
        const totalLength = this.audioBuffer.reduce((sum, buffer) => sum + buffer.length, 0);
        const mergedBuffer = new Uint8Array(totalLength);
        
        let offset = 0;
        for (const buffer of this.audioBuffer) {
            mergedBuffer.set(buffer, offset);
            offset += buffer.length;
        }
        
        const socket = window.realtimeClient.socket;
        console.log('📤 发送缓冲音频数据:', mergedBuffer.length, 'bytes');
        
        // 将ArrayBuffer转换为Array以便Socket.IO传输
        const audioArray = Array.from(mergedBuffer);
        socket.emit('audioData', { audioData: audioArray });
        
        // 清空缓冲区
        this.audioBuffer = [];
    },
    
    convertToPCM16(float32Array) {
        const buffer = new ArrayBuffer(float32Array.length * 2);
        const view = new DataView(buffer);
        
        for (let i = 0; i < float32Array.length; i++) {
            const sample = Math.max(-1, Math.min(1, float32Array[i]));
            view.setInt16(i * 2, sample * 0x7FFF, true);
        }
        
        return buffer;
    },
    
    handleStreamingTranscriptionResult(data) {
        console.log('📝 处理转录结果:', data);
        
        let text, isFinal, confidence, timestamp;
        
        // 处理Universal-Streaming格式
        if (data.type === 'Turn' || data.turn_order !== undefined) {
            text = data.text || data.transcript || '';
            
            // 只处理格式化后的最终结果，避免重复
            if (data.end_of_turn === true && data.turn_is_formatted === true) {
                // 这是格式化的最终结果
                isFinal = true;
                console.log(`📝 格式化最终转录结果:`, text, `(turn_order: ${data.turn_order})`);
            } else if (data.end_of_turn === false) {
                // 这是部分结果，用于实时预览
                isFinal = false;
                console.log(`📝 部分转录结果:`, text);
            } else if (data.end_of_turn === true && data.turn_is_formatted !== true) {
                // 跳过未格式化的最终结果，避免重复
                console.log(`🚫 跳过未格式化的转录结果:`, text, `(formatted: ${data.turn_is_formatted})`);
                return;
            } else {
                // 其他情况也跳过
                console.log(`🚫 跳过不明确的转录结果:`, text, data);
                return;
            }
            
            confidence = data.confidence || data.end_of_turn_confidence || 0.9;
            timestamp = Date.now();
        } else {
            // 兼容旧格式
            text = data.text || data.transcript || '';
            isFinal = data.type === 'final' || data.isFinal;
            confidence = data.confidence;
            timestamp = data.timestamp;
        }
        
        if (!text || text.trim() === '') {
            return;
        }
        
        console.log(`📝 ${isFinal ? '最终' : '部分'}转录结果:`, text);
        
        if (!isFinal) {
            this.updatePartialTranscription(text);
        } else {
            this.addFinalTranscription(text, confidence, timestamp);
        }
    },
    
    updatePartialTranscription(text) {
        const transcriptionHistory = document.getElementById('transcriptionHistory');
        if (!transcriptionHistory) return;
        
        // 清除占位符
        const placeholder = transcriptionHistory.querySelector('.transcription-placeholder');
        if (placeholder) {
            placeholder.style.display = 'none';
        }
        
        // 获取或创建累积转录容器
        let cumulativeDiv = document.getElementById('cumulativeTranscription');
        if (!cumulativeDiv) {
            cumulativeDiv = document.createElement('div');
            cumulativeDiv.id = 'cumulativeTranscription';
            cumulativeDiv.className = 'cumulative-transcription';
            cumulativeDiv.style.cssText = `
                background: white;
                border-radius: 8px;
                padding: 15px;
                font-size: 14px;
                line-height: 1.8;
                color: #374151;
                min-height: 100px;
                white-space: pre-wrap;
                word-wrap: break-word;
            `;
            transcriptionHistory.appendChild(cumulativeDiv);
        }
        
        // 更新实时预览：显示已确认的文本 + 当前正在转录的文本
        const currentPreview = text.trim();
        if (currentPreview) {
            const finalText = this.fullTranscriptionText;
            const previewHtml = finalText + '<span class="current-preview" style="color: #3b82f6; background: rgba(59, 130, 246, 0.1); padding: 2px 4px; border-radius: 3px; animation: pulse 1.5s infinite;">' + currentPreview + '</span>';
            cumulativeDiv.innerHTML = previewHtml;
        } else {
            cumulativeDiv.innerHTML = this.fullTranscriptionText;
        }
        
        transcriptionHistory.scrollTop = transcriptionHistory.scrollHeight;
    },
    
    addFinalTranscription(text, confidence, timestamp) {
        const transcriptionHistory = document.getElementById('transcriptionHistory');
        if (!transcriptionHistory) return;
        
        const cleanText = text.trim();
        if (!cleanText) {
            console.log('🚫 跳过空白的转录结果');
            return;
        }
        
        // 避免重复：检查是否已经包含在全文中
        if (this.fullTranscriptionText.includes(cleanText)) {
            console.log('🚫 跳过重复的转录结果:', cleanText);
            return;
        }
        
        // 添加到累积转录文本
        if (this.fullTranscriptionText.length > 0) {
            this.fullTranscriptionText += ' ';
        }
        this.fullTranscriptionText += cleanText;
        
        // 更新显示
        this.updateCumulativeDisplay();
        
        // 显示下载按钮
        const downloadBtn = document.getElementById('downloadBtn');
        if (downloadBtn && this.fullTranscriptionText.length > 0) {
            downloadBtn.style.display = 'block';
        }
        
        console.log('✅ 转录结果已添加:', cleanText);
        console.log('📝 当前全文长度:', this.fullTranscriptionText.length);
    },
    
    updateCumulativeDisplay() {
        const transcriptionHistory = document.getElementById('transcriptionHistory');
        if (!transcriptionHistory) return;
        
        // 清除占位符
        const placeholder = transcriptionHistory.querySelector('.transcription-placeholder');
        if (placeholder) {
            placeholder.style.display = 'none';
        }
        
        // 获取或创建累积转录容器
        let cumulativeDiv = document.getElementById('cumulativeTranscription');
        if (!cumulativeDiv) {
            cumulativeDiv = document.createElement('div');
            cumulativeDiv.id = 'cumulativeTranscription';
            cumulativeDiv.className = 'cumulative-transcription';
            cumulativeDiv.style.cssText = `
                background: white;
                border-radius: 8px;
                padding: 15px;
                font-size: 14px;
                line-height: 1.8;
                color: #374151;
                min-height: 100px;
                white-space: pre-wrap;
                word-wrap: break-word;
            `;
            transcriptionHistory.appendChild(cumulativeDiv);
        }
        
        // 显示全部累积内容
        cumulativeDiv.textContent = this.fullTranscriptionText;
        transcriptionHistory.scrollTop = transcriptionHistory.scrollHeight;
    },
    
    displayTranscriptionFromOthers(data) {
        const transcriptionMessage = {
            type: 'transcription',
            text: `🎙️ [${data.author}的语音] ${data.text}`,
            author: data.author,
            userId: data.userId,
            time: new Date(data.timestamp).toLocaleTimeString('zh-CN', { 
                hour: '2-digit', 
                minute: '2-digit' 
            }),
            timestamp: data.timestamp,
            isTranscription: true,
            isFromOthers: true
        };
        
        if (typeof addMessage === 'function') {
            addMessage('transcription', transcriptionMessage.text, transcriptionMessage.author, transcriptionMessage.userId);
        } else {
            if (typeof messages !== 'undefined') {
                messages.push(transcriptionMessage);
            }
            if (typeof renderMessage === 'function') {
                renderMessage(transcriptionMessage);
            }
            if (typeof scrollToBottom === 'function') {
                scrollToBottom();
            }
        }
    },
    
    async startStreamingMode(roomId) {
        console.log('🌊 启动流式转录模式');
        
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000
                }
            });
            
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000
            });
            
            const source = this.audioContext.createMediaStreamSource(this.stream);
            this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
            
            this.processor.onaudioprocess = (event) => {
                if (this.isRecording) {
                    const inputData = event.inputBuffer.getChannelData(0);
                    const pcmData = this.convertToPCM16(inputData);
                    
                    // 添加调试日志
                    console.log('🎵 处理音频数据:', {
                        inputDataLength: inputData.length,
                        pcmDataLength: pcmData.byteLength,
                        isRecording: this.isRecording,
                        socketConnected: !!(window.realtimeClient && window.realtimeClient.socket)
                    });
                    
                    this.sendAudioData(pcmData);
                }
            };
            
            source.connect(this.processor);
            this.processor.connect(this.audioContext.destination);
            
            await this.startStreamingTranscription(roomId);
            
            this.isRecording = true;
            this.recordingStartTime = Date.now();
            
            console.log('🎙️ 开始流式录音和转录');
            this.showToast('开始实时语音转录', 'info');
            this.updateRecordingUI(true);
            
        } catch (error) {
            console.error('启动流式转录失败:', error);
            this.showToast('无法启动流式转录: ' + error.message, 'error');
            throw error;
        }
    },
    
    async stopStreamingMode() {
        try {
            if (this.processor) {
                this.processor.disconnect();
                this.processor = null;
            }
            
            if (this.audioContext) {
                await this.audioContext.close();
                this.audioContext = null;
            }
            
            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
                this.stream = null;
            }
            
            await this.stopStreamingTranscription();
            
            this.isRecording = false;
            
            const partialDiv = document.getElementById('partialTranscription');
            if (partialDiv) {
                partialDiv.remove();
            }
            
            console.log('⏹️ 流式转录已停止');
            this.showToast('实时转录已停止', 'info');
            this.updateRecordingUI(false);
            
        } catch (error) {
            console.error('停止流式转录失败:', error);
        }
    }
});

// 更新toggleRecording方法以支持流式模式
const originalToggleRecording = TranscriptionClient.prototype.toggleRecording;
TranscriptionClient.prototype.toggleRecording = function() {
    if (this.isStreamingMode) {
        if (this.isRecording) {
            this.stopStreamingMode();
        } else {
            // 获取当前房间ID
            const roomId = this.getCurrentRoomId();
            if (!roomId) {
                console.error('无法获取房间ID，无法启动转录');
                                        this.showToast('请先加入房间再开始Assembly转录', 'error');
                return;
            }
            this.startStreamingMode(roomId);
        }
    } else {
        return originalToggleRecording.call(this);
    }
};

// 添加获取当前房间ID的方法
Object.assign(TranscriptionClient.prototype, {
    getCurrentRoomId() {
        // 优先使用内部存储的roomId
        if (this.currentRoomId) {
            return this.currentRoomId;
        }
        
        // 从全局变量获取roomId
        if (typeof window !== 'undefined' && window.roomId) {
            return window.roomId;
        }
        
        // 从URL参数获取
        const urlParams = new URLSearchParams(window.location.search);
        const urlRoomId = urlParams.get('room');
        if (urlRoomId) {
            return urlRoomId;
        }
        
        // 从DOM元素获取
        const roomIdElement = document.getElementById('roomId');
        if (roomIdElement) {
            const textContent = roomIdElement.textContent || roomIdElement.innerText;
            const match = textContent.match(/房间: (.+)/);
            if (match) {
                return match[1];
            }
        }
        
        // 从realtime client获取
        if (window.realtimeClient && window.realtimeClient.currentRoomId) {
            return window.realtimeClient.currentRoomId;
        }
        
        return null;
    }
});
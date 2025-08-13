/**
 * 科大讯飞实时语音转写 - 基于官方SDK实现
 * 使用科大讯飞官方JavaScript SDK
 */

class XfyunOfficialRTASR {
    constructor() {
        this.isRecording = false;
        this.isConnected = false;
        this.websocket = null;
        this.recorder = null;
        this.btnStatus = "UNDEFINED"; // "UNDEFINED" "CONNECTING" "OPEN" "CLOSING" "CLOSED"
        this.resultText = "";
        this.resultTextTemp = "";
        
        // 科大讯飞配置 - 需要用户提供
        this.APPID = "84959f16";
        this.API_KEY = "065eee5163baa4692717b923323e6853";
        
        console.log('🏭 科大讯飞官方RTASR服务初始化');
        
        this.initRecorder();
    }

    // 初始化录音器
    initRecorder() {
        if (typeof RecorderManager === 'undefined') {
            console.error('❌ RecorderManager未找到，请确保已加载科大讯飞SDK');
            this.showToast('科大讯飞SDK未正确加载', 'error');
            return;
        }

        try {
            // 初始化录音管理器，processorPath是processor文件的路径
            this.recorder = new RecorderManager(".");
            
            this.recorder.onStart = () => {
                console.log('🎙️ 录音器启动成功');
                this.changeBtnStatus("OPEN");
            };

            this.recorder.onFrameRecorded = ({ isLastFrame, frameBuffer }) => {
                if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                    // 发送音频数据到科大讯飞
                    const audioData = new Int8Array(frameBuffer);
                    console.log('🎵 发送音频数据:', {
                        isLastFrame: isLastFrame,
                        bufferLength: frameBuffer.byteLength,
                        audioDataLength: audioData.length,
                        firstFewBytes: Array.from(audioData.slice(0, 10)),
                        websocketState: this.websocket.readyState
                    });
                    
                    this.websocket.send(audioData);
                    
                    if (isLastFrame) {
                        // 发送结束标志
                        console.log('🏁 发送结束标志');
                        this.websocket.send('{"end": true}');
                        this.changeBtnStatus("CLOSING");
                    }
                } else {
                    console.warn('❌ WebSocket未连接，无法发送音频数据');
                }
            };

            this.recorder.onStop = () => {
                console.log('🛑 录音器已停止');
                this.isRecording = false;
                this.updateRecordingUI(false);
            };

            console.log('✅ 录音器初始化成功');
        } catch (error) {
            console.error('❌ 录音器初始化失败:', error);
            this.showToast('录音器初始化失败', 'error');
        }
    }

    // 获取WebSocket连接URL（包含签名认证）
    getWebSocketUrl() {
        if (!this.APPID || !this.API_KEY) {
            throw new Error('缺少必要的API密钥配置');
        }

        // 检查加密库是否可用
        console.log('🔐 检查加密库:');
        console.log('- hex_md5 可用:', typeof hex_md5 !== 'undefined');
        console.log('- CryptoJSNew 可用:', typeof CryptoJSNew !== 'undefined');
        console.log('- CryptoJS 可用:', typeof CryptoJS !== 'undefined');

        // 科大讯飞实时语音转写接口地址
        const url = "wss://rtasr.xfyun.cn/v1/ws";
        const appId = this.APPID;
        const secretKey = this.API_KEY;
        const ts = Math.floor(new Date().getTime() / 1000);
        
        console.log('🔐 签名生成参数:');
        console.log('- appId:', appId);
        console.log('- secretKey:', secretKey.substring(0, 8) + '...');
        console.log('- timestamp:', ts);
        
        // 生成签名
        const signa = hex_md5(appId + ts);
        console.log('- MD5签名:', signa);
        
        const signatureSha = CryptoJSNew.HmacSHA1(signa, secretKey);
        console.log('- HMAC-SHA1:', signatureSha.toString());
        
        const signature = encodeURIComponent(CryptoJS.enc.Base64.stringify(signatureSha));
        console.log('- Base64编码签名:', signature);
        
        const wsUrl = `${url}?appid=${appId}&ts=${ts}&signa=${signature}`;
        console.log('🔗 科大讯飞WebSocket URL:', wsUrl);
        
        return wsUrl;
    }

    // 连接到科大讯飞服务
    async connect() {
        try {
            const websocketUrl = this.getWebSocketUrl();
            
            console.log('🔄 正在连接科大讯飞实时语音转写服务...');
            this.changeBtnStatus("CONNECTING");

            // 创建WebSocket连接
            if ("WebSocket" in window) {
                this.websocket = new WebSocket(websocketUrl);
            } else if ("MozWebSocket" in window) {
                this.websocket = new MozWebSocket(websocketUrl);
            } else {
                throw new Error('浏览器不支持WebSocket');
            }

            // 设置WebSocket事件处理
            this.websocket.onopen = (e) => {
                console.log('✅ 科大讯飞WebSocket连接成功');
                this.isConnected = true;
                
                // 连接成功后开始录音
                this.startRecording();
            };

            this.websocket.onmessage = (e) => {
                this.handleMessage(e.data);
            };

            this.websocket.onerror = (e) => {
                console.error('❌ 科大讯飞WebSocket连接错误:', e);
                this.handleError(e);
            };

            this.websocket.onclose = (e) => {
                console.log('🔌 科大讯飞WebSocket连接已关闭');
                this.isConnected = false;
                this.stopRecording();
                this.changeBtnStatus("CLOSED");
            };

        } catch (error) {
            console.error('❌ 连接科大讯飞服务失败:', error);
            this.showToast(`连接失败: ${error.message}`, 'error');
            this.changeBtnStatus("CLOSED");
        }
    }

    // 处理科大讯飞返回的消息
    handleMessage(data) {
        try {
            console.log('📨 收到原始消息:', data);
            const jsonData = JSON.parse(data);
            console.log('📨 解析后的科大讯飞消息:', jsonData);

            if (jsonData.action == "started") {
                // 握手成功
                console.log('🤝 握手成功');
                this.showToast('科大讯飞服务连接成功', 'success');
                
            } else if (jsonData.action == "result") {
                // 转写结果
                console.log('📝 收到转写结果，原始data:', jsonData.data);
                try {
                    const resultData = JSON.parse(jsonData.data);
                    console.log('📝 解析后的转写结果:', resultData);
                    this.processTranscriptionResult(resultData);
                } catch (parseError) {
                    console.error('❌ 解析转写结果失败:', parseError);
                    console.error('❌ 原始data内容:', jsonData.data);
                }
                
            } else if (jsonData.action == "error") {
                // 连接发生错误
                console.error('❌ 科大讯飞服务错误:', jsonData);
                this.showToast(`科大讯飞错误: ${jsonData.desc}`, 'error');
            } else {
                console.log('📨 收到未知类型的消息:', jsonData);
            }
        } catch (error) {
            console.error('❌ 处理消息失败:', error);
            console.error('❌ 原始消息内容:', data);
        }
    }

    // 处理转写结果
    processTranscriptionResult(data) {
        console.log('🔍 开始处理转写结果，输入数据:', data);
        
        let resultTextTemp = "";
        
        // 检查数据结构
        console.log('🔍 检查数据结构:');
        console.log('- data.cn 存在:', !!data.cn);
        if (data.cn) {
            console.log('- data.cn.st 存在:', !!data.cn.st);
            if (data.cn.st) {
                console.log('- data.cn.st.rt 存在:', !!data.cn.st.rt);
                console.log('- data.cn.st.type:', data.cn.st.type);
            }
        }
        
        // 解析科大讯飞的结果格式
        if (data.cn && data.cn.st && data.cn.st.rt) {
            console.log('🔍 开始解析rt数据，rt长度:', data.cn.st.rt.length);
            data.cn.st.rt.forEach((sentence, sentenceIndex) => {
                console.log(`🔍 处理句子 ${sentenceIndex}:`, sentence);
                if (sentence.ws) {
                    sentence.ws.forEach((word, wordIndex) => {
                        console.log(`🔍 处理词语 ${sentenceIndex}-${wordIndex}:`, word);
                        if (word.cw) {
                            word.cw.forEach((char, charIndex) => {
                                console.log(`🔍 处理字符 ${sentenceIndex}-${wordIndex}-${charIndex}:`, char);
                                resultTextTemp += char.w;
                            });
                        }
                    });
                }
            });
        } else {
            console.warn('❌ 数据结构不匹配预期格式');
        }

        console.log('🔍 解析出的文本:', resultTextTemp);
        console.log('🔍 文本长度:', resultTextTemp.length);

        if (data.cn && data.cn.st) {
            if (data.cn.st.type == 0) {
                // 最终识别结果 - 添加到实时记录框并同步到所有用户
                this.resultText += resultTextTemp;
                this.resultTextTemp = "";
                console.log('✅ 最终结果:', resultTextTemp);
                
                // 最终结果同步到所有用户
                if (resultTextTemp.trim()) {
                    // 只发送到服务器，不直接本地显示（避免重复）
                    this.sendTranscriptionResult(resultTextTemp, false);
                    console.log('📡 已发送最终结果到服务器');
                } else {
                    console.log('🚫 跳过空的最终结果');
                }
            } else {
                // 临时结果 - 显示实时预览并同步到所有用户
                this.resultTextTemp = resultTextTemp;
                console.log('🔄 临时结果:', resultTextTemp);
                
                // 临时结果也同步到所有用户
                if (resultTextTemp.trim()) {
                    // 只发送到服务器，不直接本地显示（避免重复）
                    this.sendTranscriptionResult(resultTextTemp, true);
                    console.log('📡 已发送临时结果到服务器');
                } else {
                    console.log('🚫 跳过空的临时结果');
                }
            }
        } else {
            console.warn('❌ 无法确定结果类型');
        }
    }

    // 开始录音
    async startRecording() {
        if (!this.recorder) {
            console.error('❌ 录音器未初始化');
            this.showToast('录音器未初始化', 'error');
            return;
        }

        if (this.isRecording) {
            console.warn('⚠️ 已在录音中');
            return;
        }

        try {
            console.log('🎙️ 开始录音...');
            this.isRecording = true;
            
            // 清空之前的结果
            this.resultText = "";
            this.resultTextTemp = "";
            
            // 清空实时记录框的临时预览（但保留之前的转录内容）
            this.clearPartialTranscription();
            
            // 开始录音，设置参数
            const recordingConfig = {
                sampleRate: 16000,  // 采样率16kHz，科大讯飞要求
                frameSize: 1280,    // 帧大小，每80ms一帧 (16000 * 0.08 = 1280)
            };
            
            console.log('🎙️ 录音配置:', recordingConfig);
            this.recorder.start(recordingConfig);
            
            this.updateRecordingUI(true);
            this.showToast('开始科大讯飞实时转录', 'success');
            
            // 通知服务器转录开始
            this.sendTranscriptionStart();
            
        } catch (error) {
            console.error('❌ 开始录音失败:', error);
            this.showToast(`录音失败: ${error.message}`, 'error');
            this.isRecording = false;
            this.updateRecordingUI(false);
        }
    }

    // 停止录音
    stopRecording() {
        if (!this.isRecording || !this.recorder) {
            console.warn('❌ 未在录音中或录音器不可用');
            return;
        }

        console.log('🛑 停止录音...');
        
        try {
            this.recorder.stop();
        } catch (error) {
            console.error('❌ 停止录音失败:', error);
        }
        
        // 清除临时预览，只保留最终结果
        this.clearPartialTranscription();
        
        // 通知服务器转录停止
        this.sendTranscriptionStop();
        
        this.isRecording = false;
        this.disconnect();
    }

    // 切换录音状态
    toggleRecording() {
        if (this.btnStatus === "UNDEFINED" || this.btnStatus === "CLOSED") {
            this.connect();
        } else if (this.btnStatus === "CONNECTING" || this.btnStatus === "OPEN") {
            this.stopRecording();
        }
    }

    // 断开连接
    disconnect() {
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
        this.isConnected = false;
        this.changeBtnStatus("CLOSED");
    }

    // 改变按钮状态
    changeBtnStatus(status) {
        this.btnStatus = status;
        
        const startBtn = document.getElementById('xfyunStartBtn');
        const stopBtn = document.getElementById('xfyunStopBtn');
        
        if (startBtn && stopBtn) {
            switch (status) {
                case "CONNECTING":
                    startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 连接中...';
                    startBtn.disabled = true;
                    stopBtn.style.display = 'none';
                    break;
                case "OPEN":
                    startBtn.style.display = 'none';
                    stopBtn.style.display = 'inline-flex';
                    stopBtn.innerHTML = '<i class="fas fa-stop"></i> 停止科大讯飞转录';
                    stopBtn.disabled = false;
                    break;
                case "CLOSING":
                    stopBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 停止中...';
                    stopBtn.disabled = true;
                    break;
                case "CLOSED":
                default:
                    startBtn.style.display = 'inline-flex';
                    startBtn.innerHTML = '<i class="fas fa-microphone"></i> 科大讯飞转录';
                    startBtn.disabled = false;
                    stopBtn.style.display = 'none';
                    break;
            }
        }
        
        this.updateRecordingUI(status === "OPEN");
    }

    // 更新录音UI
    updateRecordingUI(isRecording) {
        const transcriptionStatus = document.getElementById('transcriptionStatus');
        
        if (transcriptionStatus) {
            if (isRecording) {
                transcriptionStatus.innerHTML = '<i class="fas fa-circle text-red-500"></i> 科大讯飞实时转录中...';
                transcriptionStatus.style.display = 'block';
            } else {
                transcriptionStatus.style.display = 'none';
            }
        }
    }

    // 更新转录文本显示 - 使用与Assembly AI相同的实时记录框
    updateTranscriptDisplay(text) {
        if (!text || text.trim() === '') {
            return;
        }

        console.log('📝 科大讯飞转录文本:', text);
        
        // 使用与Assembly AI完全相同的机制：添加到实时记录框
        this.addFinalTranscription(text);
    }

    // 添加最终转录结果到实时记录框（与Assembly AI相同的方法）
    addFinalTranscription(text) {
        const transcriptionHistory = document.getElementById('transcriptionHistory');
        if (!transcriptionHistory) {
            console.warn('📝 找不到transcriptionHistory元素');
            return;
        }
        
        const cleanText = text.trim();
        if (!cleanText) {
            console.log('🚫 跳过空白的转录结果');
            return;
        }
        
        // 避免重复：检查是否已经包含在全文中
        if (window.transcriptionClient && window.transcriptionClient.fullTranscriptionText.includes(cleanText)) {
            console.log('🚫 跳过重复的转录结果:', cleanText);
            return;
        }
        
        // 检查是否是当前用户发送的转录结果（避免本地重复显示）
        const isCurrentUserTranscription = typeof currentUserId !== 'undefined' && 
                                         typeof currentUsername !== 'undefined' && 
                                         this.isRecording;
        
        if (isCurrentUserTranscription) {
            console.log('🚫 跳过当前用户的本地转录显示（避免重复）:', cleanText);
            return;
        }
        
        // 添加到转录客户端的累积转录文本
        if (window.transcriptionClient) {
            if (window.transcriptionClient.fullTranscriptionText.length > 0) {
                window.transcriptionClient.fullTranscriptionText += ' ';
            }
            window.transcriptionClient.fullTranscriptionText += cleanText;
        }
        
        // 更新实时记录框显示
        this.updateCumulativeDisplay();
        
        // 显示下载按钮
        const downloadBtn = document.getElementById('downloadBtn');
        if (downloadBtn && window.transcriptionClient && window.transcriptionClient.fullTranscriptionText.length > 0) {
            downloadBtn.style.display = 'block';
        }
        
        console.log('✅ 科大讯飞转录结果已添加:', cleanText);
        console.log('📝 当前全文长度:', window.transcriptionClient ? window.transcriptionClient.fullTranscriptionText.length : 0);
    }

    // 更新累积显示（与Assembly AI相同的方法）
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
                border: 2px solid #3b82f6;
                border-left: 4px solid #3b82f6;
                background: linear-gradient(135deg, #eff6ff, #dbeafe);
            `;
            transcriptionHistory.appendChild(cumulativeDiv);
        }
        
        // 显示全部累积内容
        if (window.transcriptionClient && window.transcriptionClient.fullTranscriptionText) {
            cumulativeDiv.textContent = window.transcriptionClient.fullTranscriptionText;
        }
        
        transcriptionHistory.scrollTop = transcriptionHistory.scrollHeight;
    }

    // 显示临时结果预览（用于实时预览）
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
                border: 2px solid #3b82f6;
                border-left: 4px solid #3b82f6;
                background: linear-gradient(135deg, #eff6ff, #dbeafe);
            `;
            transcriptionHistory.appendChild(cumulativeDiv);
        }
        
        // 更新实时预览：显示已确认的文本 + 当前正在转录的文本
        const currentPreview = text.trim();
        if (currentPreview) {
            const finalText = window.transcriptionClient ? window.transcriptionClient.fullTranscriptionText : '';
            const previewHtml = finalText + '<span class="current-preview" style="color: #2563eb; background: rgba(37, 99, 235, 0.15); padding: 2px 4px; border-radius: 3px; animation: pulse 1.5s infinite;">' + currentPreview + '</span>';
            cumulativeDiv.innerHTML = previewHtml;
        } else {
            cumulativeDiv.textContent = window.transcriptionClient ? window.transcriptionClient.fullTranscriptionText : '';
        }
        
        transcriptionHistory.scrollTop = transcriptionHistory.scrollHeight;
    }

    // 清除临时预览
    clearPartialTranscription() {
        const transcriptionHistory = document.getElementById('transcriptionHistory');
        if (!transcriptionHistory) return;
        
        // 获取累积转录容器
        const cumulativeDiv = document.getElementById('cumulativeTranscription');
        if (cumulativeDiv && window.transcriptionClient) {
            // 只显示已确认的最终文本，清除临时预览
            cumulativeDiv.textContent = window.transcriptionClient.fullTranscriptionText;
        }
    }

    // 发送转录开始事件到服务器
    sendTranscriptionStart() {
        if (window.realtimeClient && typeof roomId !== 'undefined' && typeof currentUserId !== 'undefined' && typeof currentUsername !== 'undefined') {
            window.realtimeClient.sendXfyunTranscriptionStart({
                roomId: roomId,
                userId: currentUserId,
                username: currentUsername
            });
            console.log('📡 已发送转录开始事件');
        } else {
            console.warn('⚠️ 无法发送转录开始事件：缺少必要参数或实时客户端未连接');
        }
    }

    // 发送转录停止事件到服务器
    sendTranscriptionStop() {
        if (window.realtimeClient && typeof roomId !== 'undefined' && typeof currentUserId !== 'undefined' && typeof currentUsername !== 'undefined') {
            window.realtimeClient.sendXfyunTranscriptionStop({
                roomId: roomId,
                userId: currentUserId,
                username: currentUsername
            });
            console.log('📡 已发送转录停止事件');
        } else {
            console.warn('⚠️ 无法发送转录停止事件：缺少必要参数或实时客户端未连接');
        }
    }

    // 发送转录结果到服务器同步
    sendTranscriptionResult(result, isPartial) {
        if (window.realtimeClient && typeof roomId !== 'undefined' && typeof currentUserId !== 'undefined' && typeof currentUsername !== 'undefined') {
            const transcriptionData = {
                roomId: roomId,
                userId: currentUserId,
                username: currentUsername,
                result: result,
                isPartial: isPartial,
                timestamp: new Date().toISOString()
            };
            
            console.log('📡 准备发送转录结果:', transcriptionData);
            console.log('📡 实时客户端连接状态:', window.realtimeClient.isConnected);
            
            const sendResult = window.realtimeClient.sendXfyunTranscriptionResult(transcriptionData);
            
            if (sendResult) {
                console.log(`📡 已发送转录结果: ${result.substring(0, 50)}... (临时: ${isPartial})`);
            } else {
                console.error('❌ 发送转录结果失败 - 连接未建立');
            }
        } else {
            console.warn('⚠️ 无法发送转录结果：');
            console.warn('- realtimeClient存在:', !!window.realtimeClient);
            console.warn('- roomId存在:', typeof roomId !== 'undefined', roomId);
            console.warn('- currentUserId存在:', typeof currentUserId !== 'undefined', currentUserId);
            console.warn('- currentUsername存在:', typeof currentUsername !== 'undefined', currentUsername);
        }
    }

    // 处理错误
    handleError(error) {
        console.error('❌ 科大讯飞服务错误:', error);
        this.showToast('科大讯飞服务连接错误', 'error');
        this.stopRecording();
    }

    // 显示提示消息
    showToast(message, type = 'info') {
        console.log(`📢 ${message}`);
        
        // 创建提示元素
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6'};
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            max-width: 400px;
            font-size: 14px;
        `;
        toast.textContent = message;
        
        document.body.appendChild(toast);
        
        // 3秒后自动移除
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 3000);
    }

    // 检查SDK和依赖
    checkDependencies() {
        const dependencies = [
            'RecorderManager',
            'hex_md5',
            'CryptoJSNew',
            'CryptoJS'
        ];
        
        const missing = dependencies.filter(dep => typeof window[dep] === 'undefined');
        
        if (missing.length > 0) {
            console.error('❌ 缺少依赖:', missing);
            return false;
        }
        
        console.log('✅ 所有依赖已加载');
        return true;
    }

    // 获取状态信息
    getStatus() {
        return {
            isRecording: this.isRecording,
            isConnected: this.isConnected,
            btnStatus: this.btnStatus,
            hasApiKeys: !!(this.APPID && this.API_KEY),
            dependenciesLoaded: this.checkDependencies()
        };
    }
}

// 全局实例
if (typeof window !== 'undefined') {
    // 等待所有依赖加载完成后初始化
    window.addEventListener('load', () => {
        window.xfyunOfficialRTASR = new XfyunOfficialRTASR();
        
        // 暴露给全局使用的函数
        window.startXfyunTranscription = function() {
            if (window.xfyunOfficialRTASR.btnStatus === "UNDEFINED" || window.xfyunOfficialRTASR.btnStatus === "CLOSED") {
                window.xfyunOfficialRTASR.connect();
            }
        };

        window.stopXfyunTranscription = function() {
            if (window.xfyunOfficialRTASR.btnStatus === "CONNECTING" || window.xfyunOfficialRTASR.btnStatus === "OPEN") {
                window.xfyunOfficialRTASR.stopRecording();
            }
        };

        window.toggleXfyunTranscription = function() {
            window.xfyunOfficialRTASR.toggleRecording();
        };

        window.getXfyunTranscriptionStatus = function() {
            return window.xfyunOfficialRTASR.getStatus();
        };

        window.debugXfyunConnection = function() {
            console.log('🔧 科大讯飞官方RTASR连接调试信息:');
            const status = window.xfyunOfficialRTASR.getStatus();
            console.log('- 状态:', status);
            console.log('- 录音器:', window.xfyunOfficialRTASR.recorder);
            console.log('- WebSocket:', window.xfyunOfficialRTASR.websocket);
            
            // 额外的调试信息
            console.log('🔧 详细调试信息:');
            console.log('- 当前按钮状态:', window.xfyunOfficialRTASR.btnStatus);
            console.log('- 是否正在录音:', window.xfyunOfficialRTASR.isRecording);
            console.log('- 是否已连接:', window.xfyunOfficialRTASR.isConnected);
            console.log('- APPID:', window.xfyunOfficialRTASR.APPID);
            console.log('- API_KEY存在:', !!window.xfyunOfficialRTASR.API_KEY);
            
            // 检查依赖
            console.log('🔧 依赖检查:');
            console.log('- RecorderManager:', typeof RecorderManager !== 'undefined');
            console.log('- hex_md5:', typeof hex_md5 !== 'undefined');
            console.log('- CryptoJSNew:', typeof CryptoJSNew !== 'undefined');
            console.log('- CryptoJS:', typeof CryptoJS !== 'undefined');
            
            // 检查DOM元素
            console.log('🔧 DOM元素检查:');
            console.log('- transcriptionHistory:', !!document.getElementById('transcriptionHistory'));
            console.log('- xfyunStartBtn:', !!document.getElementById('xfyunStartBtn'));
            console.log('- xfyunStopBtn:', !!document.getElementById('xfyunStopBtn'));
            
            return status;
        };
        
        // 新增：测试音频数据发送的调试函数
        window.testXfyunAudioSending = function() {
            console.log('🧪 测试科大讯飞音频数据发送');
            if (window.xfyunOfficialRTASR && window.xfyunOfficialRTASR.recorder) {
                console.log('- 录音器存在，测试onFrameRecorded回调');
                // 模拟一个假的音频帧来测试回调
                const testFrame = new ArrayBuffer(1280);
                const testView = new Uint8Array(testFrame);
                testView.fill(Math.random() * 255); // 填充随机数据
                
                if (window.xfyunOfficialRTASR.recorder.onFrameRecorded) {
                    console.log('- 调用测试音频帧');
                    window.xfyunOfficialRTASR.recorder.onFrameRecorded({
                        isLastFrame: false,
                        frameBuffer: testFrame
                    });
                } else {
                    console.warn('- onFrameRecorded回调不存在');
                }
            } else {
                console.error('- 录音器不存在，无法测试');
            }
        };

        console.log('🏭 科大讯飞官方RTASR模块已加载');
        console.log('💡 使用 debugXfyunConnection() 查看详细信息');
    });
}

// 导出类（用于模块化环境）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = XfyunOfficialRTASR;
}
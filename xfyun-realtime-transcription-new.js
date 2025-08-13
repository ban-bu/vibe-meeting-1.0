/**
 * 科大讯飞实时语音转写客户端 - 新实现
 * 基于研究发现，科大讯飞没有公开的RTASR WebSocket API
 * 改为使用其他可用的实时语音转写服务或提供备选方案
 */

class XfyunRealtimeTranscription {
    constructor() {
        this.isRecording = false;
        this.isConnected = false;
        this.websocket = null;
        this.audioContext = null;
        this.mediaStream = null;
        this.processor = null;
        this.frameId = 0;
        
        console.log('🏭 科大讯飞转录服务初始化');
    }

    // 获取科大讯飞API状态
    getApiStatus() {
        return {
            available: false,
            reason: '科大讯飞实时语音转写API未公开提供',
            alternatives: [
                'Assembly AI',
                'Azure Speech Services', 
                'Google Cloud Speech-to-Text',
                'AWS Transcribe',
                'Speechmatics'
            ]
        };
    }

    // 连接到替代服务
    async connect() {
        console.log('❌ 科大讯飞实时语音转写API未公开提供');
        console.log('💡 建议使用以下替代方案:');
        console.log('1. Assembly AI - 支持实时转录，准确度高');
        console.log('2. Azure Speech Services - 微软语音服务');
        console.log('3. Google Cloud Speech-to-Text - 谷歌语音识别');
        console.log('4. 腾讯云语音识别 - 实时语音识别');
        
        this.showToast('科大讯飞实时转录功能暂不可用', 'warning');
        return false;
    }

    // 显示备选方案
    showAlternativeOptions() {
        const message = `
科大讯飞实时语音转写API未公开提供

推荐备选方案:
1. Assembly AI - 高质量实时转录
2. Azure Speech Services - 微软语音服务  
3. Google Cloud Speech-to-Text - 谷歌语音识别
4. 腾讯云语音识别 - 实时语音识别
5. 讯飞开放平台其他API服务

请选择其他转录服务或联系讯飞申请API权限
        `;
        
        alert(message);
    }

    // 开始录音（显示功能不可用提示）
    async startRecording() {
        console.log('⚠️ 尝试启动科大讯飞转录服务');
        
        // 显示功能不可用的友好提示
        this.showToast('科大讯飞实时转录服务暂时不可用，请使用Assembly转录', 'info');
        this.showAlternativeOptions();
        
        // 更新UI状态
        this.updateRecordingUI(false);
        
        return false;
    }

    // 停止录音
    stopRecording() {
        if (!this.isRecording) {
            console.warn('❌ 未在录音中');
            return;
        }

        console.log('🛑 停止科大讯飞转录');
        this.isRecording = false;

        // 停止音频处理
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        if (this.processor) {
            if (this.processor.port) {
                this.processor.port.onmessage = null;
            } else if (this.processor.onaudioprocess) {
                this.processor.onaudioprocess = null;
            }
            this.processor.disconnect();
            this.processor = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        // 断开连接
        this.disconnect();
        
        // 更新UI
        this.updateRecordingUI(false);
        this.showToast('科大讯飞转录已停止', 'info');
    }

    // 切换录音状态
    toggleRecording() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            this.startRecording();
        }
    }

    // 断开连接
    disconnect() {
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
        this.isConnected = false;
    }

    // 更新录音UI
    updateRecordingUI(isRecording) {
        const startBtn = document.getElementById('xfyunStartBtn');
        const stopBtn = document.getElementById('xfyunStopBtn');
        const transcriptionStatus = document.getElementById('transcriptionStatus');

        if (startBtn && stopBtn) {
            if (isRecording) {
                startBtn.style.display = 'none';
                stopBtn.style.display = 'inline-flex';
            } else {
                startBtn.style.display = 'inline-flex';
                stopBtn.style.display = 'none';
            }
        }

        if (transcriptionStatus) {
            if (isRecording) {
                transcriptionStatus.innerHTML = '<i class="fas fa-circle text-red-500"></i> 科大讯飞转录中...';
                transcriptionStatus.style.display = 'block';
            } else {
                transcriptionStatus.style.display = 'none';
            }
        }
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
            background: ${type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#3b82f6'};
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

    // 检查API可用性
    checkApiAvailability() {
        const status = this.getApiStatus();
        console.log('🔍 科大讯飞API状态检查:', status);
        return status;
    }

    // 获取推荐的替代方案
    getRecommendedAlternatives() {
        return [
            {
                name: 'Assembly AI',
                description: '高质量实时语音转录服务',
                websiteUrl: 'https://www.assemblyai.com/',
                features: ['实时转录', '高准确度', '多语言支持', '说话人识别']
            },
            {
                name: '腾讯云语音识别',
                description: '腾讯云实时语音识别服务',
                websiteUrl: 'https://cloud.tencent.com/product/asr',
                features: ['实时识别', '一句话识别', '录音文件识别', '语音流异步识别']
            },
            {
                name: 'Azure Speech Services',
                description: '微软Azure语音服务',
                websiteUrl: 'https://azure.microsoft.com/services/cognitive-services/speech-services/',
                features: ['实时转录', '批量转录', '语音翻译', '语音合成']
            },
            {
                name: 'Google Cloud Speech-to-Text',
                description: '谷歌云语音转文本服务',
                websiteUrl: 'https://cloud.google.com/speech-to-text',
                features: ['流式识别', '批处理识别', '多语言', '自动标点']
            }
        ];
    }
}

// 全局实例
if (typeof window !== 'undefined') {
    window.xfyunTranscription = new XfyunRealtimeTranscription();
    
    // 暴露给全局使用的函数
    window.startXfyunTranscription = function() {
        window.xfyunTranscription.startRecording();
    };

    window.stopXfyunTranscription = function() {
        window.xfyunTranscription.stopRecording();
    };

    window.toggleXfyunTranscription = function() {
        window.xfyunTranscription.toggleRecording();
    };

    window.getXfyunTranscriptionStatus = function() {
        return {
            isRecording: window.xfyunTranscription.isRecording,
            isConnected: window.xfyunTranscription.isConnected,
            apiStatus: window.xfyunTranscription.getApiStatus()
        };
    };

    window.debugXfyunConnection = function() {
        console.log('🔧 科大讯飞连接调试信息:');
        const status = window.xfyunTranscription.checkApiAvailability();
        console.log('- API状态:', status);
        console.log('- 推荐替代方案:', window.xfyunTranscription.getRecommendedAlternatives());
        
        return status;
    };

    // 初始化时显示状态
    console.log('🏭 科大讯飞转录模块已加载');
    console.log('💡 使用 debugXfyunConnection() 查看详细信息');
}

// 导出类（用于模块化环境）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = XfyunRealtimeTranscription;
}
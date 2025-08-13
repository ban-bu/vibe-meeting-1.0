// 配置
const CONFIG = {
    API_KEY: "sk-lNVAREVHjj386FDCd9McOL7k66DZCUkTp6IbV0u9970qqdlg",
    API_URL: "https://api.deepbricks.ai/v1/chat/completions",
    MODEL: "gemini-2.5-flash"
};

// 全局移动端检测函数
function isMobileDevice() {
    return window.innerWidth <= 768 || 
           /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           (window.innerWidth <= 1024 && window.innerHeight > window.innerWidth) ||
           (window.innerWidth <= 480 && window.innerHeight > window.innerWidth);
}

// 全局状态
let messages = [];
let participants = [];
let isAIProcessing = false;
let currentUsername = '';
let roomId = '';
window.roomId = roomId; // 暴露到全局
let currentUserId = '';

// 通话状态
let currentCallState = {
    isActive: false,
    participantCount: 0,
    participants: [],
    isUserInCall: false
};

// 基于用户名生成一致的用户ID
function generateUserIdFromUsername(username) {
    if (!username) return 'user-' + Math.random().toString(36).substr(2, 9);
    
    // 使用简单的哈希函数基于用户名生成一致的ID
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        const char = username.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // 转换为32位整数
    }
    
    // 转换为正数并生成用户ID
    const userId = 'user-' + Math.abs(hash).toString(36);
    return userId;
}

// 实时通信状态
let isRealtimeEnabled = false;
let typingTimeout = null;

// 科大讯飞转录客户端
class XfyunClient {
    constructor() {
        this.isRecording = false;
        this.mediaStream = null;
        this.audioContext = null;
        this.processor = null;
    }
    
    toggleRecording() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            this.startRecording();
        }
    }
    
    async startRecording() {
        try {
            console.log('🎤 开始科大讯飞转录...');
            
            // 检查连接
            if (!window.realtimeClient?.isConnected) {
                showToast('请先连接到聊天服务器', 'error');
                return;
            }
            
            // 获取麦克风权限 - 优化音频配置减少卡顿
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    googEchoCancellation: true,
                    googAutoGainControl: true,
                    googNoiseSuppression: true,
                    googHighpassFilter: true
                }
            });
            
            // 连接科大讯飞服务
            window.realtimeClient.socket.emit('xfyun-connect', { roomId });
            
            // 设置音频处理
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            
            // 创建音频处理器
            if (this.audioContext.createScriptProcessor) {
                this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
            } else {
                this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
            }
            
            let frameId = 0;
            
            this.processor.onaudioprocess = (event) => {
                if (!this.isRecording) return;
                
                const inputBuffer = event.inputBuffer.getChannelData(0);
                const samples = new Int16Array(inputBuffer.length);
                
                // 转换为16位PCM
                for (let i = 0; i < inputBuffer.length; i++) {
                    const s = Math.max(-1, Math.min(1, inputBuffer[i]));
                    samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                
                // 转换为base64
                const audioData = btoa(String.fromCharCode(...new Uint8Array(samples.buffer)));
                
                // 发送音频数据
                window.realtimeClient.socket.emit('xfyun-audio', {
                    frameId: frameId++,
                    audio: audioData
                });
            };
            
            source.connect(this.processor);
            this.processor.connect(this.audioContext.destination);
            
            this.isRecording = true;
            
            // 更新UI
            document.getElementById('xfyunStartBtn').style.display = 'none';
            document.getElementById('xfyunStopBtn').style.display = 'inline-block';
            
            showToast('科大讯飞转录已启动', 'success');
            
        } catch (error) {
            console.error('启动科大讯飞转录失败:', error);
            showToast('无法启动转录: ' + error.message, 'error');
        }
    }
    
    stopRecording() {
        console.log('🛑 停止科大讯飞转录');
        
        this.isRecording = false;
        
        // 发送停止命令
        if (window.realtimeClient?.isConnected) {
            window.realtimeClient.socket.emit('xfyun-stop');
        }
        
        // 清理音频资源
        if (this.processor) {
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
        
        // 更新UI
        document.getElementById('xfyunStartBtn').style.display = 'inline-block';
        document.getElementById('xfyunStopBtn').style.display = 'none';
        
        showToast('科大讯飞转录已停止', 'info');
    }
}

// 处理科大讯飞转录结果
function handleXfyunResult(data) {
    console.log('处理科大讯飞转录结果:', data);
    
    // 科大讯飞返回的数据格式
    if (data.data && data.data.result) {
        const result = data.data.result;
        const text = result.ws?.map(ws => 
            ws.cw?.map(cw => cw.w).join('')
        ).join('') || '';
        
        if (text && text.trim()) {
            // 显示转录结果
            displayTranscriptionResult({
                type: 'xfyun',
                text: text.trim(),
                isPartial: result.pgs !== 'rpl', // 如果不是replace，则是部分结果
                timestamp: Date.now(),
                userId: currentUserId,
                username: currentUsername
            });
            
            // 广播转录结果给其他用户
            if (window.realtimeClient && window.realtimeClient.isConnected) {
                window.realtimeClient.socket.emit('xfyunTranscriptionResult', {
                    roomId,
                    userId: currentUserId,
                    username: currentUsername,
                    result: text.trim(),
                    isPartial: result.pgs !== 'rpl',
                    timestamp: Date.now()
                });
            }
        }
    }
}

// 更新通话相关UI - 在聊天记录中显示通话状态（避免与下方通话面板的updateCallUI同名冲突）
function updateCallStatusInChat() {
    console.log('更新通话UI，当前状态:', currentCallState);
    
    // 清除之前的通话状态消息
    removeCallStatusMessages();
    
    if (currentCallState.isActive && !currentCallState.isUserInCall) {
        // 有通话进行中，但当前用户未参与 - 在聊天记录中显示提示
        displayCallStatusMessage({
            type: 'call-invite',
            participantCount: currentCallState.participantCount,
            showJoinButton: true
        });
    } else if (currentCallState.isActive && currentCallState.isUserInCall) {
        // 用户已在通话中 - 显示通话状态
        displayCallStatusMessage({
            type: 'call-active',
            participantCount: currentCallState.participantCount,
            showJoinButton: false
        });
    }
    // 如果通话不活跃，则不显示任何消息（已经清除了）
}

// 显示通话状态消息
function displayCallStatusMessage(options) {
    const { type, participantCount, showJoinButton } = options;
    
    let message, buttonText, buttonClass, iconClass;
    
    if (type === 'call-invite') {
        message = `🔊 房间内正在进行语音通话 (${participantCount} 人参与)`;
        buttonText = '加入通话';
        buttonClass = 'btn-join-call-inline';
        iconClass = 'fas fa-phone-volume';
    } else if (type === 'call-active') {
        message = `📞 您正在参与语音通话 (${participantCount} 人参与)`;
        buttonText = null;
        buttonClass = null;
        iconClass = 'fas fa-phone';
    }
    
    // 确保messagesContainer存在
    if (!messagesContainer) {
        console.warn('messagesContainer不存在，无法显示通话状态消息');
        return;
    }
    
    const messageElement = document.createElement('div');
    messageElement.className = 'message call-status-message';
    messageElement.setAttribute('data-call-status', 'true');
    
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'message-avatar system-avatar';
    avatarDiv.innerHTML = '<i class="fas fa-bullhorn"></i>';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    const headerDiv = document.createElement('div');
    headerDiv.className = 'message-header';
    headerDiv.innerHTML = `
        <span class="message-author">系统通知</span>
        <span class="message-time">${new Date().toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit' 
        })}</span>
    `;
    
    const textDiv = document.createElement('div');
    textDiv.className = 'message-text call-status-text';
    textDiv.innerHTML = `
        <div class="call-status-info">
            <i class="${iconClass}"></i>
            <span>${message}</span>
        </div>
        ${showJoinButton ? `
            <div class="call-status-actions">
                <button class="${buttonClass}" onclick="joinOngoingCall()">
                    <i class="fas fa-phone-volume"></i> ${buttonText}
                </button>
            </div>
        ` : ''}
    `;
    
    contentDiv.appendChild(headerDiv);
    contentDiv.appendChild(textDiv);
    messageElement.appendChild(avatarDiv);
    messageElement.appendChild(contentDiv);
    
    // 添加到聊天容器
    messagesContainer.appendChild(messageElement);
    
    // 滚动到底部
    setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, 100);
}

// 移除通话状态消息
function removeCallStatusMessages() {
    const statusMessages = document.querySelectorAll('[data-call-status="true"]');
    statusMessages.forEach(msg => msg.remove());
}

// 防止重复加入通话的标志
let isJoiningCall = false;

// 加入正在进行的通话
function joinOngoingCall() {
    console.log('尝试加入正在进行的通话，当前状态:', currentCallState);
    
    if (isJoiningCall) {
        console.log('正在加入通话中，忽略重复请求');
        return;
    }
    
    if (!window.realtimeClient || !window.realtimeClient.isConnected) {
        showToast('网络连接不可用，无法加入通话', 'error');
        return;
    }
    
    if (!currentCallState.isActive) {
        showToast('房间内没有正在进行的通话', 'error');
        return;
    }
    
    isJoiningCall = true;
    showToast('正在加入通话...', 'info');
    
    // 发送加入通话请求
    window.realtimeClient.socket.emit('joinOngoingCall', {
        roomId,
        userId: currentUserId,
        userName: currentUsername
    });
}

// 隐藏通话提示
function dismissCallNotice() {
    const ongoingCallNotice = document.getElementById('ongoingCallNotice');
    if (ongoingCallNotice) {
        ongoingCallNotice.style.display = 'none';
    }
}

// 暴露关键函数到全局，确保内联onclick可用
if (typeof window !== 'undefined') {
    window.joinOngoingCall = joinOngoingCall;
    window.dismissCallNotice = dismissCallNotice;
}

// DOM元素
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const participantsList = document.getElementById('participantsList');
const summaryContent = document.getElementById('summaryContent');
const aiStatus = document.getElementById('aiStatus');
const connectionStatus = document.getElementById('connectionStatus');
const askAIModal = document.getElementById('askAIModal');
const aiQuestionInput = document.getElementById('aiQuestionInput');
const usernameModal = document.getElementById('usernameModal');
const usernameInput = document.getElementById('usernameInput');
const roomInput = document.getElementById('roomInput');

// 移动端检测和响应式功能
function initMobileSupport() {
    const isMobile = window.innerWidth <= 768;
    const mobileNav = document.getElementById('mobileNav');
    const leftSidebar = document.querySelector('.left-sidebar');
    const rightSidebar = document.querySelector('.right-sidebar');
    const sidebarClose = document.getElementById('sidebarClose');
    const aiPanelClose = document.getElementById('aiPanelClose');
    
    // 显示/隐藏移动端导航
    if (isMobile) {
        mobileNav.style.display = 'flex';
        if (sidebarClose) sidebarClose.style.display = 'block';
        if (aiPanelClose) aiPanelClose.style.display = 'block';
        
        // 默认隐藏侧边栏
        leftSidebar.classList.remove('active');
        rightSidebar.classList.remove('active');
    } else {
        mobileNav.style.display = 'none';
        if (sidebarClose) sidebarClose.style.display = 'none';
        if (aiPanelClose) aiPanelClose.style.display = 'none';
        
        // 桌面端显示侧边栏
        leftSidebar.classList.remove('active');
        rightSidebar.classList.remove('active');
    }
    
    // 移动端导航点击事件
    const navBtns = document.querySelectorAll('.mobile-nav-btn');
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');
            
            // 更新导航状态
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // 切换内容区域
            switchMobileTab(tab);
        });
    });
    
    // 侧边栏关闭按钮
    if (sidebarClose) {
        sidebarClose.addEventListener('click', () => {
            leftSidebar.classList.remove('active');
            // 重新激活聊天标签
            navBtns.forEach(b => b.classList.remove('active'));
            const chatBtn = document.querySelector('[data-tab="chat"]');
            if (chatBtn) chatBtn.classList.add('active');
            switchMobileTab('chat');
        });
    }
    
    if (aiPanelClose) {
        aiPanelClose.addEventListener('click', () => {
            rightSidebar.classList.remove('active');
            // 重新激活聊天标签
            navBtns.forEach(b => b.classList.remove('active'));
            const chatBtn = document.querySelector('[data-tab="chat"]');
            if (chatBtn) chatBtn.classList.add('active');
            switchMobileTab('chat');
        });
    }
    
    // 监听窗口大小变化
    window.addEventListener('resize', handleResize);
    
    // 图标加载优化
    optimizeIconLoading();
    
    // 强制确保移动端输入框可见
    forceMobileInputVisibility();
}

// 强制确保移动端输入框可见
function forceMobileInputVisibility() {
    if (isMobileDevice()) {
        // 延迟执行，确保DOM完全加载
        setTimeout(() => {
            const inputContainer = document.querySelector('.input-container');
            const inputWrapper = document.querySelector('.input-wrapper');
            const messageInput = document.getElementById('messageInput');
            const chatContainer = document.querySelector('.chat-container');
            
            // 检查是否在欢迎页面（用户名模态框显示时）
            const usernameModal = document.getElementById('usernameModal');
            const isOnWelcomePage = usernameModal && (usernameModal.style.display === 'block' || usernameModal.style.display === 'flex');
            
            if (isOnWelcomePage) {
                // 在欢迎页面时隐藏输入框
                if (inputContainer) {
                    inputContainer.style.display = 'none';
                }
                return;
            }
            
            // 确保输入框在正常聊天时始终可见
            if (inputContainer) {
                // 强制设置样式
                Object.assign(inputContainer.style, {
                    position: 'fixed',
                    bottom: '0',
                    left: '0',
                    right: '0',
                    background: '#ffffff',
                    borderTop: '1px solid #e5e7eb',
                    zIndex: '9999',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '0.75rem',
                    gap: '0.5rem',
                    boxShadow: '0 -2px 10px rgba(0, 0, 0, 0.1)',
                    minHeight: '140px',
                    maxHeight: '200px',
                    visibility: 'visible',
                    opacity: '1'
                });
            }
            
            if (inputWrapper) {
                Object.assign(inputWrapper.style, {
                    display: 'flex',
                    gap: '0.5rem',
                    alignItems: 'flex-end',
                    width: '100%'
                });
            }
            
            // 强制显示AI询问和文件上传按钮
            const inputActions = document.querySelector('.input-actions');
            if (inputActions) {
                Object.assign(inputActions.style, {
                    display: 'flex !important',
                    gap: '0.5rem',
                    flexShrink: '0',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    width: '100%',
                    marginTop: '0.5rem'
                });
    
            }
            
            // 强制显示所有功能按钮
            const buttons = document.querySelectorAll('.btn-ask-ai, .btn-summarize, .btn-upload');
            buttons.forEach(button => {
                Object.assign(button.style, {
                    display: 'flex !important',
                    flex: '1',
                    minHeight: '44px',
                    padding: '0.75rem 0.5rem',
                    border: 'none',
                    borderRadius: '0.5rem',
                    background: button.classList.contains('btn-ask-ai') ? '#3b82f6' : 
                              button.classList.contains('btn-summarize') ? '#10b981' : '#f59e0b',
                    color: 'white',
                    cursor: 'pointer',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.875rem',
                    fontWeight: '500',
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                });
            });

            
            if (messageInput) {
                Object.assign(messageInput.style, {
                    flex: '1',
                    minHeight: '44px',
                    fontSize: '16px',
                    padding: '0.75rem',
                    border: '1px solid #e5e7eb',
                    borderRadius: '0.5rem',
                    resize: 'none',
                    background: '#ffffff',
                    display: 'block'
                });
            }
            
            if (chatContainer) {
                Object.assign(chatContainer.style, {
                    height: 'calc(100vh - 200px)',
                    overflow: 'hidden',
                    position: 'relative',
                    paddingBottom: '0' // 移除底部padding，让输入框完全独立
                });
            }
            
            // 监听窗口大小变化
            window.addEventListener('resize', () => {
                if (window.innerWidth <= 768) {
                    forceMobileInputVisibility();
                }
            });
            
                // 监听滚动事件，确保输入框始终在底部
    window.addEventListener('scroll', () => {
        if (inputContainer) {
            inputContainer.style.bottom = '0';
        }
    });
    
    // 定期检查输入框和按钮可见性
    setInterval(() => {
        const inputContainer = document.querySelector('.input-container');
        const inputActions = document.querySelector('.input-actions');
        const buttons = document.querySelectorAll('.btn-ask-ai, .btn-summarize, .btn-upload');
        
        // 检查是否在欢迎页面
        const usernameModal = document.getElementById('usernameModal');
        const isOnWelcomePage = usernameModal && (usernameModal.style.display === 'block' || usernameModal.style.display === 'flex');
        
        if (isOnWelcomePage) {
            // 在欢迎页面时隐藏输入框
            if (inputContainer) {
                inputContainer.style.display = 'none';
            }
            return;
        }
        
        if (inputContainer) {
            const rect = inputContainer.getBoundingClientRect();
            const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
            
            if (!isVisible) {
                console.log('⚠️ 检测到输入框不可见，正在修复...');
                inputContainer.style.display = 'flex';
                inputContainer.style.position = 'fixed';
                inputContainer.style.bottom = '0';
                inputContainer.style.zIndex = '9999';
            }
        }
        
        // 检查按钮是否可见
        if (inputActions) {
            const actionsRect = inputActions.getBoundingClientRect();
            const actionsVisible = actionsRect.top < window.innerHeight && actionsRect.bottom > 0;
            
            if (!actionsVisible) {
                console.log('⚠️ 检测到功能按钮不可见，正在修复...');
                Object.assign(inputActions.style, {
                    display: 'flex !important',
                    gap: '0.5rem',
                    flexShrink: '0',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    width: '100%',
                    marginTop: '0.5rem'
                });
            }
        }
        
        // 检查每个按钮的可见性
        buttons.forEach(button => {
            const buttonRect = button.getBoundingClientRect();
            const buttonVisible = buttonRect.top < window.innerHeight && buttonRect.bottom > 0;
            
            if (!buttonVisible) {
                console.log('⚠️ 检测到按钮不可见，正在修复...');
                Object.assign(button.style, {
                    display: 'flex !important',
                    flex: '1',
                    minHeight: '44px',
                    padding: '0.75rem 0.5rem',
                    border: 'none',
                    borderRadius: '0.5rem',
                    background: button.classList.contains('btn-ask-ai') ? '#3b82f6' : 
                              button.classList.contains('btn-summarize') ? '#10b981' : '#f59e0b',
                    color: 'white',
                    cursor: 'pointer',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.875rem',
                    fontWeight: '500',
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                });
            }
        });
    }, 3000);
    
    }, 1000);
}

// 显示输入框提示（已禁用）
function showInputBoxHint() {
    // 此功能已禁用，不再显示修复按钮
    return;
}
        
            // 再次检查，确保在页面完全加载后输入框可见
    setTimeout(() => {
        const inputContainer = document.querySelector('.input-container');
        if (inputContainer && inputContainer.style.display === 'none') {
            inputContainer.style.display = 'flex';
            console.log('🔄 输入框显示状态已修复');
        }
        
        // 添加调试信息
        console.log('📱 移动端输入框调试信息:');
        console.log('- 屏幕宽度:', window.innerWidth);
        console.log('- 屏幕高度:', window.innerHeight);
        console.log('- 输入框容器:', inputContainer);
        if (inputContainer) {
            console.log('- 输入框位置:', inputContainer.getBoundingClientRect());
            console.log('- 输入框样式:', inputContainer.style.cssText);
        }
        
        // 添加手动修复按钮（仅在开发环境）
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            addDebugButton();
        }
    }, 2000);
}

// 添加调试按钮
function addDebugButton() {
    const debugBtn = document.createElement('button');
    debugBtn.textContent = '🔧 修复输入框';
    debugBtn.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 10000;
        background: #ff4444;
        color: white;
        border: none;
        padding: 10px;
        border-radius: 5px;
        font-size: 12px;
    `;
    debugBtn.onclick = () => {
        forceMobileInputVisibility();
        alert('输入框已强制修复！');
    };
    document.body.appendChild(debugBtn);
}

// 优化图标加载
function optimizeIconLoading() {
    // 检测Font Awesome是否加载成功
    setTimeout(() => {
        const testIcon = document.createElement('i');
        testIcon.className = 'fas fa-check';
        testIcon.style.display = 'none';
        document.body.appendChild(testIcon);
        
        const computedStyle = window.getComputedStyle(testIcon, '::before');
        const content = computedStyle.content;
        
        if (content === 'none' || content === '') {
            console.log('Font Awesome 加载失败，使用备用图标');
            useFallbackIcons();
        } else {
            console.log('Font Awesome 加载成功');
        }
        
        document.body.removeChild(testIcon);
    }, 2000);
}

// 备用图标方案
function useFallbackIcons() {
    // 替换常用图标为Unicode字符或SVG
    const iconReplacements = {
        'fas fa-comments': '💬',
        'fas fa-user-friends': '👥',
        'fas fa-robot': '🤖',
        'fas fa-search': '🔍',
        'fas fa-times': '✕',
        'fas fa-file': '📄',
        'fas fa-upload': '📤',
        'fas fa-send': '📤',
        'fas fa-copy': '📋',
        'fas fa-wifi': '📶',
        'fas fa-circle': '●',
        'fas fa-eye': '👁️',
        'fas fa-language': '🌐',
        'fas fa-file-text': '📝',
        'fas fa-key': '🔑',
        'fas fa-magic': '✨',
        'fas fa-spinner': '⏳',
        'fas fa-power-off': '⏻',
        'fas fa-clipboard-list': '📋',
        'fas fa-info-circle': 'ℹ️',
        'fas fa-check': '✓',
        'fas fa-exclamation-triangle': '⚠️',
        'fas fa-download': '📥'
    };
    
    // 替换所有图标
    Object.keys(iconReplacements).forEach(iconClass => {
        const className = iconClass.replace('fas fa-', '');
        const elements = document.querySelectorAll(`.${className}`);
        elements.forEach(element => {
            if (element.tagName === 'I') {
                element.textContent = iconReplacements[iconClass];
                element.style.fontFamily = 'inherit';
                element.style.fontStyle = 'normal';
            }
        });
    });
}

function switchMobileTab(tab) {
    const leftSidebar = document.querySelector('.left-sidebar');
    const rightSidebar = document.querySelector('.right-sidebar');
    const chatContainer = document.querySelector('.chat-container');
    
    // 隐藏所有面板
    leftSidebar.classList.remove('active');
    rightSidebar.classList.remove('active');
    chatContainer.style.display = 'flex';
    
    switch(tab) {
        case 'participants':
            if (window.innerWidth <= 768) {
                leftSidebar.classList.add('active');
                chatContainer.style.display = 'none';
            }
            break;
        case 'ai':
            if (window.innerWidth <= 768) {
                rightSidebar.classList.add('active');
                chatContainer.style.display = 'none';
            }
            break;
        case 'chat':
        default:
            chatContainer.style.display = 'flex';
            // 确保聊天页面时按钮可见
            setTimeout(ensureMobileButtonsVisibility, 100);
            break;
    }
}

// 窗口大小改变时重新初始化移动端支持
function handleResize() {
    initMobileSupport();
    // 确保按钮可见性
    ensureMobileButtonsVisibility();
}

// 添加移动端手势支持
function initTouchGestures() {
    if (window.innerWidth <= 768) {
        let startY = 0;
        let startX = 0;
        let currentY = 0;
        let currentX = 0;
        let threshold = 50; // 手势触发阈值
        
        // 为侧边栏添加滑动手势
        const leftSidebar = document.querySelector('.left-sidebar');
        const rightSidebar = document.querySelector('.right-sidebar');
        
        // 从左边缘滑动打开参与者面板
        document.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        });
        
        document.addEventListener('touchmove', (e) => {
            if (!startX || !startY) return;
            
            currentX = e.touches[0].clientX;
            currentY = e.touches[0].clientY;
            
            const diffX = currentX - startX;
            const diffY = currentY - startY;
            
            // 确保是水平滑动
            if (Math.abs(diffX) > Math.abs(diffY)) {
                // 从左边缘向右滑动，打开参与者面板
                if (startX < 20 && diffX > threshold) {
                    const navBtns = document.querySelectorAll('.mobile-nav-btn');
                    navBtns.forEach(b => b.classList.remove('active'));
                    document.querySelector('[data-tab="participants"]').classList.add('active');
                    switchMobileTab('participants');
                }
                
                // 从右边缘向左滑动，打开AI工具面板
                if (startX > window.innerWidth - 20 && diffX < -threshold) {
                    const navBtns = document.querySelectorAll('.mobile-nav-btn');
                    navBtns.forEach(b => b.classList.remove('active'));
                    document.querySelector('[data-tab="ai"]').classList.add('active');
                    switchMobileTab('ai');
                }
                
                // 在侧边栏上向相反方向滑动，关闭面板
                if (leftSidebar.classList.contains('active') && diffX < -threshold) {
                    leftSidebar.classList.remove('active');
                    const navBtns = document.querySelectorAll('.mobile-nav-btn');
                    navBtns.forEach(b => b.classList.remove('active'));
                    document.querySelector('[data-tab="chat"]').classList.add('active');
                    switchMobileTab('chat');
                }
                
                if (rightSidebar.classList.contains('active') && diffX > threshold) {
                    rightSidebar.classList.remove('active');
                    const navBtns = document.querySelectorAll('.mobile-nav-btn');
                    navBtns.forEach(b => b.classList.remove('active'));
                    document.querySelector('[data-tab="chat"]').classList.add('active');
                    switchMobileTab('chat');
                }
            }
        });
        
        document.addEventListener('touchend', () => {
            startX = 0;
            startY = 0;
        });
        
        // 防止默认的滑动行为干扰
        document.addEventListener('touchmove', (e) => {
            if (leftSidebar.classList.contains('active') || rightSidebar.classList.contains('active')) {
                // 在侧边栏打开时，阻止页面滚动
                if (e.target.closest('.left-sidebar') || e.target.closest('.right-sidebar')) {
                    return;
                }
                e.preventDefault();
            }
        }, { passive: false });
    }
}

// 确保移动端按钮可见性
function ensureMobileButtonsVisibility() {
    if (isMobileDevice()) {
        // 检查是否在欢迎页面
        const usernameModal = document.getElementById('usernameModal');
        const isOnWelcomePage = usernameModal && (usernameModal.style.display === 'block' || usernameModal.style.display === 'flex');
        
        if (isOnWelcomePage) {
            // 在欢迎页面时隐藏输入框
            const inputContainer = document.querySelector('.input-container');
            if (inputContainer) {
                inputContainer.style.display = 'none';
            }
            return;
        }
        
        // 确保输入框在正常聊天时始终可见
        const inputContainer = document.querySelector('.input-container');
        if (inputContainer) {
            inputContainer.style.display = 'flex';
        }
        
        const inputActions = document.querySelector('.input-actions');
        const buttons = document.querySelectorAll('.btn-ask-ai, .btn-summarize, .btn-upload');
        
        if (inputActions) {
            Object.assign(inputActions.style, {
                display: 'flex !important',
                gap: '0.5rem',
                flexShrink: '0',
                alignItems: 'center',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                width: '100%',
                marginTop: '0.5rem'
            });
        }
        
        buttons.forEach(button => {
            Object.assign(button.style, {
                display: 'flex !important',
                flex: '1',
                minHeight: '44px',
                padding: '0.75rem 0.5rem',
                border: 'none',
                borderRadius: '0.5rem',
                background: button.classList.contains('btn-ask-ai') ? '#3b82f6' : 
                          button.classList.contains('btn-summarize') ? '#10b981' : '#f59e0b',
                color: 'white',
                cursor: 'pointer',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.875rem',
                fontWeight: '500',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
            });
        });
        

    }
}

// 优化移动端输入体验
function optimizeMobileInput() {
    if (isMobileDevice()) {
        const messageInput = document.getElementById('messageInput');
        
        // 移动端输入框获得焦点时，调整视图
        messageInput.addEventListener('focus', () => {
            setTimeout(() => {
                messageInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        });
        
        // 移动端虚拟键盘处理
        let initialHeight = window.innerHeight;
        window.addEventListener('resize', () => {
            const currentHeight = window.innerHeight;
            const heightDiff = initialHeight - currentHeight;
            
            // 检测虚拟键盘是否弹出（高度减少超过150px）
            if (heightDiff > 150) {
                document.body.classList.add('keyboard-open');
                // 调整聊天容器高度
                const chatContainer = document.querySelector('.chat-container');
                if (chatContainer) {
                    chatContainer.style.height = `${currentHeight - 120}px`;
                }
            } else {
                document.body.classList.remove('keyboard-open');
                const chatContainer = document.querySelector('.chat-container');
                if (chatContainer) {
                    chatContainer.style.height = '';
                }
            }
        });
    }
}

// 初始化
function init() {
    // 从URL获取房间号，如果没有则在设置用户名时处理
    const urlParams = new URLSearchParams(window.location.search);
    const urlRoomId = urlParams.get('room');
    if (urlRoomId) {
        roomId = urlRoomId;
        window.roomId = roomId;
        document.getElementById('roomId').textContent = `房间: ${roomId}`;
    }
    
    setupEventListeners();
    setupRealtimeClient();
    
    // 初始化科大讯飞转录客户端
    window.xfyunClient = new XfyunClient();
    console.log('🎤 科大讯飞转录客户端已初始化');
    
    // 初始化移动端支持
    initMobileSupport();
    initTouchGestures();
    optimizeMobileInput();
    
        // 移动端输入框管理
    if (isMobileDevice()) {
        // 检查欢迎页面状态并相应处理输入框
        const checkWelcomePageAndInput = () => {
            const inputContainer = document.querySelector('.input-container');
            const usernameModal = document.getElementById('usernameModal');
            const isOnWelcomePage = usernameModal && (usernameModal.style.display === 'block' || usernameModal.style.display === 'flex');
            
            if (inputContainer) {
                if (isOnWelcomePage) {
                    // 在欢迎页面时隐藏输入框
                    inputContainer.style.display = 'none';
                } else {
                    // 在正常聊天时显示输入框
                    inputContainer.style.display = 'flex';
                    inputContainer.style.visibility = 'visible';
                    inputContainer.style.opacity = '1';
                    inputContainer.style.position = 'fixed';
                    inputContainer.style.bottom = '0';
                    inputContainer.style.left = '0';
                    inputContainer.style.right = '0';
                    inputContainer.style.zIndex = '9999';
                }
            }
        };
        
        // 初始检查
        setTimeout(checkWelcomePageAndInput, 500);
        
        // 定期检查状态变化
        setInterval(checkWelcomePageAndInput, 1000);
        
        // 监听屏幕方向变化
        window.addEventListener('orientationchange', () => {
            setTimeout(checkWelcomePageAndInput, 100);
        });
        
        // 监听窗口大小变化
        window.addEventListener('resize', () => {
            setTimeout(checkWelcomePageAndInput, 100);
        });
    }


    
    // 确保移动端按钮可见性
    setTimeout(() => {
        if (isMobileDevice()) {
            // 检查是否在欢迎页面，如果是则隐藏输入框
            const usernameModal = document.getElementById('usernameModal');
            const isOnWelcomePage = usernameModal && (usernameModal.style.display === 'block' || usernameModal.style.display === 'flex');
            
            if (isOnWelcomePage) {
                const inputContainer = document.querySelector('.input-container');
                if (inputContainer) {
                    inputContainer.style.display = 'none';
                }
            } else {
                // 确保输入框在正常聊天时始终可见
                const inputContainer = document.querySelector('.input-container');
                if (inputContainer) {
                    inputContainer.style.display = 'flex';
                    inputContainer.style.visibility = 'visible';
                    inputContainer.style.opacity = '1';
                }
                forceMobileInputVisibility();
            }
        }
    }, 1000);
    
    // 检查文档处理库加载状态
    setTimeout(checkDocumentLibraries, 1000); // 延迟1秒确保库完全加载
    
    // 测试XLSX库
    setTimeout(testXLSXLibrary, 1500);
    
    // 初始化语音通话功能
    initVoiceCall();
}

// ==================== 语音通话功能 ====================

// 获取兼容的getUserMedia函数
function getCompatibleGetUserMedia() {
    // 优先使用现代API
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        return (constraints) => navigator.mediaDevices.getUserMedia(constraints);
    }
    
    // 兼容旧版浏览器
    const getUserMedia = navigator.getUserMedia ||
                        navigator.webkitGetUserMedia ||
                        navigator.mozGetUserMedia ||
                        navigator.msGetUserMedia;
    
    if (getUserMedia) {
        return (constraints) => {
            return new Promise((resolve, reject) => {
                getUserMedia.call(navigator, constraints, resolve, reject);
            });
        };
    }
    
    return null;
}

// 检查是否为安全环境
function isSecureEnvironment() {
    return window.isSecureContext || 
           location.protocol === 'https:' || 
           location.hostname === 'localhost' || 
           location.hostname === '127.0.0.1' ||
           /^192\.168\.\d{1,3}\.\d{1,3}$/.test(location.hostname) ||
           /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(location.hostname) ||
           /^172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(location.hostname);
}

// 初始化语音通话
function initVoiceCall() {
    console.log('🎙️ 初始化语音通话功能...');
    
    // 检查浏览器支持 - 检查多种API兼容性
    const getUserMedia = getCompatibleGetUserMedia();
    if (!getUserMedia) {
        console.warn('⚠️ 浏览器不支持语音通话功能');
        showToast('您的浏览器不支持语音通话功能，请使用Chrome、Firefox或Safari', 'warning');
        return;
    }
    
    // 检查环境安全性
    if (!isSecureEnvironment()) {
        console.warn('⚠️ 非安全环境，可能影响麦克风访问');
        showToast('⚠️ HTTP环境可能无法访问麦克风，建议使用localhost或HTTPS', 'warning');
    }
    
    // 初始化WebRTC配置
    window.RTCPeerConnection = window.RTCPeerConnection || 
                              window.webkitRTCPeerConnection || 
                              window.mozRTCPeerConnection;
    
    if (!window.RTCPeerConnection) {
        console.warn('⚠️ 浏览器不支持WebRTC');
        showToast('您的浏览器不支持WebRTC，无法使用语音通话', 'warning');
        return;
    }
    
    // 测试麦克风权限
    testMicrophonePermission();
    
    console.log('✅ 语音通话功能初始化完成');
    
    // 隐藏加载界面
    updateLoadProgress('加载完成');
    setTimeout(hideLoadingOverlay, 500);
}

// 测试麦克风权限
async function testMicrophonePermission() {
    const testMicBtn = document.getElementById('testMicBtn');
    
    try {
        // 在不安全的HTTPS环境下跳过自动测试，避免卡住
        if (window.location.protocol === 'https:' && 
            (window.location.hostname.match(/^\d+\.\d+\.\d+\.\d+$/) || 
             window.location.hostname === 'localhost') &&
            window.location.port === '3443') {
            console.log('🔧 检测到不安全的HTTPS环境，跳过自动麦克风测试');
            if (testMicBtn) {
                testMicBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
                testMicBtn.title = '点击手动测试麦克风（HTTPS证书问题）';
                testMicBtn.style.background = '#f59e0b';
            }
            return;
        }
        
        console.log('🔍 测试麦克风权限...');
        
        // 更新按钮状态
        if (testMicBtn) {
            testMicBtn.classList.add('testing');
            testMicBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            testMicBtn.title = '正在测试麦克风...';
        }
        
        // 检查浏览器支持
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('浏览器不支持getUserMedia API');
        }
        
        // 检查环境安全性
        if (!isSecureEnvironment()) {
            throw new Error('非安全环境无法访问麦克风，请使用localhost访问或部署HTTPS');
        }
        
        // 检查权限API是否可用
        if (navigator.permissions && navigator.permissions.query) {
            try {
                const permissions = await navigator.permissions.query({ name: 'microphone' });
                console.log('麦克风权限状态:', permissions.state);
                
                if (permissions.state === 'denied') {
                    throw new Error('麦克风权限被拒绝，请在浏览器设置中允许麦克风访问');
                }
            } catch (permError) {
                console.warn('权限检查失败，将直接尝试获取麦克风:', permError);
            }
        }
        
        // 尝试获取麦克风权限（不保存流）
        console.log('正在请求麦克风权限...');
        const getUserMedia = getCompatibleGetUserMedia();
        const testStream = await getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        // 立即停止测试流
        testStream.getTracks().forEach(track => track.stop());
        
        console.log('✅ 麦克风权限测试通过');
        showToast('✅ 麦克风权限测试通过，可以正常使用语音通话', 'success');
        
        // 更新按钮状态为成功
        if (testMicBtn) {
            testMicBtn.classList.remove('testing');
            testMicBtn.classList.add('success');
            testMicBtn.innerHTML = '<i class="fas fa-check"></i>';
            testMicBtn.title = '麦克风权限正常';
            testMicBtn.style.background = '#10b981';
            
            // 3秒后恢复原始状态
            setTimeout(() => {
                testMicBtn.classList.remove('success');
                testMicBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
                testMicBtn.title = '测试麦克风';
                testMicBtn.style.background = '';
            }, 3000);
        }
        
    } catch (error) {
        console.warn('⚠️ 麦克风权限测试失败:', error);
        
        let warningMessage = '麦克风权限测试失败';
        
        if (error.name === 'NotAllowedError') {
            warningMessage = '麦克风权限被拒绝，请点击地址栏的麦克风图标并选择"允许"';
        } else if (error.name === 'NotFoundError') {
            warningMessage = '未找到麦克风设备，请检查麦克风连接';
        } else if (error.name === 'NotSupportedError') {
            warningMessage = '浏览器不支持麦克风功能';
        } else if (error.name === 'NotReadableError') {
            warningMessage = '麦克风被其他应用占用，请关闭其他使用麦克风的应用';
        } else if (error.name === 'OverconstrainedError') {
            warningMessage = '麦克风配置不兼容，请尝试刷新页面';
        } else {
            warningMessage = `麦克风测试失败: ${error.message}`;
        }
        
        showToast(warningMessage, 'error');
        
        // 更新按钮状态为失败
        if (testMicBtn) {
            testMicBtn.classList.remove('testing');
            testMicBtn.classList.add('error');
            testMicBtn.innerHTML = '<i class="fas fa-times"></i>';
            testMicBtn.title = '麦克风权限测试失败';
            testMicBtn.style.background = '#ef4444';
            
            // 3秒后恢复原始状态
            setTimeout(() => {
                testMicBtn.classList.remove('error');
                testMicBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
                testMicBtn.title = '测试麦克风';
                testMicBtn.style.background = '';
            }, 3000);
        }
        
        // 显示详细的错误信息
        console.error('详细错误信息:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
    }
}

// 为加入通话专门创建的启动函数
async function startVoiceCallForJoin() {
    try {
        console.log('📞 开始为加入通话获取麦克风权限...');
        
        // 检查浏览器支持 - 兼容多种API
        const getUserMedia = getCompatibleGetUserMedia();
        if (!getUserMedia) {
            throw new Error('浏览器不支持麦克风访问，请使用Chrome、Firefox或Safari浏览器');
        }
        
        // 获取麦克风权限
        console.log('正在请求麦克风权限...');
        localStream = await getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        console.log('✅ 麦克风权限获取成功');
        
        isInCall = true;
        callStartTime = Date.now();
        
        // 清空并重新添加参与者（包括当前用户）
        callParticipants.clear();
        callParticipants.add(currentUserId);
        
        // 如果currentCallState中有其他参与者，也添加进来
        if (currentCallState.participants) {
            currentCallState.participants.forEach(participantId => {
                callParticipants.add(participantId);
            });
        }
        
        // 更新UI
        updateCallUI();
        showCallPanel();
        
        // 同步参与者数据
        syncCallParticipants();
        
        console.log('✅ 成功加入语音通话');
        
        // 新加入的用户需要主动向现有用户发送WebRTC连接请求
        // 遍历currentCallState中的现有参与者，与他们建立连接
        if (currentCallState.participants && currentCallState.participants.length > 1) {
            console.log('📞 向现有通话参与者发送WebRTC连接请求');
            
            currentCallState.participants.forEach(participantId => {
                // 排除自己
                if (participantId !== currentUserId) {
                    console.log('📞 向参与者发送offer:', participantId);
                    
                    const peerConnection = createPeerConnection(participantId);
                    
                    peerConnection.createOffer()
                        .then(offer => peerConnection.setLocalDescription(offer))
                        .then(() => {
                            if (isRealtimeEnabled && window.realtimeClient) {
                                window.realtimeClient.sendCallOffer({
                                    roomId,
                                    targetUserId: participantId,
                                    offer: peerConnection.localDescription,
                                    fromUserId: currentUserId
                                });
                            }
                        })
                        .catch(error => {
                            console.error('❌ 向现有用户发送offer失败:', error);
                        });
                }
            });
        }
        
        // 更新转录按钮状态
        if (typeof onCallStatusChange === 'function') {
            onCallStatusChange();
        }
        
    } catch (error) {
        console.error('❌ 加入语音通话失败:', error);
        isJoiningCall = false; // 重置加入状态
        
        let errorMessage = '无法加入语音通话';
        
        if (error.name === 'NotAllowedError') {
            errorMessage = '麦克风权限被拒绝，请点击地址栏的麦克风图标并选择"允许"';
        } else if (error.name === 'NotFoundError') {
            errorMessage = '未找到麦克风设备，请检查麦克风连接';
        } else if (error.name === 'NotSupportedError') {
            errorMessage = '浏览器不支持语音通话功能';
        } else if (error.name === 'NotReadableError') {
            errorMessage = '麦克风被其他应用占用，请关闭其他使用麦克风的应用';
        } else if (error.name === 'OverconstrainedError') {
            errorMessage = '麦克风配置不兼容，请尝试刷新页面';
        } else {
            errorMessage = error.message;
        }
        
        showToast(errorMessage, 'error');
    }
}

// 切换语音通话状态
function toggleVoiceCall() {
    if (isInCall) {
        endVoiceCall();
    } else {
        startVoiceCall();
    }
}

// 开始语音通话
async function startVoiceCall() {
    try {
        console.log('📞 开始语音通话...');
        
        // 检查浏览器支持 - 兼容多种API
        const getUserMedia = getCompatibleGetUserMedia();
        if (!getUserMedia) {
            throw new Error('浏览器不支持麦克风访问，请使用Chrome、Firefox或Safari浏览器');
        }
        
        // 检查环境安全性
        if (!isSecureEnvironment()) {
            throw new Error('非安全环境无法访问麦克风。解决方案：\n1. 使用 http://localhost:3001 访问\n2. 或部署HTTPS服务');
        }
        
        // 检查麦克风权限（如果支持）
        if (navigator.permissions && navigator.permissions.query) {
            try {
                const permissions = await navigator.permissions.query({ name: 'microphone' });
                console.log('麦克风权限状态:', permissions.state);
                
                if (permissions.state === 'denied') {
                    throw new Error('麦克风权限已被拒绝，请在浏览器设置中允许麦克风访问');
                }
            } catch (permError) {
                console.warn('权限检查失败，将直接尝试获取麦克风:', permError);
            }
        }
        
        // 获取麦克风权限
        console.log('正在请求麦克风权限...');
        localStream = await getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        console.log('✅ 麦克风权限获取成功');
        
        isInCall = true;
        callStartTime = Date.now();
        
        // 清空并重新添加参与者
        callParticipants.clear();
        callParticipants.add(currentUserId);
        
        // 更新UI
        updateCallUI();
        showCallPanel();
        
        // 同步参与者数据
        syncCallParticipants();
        
        // 通知其他用户加入通话
        console.log('📞 发送通话邀请，roomId:', roomId, 'currentUserId:', currentUserId, 'currentUsername:', currentUsername);
        if (isRealtimeEnabled && window.realtimeClient) {
            window.realtimeClient.sendCallInvite({
                roomId,
                callerId: currentUserId,
                callerName: currentUsername
            });
        } else {
            console.warn('⚠️ 实时通信未启用或客户端未初始化');
        }
        
        showToast('语音通话已开始', 'success');
        console.log('✅ 语音通话已启动');
        
        // 更新转录按钮状态
        if (typeof onCallStatusChange === 'function') {
            onCallStatusChange();
        }
        
    } catch (error) {
        console.error('❌ 启动语音通话失败:', error);
        
        let errorMessage = '无法启动语音通话';
        
        if (error.name === 'NotAllowedError') {
            errorMessage = '麦克风权限被拒绝，请点击地址栏的麦克风图标并选择"允许"';
        } else if (error.name === 'NotFoundError') {
            errorMessage = '未找到麦克风设备，请检查麦克风连接';
        } else if (error.name === 'NotSupportedError') {
            errorMessage = '浏览器不支持语音通话功能';
        } else if (error.name === 'NotReadableError') {
            errorMessage = '麦克风被其他应用占用，请关闭其他使用麦克风的应用';
        } else if (error.name === 'OverconstrainedError') {
            errorMessage = '麦克风配置不兼容，请尝试刷新页面';
        } else {
            errorMessage = `启动语音通话失败: ${error.message}`;
        }
        
        showToast(errorMessage, 'error');
        
        // 显示详细的错误信息
        console.error('详细错误信息:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
    }
}

// 清理通话资源（不发送事件）
function cleanupCallResources() {
    console.log('📞 清理通话资源...');
    
    // 停止本地流
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    // 关闭所有对等连接
    peerConnections.forEach((connection, userId) => {
        connection.close();
    });
    peerConnections.clear();
    remoteStreams.clear();
    
    // 重置状态
    isInCall = false;
    isMuted = false;
    callParticipants.clear();
    callStartTime = null;
    callDuration = null;
    
    // 更新UI
    updateCallUI();
    hideCallPanel();
    
    showToast('语音通话已结束', 'info');
    console.log('✅ 通话资源已清理');
    
    // 更新转录按钮状态（禁用转录功能）
    if (typeof onCallStatusChange === 'function') {
        onCallStatusChange();
    }
}

// 结束语音通话
function endVoiceCall() {
    console.log('📞 结束语音通话...');
    
    // 清理资源
    cleanupCallResources();
    
    // 通知其他用户结束通话
    if (isRealtimeEnabled && window.realtimeClient) {
        window.realtimeClient.sendCallEnd({
            roomId,
            userId: currentUserId
        });
    }
    
    console.log('✅ 语音通话已结束');
}

// 接受通话邀请
async function acceptCall() {
    try {
        console.log('📞 接受通话邀请...');
        
        // 检查浏览器支持 - 兼容多种API
        const getUserMedia = getCompatibleGetUserMedia();
        if (!getUserMedia) {
            throw new Error('浏览器不支持麦克风访问，请使用Chrome、Firefox或Safari浏览器');
        }
        
        // 检查环境安全性
        if (!isSecureEnvironment()) {
            throw new Error('非安全环境无法访问麦克风。解决方案：\n1. 使用 http://localhost:3001 访问\n2. 或部署HTTPS服务');
        }
        
        // 检查麦克风权限（如果支持）
        if (navigator.permissions && navigator.permissions.query) {
            try {
                const permissions = await navigator.permissions.query({ name: 'microphone' });
                console.log('麦克风权限状态:', permissions.state);
                
                if (permissions.state === 'denied') {
                    throw new Error('麦克风权限已被拒绝，请在浏览器设置中允许麦克风访问');
                }
            } catch (permError) {
                console.warn('权限检查失败，将直接尝试获取麦克风:', permError);
            }
        }
        
        // 获取麦克风权限
        console.log('正在请求麦克风权限...');
        localStream = await getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        console.log('✅ 麦克风权限获取成功');
        
        isInCall = true;
        callStartTime = Date.now();
        callParticipants.add(currentUserId);
        
        // 如果有来电数据，将呼叫者也添加到参与者列表
        if (window.incomingCallData && window.incomingCallData.callerId) {
            callParticipants.add(window.incomingCallData.callerId);
            console.log('📞 添加呼叫者到参与者列表:', window.incomingCallData.callerId);
        }
        
        // 更新UI
        updateCallUI();
        showCallPanel();
        hideIncomingCallModal();
        
        // 同步参与者数据
        syncCallParticipants();
        
        // 通知发起者已接受
        if (isRealtimeEnabled && window.realtimeClient) {
            window.realtimeClient.sendCallAccept({
                roomId,
                userId: currentUserId,
                userName: currentUsername
            });
        }
        
        showToast('已加入语音通话', 'success');
        console.log('✅ 已接受通话邀请');
        
        // 更新转录按钮状态
        if (typeof onCallStatusChange === 'function') {
            onCallStatusChange();
        }
        
    } catch (error) {
        console.error('❌ 接受通话失败:', error);
        showToast('无法加入通话，请检查麦克风权限', 'error');
    }
}

// 拒绝通话邀请
function rejectCall() {
    console.log('📞 拒绝通话邀请...');
    
    hideIncomingCallModal();
    
    // 通知发起者已拒绝
    if (isRealtimeEnabled && window.realtimeClient) {
        window.realtimeClient.sendCallReject({
            roomId,
            userId: currentUserId
        });
    }
    
    showToast('已拒绝通话邀请', 'info');
}

// 切换静音状态
function toggleMute() {
    if (!localStream) return;
    
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
    });
    
    // 更新UI
    const muteBtn = document.getElementById('muteBtn');
    if (muteBtn) {
        muteBtn.classList.toggle('muted', isMuted);
        muteBtn.innerHTML = isMuted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
        muteBtn.style.background = isMuted ? '#ef4444' : '#10b981';
    }
    
    // 更新通话参与者列表中的状态
    updateCallParticipants();
    
    // 通知其他用户静音状态变化
    if (isRealtimeEnabled && window.realtimeClient) {
        window.realtimeClient.sendMuteStatus({
            roomId,
            userId: currentUserId,
            isMuted
        });
    }
    
    showToast(isMuted ? '已静音' : '已取消静音', 'info');
}

// 切换扬声器状态
function toggleSpeaker() {
    isSpeakerOn = !isSpeakerOn;
    
    // 更新UI
    const speakerBtn = document.getElementById('speakerBtn');
    if (speakerBtn) {
        speakerBtn.innerHTML = isSpeakerOn ? '<i class="fas fa-volume-up"></i>' : '<i class="fas fa-volume-mute"></i>';
    }
    
    showToast(isSpeakerOn ? '扬声器已开启' : '扬声器已关闭', 'info');
}

// 显示通话面板
function showCallPanel() {
    const callPanel = document.getElementById('voiceCallPanel');
    if (callPanel) {
        callPanel.style.display = 'block';
    }
    
    // 更新通话按钮状态
    const callBtn = document.getElementById('callBtn');
    if (callBtn) {
        callBtn.classList.add('in-call');
        callBtn.innerHTML = '<i class="fas fa-phone-slash"></i>';
    }
    
    // 开始计时
    startCallTimer();
}

// 隐藏通话面板
function hideCallPanel() {
    const callPanel = document.getElementById('voiceCallPanel');
    if (callPanel) {
        callPanel.style.display = 'none';
    }
    
    // 更新通话按钮状态
    const callBtn = document.getElementById('callBtn');
    if (callBtn) {
        callBtn.classList.remove('in-call');
        callBtn.innerHTML = '<i class="fas fa-phone"></i>';
    }
    
    // 停止计时
    stopCallTimer();
}

// 显示来电提示
function showIncomingCallModal(callerName) {
    const modal = document.getElementById('incomingCallModal');
    const callerNameElement = document.getElementById('incomingCallerName');
    
    if (modal && callerNameElement) {
        callerNameElement.textContent = callerName;
        modal.style.display = 'flex';
        
        // 播放来电铃声（可选）
        // playIncomingCallSound();
    }
}

// 隐藏来电提示
function hideIncomingCallModal() {
    const modal = document.getElementById('incomingCallModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// 更新通话UI
function updateCallUI() {
    updateCallParticipants();
    updateCallDuration();
}

// 更新通话时长显示
function updateCallDuration() {
    const durationElement = document.getElementById('callDuration');
    if (!durationElement) return;
    
    if (callStartTime && isInCall) {
        const duration = Math.floor((Date.now() - callStartTime) / 1000);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        durationElement.textContent = timeString;
    } else {
        durationElement.textContent = '00:00';
    }
}

// 更新通话参与者列表
function updateCallParticipants() {
    const participantsList = document.getElementById('callParticipantsList');
    const participantsCount = document.getElementById('callParticipants');
    
    if (!participantsList) return;
    
    participantsList.innerHTML = '';
    
    // 添加当前用户
    const currentUserDiv = document.createElement('div');
    currentUserDiv.className = 'call-participant';
    currentUserDiv.innerHTML = `
        <div class="call-participant-avatar">${currentUsername.charAt(0).toUpperCase()}</div>
        <div class="call-participant-info">
            <div class="call-participant-name">${currentUsername} (我)</div>
            <div class="call-participant-status ${isMuted ? 'muted' : 'online'}">
                <i class="fas fa-${isMuted ? 'microphone-slash' : 'microphone'}"></i>
                ${isMuted ? '已静音' : '在线'}
            </div>
        </div>
    `;
    participantsList.appendChild(currentUserDiv);
    
    // 添加其他参与者
    let otherParticipantsCount = 0;
    callParticipants.forEach(participantId => {
        if (participantId !== currentUserId) {
            // 首先尝试从参与者列表中找到
            let participant = participants.find(p => p.userId === participantId);
            
            // 如果找不到，创建一个临时的参与者对象
            if (!participant) {
                // 尝试从实时通信客户端获取用户信息
                if (window.realtimeClient && window.realtimeClient.socket) {
                    // 创建一个基于用户ID的临时参与者对象
                    participant = {
                        userId: participantId,
                        name: `用户${participantId.slice(-4)}`, // 使用用户ID的后4位作为显示名
                        status: 'online'
                    };
                } else {
                    // 如果无法获取用户信息，跳过这个参与者
                    console.warn(`无法找到参与者信息: ${participantId}`);
                    return;
                }
            }
            
            const participantDiv = document.createElement('div');
            participantDiv.className = 'call-participant';
            participantDiv.innerHTML = `
                <div class="call-participant-avatar">${participant.name.charAt(0).toUpperCase()}</div>
                <div class="call-participant-info">
                    <div class="call-participant-name">${participant.name}</div>
                    <div class="call-participant-status ${participant.isMuted ? 'muted' : 'online'}">
                        <i class="fas fa-${participant.isMuted ? 'microphone-slash' : 'microphone'}"></i>
                        ${participant.isMuted ? '已静音' : '在线'}
                    </div>
                </div>
            `;
            participantsList.appendChild(participantDiv);
            otherParticipantsCount++;
        }
    });
    
    // 更新参与者数量 - 确保显示正确的数量
    if (participantsCount) {
        const totalParticipants = callParticipants.size;
        participantsCount.textContent = `${totalParticipants} 人参与`;
        
        // 添加调试信息
        console.log(`📞 通话参与者更新:`, {
            callParticipantsSize: callParticipants.size,
            callParticipantsIds: Array.from(callParticipants),
            participantsArrayLength: participants.length,
            participantsIds: participants.map(p => p.userId),
            otherParticipantsCount,
            currentUserId
        });
    }
}

// 开始通话计时
function startCallTimer() {
    if (callDuration) return; // 避免重复启动
    
    callDuration = setInterval(() => {
        if (callStartTime) {
            const duration = Math.floor((Date.now() - callStartTime) / 1000);
            const minutes = Math.floor(duration / 60);
            const seconds = duration % 60;
            const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            
            const durationElement = document.getElementById('callDuration');
            if (durationElement) {
                durationElement.textContent = timeString;
            }
        }
    }, 1000);
}

// 停止通话计时
function stopCallTimer() {
    if (callDuration) {
        clearInterval(callDuration);
        callDuration = null;
    }
    
    const durationElement = document.getElementById('callDuration');
    if (durationElement) {
        durationElement.textContent = '00:00';
    }
}

// WebRTC连接处理
function createPeerConnection(userId) {
    const configuration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };
    
    const peerConnection = new RTCPeerConnection(configuration);
    
    // 添加本地流
    if (localStream) {
        localStream.getTracks().forEach(track => {
            console.log('📞 添加音频轨道到对等连接:', track.kind, track.enabled);
            peerConnection.addTrack(track, localStream);
        });
    }
    
    // 处理远程流
    peerConnection.ontrack = (event) => {
        console.log('📞 收到远程音频流:', userId, event.streams[0].getTracks());
        remoteStreams.set(userId, event.streams[0]);
        
        // 播放远程音频
        const audioElement = document.createElement('audio');
        audioElement.srcObject = event.streams[0];
        audioElement.autoplay = true;
        audioElement.muted = !isSpeakerOn;
        audioElement.volume = 1.0;
        
        // 添加音频事件监听
        audioElement.onloadedmetadata = () => {
            console.log('📞 远程音频元数据加载完成');
        };
        
        audioElement.onplay = () => {
            console.log('📞 远程音频开始播放');
        };
        
        audioElement.onerror = (error) => {
            console.error('📞 远程音频播放错误:', error);
        };
        
        document.body.appendChild(audioElement);
    };
    
    // 处理ICE候选
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            if (isRealtimeEnabled && window.realtimeClient) {
                window.realtimeClient.sendIceCandidate({
                    roomId,
                    targetUserId: userId,
                    candidate: event.candidate,
                    fromUserId: currentUserId
                });
            }
        }
    };

    // 若在设置远程描述之前就收到了ICE候选，需要一个缓冲区
    peerConnection.pendingIceCandidates = [];
    
    peerConnections.set(userId, peerConnection);
    return peerConnection;
}

// 处理通话邀请
function handleCallInvite(data) {
    console.log('📞 收到通话邀请:', data);
    console.log('📞 当前用户ID:', currentUserId, '当前用户名:', currentUsername);
    console.log('📞 是否已在通话中:', isInCall);
    
    if (isInCall) {
        // 如果已在通话中，自动拒绝
        console.log('📞 已在通话中，自动拒绝邀请');
        if (isRealtimeEnabled && window.realtimeClient) {
            window.realtimeClient.sendCallReject({
                roomId,
                userId: currentUserId,
                reason: 'busy'
            });
        }
        return;
    }
    
    // 保存呼叫者信息，用于后续处理
    window.incomingCallData = data;
    
    console.log('📞 显示来电提示，呼叫者:', data.callerName);
    showIncomingCallModal(data.callerName);
}

// 处理通话接受
function handleCallAccept(data) {
    console.log('📞 用户接受通话:', data);
    
    callParticipants.add(data.userId);
    
    // 确保当前用户也在参与者列表中
    if (!callParticipants.has(currentUserId)) {
        callParticipants.add(currentUserId);
    }
    
    updateCallUI();
    
    // 创建对等连接
    const peerConnection = createPeerConnection(data.userId);
    
    // 创建并发送offer
    peerConnection.createOffer()
        .then(offer => peerConnection.setLocalDescription(offer))
        .then(() => {
            if (isRealtimeEnabled && window.realtimeClient) {
                window.realtimeClient.sendCallOffer({
                    roomId,
                    targetUserId: data.userId,
                    offer: peerConnection.localDescription,
                    fromUserId: currentUserId
                });
            }
        })
        .catch(error => {
            console.error('❌ 创建offer失败:', error);
        });
}

// 处理通话拒绝
function handleCallReject(data) {
    console.log('📞 用户拒绝通话:', data);
    
    callParticipants.delete(data.userId);
    updateCallUI();
    
    if (data.reason === 'busy') {
        showToast('对方正在通话中', 'warning');
    }
}

// 处理通话结束
function handleCallEnd(data) {
    // 临时注释掉日志以减少输出
    // console.log('📞 用户结束通话:', data);
    
    // 防止重复处理同一个用户的结束事件
    if (!callParticipants.has(data.userId)) {
        console.log('📞 用户已离开通话，跳过重复处理');
        return;
    }
    
    callParticipants.delete(data.userId);
    
    // 关闭对等连接
    const peerConnection = peerConnections.get(data.userId);
    if (peerConnection) {
        peerConnection.close();
        peerConnections.delete(data.userId);
    }
    
    // 移除远程流
    remoteStreams.delete(data.userId);
    
    updateCallUI();
    
    // 只有当自己是最后一个参与者时才结束通话，避免循环触发
    if (callParticipants.size <= 1 && callParticipants.has(currentUserId)) {
        console.log('📞 只剩自己，结束通话');
        // 直接清理资源，不发送callEnd事件
        cleanupCallResources();
    }
}

// 同步通话参与者数据
function syncCallParticipants() {
    if (!isInCall) return;
    
    // 确保当前用户在参与者列表中
    if (!callParticipants.has(currentUserId)) {
        callParticipants.add(currentUserId);
    }
    
    // 更新UI
    updateCallUI();
    
    console.log('📞 同步通话参与者数据:', {
        callParticipantsSize: callParticipants.size,
        callParticipantsIds: Array.from(callParticipants),
        currentUserId
    });
}

// 处理WebRTC offer
async function handleCallOffer(data) {
    console.log('📞 收到WebRTC offer:', data);
    
    const peerConnection = createPeerConnection(data.fromUserId);
    
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        if (isRealtimeEnabled && window.realtimeClient) {
            window.realtimeClient.sendCallAnswer({
                roomId,
                targetUserId: data.fromUserId,
                answer: peerConnection.localDescription,
                fromUserId: currentUserId
            });
        }
        // 在设置完远程描述后，若有暂存的ICE候选，立即刷新处理
        if (peerConnection.pendingIceCandidates && peerConnection.pendingIceCandidates.length > 0) {
            console.log('📞 offer流程完成后，处理暂存的ICE候选:', peerConnection.pendingIceCandidates.length);
            for (const candidate of peerConnection.pendingIceCandidates) {
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (err) {
                    console.error('❌ 添加暂存ICE候选失败:', err);
                }
            }
            peerConnection.pendingIceCandidates = [];
        }
    } catch (error) {
        console.error('❌ 处理offer失败:', error);
    }
}

// 处理WebRTC answer
async function handleCallAnswer(data) {
    console.log('📞 收到WebRTC answer:', data);
    
    const peerConnection = peerConnections.get(data.fromUserId);
    if (peerConnection) {
        try {
            // 检查连接状态，只有在have-local-offer状态下才能设置远程描述
            if (peerConnection.signalingState === 'have-local-offer') {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
                console.log('✅ Answer设置成功，信令状态:', peerConnection.signalingState);
                
                // 处理暂存的ICE候选
                if (peerConnection.pendingIceCandidates && peerConnection.pendingIceCandidates.length > 0) {
                    console.log('📞 处理暂存的ICE候选:', peerConnection.pendingIceCandidates.length);
                    for (const candidate of peerConnection.pendingIceCandidates) {
                        try {
                            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                        } catch (error) {
                            console.error('❌ 添加暂存ICE候选失败:', error);
                        }
                    }
                    peerConnection.pendingIceCandidates = [];
                }
            } else {
                console.warn('⚠️ 信令状态不正确，无法设置answer:', peerConnection.signalingState);
            }
        } catch (error) {
            console.error('❌ 处理answer失败:', error);
        }
    }
}

// 处理ICE候选
async function handleIceCandidate(data) {
    console.log('📞 收到ICE候选:', data);
    
    const peerConnection = peerConnections.get(data.fromUserId);
    if (peerConnection) {
        try {
            // 检查连接状态，确保远程描述已设置
            if (peerConnection.remoteDescription) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                console.log('✅ ICE候选添加成功');
            } else {
                // 如果远程描述还未设置，将ICE候选存储起来稍后处理
                console.warn('⚠️ 远程描述未设置，暂存ICE候选');
                if (!peerConnection.pendingIceCandidates) {
                    peerConnection.pendingIceCandidates = [];
                }
                peerConnection.pendingIceCandidates.push(data.candidate);
            }
        } catch (error) {
            console.error('❌ 添加ICE候选失败:', error);
        }
    }
}

// 处理静音状态
function handleMuteStatus(data) {
    console.log('📞 收到静音状态:', data);
    
    // 更新参与者列表中的静音状态
    const participant = participants.find(p => p.userId === data.userId);
    if (participant) {
        participant.isMuted = data.isMuted;
        updateCallParticipants();
    }
}

// 处理转录状态变化
function handleTranscriptionStatusChange(data) {
    console.log('📝 转录状态变化:', data);
    
    if (data.action === 'start') {
        showToast(`${data.username} 开始了转录`, 'info');
        console.log(`📝 ${data.username} 开始转录`);
    } else if (data.action === 'stop') {
        showToast(`${data.username} 停止了转录`, 'info');
        console.log(`📝 ${data.username} 停止转录`);
    }
}

// 处理转录结果
function handleTranscriptionResult(data) {
    console.log('📝 收到转录结果:', data);
    
    if (data.type === 'xfyun') {
        // 显示转录结果到实时记录框
        displayTranscriptionResult(data);
        
        // 如果不是临时结果，更新全局转录文本用于下载
        if (!data.isPartial && data.result) {
            updateGlobalTranscriptionText(data);
        }
    }
}

// 显示转录结果到实时记录框
function displayTranscriptionResult(data) {
    const transcriptionHistory = document.getElementById('transcriptionHistory');
    if (!transcriptionHistory) return;
    
    // 隐藏占位符
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
    
    // 初始化全局转录文本（如果不存在）
    if (!window.transcriptionClient) {
        window.transcriptionClient = { fullTranscriptionText: '' };
    }
    
    // 避免重复：检查是否已经包含在全文中
    if (data.result && data.result.trim()) {
        const cleanText = data.result.trim();
        if (window.transcriptionClient.fullTranscriptionText.includes(cleanText)) {
            console.log('🚫 跳过重复的转录结果:', cleanText);
            return;
        }
    }
    
    if (data.isPartial) {
        // 临时结果：显示为蓝色动画预览
        const finalText = window.transcriptionClient.fullTranscriptionText;
        const previewHtml = finalText + 
            '<span class="current-preview" style="color: #2563eb; background: rgba(37, 99, 235, 0.15); padding: 2px 4px; border-radius: 3px; animation: pulse 1.5s infinite;">' + 
            data.result + '</span>';
        cumulativeDiv.innerHTML = previewHtml;
    } else {
        // 最终结果：添加到累积文本
        if (data.result && data.result.trim()) {
            if (window.transcriptionClient.fullTranscriptionText.length > 0) {
                window.transcriptionClient.fullTranscriptionText += ' ';
            }
            window.transcriptionClient.fullTranscriptionText += data.result.trim();
            cumulativeDiv.textContent = window.transcriptionClient.fullTranscriptionText;
            
            // 显示下载按钮
            const downloadBtn = document.getElementById('downloadBtn');
            if (downloadBtn && window.transcriptionClient.fullTranscriptionText.length > 0) {
                downloadBtn.style.display = 'block';
            }
        }
    }
    
    // 自动滚动到底部
    transcriptionHistory.scrollTop = transcriptionHistory.scrollHeight;
}

// 更新全局转录文本（用于下载）
function updateGlobalTranscriptionText(data) {
    if (!window.transcriptionClient) {
        window.transcriptionClient = { fullTranscriptionText: '' };
    }
    
    if (data.result && data.result.trim()) {
        // 避免重复添加相同内容
        const newText = data.result.trim();
        if (!window.transcriptionClient.fullTranscriptionText.includes(newText)) {
            if (window.transcriptionClient.fullTranscriptionText.length > 0) {
                window.transcriptionClient.fullTranscriptionText += ' ';
            }
            window.transcriptionClient.fullTranscriptionText += newText;
            
            console.log('📝 已更新全局转录文本，总长度:', window.transcriptionClient.fullTranscriptionText.length);
        }
    }
}
    
    showUsernameModal();
    registerServiceWorker();
    setupOfflineIndicator();
    

    
    // 监听localStorage变化，实现跨标签页同步
    window.addEventListener('storage', handleStorageChange);
    
    // 定期同步参与者在线状态
    setInterval(syncParticipantsStatus, 30000);
    
    // 定期同步通话参与者数据
    setInterval(() => {
        if (isInCall) {
            syncCallParticipants();
        }
    }, 5000);
    
    // Hugging Face环境提示
    if (window.location.hostname.includes('huggingface.co')) {
        // 显示侧边栏提示
        const hfNotice = document.getElementById('hfNotice');
        if (hfNotice) {
            hfNotice.style.display = 'block';
        }
        
        setTimeout(() => {
            showToast('💡 提示：现在支持多端实时聊天！配置WebSocket服务器后即可使用', 'info');
        }, 3000);
    }
// 设置事件监听器
function setupEventListeners() {
    messageInput.addEventListener('keydown', handleKeyDown);
    messageInput.addEventListener('input', autoResizeTextarea);
    
    // 实时输入提示 - 优化版本
    messageInput.addEventListener('input', handleTypingIndicator);
    
    // 处理输入法事件，减少输入法状态变化的影响
    messageInput.addEventListener('compositionstart', () => {
        // 输入法开始输入时，暂时不发送输入提示
        if (typingTimeout) {
            clearTimeout(typingTimeout);
        }
    });
    
    messageInput.addEventListener('compositionend', () => {
        // 输入法结束输入时，延迟发送输入提示
        setTimeout(() => {
            if (messageInput.value.trim()) {
                handleTypingIndicator();
            }
        }, 300);
    });
    
    // 用户名输入事件
    usernameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            setUsername();
        }
    });
    
    // 点击外部关闭模态框
    askAIModal.addEventListener('click', (e) => {
        if (e.target === askAIModal) {
            closeAskAIModal();
        }
    });
    
    // 参与者搜索功能
    const participantsSearch = document.getElementById('participantsSearch');
    if (participantsSearch) {
        participantsSearch.addEventListener('input', (e) => {
            filterParticipants(e.target.value);
        });
    }
    
    // 聊天记录搜索功能
    const chatSearchInput = document.getElementById('chatSearchInput');
    if (chatSearchInput) {
        chatSearchInput.addEventListener('input', (e) => {
            searchChatMessages(e.target.value);
        });
    }
}

// 处理键盘事件
function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

// 处理输入提示 - 优化版本
let lastTypingTime = 0;
let typingState = false;

function handleTypingIndicator() {
    if (!isRealtimeEnabled || !window.realtimeClient) return;
    
    const now = Date.now();
    
    // 防止过于频繁的状态更新（至少间隔500ms）
    if (now - lastTypingTime < 500) {
        return;
    }
    
    lastTypingTime = now;
    
    // 如果当前不在输入状态，才发送开始输入信号
    if (!typingState) {
        typingState = true;
        window.realtimeClient.sendTypingIndicator(true);
    }
    
    // 清除之前的定时器
    if (typingTimeout) {
        clearTimeout(typingTimeout);
    }
    
    // 3秒后停止输入提示（增加延迟）
    typingTimeout = setTimeout(() => {
        if (window.realtimeClient && typingState) {
            typingState = false;
            window.realtimeClient.sendTypingIndicator(false);
        }
    }, 3000);
}

// 自动调整文本框大小
function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
}

// 设置实时客户端
function setupRealtimeClient() {
    if (!window.realtimeClient) {
        console.warn('实时客户端未加载');
        return;
    }
    
    // 设置事件处理器
    window.realtimeClient.setEventHandlers({
        onConnectionChange: (isConnected) => {
            isRealtimeEnabled = isConnected;
            updateConnectionStatus(isConnected);
            // 连接成功后，如果用户与房间信息已确定但尚未加入，则立即加入
            if (isConnected && currentUsername && roomId && window.realtimeClient && !window.realtimeClient.localMode) {
                if (window.realtimeClient.currentRoomId !== roomId || window.realtimeClient.currentUserId !== currentUserId) {
                    window.realtimeClient.joinRoom(roomId, currentUserId, currentUsername);
                }
            }
        },
        
        onRoomData: async (data) => {
            console.log('收到房间数据:', data);
            
            // 保存房间信息和创建者状态
            if (data.roomInfo) {
                window.currentRoomInfo = data.roomInfo;
                window.isCreator = data.isCreator;
                console.log('房间信息:', data.roomInfo, '是否创建者:', data.isCreator);
                
                // 更新转录按钮状态（创建者状态变化时）
                if (typeof onCallStatusChange === 'function') {
                    onCallStatusChange();
                }
            }
            
            // 处理通话状态信息
            if (data.callState) {
                console.log('收到通话状态信息:', data.callState);
                currentCallState = data.callState;
                
                // 延迟更新UI，确保DOM已准备好
                setTimeout(() => {
                    console.log('更新通话UI（聊天栏），当前状态:', currentCallState);
                    updateCallStatusInChat();
                }, 200);
            }
            
            // 智能合并消息列表（优先服务器数据，但保留本地较新的消息）
            if (data.messages && data.messages.length > 0) {
                // 如果服务器有更多消息，使用服务器数据
                if (data.messages.length > messages.length) {
                    messagesContainer.innerHTML = '';
                    messages = data.messages;
                    
                    // 处理文件消息：恢复文件URL
                    for (const msg of messages) {
                        if (msg.type === 'file' && msg.file && msg.file.base64 && !msg.file.url) {
                            try {
                                // 将base64转换为Blob并创建URL
                                const response = await fetch(msg.file.base64);
                                const blob = await response.blob();
                                msg.file.url = URL.createObjectURL(blob);
                            } catch (error) {
                                console.error('恢复文件URL失败:', error);
                            }
                        }
                    }
                    
                    messages.forEach(msg => renderMessage(msg));
                    scrollToBottom();
                    // 同步到本地存储
                    saveRoomData();
                    showToast('已同步服务器数据', 'success');
                }
            }
            
            // 智能合并参与者列表
            if (data.participants) {
                // 直接使用服务器返回的参与者列表，避免重复添加
                participants = data.participants;
                renderParticipants();
            }
        },
        
        onMessageReceived: async (message) => {
            console.log('收到新消息:', message);
            
            // 避免重复显示自己发送的消息
            if (message.userId !== currentUserId) {
                // 检查是否是重复的AI消息（防止AI回复重复显示）
                if (message.userId === 'ai-assistant') {
                    // 如果这个AI回复是当前用户触发的，跳过（因为本地已经显示了）
                    if (message.originUserId === currentUserId) {
                        console.log('跳过自己触发的AI消息重复显示:', message.text.substring(0, 30) + '...');
                        return;
                    }
                    
                    // 简化的重复检测：检查相同内容的AI消息（最近1分钟内）
                    const isDuplicate = messages.some(existingMsg => 
                        existingMsg.type === 'ai' && 
                        existingMsg.author === 'AI助手' &&
                        existingMsg.text === message.text
                    );
                    
                    if (isDuplicate) {
                        console.log('跳过重复的AI消息:', message.text.substring(0, 30) + '...');
                        return;
                    }
                }
                
                // 检查是否是重复的文件消息（防止文件重复显示）
                if (message.type === 'file') {
                    const isDuplicateFile = messages.some(existingMsg => 
                        existingMsg.type === 'file' && 
                        existingMsg.file && 
                        existingMsg.file.name === message.file.name &&
                        existingMsg.userId === message.userId &&
                        Math.abs(new Date() - new Date(existingMsg.time)) < 5000 // 5秒内
                    );
                    
                    if (isDuplicateFile) {
                        console.log('跳过重复的文件消息:', message.file.name);
                        return;
                    }
                
                // 处理文件消息：如果有base64数据但没有URL，创建可用的URL
                    if (message.file && message.file.base64 && !message.file.url) {
                    try {
                        // 将base64转换为Blob并创建URL
                        const response = await fetch(message.file.base64);
                        const blob = await response.blob();
                        message.file.url = URL.createObjectURL(blob);
                        console.log('为接收的文件创建了可用URL');
                    } catch (error) {
                        console.error('处理接收的文件失败:', error);
                        }
                    }
                }
                
                // 确保接收到的消息有时间戳，如果没有则添加
                if (!message.timestamp && message.time) {
                    // 如果只有time字段，尝试解析为时间戳
                    try {
                        const timeParts = message.time.split(':');
                        if (timeParts.length === 2) {
                            const now = new Date();
                            const messageTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 
                                parseInt(timeParts[0]), parseInt(timeParts[1]));
                            message.timestamp = messageTime.getTime();
                        }
                    } catch (e) {
                        // 如果解析失败，使用当前时间
                        message.timestamp = Date.now();
                    }
                } else if (!message.timestamp) {
                    // 如果完全没有时间信息，使用当前时间
                    message.timestamp = Date.now();
                }
                
                messages.push(message);
                renderMessage(message);
                scrollToBottom();
                
                // 同时保存到本地存储作为备份
                saveRoomData();
            }
        },
        
        onParticipantsUpdate: (participantsList) => {
            console.log('参与者列表更新:', participantsList);
            participants = participantsList;
            renderParticipants();
        },
        
        onUserJoined: (user) => {
            console.log('用户加入:', user);
            showToast(`${user.name} 加入了会议`, 'info');
        },
        
        onUserLeft: (data) => {
            console.log('用户离开:', data);
            const user = participants.find(p => p.userId === data.userId);
            if (user) {
                showToast(`${user.name} 离开了会议`, 'info');
            }
        },
        
        onMeetingEnded: (data) => {
            console.log('会议已结束:', data);
            showToast(data.message, 'warning', 5000);
            
            // 清理本地数据
            messages = [];
            participants = [];
            window.currentRoomInfo = null;
            window.isCreator = false;
            
            // 清理UI
            messagesContainer.innerHTML = '';
            renderParticipants();
            
            // 清理localStorage
            const storageKey = `meeting_${roomId}`;
            localStorage.removeItem(storageKey);
            
            // 3秒后跳转到首页
            setTimeout(() => {
                window.location.href = '/';
            }, 3000);
        },
        
        onEndMeetingSuccess: (data) => {
            console.log('会议结束成功:', data);
            showToast(data.message, 'success');
        },
        
        onUserTyping: (data) => {
            if (data.userId !== currentUserId) {
                showTypingIndicator(data);
            }
        },
        
        // 科大讯飞转录事件处理
        onXfyunConnected: (data) => {
            console.log('✅ 科大讯飞连接成功:', data);
            showToast('科大讯飞转录服务已连接', 'success');
        },
        
        onXfyunResult: (data) => {
            console.log('📝 科大讯飞转录结果:', data);
            if (data.success && data.data) {
                handleXfyunResult(data.data);
            }
        },
        
        onXfyunError: (data) => {
            console.error('❌ 科大讯飞转录错误:', data);
            showToast('转录服务错误: ' + data.error, 'error');
            
            // 自动停止转录
            if (window.xfyunClient && window.xfyunClient.isRecording) {
                window.xfyunClient.stopRecording();
            }
        },
        
        // 通话状态更新
        onCallStateUpdate: (data) => {
            console.log('通话状态更新:', data);
            if (data.roomId === roomId) {
                currentCallState = data.callState;
                // 推导当前用户是否在通话中
                if (currentCallState && Array.isArray(currentCallState.participants)) {
                    currentCallState.isUserInCall = currentCallState.participants.includes(currentUserId);
                }
                // 延迟更新聊天栏提示
                setTimeout(() => updateCallStatusInChat(), 100);
            }
        },
        
        // 用户加入通话成功
        onJoinCallSuccess: (data) => {
            console.log('加入通话成功:', data);
            isJoiningCall = false; // 重置加入状态
            currentCallState = data.callState;
            currentCallState.isUserInCall = true;
            
            // 直接启动通话流程，但需要先获取麦克风权限
            startVoiceCallForJoin();
            showToast('已成功加入通话', 'success');
            
            // 更新聊天中的通话状态
            setTimeout(() => updateCallStatusInChat(), 100);
        },
        
        // 其他用户加入了通话
        onUserJoinedCall: (data) => {
            console.log('用户加入了通话:', data);
            
            // 添加新用户到通话参与者列表
            if (data.userId && !callParticipants.has(data.userId)) {
                callParticipants.add(data.userId);
                console.log('📞 添加新用户到通话参与者:', data.userId, data.userName);
                
                // 更新通话UI显示
                updateCallUI();
                
                // 如果当前用户也在通话中，主动与新用户建立WebRTC连接
                if (isInCall && localStream) {
                    console.log('📞 与新加入用户建立WebRTC连接:', data.userName);
                    
                    // 创建对等连接并发送offer给新用户
                    const peerConnection = createPeerConnection(data.userId);
                    
                    peerConnection.createOffer()
                        .then(offer => peerConnection.setLocalDescription(offer))
                        .then(() => {
                            if (isRealtimeEnabled && window.realtimeClient) {
                                window.realtimeClient.sendCallOffer({
                                    roomId,
                                    targetUserId: data.userId,
                                    offer: peerConnection.localDescription,
                                    fromUserId: currentUserId
                                });
                            }
                        })
                        .catch(error => {
                            console.error('❌ 向新用户发送offer失败:', error);
                        });
                }
            }
            
            showToast(`${data.userName} 加入了通话`, 'info');
        },
        
        // 语音通话事件处理
        onCallInvite: (data) => {
            console.log('收到通话邀请:', data);
            handleCallInvite(data);
        },
        
        onCallAccept: (data) => {
            console.log('用户接受通话:', data);
            handleCallAccept(data);
        },
        
        onCallReject: (data) => {
            console.log('用户拒绝通话:', data);
            handleCallReject(data);
        },
        
        onCallEnd: (data) => {
            // 临时注释掉日志以减少输出
            // console.log('用户结束通话:', data);
            handleCallEnd(data);
        },
        
        onCallOffer: (data) => {
            console.log('收到WebRTC offer:', data);
            handleCallOffer(data);
        },
        
        onCallAnswer: (data) => {
            console.log('收到WebRTC answer:', data);
            handleCallAnswer(data);
        },
        
        onIceCandidate: (data) => {
            console.log('收到ICE候选:', data);
            handleIceCandidate(data);
        },
        
        onMuteStatus: (data) => {
            console.log('收到静音状态:', data);
            handleMuteStatus(data);
        },
        
        // 转录事件处理
        onTranscriptionStatusChange: (data) => {
            console.log('📝 转录状态变化:', data);
            handleTranscriptionStatusChange(data);
        },
        
        onTranscriptionResult: (data) => {
            console.log('📝 收到转录结果:', data);
            console.log('📝 转录结果详细信息:', {
                type: data.type,
                userId: data.userId,
                username: data.username,
                result: data.result,
                isPartial: data.isPartial,
                timestamp: data.timestamp
            });
            handleTranscriptionResult(data);
        },
        
        onError: (error) => {
            console.error('实时通信错误:', error);
            showToast(`连接错误: ${error}`, 'error');
        }
    });
}

// 更新连接状态显示
function updateConnectionStatus(isConnected) {
    if (!connectionStatus) return;
    
    if (isConnected) {
        connectionStatus.innerHTML = '<i class="fas fa-wifi"></i> 实时连接';
        connectionStatus.style.color = 'var(--success-color)';
        connectionStatus.title = '实时聊天已启用';
    } else {
        connectionStatus.innerHTML = '<i class="fas fa-wifi" style="opacity: 0.5;"></i> 本地模式';
        connectionStatus.style.color = 'var(--warning-color)';
        connectionStatus.title = '使用本地存储，无法多端同步';
    }
}

// 显示输入提示 - 优化版本
const typingIndicators = new Map(); // 跟踪所有输入提示的状态

function showTypingIndicator(data) {
    const indicatorId = `typing-${data.userId}`;
    let indicator = document.getElementById(indicatorId);
    
    if (data.isTyping) {
        // 如果指示器已存在且正在显示，不重复创建
        if (indicator && typingIndicators.get(data.userId)) {
            return;
        }
        
        // 创建或更新指示器
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = indicatorId;
            indicator.className = 'typing-indicator-message';
            indicator.innerHTML = `
                <div class="message-avatar" style="background-color: ${getAvatarColor(data.username)}">
                    ${data.username.charAt(0).toUpperCase()}
                </div>
                <div class="typing-content">
                    <span>${data.username} 正在输入...</span>
                    <div class="typing-dots">
                        <span></span><span></span><span></span>
                    </div>
                </div>
            `;
            messagesContainer.appendChild(indicator);
            scrollToBottom();
        }
        
        // 标记为正在显示
        typingIndicators.set(data.userId, true);
        
        // 清除之前的自动移除定时器
        if (indicator.dataset.autoRemoveTimer) {
            clearTimeout(parseInt(indicator.dataset.autoRemoveTimer));
        }
        
        // 设置新的自动移除定时器（8秒后自动移除）
        const timerId = setTimeout(() => {
            const currentIndicator = document.getElementById(indicatorId);
            if (currentIndicator) {
                currentIndicator.remove();
                typingIndicators.delete(data.userId);
            }
        }, 8000);
        
        indicator.dataset.autoRemoveTimer = timerId;
        
    } else {
        // 停止输入状态
        if (indicator) {
            indicator.remove();
            typingIndicators.delete(data.userId);
        }
    }
}

// 滚动到底部
function scrollToBottom() {
    // 在移动端，由于输入框独立布局，直接滚动到底部即可
    if (window.innerWidth <= 768) {
        setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 100);
    } else {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

// 生成或获取房间ID
function generateRoomId() {
    const urlParams = new URLSearchParams(window.location.search);
    let roomId = urlParams.get('room');
    
    if (!roomId) {
        roomId = 'meeting-' + Math.random().toString(36).substr(2, 6);
        // 更新URL但不刷新页面
        const newUrl = window.location.pathname + '?room=' + roomId;
        window.history.replaceState({path: newUrl}, '', newUrl);
    }
    
    document.getElementById('roomId').textContent = `房间: ${roomId}`;
    return roomId;
}

// 显示用户名设置模态框
function showUsernameModal() {
    usernameModal.style.display = 'block';
    document.body.classList.add('modal-open'); // 添加modal-open类
    
    // 预填房间号
    const urlParams = new URLSearchParams(window.location.search);
    const urlRoomId = urlParams.get('room');
    if (urlRoomId) {
        roomInput.value = urlRoomId;
    }
    
    usernameInput.focus();
}

// 加载房间数据
function loadRoomData() {
    // 从localStorage加载房间数据
    const storageKey = `meeting_${roomId}`;
    const savedData = localStorage.getItem(storageKey);
    
    if (savedData) {
        const data = JSON.parse(savedData);
        messages = data.messages || [];
        participants = data.participants || [];
        
        // 处理文件消息：恢复文件URL
        messages.forEach(async (msg) => {
            if (msg.type === 'file' && msg.file && msg.file.base64 && !msg.file.url) {
                try {
                    // 将base64转换为Blob并创建URL
                    const response = await fetch(msg.file.base64);
                    const blob = await response.blob();
                    msg.file.url = URL.createObjectURL(blob);
                } catch (error) {
                    console.error('恢复文件URL失败:', error);
                }
            }
        });
        
        // 渲染已存在的消息
        messages.forEach(msg => renderMessage(msg));
        renderParticipants();
    }
    
    // 添加当前用户到参与者列表
    if (currentUsername) {
        addCurrentUserToParticipants();
    }
}

// 保存房间数据到localStorage
function saveRoomData() {
    const storageKey = `meeting_${roomId}`;
    const data = {
        messages: messages,
        participants: participants,
        lastUpdate: Date.now()
    };
    localStorage.setItem(storageKey, JSON.stringify(data));
}

// 处理localStorage变化事件
function handleStorageChange(e) {
    if (e.key === `meeting_${roomId}` && e.newValue) {
        const data = JSON.parse(e.newValue);
        
        // 更新消息（避免重复）
        if (data.messages && data.messages.length > messages.length) {
            const newMessages = data.messages.slice(messages.length);
            newMessages.forEach(msg => {
                messages.push(msg);
                renderMessage(msg);
            });
        }
        
        // 更新参与者列表
        if (data.participants) {
            participants = data.participants;
            renderParticipants();
        }
    }
}

// 添加当前用户到参与者列表
function addCurrentUserToParticipants() {
    const existingUser = participants.find(p => p.userId === currentUserId);
    if (!existingUser && currentUsername) {
        participants.push({
            userId: currentUserId,
            name: currentUsername,
            status: 'online',
            joinTime: Date.now()
        });
        saveRoomData();
        renderParticipants();
    }
}

// 更新消息显示中的"(我)"标识
function updateMessagesOwnership() {
    // 重新渲染所有消息以更新"(我)"标识
    messagesContainer.innerHTML = '';
    messages.forEach(msg => renderMessage(msg));
}

// 同步参与者在线状态
function syncParticipantsStatus() {
    if (currentUsername) {
        addCurrentUserToParticipants();
    }
}









// 自动提醒用户保存会议数据
function remindToSaveData() {
    if (messages.length >= 5 && window.location.hostname.includes('huggingface.co')) {
        showToast('💾 数据已自动保存到服务器', 'info');
    }
}

// 设置用户名和房间号
function setUsername() {
    const username = usernameInput.value.trim();
    const customRoomId = roomInput.value.trim();
    
    if (!username) {
        alert('请输入您的姓名');
        return;
    }
    
    // 处理房间号
            if (customRoomId) {
            roomId = customRoomId;
            window.roomId = roomId;
            // 更新URL
            const newUrl = window.location.pathname + '?room=' + roomId;
            window.history.replaceState({path: newUrl}, '', newUrl);
            document.getElementById('roomId').textContent = `房间: ${roomId}`;
    } else if (!roomId) {
        // 如果没有自定义房间号且roomId未设置，生成新的
        roomId = 'meeting-' + Math.random().toString(36).substr(2, 6);
        window.roomId = roomId;
        const newUrl = window.location.pathname + '?room=' + roomId;
        window.history.replaceState({path: newUrl}, '', newUrl);
        document.getElementById('roomId').textContent = `房间: ${roomId}`;
    }
    
    // 设置当前用户信息
    currentUsername = username;
    // 基于用户名生成一致的用户ID
    currentUserId = generateUserIdFromUsername(username);
    
    // 尝试通过WebSocket加入房间
    if (window.realtimeClient && !window.realtimeClient.localMode) {
        // 先加载本地数据作为备用
        loadRoomData();
        
        // 然后尝试连接WebSocket获取最新数据
        // 如果实时连接尚未建立，先等待一次 'connect' 回调或做延迟重试，避免首次进入卡"连接中"
        if (window.realtimeClient && window.realtimeClient.isConnected) {
            window.realtimeClient.joinRoom(roomId, currentUserId, username);
        } else {
            setTimeout(() => {
                if (window.realtimeClient) {
                    window.realtimeClient.joinRoom(roomId, currentUserId, username);
                }
            }, 1500);
        }
        showToast('正在连接实时聊天...', 'info');
    } else {
        // 降级到本地模式
        loadRoomData();
        
        // 检查是否已有相同用户名的用户
        const existingUser = participants.find(p => p.name === username);
        if (existingUser) {
            // 使用现有的用户ID
            currentUserId = existingUser.id;
            currentUsername = username;
            
            // 更新用户状态为在线
            existingUser.status = 'online';
            existingUser.lastSeen = Date.now();
            
            // 更新消息显示中的"(我)"标识
            updateMessagesOwnership();
        } else {
            // 添加新用户到参与者列表
            participants.push({
                id: currentUserId,
                name: currentUsername,
                status: 'online',
                joinTime: Date.now(),
                lastSeen: Date.now()
            });
        }
        
        // 保存房间数据
        saveRoomData();
        renderParticipants();
    }
    
    usernameModal.style.display = 'none';
    
    // 在移动端，确保输入框在用户加入房间后显示
    if (isMobileDevice()) {
        setTimeout(() => {
            const inputContainer = document.querySelector('.input-container');
            if (inputContainer) {
                inputContainer.style.display = 'flex';
                inputContainer.style.visibility = 'visible';
                inputContainer.style.opacity = '1';
                forceMobileInputVisibility();
            }
        }, 500);
    }
}

// 关闭用户名设置模态框
function closeUsernameModal() {
    usernameModal.style.display = 'none';
    document.body.classList.remove('modal-open'); // 移除modal-open类
    
    // 在移动端，确保输入框在用户加入房间后显示
    if (isMobileDevice()) {
        setTimeout(() => {
            const inputContainer = document.querySelector('.input-container');
            if (inputContainer) {
                inputContainer.style.display = 'flex';
                inputContainer.style.visibility = 'visible';
                inputContainer.style.opacity = '1';
                forceMobileInputVisibility();
            }
        }, 500);
    }
}

// 创建新房间
function createNewRoom() {
    roomInput.value = ''; // 清空房间号输入
    
    // 强制重置房间ID，创建全新的房间
    roomId = 'meeting-' + Math.random().toString(36).substr(2, 6);
    window.roomId = roomId;
    const newUrl = window.location.pathname + '?room=' + roomId;
    window.history.replaceState({path: newUrl}, '', newUrl);
    document.getElementById('roomId').textContent = `房间: ${roomId}`;
    
    // 重置当前会话状态
    messages = [];
    participants = [];
    
    // 清空消息容器
    messagesContainer.innerHTML = '';
    
    // 重置总结内容
    summaryContent.innerHTML = '<p class="empty-summary">讨论开始后，AI将为您生成智能总结...</p>';
    
    // 如果已设置用户名，直接加入新房间
    if (currentUsername) {
        usernameModal.style.display = 'none';
        
        // 直接将当前用户添加到新房间的参与者列表
        participants.push({
            id: currentUserId,
            name: currentUsername,
            status: 'online',
            joinTime: Date.now(),
            lastSeen: Date.now()
        });
        
        // 保存房间数据并渲染参与者
        saveRoomData();
        renderParticipants();
    } else {
        // 否则显示用户名设置对话框
        setUsername();
    }
}

// 发送消息
async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || isAIProcessing || !currentUsername) return;

    // 创建消息对象
    const message = {
        type: 'user',
        text: text,
        author: currentUsername,
        userId: currentUserId,
        time: new Date().toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit' 
        })
    };
    
    // 清空输入框
    messageInput.value = '';
    autoResizeTextarea();
    
    // 停止输入提示
    if (window.realtimeClient) {
        window.realtimeClient.sendTypingIndicator(false);
    }
    
    // 立即显示消息（提供即时反馈）
    messages.push(message);
    renderMessage(message);
    scrollToBottom();
    
    // 尝试通过WebSocket发送
    if (isRealtimeEnabled && window.realtimeClient) {
        const sent = window.realtimeClient.sendMessage(message);
        if (!sent) {
            // WebSocket发送失败，使用本地存储备份
            saveRoomData();
            showToast('消息已保存到本地，连接恢复后将同步', 'warning');
        }
    } else {
        // 本地模式，保存到localStorage
        saveRoomData();
    }

    // 在Hugging Face环境下提醒用户保存数据
    remindToSaveData();
}

// 添加消息到界面
function addMessage(type, text, author = 'AI助手', userId = null, shouldBroadcast = true, isAIQuestion = false) {
    const message = {
        type,
        text,
        author,
        userId: userId || (type === 'ai' ? 'ai-assistant' : 'unknown'),
        isAIQuestion: isAIQuestion || false,
        timestamp: Date.now(), // 使用UTC时间戳
        time: new Date().toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit' 
        })
    };
    
    // 立即显示消息
    messages.push(message);
    renderMessage(message);
    scrollToBottom();
    
    // 通过WebSocket发送AI消息给其他用户（只有本地产生的消息才发送）
    if (shouldBroadcast && isRealtimeEnabled && window.realtimeClient) {

        const sent = window.realtimeClient.sendMessage(message);
        if (!sent) {
            // WebSocket发送失败，使用本地存储备份
            saveRoomData();
        }
    } else {
        // 本地模式或接收到的消息，保存到localStorage
        saveRoomData();
    }
}

// 渲染单条消息
function renderMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.type}-message${message.isAIQuestion ? ' ai-question-message' : ''}`;
    messageDiv.dataset.messageId = message.id || Date.now();
    
    let avatarContent;
    let avatarColor;
    
    if (message.type === 'user') {
        avatarColor = getAvatarColor(message.author);
        const initials = message.author.charAt(0).toUpperCase();
        avatarContent = `<span style="color: white; font-weight: bold;">${initials}</span>`;
    } else {
        avatarColor = '#6b7280';
        avatarContent = '<i class="fas fa-robot"></i>';
    }
    
    const isCurrentUser = message.userId === currentUserId;
    
    let messageText;
    if (message.isLoading) {
        messageDiv.classList.add('loading');
        messageText = `
            <div class="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
            </div>
        `;
    } else {
        const aiQuestionPrefix = message.isAIQuestion ? '<i class="fas fa-robot ai-question-icon"></i> [询问AI] ' : '';
        messageText = `<div class="message-text">${aiQuestionPrefix}${message.text}</div>`;
    }
    
    // 处理时间显示：如果有时间戳，使用本地时区格式化；否则使用原始时间
    let displayTime;
    if (message.timestamp) {
        displayTime = new Date(message.timestamp).toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    } else {
        displayTime = message.time || new Date().toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }
    
    messageDiv.innerHTML = `
        <div class="message-avatar" style="background-color: ${avatarColor}">${avatarContent}</div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-author" ${isCurrentUser ? 'style="color: #3b82f6; font-weight: 600;"' : ''}>
                    ${message.author} ${isCurrentUser ? '(我)' : ''}
                </span>
                <span class="message-time">${displayTime}</span>
            </div>
            ${messageText}
        </div>
    `;
    
    messagesContainer.appendChild(messageDiv);
}

// 处理AI集成（手动召唤版本）
async function processWithAI(userMessage) {
    if (isAIProcessing) return;
    
    isAIProcessing = true;
    updateAIStatus('AI正在分析...', 'processing');
    
    try {
        // 构建对话上下文
        const context = buildAIContext(userMessage);
        
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.API_KEY}`
            },
            body: JSON.stringify({
                model: CONFIG.MODEL,
                messages: context,
                max_tokens: 300,
                temperature: 0.7
            })
        });
        
        if (!response.ok) {
            throw new Error('AI服务响应异常');
        }
        
        const data = await response.json();
        const aiResponse = data.choices[0].message.content;
        
        // 添加AI回答
        addMessage('ai', aiResponse, 'AI助手');
        
        updateAIStatus('AI回答完成', 'complete');
        setTimeout(() => updateAIStatus('AI正在待命...', 'idle'), 2000);
        
    } catch (error) {
        console.error('AI处理失败:', error);
        updateAIStatus('AI服务暂时不可用', 'error');
        setTimeout(() => updateAIStatus('AI正在待命...', 'idle'), 3000);
        
        // 模拟AI回答（降级方案）
        setTimeout(() => {
            const mockResponse = generateMockAIAnswer(userMessage);
            addMessage('ai', mockResponse, 'AI助手');
            updateAIStatus('AI正在待命...', 'idle');
        }, 1000);
    } finally {
        isAIProcessing = false;
    }
}

// 构建AI上下文
function buildAIContext(userMessage) {
    const recentMessages = messages.slice(-10);
    const conversationHistory = recentMessages.map(msg => ({
        role: msg.type === 'user' ? 'user' : 'assistant',
        content: `${msg.author}: ${msg.text}`
    }));
    
    return [
        {
            role: 'system',
            content: '你是一个智能会议助手，能够回答关于当前讨论的问题、提供总结和建议。请用中文回答。'
        },
        ...conversationHistory,
        {
            role: 'user',
            content: userMessage
        }
    ];
}

// 生成模拟AI响应
function generateMockAIResponse(message) {
    const mockResponses = [
        `用户提到: ${message.substring(0, 20)}...`,
        `讨论要点: ${message.includes('技术') ? '技术方案讨论' : '项目规划'}`,
        `记录: 重要观点 - ${message.length > 10 ? message.substring(0, 15) + '...' : message}`,
        `总结: ${message.includes('架构') ? '架构设计讨论' : '需求分析'}`,
    ];
    return mockResponses[Math.floor(Math.random() * mockResponses.length)];
}

// 生成模拟AI回答
function generateMockAIAnswer(question) {
    const answers = [
        "根据当前讨论，我认为这是一个很有价值的观点。",
        "从讨论内容来看，大家的想法比较一致，可以继续深入探讨。",
        "这个问题很有深度，建议从多个角度继续分析。",
        "基于现有信息，我可以提供一些补充建议。",
        "讨论进展良好，建议总结一下目前的共识。"
    ];
    return answers[Math.floor(Math.random() * answers.length)];
}

// 更新AI状态
function updateAIStatus(text, type) {
    const icon = type === 'processing' ? 'fas fa-spinner fa-spin' : 
                 type === 'error' ? 'fas fa-exclamation-triangle' : 
                 'fas fa-robot';
    aiStatus.innerHTML = `<i class="${icon}"></i> ${text}`;
    
    if (type === 'error') {
        aiStatus.style.color = 'var(--error-color)';
    } else {
        aiStatus.style.color = 'var(--success-color)';
    }
}

// 询问AI
function askAI() {
    askAIModal.style.display = 'block';
    aiQuestionInput.focus();
}

// 关闭询问AI模态框
function closeAskAIModal() {
    askAIModal.style.display = 'none';
    aiQuestionInput.value = '';
}

// 提交AI问题
async function submitAIQuestion() {
    const question = aiQuestionInput.value.trim();
    if (!question || isAIProcessing) return;
    
    // 添加用户问题（标记为AI问题）
    addMessage('user', question, currentUsername, currentUserId, true, true);
    closeAskAIModal();
    
    isAIProcessing = true;
    updateAIStatus('AI正在思考...', 'processing');
    
    // 添加AI加载消息
    const loadingMessageId = addLoadingMessage('AI正在思考中...');
    
    try {
        const context = [
            {
                role: 'system',
                content: '你是一个专业的技术顾问。基于当前的会议讨论内容，为用户提供准确、有用的回答。回答要简洁明了，不超过200字。'
            },
            {
                role: 'user',
                content: `当前讨论内容: ${messages.slice(-3).map(m => m.text).join('；')}。用户问题: ${question}`
            }
        ];
        
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.API_KEY}`
            },
            body: JSON.stringify({
                model: CONFIG.MODEL,
                messages: context,
                max_tokens: 300,
                temperature: 0.7
            })
        });
        
        if (!response.ok) {
            throw new Error('AI问答服务异常');
        }
        
        const data = await response.json();
        const aiAnswer = data.choices[0].message.content;
        
        // 更新加载消息为实际回答
        updateMessage(loadingMessageId, aiAnswer);
        
        // 同时创建一个新的AI消息发送给其他用户
        const aiMessage = {
            type: 'ai',
            text: aiAnswer,
            author: 'AI助手',
            userId: 'ai-assistant',
            time: new Date().toLocaleTimeString('zh-CN', { 
                hour: '2-digit', 
                minute: '2-digit' 
            }),
            originUserId: currentUserId // 标记这个AI回复是由当前用户触发的
        };
        
        // 发送给其他用户（不影响本地显示）
        if (isRealtimeEnabled && window.realtimeClient) {
            window.realtimeClient.sendMessage(aiMessage);
        }
        
        updateAIStatus('AI正在监听...', 'listening');
        
    } catch (error) {
        console.error('AI问答失败:', error);
        
        // 更新加载消息为错误消息
        updateMessage(loadingMessageId, '抱歉，AI服务暂时不可用，请稍后重试。', true);
        
        updateAIStatus('AI正在监听...', 'listening');
    } finally {
        isAIProcessing = false;
    }
}

// 生成模拟AI回答
function generateMockAIAnswer(question) {
    const mockAnswers = [
        `关于"${question}"，建议考虑以下几点：1) 技术可行性 2) 成本效益 3) 实施周期。`,
        `这是一个很好的问题。基于当前讨论，我建议先进行小规模试点，验证效果后再全面推广。`,
        `从技术角度看，这个方案是可行的。但需要注意数据安全和性能优化方面的问题。`,
        `根据我的经验，建议采用渐进式实施策略，先解决核心痛点，再逐步完善。`
    ];
    return mockAnswers[Math.floor(Math.random() * mockAnswers.length)];
}

// 生成总结
async function generateSummary() {
    if (messages.length === 0) {
        alert('暂无讨论内容可总结');
        return;
    }
    
    if (isAIProcessing) return;
    
    // 显示加载状态
    summaryContent.innerHTML = '<p class="loading-summary">AI正在分析讨论内容，请稍候...</p>';
    
    isAIProcessing = true;
    updateAIStatus('AI正在生成总结...', 'processing');
    
    try {
        // 构建会议内容
        const meetingContent = messages.map(m => `${m.author}: ${m.text}`).join('\n');
        console.log('📝 准备生成总结，会议内容长度:', meetingContent.length);
        console.log('📝 会议内容预览:', meetingContent.substring(0, 200) + '...');
        
        const context = [
            {
                role: 'system',
                content: '你是一个专业的会议总结AI。请基于讨论内容，生成结构化的会议总结，包括：1) 主要讨论点 2) 达成的共识 3) 待解决问题 4) 下一步行动。用中文回答，格式清晰。'
            },
            {
                role: 'user',
                content: `会议讨论内容：${meetingContent}`
            }
        ];
        
        console.log('🔗 正在调用AI API:', CONFIG.API_URL);
        console.log('🔑 API Key 长度:', CONFIG.API_KEY.length);
        
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.API_KEY}`
            },
            body: JSON.stringify({
                model: CONFIG.MODEL,
                messages: context,
                max_tokens: 500,
                temperature: 0.5
            })
        });
        
        console.log('📡 API响应状态:', response.status, response.statusText);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ API响应错误:', errorText);
            throw new Error(`AI总结服务异常: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('✅ API响应成功:', data);
        
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            throw new Error('AI响应格式异常');
        }
        
        const summary = data.choices[0].message.content;
        console.log('📋 生成的总结:', summary);
        
        // 在侧边栏显示总结
        summaryContent.innerHTML = `<div class="summary-text">${summary.replace(/\n/g, '<br>')}</div>`;
        
        // 同时将总结作为AI消息添加到聊天流中，让所有用户都能看到
        addMessage('ai', `📋 **会议总结**\n\n${summary}`, 'AI助手', 'ai-assistant');
        
        updateAIStatus('AI正在监听...', 'listening');
        
    } catch (error) {
        console.error('❌ AI总结失败:', error);
        console.error('❌ 错误详情:', {
            message: error.message,
            stack: error.stack,
            config: {
                apiUrl: CONFIG.API_URL,
                model: CONFIG.MODEL,
                hasApiKey: !!CONFIG.API_KEY
            }
        });
        
        // 生成基于实际内容的模拟总结
        const mockSummary = generateSmartMockSummary(messages);
        summaryContent.innerHTML = `<div class="summary-text">${mockSummary}</div>`;
        
        // 同时将模拟总结作为AI消息添加到聊天流中
        addMessage('ai', `📋 **会议总结**\n\n${mockSummary.replace(/<br>/g, '\n').replace(/<\/?strong>/g, '**')}`, 'AI助手', 'ai-assistant');
        
        updateAIStatus('AI正在监听...', 'listening');
        
        // 显示错误提示
        showToast('AI服务暂时不可用，已生成基于讨论内容的总结', 'warning');
    } finally {
        isAIProcessing = false;
    }
}

// 生成智能模拟总结（基于实际会议内容）
function generateSmartMockSummary(messages) {
    if (!messages || messages.length === 0) {
        return `
            <strong>📋 会议总结</strong><br><br>
            <strong>⚠️ 暂无讨论内容</strong><br>
            请开始讨论后再次尝试生成总结。
        `;
    }
    
    // 分析会议内容
    const userMessages = messages.filter(m => m.type === 'user');
    const aiMessages = messages.filter(m => m.type === 'ai');
    const participants = [...new Set(messages.map(m => m.author))];
    
    // 提取关键词和主题
    const allText = messages.map(m => m.text).join(' ');
    const commonTopics = extractCommonTopics(allText);
    const keyPoints = extractKeyPoints(messages);
    
    // 生成基于实际内容的总结
    let summary = `<strong>📋 会议总结</strong><br><br>`;
    
    // 主要讨论点
    summary += `<strong>🎯 主要讨论点：</strong><br>`;
    if (commonTopics.length > 0) {
        commonTopics.forEach(topic => {
            summary += `• ${topic}<br>`;
        });
    } else {
        summary += `• 讨论了${userMessages.length}个话题<br>`;
        summary += `• 涉及${participants.length}位参与者<br>`;
    }
    summary += `<br>`;
    
    // 达成共识
    summary += `<strong>✅ 达成共识：</strong><br>`;
    if (aiMessages.length > 0) {
        summary += `• AI助手提供了${aiMessages.length}次协助<br>`;
    }
    summary += `• 会议持续了${Math.ceil((Date.now() - (messages[0]?.timestamp || Date.now())) / 60000)}分钟<br>`;
    summary += `• 共有${participants.length}位参与者参与讨论<br>`;
    summary += `<br>`;
    
    // 待解决问题
    summary += `<strong>❓ 待解决问题：</strong><br>`;
    if (keyPoints.length > 0) {
        keyPoints.slice(0, 3).forEach(point => {
            summary += `• ${point}<br>`;
        });
    } else {
        summary += `• 需要进一步明确讨论方向<br>`;
        summary += `• 建议制定具体的行动计划<br>`;
    }
    summary += `<br>`;
    
    // 下一步行动
    summary += `<strong>🚀 下一步行动：</strong><br>`;
    summary += `• 继续深入讨论关键议题<br>`;
    summary += `• 制定详细的实施计划<br>`;
    summary += `• 安排后续跟进会议<br>`;
    
    return summary;
}

// 提取常见主题
function extractCommonTopics(text) {
    const topics = [];
    const lowerText = text.toLowerCase();
    
    // 常见技术主题
    const techTopics = [
        '技术', '架构', '开发', '部署', '测试', '优化', '性能', '安全',
        '数据库', '前端', '后端', 'API', '微服务', '容器', '云服务',
        '人工智能', '机器学习', '数据分析', '自动化'
    ];
    
    techTopics.forEach(topic => {
        if (lowerText.includes(topic)) {
            topics.push(topic);
        }
    });
    
    // 常见业务主题
    const businessTopics = [
        '项目', '计划', '进度', '目标', '预算', '成本', '收益', '风险',
        '团队', '合作', '沟通', '管理', '流程', '规范', '标准'
    ];
    
    businessTopics.forEach(topic => {
        if (lowerText.includes(topic)) {
            topics.push(topic);
        }
    });
    
    return topics.slice(0, 5); // 最多返回5个主题
}

// 提取关键点
function extractKeyPoints(messages) {
    const points = [];
    
    // 查找包含关键词的消息
    const keywords = ['问题', '需要', '建议', '重要', '关键', '注意', '考虑'];
    
    messages.forEach(msg => {
        if (msg.type === 'user') {
            keywords.forEach(keyword => {
                if (msg.text.includes(keyword)) {
                    const point = msg.text.substring(0, 50) + '...';
                    if (!points.includes(point)) {
                        points.push(point);
                    }
                }
            });
        }
    });
    
    return points.slice(0, 3); // 最多返回3个关键点
}

// 获取用户头像颜色
function getAvatarColor(name) {
    const colors = [
        '#ef4444', '#f97316', '#f59e0b', '#eab308',
        '#84cc16', '#22c55e', '#10b981', '#14b8a6',
        '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
        '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'
    ];
    
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    return colors[Math.abs(hash) % colors.length];
}

// 生成模拟总结（已废弃，使用generateSmartMockSummary替代）
function generateMockSummary() {
    console.warn('⚠️ generateMockSummary已废弃，请使用generateSmartMockSummary');
    return generateSmartMockSummary(messages);
}

// 导出总结
function exportSummary() {
    const summaryText = summaryContent.innerText || summaryContent.textContent;
    if (!summaryText || summaryText.includes('暂无总结')) {
        alert('暂无总结内容可导出');
        return;
    }
    
    const fullContent = `
会议记录 - Vibe Meeting
时间: ${new Date().toLocaleString('zh-CN')}
房间: ${document.getElementById('roomId').textContent}
讨论内容:
${messages.map(m => `[${m.time}] ${m.author}: ${m.text}`).join('\n')}
AI总结:
${summaryText}
---
由Vibe Meeting AI助手生成
    `;
    
    const blob = new Blob([fullContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meeting-summary-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 复制房间号
function copyRoomId(event) {
    const roomId = document.getElementById('roomId').textContent.replace('房间: ', '');
    navigator.clipboard.writeText(roomId).then(() => {
        const btn = event.target.tagName === 'BUTTON' ? event.target : event.target.closest('button');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> 已复制';
        setTimeout(() => {
            btn.innerHTML = originalText;
        }, 2000);
    }).catch(err => {
        console.error('复制失败:', err);
        alert('复制失败，请手动复制房间号');
    });
}



// 搜索过滤参与者
function filterParticipants(searchTerm) {
    const filteredParticipants = participants.filter(participant => 
        participant.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
    renderFilteredParticipants(filteredParticipants);
}

// 渲染过滤后的参与者列表
function renderFilteredParticipants(filteredParticipants) {
    participantsList.innerHTML = '';
    
    if (filteredParticipants.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-participants';
        if (document.getElementById('participantsSearch').value.trim()) {
            emptyDiv.innerHTML = '<p>没有找到匹配的在线成员</p>';
        } else {
            emptyDiv.innerHTML = '<p>暂无在线成员</p>';
        }
        participantsList.appendChild(emptyDiv);
        return;
    }
    
    // 对参与者进行排序：当前用户第一，创建者第二，其他按原顺序
    const sortedParticipants = [...filteredParticipants].sort((a, b) => {
        const aIsCurrentUser = a.userId === currentUserId;
        const bIsCurrentUser = b.userId === currentUserId;
        const aIsCreator = window.currentRoomInfo && a.userId === window.currentRoomInfo.creatorId;
        const bIsCreator = window.currentRoomInfo && b.userId === window.currentRoomInfo.creatorId;
        
        // 当前用户始终排在第一位
        if (aIsCurrentUser && !bIsCurrentUser) return -1;
        if (!aIsCurrentUser && bIsCurrentUser) return 1;
        
        // 如果当前用户就是创建者，直接保持顺序
        if (aIsCurrentUser && bIsCurrentUser) return 0;
        
        // 在非当前用户中，创建者排在第二位
        if (aIsCreator && !bIsCreator) return -1;
        if (!aIsCreator && bIsCreator) return 1;
        
        // 其他按原顺序
        return 0;
    });
    
    sortedParticipants.forEach((participant, index) => {
        const participantDiv = document.createElement('div');
        participantDiv.className = 'participant';
        
        const initials = participant.name.charAt(0).toUpperCase();
        const avatarColor = getAvatarColor(participant.name);
        const isCurrentUser = participant.userId === currentUserId;
        const isCreator = window.currentRoomInfo && participant.userId === window.currentRoomInfo.creatorId;
        
        // 确定显示标签
        let userTag = '';
        if (isCurrentUser && isCreator) {
            userTag = '(我·创建者)';
        } else if (isCurrentUser) {
            userTag = '(我)';
        } else if (isCreator) {
            userTag = '(创建者)';
        }
        
        participantDiv.innerHTML = `
            <div class="participant-avatar" style="background-color: ${avatarColor}">
                ${initials}
            </div>
            <div class="participant-info">
                <div class="participant-name">
                    ${participant.name} ${userTag}
                </div>
                <div class="participant-status ${participant.status}">
                    <i class="fas fa-circle"></i> ${participant.status === 'online' ? '在线' : '离线'}
                </div>
            </div>
        `;
        
        participantsList.appendChild(participantDiv);
    });
    
    // 如果当前用户是创建者，在参与者列表下方添加结束会议按钮
    if (window.isCreator) {
        const endMeetingDiv = document.createElement('div');
        endMeetingDiv.className = 'creator-actions';
        endMeetingDiv.innerHTML = `
            <button id="endMeetingBtn" class="btn-end-meeting" onclick="endMeeting()">
                <i class="fas fa-power-off"></i> 结束会议
            </button>
            <p class="creator-note">结束会议将清空所有聊天记录和文件</p>
        `;
        participantsList.appendChild(endMeetingDiv);
    }
}

// 渲染参与者列表（原始函数，保持向后兼容）
function renderParticipants() {
    renderFilteredParticipants(participants);
}

// 结束会议函数（仅创建者可调用）
function endMeeting() {
    if (!window.isCreator) {
        showToast('只有会议创建者可以结束会议', 'error');
        return;
    }
    
    const confirmMessage = `确定要结束会议吗？\n\n这将会：\n• 清空所有聊天记录\n• 删除所有上传的文件\n• 移除所有参与者\n• 此操作不可撤销`;
    
    if (!confirm(confirmMessage)) {
        return;
    }
    
    // 显示结束中状态
    const endBtn = document.getElementById('endMeetingBtn');
    if (endBtn) {
        endBtn.disabled = true;
        endBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 结束中...';
    }
    
    // 发送结束会议请求
    if (isRealtimeEnabled && window.realtimeClient) {
        window.realtimeClient.endMeeting(roomId, currentUserId);
    } else {
        showToast('无法连接到服务器，请检查网络', 'error');
        // 恢复按钮状态
        if (endBtn) {
            endBtn.disabled = false;
            endBtn.innerHTML = '<i class="fas fa-power-off"></i> 结束会议';
        }
    }
}

// 这里可以添加真实的用户加入功能，例如WebSocket连接

// 检查文档处理库是否正确加载
function checkDocumentLibraries() {
    const libraries = {
        'PDF.js': typeof pdfjsLib !== 'undefined',
        'Mammoth.js': typeof mammoth !== 'undefined',
        'XLSX.js': typeof XLSX !== 'undefined'
    };
    
    console.log('文档处理库加载状态:', libraries);
    
    const missingLibs = Object.entries(libraries)
        .filter(([name, loaded]) => !loaded)
        .map(([name]) => name);
    
    if (missingLibs.length > 0) {
        console.warn('以下库未正确加载:', missingLibs.join(', '));
        showToast(`部分文档处理功能不可用：${missingLibs.join(', ')}`, 'warning');
    }
    
    return libraries;
}

// 处理Excel文档
async function processExcelDocument(file, fileMessage) {
    try {
        showToast('正在提取Excel文件内容...', 'info');
        
        // 检查XLSX.js是否加载
        if (typeof XLSX === 'undefined') {
            throw new Error('XLSX.js库未加载，请刷新页面重试');
        }
        
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        
        let allSheetsContent = '';
        const sheetNames = workbook.SheetNames;
        
        // 遍历所有工作表
        for (let i = 0; i < sheetNames.length; i++) {
            const sheetName = sheetNames[i];
            const worksheet = workbook.Sheets[sheetName];
            
            // 尝试多种方法提取工作表内容
            try {
                let sheetContent = '';
                
                // 方法1：使用sheet_to_csv (如果存在)
                if (typeof XLSX.utils.sheet_to_csv === 'function') {
                    try {
                        const csvData = XLSX.utils.sheet_to_csv(worksheet);
                        if (csvData && csvData.trim()) {
                            sheetContent = csvData.trim();
                        }
                    } catch (csvError) {
                        console.warn(`CSV转换失败:`, csvError);
                    }
                }
                
                // 方法2：使用sheet_to_json（备用方法）
                if (!sheetContent && typeof XLSX.utils.sheet_to_json === 'function') {
                    try {
                        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                        if (jsonData && jsonData.length > 0) {
                            sheetContent = jsonData.map(row => {
                                return (row || []).join('\t');
                            }).filter(line => line.trim()).join('\n');
                        }
                    } catch (jsonError) {
                        console.warn(`JSON转换失败:`, jsonError);
                    }
                }
                
                // 方法3：直接读取单元格（最后的备用方法）
                if (!sheetContent) {
                    try {
                        const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
                        const cells = [];
                        for (let row = range.s.r; row <= range.e.r; row++) {
                            const rowData = [];
                            for (let col = range.s.c; col <= range.e.c; col++) {
                                const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
                                const cell = worksheet[cellAddress];
                                rowData.push(cell ? (cell.v || '') : '');
                            }
                            if (rowData.some(cell => cell.toString().trim())) {
                                cells.push(rowData.join('\t'));
                            }
                        }
                        sheetContent = cells.join('\n');
                    } catch (cellError) {
                        console.warn(`单元格读取失败:`, cellError);
                    }
                }
                
                if (sheetContent && sheetContent.trim()) {
                    allSheetsContent += `\n=== 工作表: ${sheetName} ===\n`;
                    allSheetsContent += sheetContent.trim() + '\n';
                } else {
                    console.warn(`工作表 ${sheetName} 无内容或无法读取`);
                }
                
            } catch (sheetError) {
                console.error(`处理工作表 ${sheetName} 完全失败:`, sheetError);
            }
        }
        
        if (!allSheetsContent.trim()) {
            throw new Error('Excel文件中没有找到可提取的数据');
        }
        
        // 构建完整内容
        const content = `Excel文件: ${file.name}\n文件大小: ${formatFileSize(file.size)}\n工作表数量: ${sheetNames.length}\n\n内容：${allSheetsContent.trim()}`;
        
        console.log('Excel文件处理完成:', {
            fileName: file.name,
            fileType: file.type,
            sheetsCount: sheetNames.length,
            contentLength: allSheetsContent.length,
            content: content.substring(0, 200) + (content.length > 200 ? '...' : '')
        });
        
        window.currentFileInfo = {
            name: file.name,
            url: URL.createObjectURL(file),
            type: file.type,
            content: content
        };
        
        showAIToolbar(file.name, window.currentFileInfo.url, file.type);
        showToast('Excel文件内容提取完成', 'success');
        
    } catch (error) {
        console.error('处理Excel文件失败:', error);
        showToast(`Excel文件处理失败: ${error.message}`, 'error');
        
        // 即使失败也显示工具箱，但使用占位符内容
        window.currentFileInfo = {
            name: file.name,
            url: URL.createObjectURL(file),
            type: file.type,
            content: `这是一个Excel文件，但无法提取内容。文件可能已损坏或使用了不支持的格式。`
        };
        showAIToolbar(file.name, window.currentFileInfo.url, file.type);
    }
}

// 处理PPT文档
async function processPPTDocument(file, fileMessage) {
    try {
        showToast('正在分析PPT文件...', 'info');
        
        const arrayBuffer = await file.arrayBuffer();
        
        // PPT文件结构比较复杂，直接解析困难
        // 我们提供文件信息和基本分析，用户可以通过AI工具进行深度分析
        let content = `PowerPoint文件: ${file.name}\n文件大小: ${formatFileSize(file.size)}\n文件类型: ${file.type}\n\n`;
        
        // 尝试检测是否是新格式的PPTX（实际上是ZIP文件）
        const uint8Array = new Uint8Array(arrayBuffer);
        const isZipFormat = uint8Array[0] === 0x50 && uint8Array[1] === 0x4B; // PK signature
        
        if (isZipFormat) {
            content += `文件格式：PowerPoint 2007+ (.pptx)\n`;
            content += `压缩格式：是（基于XML）\n\n`;
            content += `内容摘要：这是一个现代PowerPoint演示文稿文件。由于PPT文件结构复杂，无法直接提取文本内容，但您可以使用AI工具进行智能分析，包括：\n`;
            content += `• 幻灯片内容识别\n`;
            content += `• 图表和图片分析\n`;
            content += `• 文本信息提取\n`;
            content += `• 演示文稿结构分析`;
        } else {
            content += `文件格式：PowerPoint 97-2003 (.ppt)\n`;
            content += `压缩格式：否（二进制格式）\n\n`;
            content += `内容摘要：这是一个传统PowerPoint演示文稿文件。建议转换为.pptx格式以获得更好的兼容性，或使用AI工具进行内容分析。`;
        }
        
        window.currentFileInfo = {
            name: file.name,
            url: URL.createObjectURL(file),
            type: file.type,
            content: content
        };
        
        showAIToolbar(file.name, window.currentFileInfo.url, file.type);
        showToast('PPT文件分析完成，可使用AI工具进一步处理', 'success');
        
    } catch (error) {
        console.error('处理PPT文件失败:', error);
        showToast(`PPT文件处理失败: ${error.message}`, 'error');
        
        // 即使失败也显示工具箱，但使用占位符内容
        window.currentFileInfo = {
            name: file.name,
            url: URL.createObjectURL(file),
            type: file.type,
            content: `这是一个PowerPoint演示文稿文件。由于文件格式复杂或文件可能损坏，无法直接分析内容。建议检查文件完整性或使用其他工具。`
        };
        showAIToolbar(file.name, window.currentFileInfo.url, file.type);
    }
}

// 处理CSV文件
async function processCSVFile(file, fileMessage) {
    try {
        showToast('正在处理CSV文件...', 'info');
        
        const text = await file.text();
        const lines = text.split('\n').slice(0, 20); // 只取前20行
        const preview = lines.join('\n');
        
        const content = `CSV文件: ${file.name}\n文件大小: ${formatFileSize(file.size)}\n\n内容预览：\n${preview}${lines.length > 20 ? '\n...（更多内容）' : ''}`;
        
        window.currentFileInfo = {
            name: file.name,
            url: URL.createObjectURL(file),
            type: file.type,
            content: content
        };
        
        showAIToolbar(file.name, window.currentFileInfo.url, file.type);
        
    } catch (error) {
        console.error('处理CSV文件失败:', error);
        showToast('处理CSV文件失败，请稍后重试', 'error');
    }
}

// 处理JSON文件
async function processJSONFile(file, fileMessage) {
    try {
        showToast('正在处理JSON文件...', 'info');
        
        const text = await file.text();
        const jsonData = JSON.parse(text);
        const preview = JSON.stringify(jsonData, null, 2).substring(0, 1000);
        
        const content = `JSON文件: ${file.name}\n文件大小: ${formatFileSize(file.size)}\n\n内容预览：\n${preview}${text.length > 1000 ? '\n...（更多内容）' : ''}`;
        
        window.currentFileInfo = {
            name: file.name,
            url: URL.createObjectURL(file),
            type: file.type,
            content: content
        };
        
        showAIToolbar(file.name, window.currentFileInfo.url, file.type);
        
    } catch (error) {
        console.error('处理JSON文件失败:', error);
        showToast('处理JSON文件失败，请稍后重试', 'error');
    }
}

// 处理HTML/XML文件
async function processHTMLFile(file, fileMessage) {
    try {
        showToast('正在处理HTML/XML文件...', 'info');
        
        const text = await file.text();
        const preview = text.substring(0, 1000);
        
        const content = `HTML/XML文件: ${file.name}\n文件大小: ${formatFileSize(file.size)}\n\n内容预览：\n${preview}${text.length > 1000 ? '\n...（更多内容）' : ''}`;
        
        window.currentFileInfo = {
            name: file.name,
            url: URL.createObjectURL(file),
            type: file.type,
            content: content
        };
        
        showAIToolbar(file.name, window.currentFileInfo.url, file.type);
        
    } catch (error) {
        console.error('处理HTML/XML文件失败:', error);
        showToast('处理HTML/XML文件失败，请稍后重试', 'error');
    }
}

// 处理通用文件（尝试提取文本内容）
async function processGenericFile(file, fileMessage) {
    try {
        showToast('正在处理文件...', 'info');
        
        let content = '';
        
        // 尝试按文本文件处理
        try {
            const text = await file.text();
            content = `文件: ${file.name}\n文件大小: ${formatFileSize(file.size)}\n文件类型: ${file.type}\n\n内容预览：\n${text.substring(0, 1000)}${text.length > 1000 ? '\n...（更多内容）' : ''}`;
        } catch (e) {
            content = `文件: ${file.name}\n文件大小: ${formatFileSize(file.size)}\n文件类型: ${file.type}\n\n内容：这是一个二进制文件，无法直接解析其内容。可以通过AI工具箱进行智能分析。`;
        }
        
        window.currentFileInfo = {
            name: file.name,
            url: URL.createObjectURL(file),
            type: file.type,
            content: content
        };
        
        showAIToolbar(file.name, window.currentFileInfo.url, file.type);
        
    } catch (error) {
        console.error('处理文件失败:', error);
        showToast('处理文件失败，请稍后重试', 'error');
    }
}

// 搜索聊天记录
function searchChatMessages(searchTerm) {
    const searchLower = searchTerm.toLowerCase();
    const messageElements = messagesContainer.querySelectorAll('.message');
    
    messageElements.forEach(messageEl => {
        const messageText = messageEl.querySelector('.message-text')?.textContent.toLowerCase() || '';
        const authorName = messageEl.querySelector('.message-author')?.textContent.toLowerCase() || '';
        
        if (searchTerm === '' || messageText.includes(searchLower) || authorName.includes(searchLower)) {
            messageEl.style.display = 'flex';
            messageEl.style.opacity = '1';
        } else {
            messageEl.style.display = 'none';
        }
    });
    
    // 高亮匹配的文本（可选功能）
    if (searchTerm !== '') {
        highlightSearchTerms(searchTerm);
    } else {
        removeHighlights();
    }
}

// 高亮搜索词
function highlightSearchTerms(searchTerm) {
    const messageElements = messagesContainer.querySelectorAll('.message');
    messageElements.forEach(messageEl => {
        const messageText = messageEl.querySelector('.message-text');
        if (messageText) {
            const text = messageText.textContent;
            const regex = new RegExp(`(${escapeRegExp(searchTerm)})`, 'gi');
            const highlightedText = text.replace(regex, '<mark class="search-highlight">$1</mark>');
            messageText.innerHTML = highlightedText;
        }
    });
}

// 移除高亮
function removeHighlights() {
    const messageElements = messagesContainer.querySelectorAll('.message');
    messageElements.forEach(messageEl => {
        const messageText = messageEl.querySelector('.message-text');
        if (messageText) {
            messageText.innerHTML = messageText.textContent;
        }
    });
}

// 转义正则表达式特殊字符
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 注册服务工作者
function registerServiceWorker() {
    // 在HTTPS自签名证书环境下，暂时跳过Service Worker注册
    // 避免SSL证书错误影响应用启动
    if (window.location.protocol === 'https:' && 
        (window.location.hostname.match(/^\d+\.\d+\.\d+\.\d+$/) || 
         window.location.hostname === 'localhost')) {
        console.log('🔧 检测到自签名证书环境，跳过Service Worker注册');
        return;
    }
    
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then(registration => {
                    console.log('✅ SW注册成功: ', registration);
                })
                .catch(registrationError => {
                    console.warn('⚠️ SW注册失败，应用将在无SW模式下运行: ', registrationError);
                    // SW注册失败不影响应用正常运行
                });
        });
    }
}

// 设置离线指示器
function setupOfflineIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'offline-indicator';
    indicator.textContent = '⚠️ 网络连接已断开，部分功能可能受限';
    document.body.appendChild(indicator);

    window.addEventListener('online', () => {
        indicator.classList.remove('show');
        showToast('网络已恢复', 'success');
    });

    window.addEventListener('offline', () => {
        indicator.classList.add('show');
    });
}

// 显示提示消息
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `${type}-toast`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// 页面加载完成后初始化
// 快速加载管理
function updateLoadProgress(text) {
    const progressEl = document.getElementById('load-progress');
    if (progressEl) progressEl.textContent = text;
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.style.display = 'none', 300);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    updateLoadProgress('加载界面组件...');
    init();
    // 网络延迟UI更新函数
    window.updateNetworkLatency = function(latency) {
        const el = document.getElementById('network-indicator');
        const rttEl = document.getElementById('latency-rtt');
        if (!el || !rttEl) return;
        rttEl.textContent = String(latency?.rtt ?? '--');
        el.style.display = 'inline-block';
        const rtt = latency?.rtt ?? 0;
        if (rtt < 80) {
            el.style.background = 'rgba(34,197,94,0.8)';
        } else if (rtt < 200) {
            el.style.background = 'rgba(234,179,8,0.8)';
        } else {
            el.style.background = 'rgba(239,68,68,0.8)';
        }
    };
});

// 文件上传和OCR功能
const fileInput = document.getElementById('fileInput');
const uploadZone = document.getElementById('uploadZone');

// 触发文件选择
function triggerFileUpload() {
    fileInput.click();
}

// 文件选择事件
fileInput.addEventListener('change', handleFileSelect);

// 处理文件选择
function handleFileSelect(event) {
    const files = Array.from(event.target.files);
    files.forEach(file => processFile(file));
    event.target.value = ''; // 重置输入
}

// 拖拽上传事件监听 - 使用更稳定的区域检测
const dragMessageInput = document.getElementById('messageInput');
const inputContainer = document.querySelector('.input-container');

// 只为相关容器添加事件监听
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    inputContainer.addEventListener(eventName, preventDefaults, false);
});

// 防抖处理 - 使用更严格的区域检测
let isDragging = false;
let dragCheckTimeout = null;

function highlight() {
    clearTimeout(dragCheckTimeout);
    if (!isDragging) {
        isDragging = true;
        uploadZone.style.display = 'block';
        uploadZone.classList.add('dragover');
    }
}

function unhighlight() {
    clearTimeout(dragCheckTimeout);
    dragCheckTimeout = setTimeout(() => {
        // 检查是否还在拖拽区域内
        const rect = inputContainer.getBoundingClientRect();
        const isStillOver = false; // 简化检测，直接隐藏
        
        if (!isStillOver) {
            isDragging = false;
            uploadZone.style.display = 'none';
            uploadZone.classList.remove('dragover');
        }
    }, 50);
}

// 事件委托到容器级别
inputContainer.addEventListener('dragenter', highlight, false);
inputContainer.addEventListener('dragover', highlight, false);
inputContainer.addEventListener('dragleave', unhighlight, false);
inputContainer.addEventListener('drop', handleDrop);

// 防止默认行为
function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

// 处理拖拽文件
function handleDrop(e) {
    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => processFile(file));
    isDragging = false;
    uploadZone.style.display = 'none';
    uploadZone.classList.remove('dragover');
}

function handleDrop(e) {
    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => processFile(file));
    uploadZone.style.display = 'none';
}

// 处理单个文件
async function processFile(file) {
    if (!file) return;
    
    const maxSize = 10 * 1024 * 1024; // 10MB限制
    if (file.size > maxSize) {
        showToast('文件大小超过10MB限制', 'error');
        return;
    }
    
    // 支持AI分析的文件类型
    const aiSupportedTypes = [
        // 图片格式
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml',
        // 文档格式
        'application/pdf', 'text/plain', 'text/csv',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.oasis.opendocument.text',
        'application/vnd.oasis.opendocument.presentation',
        'application/vnd.oasis.opendocument.spreadsheet',
        // 网页格式
        'text/html', 'text/xml', 'application/json',
        // 压缩格式
        'application/zip', 'application/x-rar-compressed', 'application/x-tar'
    ];
    
    // 现在支持所有文件类型上传，但只有特定类型支持AI分析
    const supportsAI = aiSupportedTypes.includes(file.type);
    
    if (!supportsAI) {
        console.log(`文件类型 ${file.type} 不支持AI分析，但可以上传和下载`);
    }
    
    // 将文件转换为base64以支持跨端分享
    const fileBase64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
    });
    
    // 创建文件消息
    const fileMessage = {
        type: 'file',
        file: {
            name: file.name,
            size: formatFileSize(file.size),
            type: file.type,
            url: URL.createObjectURL(file),
            base64: fileBase64 // 添加base64数据用于跨端分享
        },
        author: currentUsername,
        userId: currentUserId,
        timestamp: Date.now(), // 使用UTC时间戳
        time: new Date().toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit' 
        })
    };
    
    // 只本地显示，不添加到messages数组（避免重复）
    renderMessage(fileMessage);
    
    // 发送文件消息给其他用户（包含base64数据）
    if (isRealtimeEnabled && window.realtimeClient) {
        const fileMessageForOthers = {
            ...fileMessage,
            file: {
                ...fileMessage.file,
                url: null // 移除本地URL，其他用户使用base64数据
            }
        };
        const sent = window.realtimeClient.sendMessage(fileMessageForOthers);
        if (sent) {
            // 发送成功后才添加到本地消息列表
            messages.push(fileMessage);
            saveRoomData();
        } else {
            // 发送失败，仍然保存到本地
            messages.push(fileMessage);
            saveRoomData();
        }
    } else {
        // 无网络连接时直接保存到本地
        messages.push(fileMessage);
        saveRoomData();
    }
    
    // 调试：文件类型信息
    console.log('处理文件:', {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        supportsAI: supportsAI
    });
    
    // 根据文件类型处理内容
    if (supportsAI) {
        // 支持AI分析的文件类型
    if (file.type === 'text/plain') {
        await processTextFile(file, fileMessage);
    } else if (file.type.startsWith('image/')) {
        // 图片文件 - 设置文件信息但不自动处理
        window.currentFileInfo = {
            name: file.name,
            url: URL.createObjectURL(file),
            type: file.type
        };
        showAIToolbar(file.name, window.currentFileInfo.url, file.type);
    } else if (file.type === 'application/pdf' || file.type.includes('word')) {
        // PDF和Word文档 - 提取文本内容
        if (file.type === 'application/pdf') {
            await processPDFDocument(file, fileMessage);
        } else if (file.type.includes('word')) {
            await processWordDocument(file, fileMessage);
        }
        } else if (file.type.includes('excel') || file.type.includes('spreadsheet') || 
                   file.type === 'application/vnd.ms-excel' ||
                   file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
        // Excel文件
        await processExcelDocument(file, fileMessage);
    } else if (file.type.includes('powerpoint') || file.type.includes('presentation')) {
        // PPT文件
        await processPPTDocument(file, fileMessage);
    } else if (file.type === 'text/csv') {
        // CSV文件
        await processCSVFile(file, fileMessage);
    } else if (file.type === 'application/json') {
        // JSON文件
        await processJSONFile(file, fileMessage);
    } else if (file.type === 'text/html' || file.type === 'text/xml') {
        // HTML/XML文件
        await processHTMLFile(file, fileMessage);
    } else {
            // 其他支持AI的文件类型 - 尝试提取文本内容
        await processGenericFile(file, fileMessage);
        }
    } else {
        // 不支持AI分析的文件类型 - 只显示文件信息，不提供AI工具
        window.currentFileInfo = {
            name: file.name,
            url: URL.createObjectURL(file),
            type: file.type
        };
        
        showToast(`文件 ${file.name} 已上传，可供下载`, 'success');
        console.log(`不支持AI分析的文件类型: ${file.type}, 仅提供下载功能`);
    }
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 处理图片OCR
async function processImageWithOCR(file, fileMessage) {
    try {
        showToast('正在识别图片中的文字...', 'info');
        
        const base64Image = await fileToBase64(file);
        
        const response = await fetch('https://api.deepbricks.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.API_KEY}`
            },
            body: JSON.stringify({
                model: 'gemini-2.5-flash',
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: '请识别这张图片中的所有文字内容，并保持原有格式。如果图片中包含表格或结构化数据，请以清晰的格式呈现。'
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:${file.type};base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 1000
            })
        });
        
        if (!response.ok) {
            throw new Error('OCR识别失败');
        }
        
        const data = await response.json();
        const ocrText = data.choices[0].message.content;
        
        // 添加OCR结果消息
        const ocrMessage = {
            type: 'ocr',
            text: ocrText,
            originalFile: file.name,
            author: 'AI助手',
            userId: 'ai-assistant',
            time: new Date().toLocaleTimeString('zh-CN', { 
                hour: '2-digit', 
                minute: '2-digit' 
            })
        };
        
        messages.push(ocrMessage);
        renderMessage(ocrMessage);
        saveRoomData();
        
        // 发送OCR结果给其他用户
        if (isRealtimeEnabled && window.realtimeClient) {
            window.realtimeClient.sendMessage(ocrMessage);
        }
        
        showToast('OCR识别完成', 'success');
        
    } catch (error) {
        console.error('OCR识别失败:', error);
        showToast('OCR识别失败，请稍后重试', 'error');
    }
}

// 处理文本文件
async function processTextFile(file, fileMessage) {
    try {
        const text = await file.text();
        
        // 设置文件内容到currentFileInfo，供AI工具箱使用
        window.currentFileInfo = {
            name: file.name,
            url: URL.createObjectURL(file),
            type: file.type,
            content: text || '文本文件内容为空'
        };
        
        // 显示AI工具箱
        showAIToolbar(file.name, window.currentFileInfo.url, file.type);
        
    } catch (error) {
        console.error('文本文件读取失败:', error);
        showToast('文本文件读取失败', 'error');
    }
}

// 文件转Base64
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = error => reject(error);
    });
}

// 处理PDF文档
async function processPDFDocument(file, fileMessage) {
    try {
        showToast('正在提取PDF文档内容...', 'info');
        
        // 检查PDF.js是否加载
        if (typeof pdfjsLib === 'undefined') {
            throw new Error('PDF.js库未加载，请刷新页面重试');
        }
        
        const fileData = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: fileData }).promise;
        
        let fullText = '';
        const totalPages = pdf.numPages;
        
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n\n';
        }
        
        if (!fullText.trim()) {
            throw new Error('PDF文档中没有找到可提取的文本内容');
        }
        
        // 设置文件内容到currentFileInfo
        window.currentFileInfo = {
            name: file.name,
            url: URL.createObjectURL(file),
            type: file.type,
            content: fullText.trim() || 'PDF文档内容为空'
        };
        
        showAIToolbar(file.name, window.currentFileInfo.url, file.type);
        showToast('PDF文档内容提取完成', 'success');
        
    } catch (error) {
        console.error('PDF文档处理失败:', error);
        showToast(`PDF文档处理失败: ${error.message}`, 'error');
        
        // 即使失败也显示工具箱，但使用占位符内容
        window.currentFileInfo = {
            name: file.name,
            url: URL.createObjectURL(file),
            type: file.type,
            content: `这是一个PDF文档，但无法提取文本内容。请使用OCR功能或上传其他格式的文档。`
        };
        showAIToolbar(file.name, window.currentFileInfo.url, file.type);
    }
}

// 处理Word文档
async function processWordDocument(file, fileMessage) {
    try {
        showToast('正在提取Word文档内容...', 'info');
        
        // 检查mammoth.js是否加载
        if (typeof mammoth === 'undefined') {
            throw new Error('Mammoth.js库未加载，请刷新页面重试');
        }
        
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        
        if (!result.value.trim()) {
            throw new Error('Word文档中没有找到可提取的文本内容');
        }
        
        // 设置文件内容到currentFileInfo
        window.currentFileInfo = {
            name: file.name,
            url: URL.createObjectURL(file),
            type: file.type,
            content: result.value.trim() || '文档内容为空'
        };
        
        showAIToolbar(file.name, window.currentFileInfo.url, file.type);
        showToast('Word文档内容提取完成', 'success');
        
    } catch (error) {
        console.error('Word文档处理失败:', error);
        showToast(`Word文档处理失败: ${error.message}`, 'error');
        
        // 即使失败也显示工具箱，但使用占位符内容
        window.currentFileInfo = {
            name: file.name,
            url: URL.createObjectURL(file),
            type: file.type,
            content: `这是一个Word文档，但无法提取文本内容。请检查文档格式或上传其他格式的文档。`
        };
        showAIToolbar(file.name, window.currentFileInfo.url, file.type);
    }
}

// 渲染文件消息
function renderFileMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.type === 'file' ? 'file-message' : 'text-message'}`;
    messageDiv.dataset.messageId = Date.now(); // 添加唯一标识
    
    const avatarColor = message.author === 'AI助手' ? '#6b7280' : getAvatarColor(message.author);
    const initials = message.author.charAt(0).toUpperCase();
    
    // 处理时间显示：如果有时间戳，使用本地时区格式化；否则使用原始时间
    let displayTime;
    if (message.timestamp) {
        displayTime = new Date(message.timestamp).toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    } else {
        displayTime = message.time || new Date().toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }
    
    messageDiv.innerHTML = `
        <div class="message-avatar" style="background-color: ${avatarColor}">
            ${initials}
        </div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-author">${message.author}</span>
                <span class="message-time">${displayTime}</span>
            </div>
            ${renderFileContent(message)}
        </div>
    `;
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// 更新消息内容（用于替换加载消息）
function updateMessage(messageId, newText, isError = false) {
    // 更新DOM元素
    const messageDiv = document.querySelector(`[data-message-id="${messageId}"]`);
    if (messageDiv) {
        const contentDiv = messageDiv.querySelector('.message-content');
        const headerDiv = contentDiv.querySelector('.message-header');
        
        messageDiv.classList.remove('loading');
        
        contentDiv.innerHTML = `
            <div class="message-header">
                ${headerDiv.innerHTML}
            </div>
            <div class="message-text ${isError ? 'error-text' : ''}">${newText}</div>
        `;
    }
    
    // 更新messages数组中的对应消息
    const msgIndex = messages.findIndex(m => m.id === messageId);
    if (msgIndex !== -1) {
        messages[msgIndex].text = newText;
        messages[msgIndex].isLoading = false;
        
        // updateMessage现在只负责本地更新，不发送WebSocket消息
        // WebSocket发送由调用者单独处理
        
        // 保存到本地存储
        saveRoomData();
    }
}

// 添加加载消息并返回消息ID（仅本地显示，不发送给其他用户）
function addLoadingMessage(text) {
    const messageId = Date.now();
    const loadingMessage = {
        id: messageId,
        type: 'ai',
        text: text,
        author: 'AI助手',
        userId: 'ai-assistant',
        timestamp: Date.now(), // 使用UTC时间戳
        time: new Date().toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit' 
        }),
        isLoading: true
    };
    
    // 只在本地添加，不发送给其他用户（这只是加载占位符）
    messages.push(loadingMessage);
    renderMessage(loadingMessage);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    return messageId;
}

// 渲染文件内容
function renderFileContent(message) {
    if (message.type === 'file') {
        const icon = getFileIcon(message.file.type);
        const messageId = Date.now();
        // 扩展AI支持检测，包含更多文件类型
        const aiSupportedTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml',
            'application/pdf', 'text/plain', 'text/csv',
            // Word文档格式
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            // Excel表格格式
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            // PowerPoint演示文稿格式
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            // 其他文本格式
            'text/html', 'text/xml', 'application/json'
        ];
        
        const isSupportedForAI = aiSupportedTypes.includes(message.file.type);
        
        return `
            <div class="file-message" data-file-id="${messageId}" data-file-name="${message.file.name}" data-file-url="${message.file.url}" data-file-type="${message.file.type}">
                <i class="fas ${icon} file-icon"></i>
                <div class="file-info">
                    <div class="file-name">${message.file.name}</div>
                    <div class="file-size">${message.file.size}</div>
                    ${!isSupportedForAI ? '<div class="file-note">该文件类型暂不支持AI分析</div>' : ''}
                </div>
                <div class="file-actions">
                    <a href="${message.file.url}" download="${message.file.name}" class="file-download" title="下载文件">
                        <i class="fas fa-download"></i>
                    </a>
                    ${isSupportedForAI ? 
                        `<button class="btn-ai-tool" onclick="window.showAIToolbar('${message.file.name}', '${message.file.url}', '${message.file.type}')" title="AI工具">
                            <i class="fas fa-magic"></i>
                        </button>` : ''
                    }
                </div>
            </div>
        `;
    } else if (message.type === 'ocr') {
        return `
            <div class="ocr-result">
                <strong>图片文字识别结果 (${message.originalFile}):</strong>
                <div class="message-text">${message.text}</div>
            </div>
        `;
    } else if (message.type === 'text') {
        return `
            <div class="text-content">
                <strong>文本文件内容 (${message.originalFile}):</strong>
                <div class="message-text"><pre>${message.text}</pre></div>
            </div>
        `;
    }
}

// 获取文件图标
function getFileIcon(fileType) {
    if (fileType.startsWith('image/')) return 'fa-image';
    if (fileType === 'application/pdf') return 'fa-file-pdf';
    if (fileType.includes('word')) return 'fa-file-word';
    if (fileType.includes('excel') || fileType.includes('spreadsheet')) return 'fa-file-excel';
    if (fileType.includes('powerpoint') || fileType.includes('presentation')) return 'fa-file-powerpoint';
    if (fileType === 'text/plain') return 'fa-file-alt';
    if (fileType === 'text/csv') return 'fa-file-csv';
    if (fileType === 'application/json') return 'fa-file-code';
    if (fileType === 'text/html' || fileType === 'text/xml') return 'fa-file-code';
    if (fileType.includes('zip') || fileType.includes('rar') || fileType.includes('tar')) return 'fa-file-archive';
    if (fileType.startsWith('video/')) return 'fa-file-video';
    if (fileType.startsWith('audio/')) return 'fa-file-audio';
    return 'fa-file';
}

// AI工具箱面板功能 - 根据文件类型动态显示工具
async function showAIToolbar(fileName, fileUrl, fileType) {
    const placeholder = document.getElementById('toolboxPlaceholder');
    const activePanel = document.getElementById('toolboxActive');
    const currentFileName = document.getElementById('currentFileName');
    
    // 检查是否需要重新处理文件内容
    const needsContentProcessing = !window.currentFileInfo || 
                                  window.currentFileInfo.name !== fileName || 
                                  !window.currentFileInfo.content;
    
    // 设置当前文件信息到全局变量
    if (!window.currentFileInfo) {
        window.currentFileInfo = {};
    }
    
    // 保留现有的content，更新其他属性
    const existingContent = needsContentProcessing ? undefined : window.currentFileInfo.content;
    window.currentFileInfo = {
        name: fileName,
        url: fileUrl,
        type: fileType,
        content: existingContent
    };
    
    console.log('showAIToolbar设置文件信息:', {
        fileName: fileName,
        hasContent: !!window.currentFileInfo.content,
        contentLength: window.currentFileInfo.content ? window.currentFileInfo.content.length : 0,
        needsProcessing: needsContentProcessing
    });
    
    // 如果需要处理文件内容，异步下载并处理
    if (needsContentProcessing) {
        await processRemoteFile(fileName, fileUrl, fileType);
    }
    
    // 获取所有工具按钮
    const ocrBtn = document.getElementById('ocrBtn');
    const translateBtn = document.getElementById('translateBtn');
    const summarizeBtn = document.getElementById('summarizeBtn');
    const keywordsBtn = document.getElementById('keywordsBtn');
    
    // 扩展支持的文件类型检查
    const aiSupportedTypes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml',
        'application/pdf', 'text/plain', 'text/csv',
        // Word文档格式
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        // Excel表格格式
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        // PowerPoint演示文稿格式
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        // 其他文本格式
        'text/html', 'text/xml', 'application/json'
    ];
    
    const isSupportedForAI = aiSupportedTypes.includes(fileType);
    
    // 根据文件类型动态显示/隐藏工具按钮
    const isImage = fileType && fileType.startsWith('image/');
    const isText = fileType && (
        fileType === 'text/plain' || 
        fileType === 'text/csv' ||
        fileType === 'application/json' ||
        fileType === 'text/html' ||
        fileType === 'text/xml' ||
        fileType === 'application/pdf' ||
        // Word文档
        fileType === 'application/msword' ||
        fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        // Excel表格
        fileType === 'application/vnd.ms-excel' ||
        fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        // PowerPoint演示文稿
        fileType === 'application/vnd.ms-powerpoint' ||
        fileType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    );
    
    // 对于不支持AI分析的文件类型，完全隐藏AI工具箱
    if (!isSupportedForAI) {
        placeholder.style.display = 'block';
        activePanel.style.display = 'none';
        return;
    }
    
    // 显示文件名
    currentFileName.textContent = fileName;
    
    // OCR - 仅图片可用
    ocrBtn.style.display = isImage ? 'flex' : 'none';
    ocrBtn.disabled = !isImage;
    
    // 翻译、总结、关键词 - 文本类文件可用
    translateBtn.style.display = isText ? 'flex' : 'none';
    summarizeBtn.style.display = isText ? 'flex' : 'none';
    keywordsBtn.style.display = isText ? 'flex' : 'none';
    
    translateBtn.disabled = !isText;
    summarizeBtn.disabled = !isText;
    keywordsBtn.disabled = !isText;
    
    // 显示活跃面板
    placeholder.style.display = 'none';
    activePanel.style.display = 'block';
}

function performOCR() {
    if (!window.currentFileInfo || !window.currentFileInfo.type.startsWith('image/')) {
        showToast('此功能仅适用于图片文件', 'error');
        return;
    }
    
    const { name, url, type } = window.currentFileInfo;
    
    // 添加加载消息并获取消息ID
    const messageId = addLoadingMessage(`正在对图片 "${name}" 进行OCR文字识别，请稍候...`);
    
    // 创建临时文件对象
    fetch(url)
        .then(res => res.blob())
        .then(blob => {
            const file = new File([blob], name, { type: type });
            return processImageWithOCR(file, { name: name });
        })
        .then(() => {
            // 处理完成，更新加载消息为成功消息
            updateMessage(messageId, `OCR文字识别完成！识别结果已添加到聊天记录中。`);
            
            // 同时创建一个新的AI消息发送给其他用户
            const aiMessage = {
                type: 'ai',
                text: `OCR文字识别完成！识别结果已添加到聊天记录中。`,
                author: 'AI助手',
                userId: 'ai-assistant',
                time: new Date().toLocaleTimeString('zh-CN', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                })
            };
            
            // 发送给其他用户
            if (isRealtimeEnabled && window.realtimeClient) {
                window.realtimeClient.sendMessage(aiMessage);
            }
        })
        .catch(err => {
            console.error('获取文件失败:', err);
            
            // 处理失败，更新加载消息为错误消息
            updateMessage(messageId, `抱歉，对图片 "${name}" 进行OCR识别时出错：${err.message}`, true);
        });
}

async function translateText() {
    if (!window.currentFileInfo) {
        showToast('请先选择文件', 'error');
        return;
    }
    
    const { name, content } = window.currentFileInfo;
    
    // 添加加载消息并获取消息ID
    const messageId = addLoadingMessage(`正在翻译文件 "${name}" 的内容，请稍候...`);
    
    try {
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.API_KEY}`
            },
            body: JSON.stringify({
                model: CONFIG.MODEL,
                messages: [
                    {
                        role: 'system',
                        content: '你是一个专业的翻译助手，请将用户提供的文本翻译成中文。请保持原文格式，准确翻译内容。'
                    },
                    {
                        role: 'user',
                        content: `请翻译以下内容：\n\n${content || '文档内容为空'}`
                    }
                ],
                max_tokens: 1000,
                temperature: 0.3
            })
        });
        
        if (!response.ok) {
            throw new Error('翻译服务响应异常');
        }
        
        const data = await response.json();
        const translatedText = data.choices[0].message.content;
        
        // 更新加载消息为成功结果
        updateMessage(messageId, `📋 **文件翻译完成：${name}**\n\n${translatedText}`);
        
        // 同时创建一个新的AI消息发送给其他用户
        const aiMessage = {
            type: 'ai',
            text: `📋 **文件翻译完成：${name}**\n\n${translatedText}`,
            author: 'AI助手',
            userId: 'ai-assistant',
            time: new Date().toLocaleTimeString('zh-CN', { 
                hour: '2-digit', 
                minute: '2-digit' 
            })
        };
        
        // 发送给其他用户
        if (isRealtimeEnabled && window.realtimeClient) {
            window.realtimeClient.sendMessage(aiMessage);
        }
        
    } catch (error) {
        console.error('翻译失败:', error);
        
        // 更新加载消息为错误结果
        updateMessage(messageId, `❌ 翻译失败：${error.message}。请稍后重试。`, true);
    }
}

async function summarizeText() {
    if (!window.currentFileInfo) {
        showToast('请先选择文件', 'error');
        return;
    }
    
    const { name, content } = window.currentFileInfo;
    
    // 调试信息
    console.log('总结函数调用:', {
        fileName: name,
        hasContent: !!content,
        contentLength: content ? content.length : 0,
        contentPreview: content ? content.substring(0, 100) + '...' : 'null/undefined'
    });
    
    // 添加加载消息并获取消息ID
    const messageId = addLoadingMessage(`正在总结文件 "${name}" 的内容，请稍候...`);
    
    try {
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.API_KEY}`
            },
            body: JSON.stringify({
                model: CONFIG.MODEL,
                messages: [
                    {
                        role: 'system',
                        content: '你是一个专业的文本总结助手，请为用户提供简洁准确的文本摘要。请用中文总结，突出关键信息和要点。'
                    },
                    {
                        role: 'user',
                        content: `请总结以下文本内容，提供简洁的摘要：\n\n${content || '文档内容为空'}`
                    }
                ],
                max_tokens: 500,
                temperature: 0.3
            })
        });
        
        if (!response.ok) {
            throw new Error('总结服务响应异常');
        }
        
        const data = await response.json();
        const summary = data.choices[0].message.content;
        
        // 更新加载消息为成功结果
        updateMessage(messageId, `📝 **文件总结：${name}**\n\n${summary}`);
        
        // 同时创建一个新的AI消息发送给其他用户
        const aiMessage = {
            type: 'ai',
            text: `📝 **文件总结：${name}**\n\n${summary}`,
            author: 'AI助手',
            userId: 'ai-assistant',
            time: new Date().toLocaleTimeString('zh-CN', { 
                hour: '2-digit', 
                minute: '2-digit' 
            })
        };
        
        // 发送给其他用户
        if (isRealtimeEnabled && window.realtimeClient) {
            window.realtimeClient.sendMessage(aiMessage);
        }
        
    } catch (error) {
        console.error('总结失败:', error);
        
        // 更新加载消息为错误结果
        updateMessage(messageId, `❌ 总结失败：${error.message}。请稍后重试。`, true);
    }
}

async function extractKeywords() {
    if (!window.currentFileInfo) {
        showToast('请先选择文件', 'error');
        return;
    }
    
    const { name, content } = window.currentFileInfo;
    
    // 添加加载消息并获取消息ID
    const messageId = addLoadingMessage(`正在从文件 "${name}" 中提取关键词，请稍候...`);
    
    try {
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.API_KEY}`
            },
            body: JSON.stringify({
                model: CONFIG.MODEL,
                messages: [
                    {
                        role: 'system',
                        content: '你是一个专业的关键词提取助手，请从文本中提取最重要的关键词和短语。请用中文回复，列出5-10个关键词，并简要说明每个关键词的重要性。'
                    },
                    {
                        role: 'user',
                        content: `请从以下文本中提取关键词：\n\n${content || '文档内容为空'}`
                    }
                ],
                max_tokens: 400,
                temperature: 0.3
            })
        });
        
        if (!response.ok) {
            throw new Error('关键词提取服务响应异常');
        }
        
        const data = await response.json();
        const keywords = data.choices[0].message.content;
        
        // 更新加载消息为成功结果
        updateMessage(messageId, `🔑 **关键词提取：${name}**\n\n${keywords}`);
        
        // 同时创建一个新的AI消息发送给其他用户
        const aiMessage = {
            type: 'ai',
            text: `🔑 **关键词提取：${name}**\n\n${keywords}`,
            author: 'AI助手',
            userId: 'ai-assistant',
            time: new Date().toLocaleTimeString('zh-CN', { 
                hour: '2-digit', 
                minute: '2-digit' 
            })
        };
        
        // 发送给其他用户
        if (isRealtimeEnabled && window.realtimeClient) {
            window.realtimeClient.sendMessage(aiMessage);
        }
        
    } catch (error) {
        console.error('关键词提取失败:', error);
        
        // 更新加载消息为错误结果
        updateMessage(messageId, `❌ 关键词提取失败：${error.message}。请稍后重试。`, true);
    }
}





// 测试XLSX库函数
function testXLSXLibrary() {
    console.log('=== XLSX库测试 ===');
    console.log('XLSX对象:', typeof XLSX);
    if (typeof XLSX !== 'undefined') {
        console.log('XLSX.version:', XLSX.version);
        console.log('XLSX.utils存在:', !!XLSX.utils);
        console.log('sheet_to_csv方法存在:', typeof XLSX.utils.sheet_to_csv);
        console.log('sheet_to_json方法存在:', typeof XLSX.utils.sheet_to_json);
        
        // 在页面上也显示状态
        showToast(`XLSX库状态: 已加载 (版本: ${XLSX.version})`, 'success');
    } else {
        console.error('XLSX库未加载！');
        showToast('XLSX库未加载！请检查网络连接', 'error');
    }
    console.log('==================');
}

// 处理远程文件（其他用户上传的文件）
async function processRemoteFile(fileName, fileUrl, fileType) {
    try {
        showToast(`正在处理远程文件 "${fileName}"...`, 'info');
        console.log('开始处理远程文件:', {fileName, fileUrl, fileType});
        
        // 下载文件
        const response = await fetch(fileUrl);
        if (!response.ok) {
            throw new Error(`下载文件失败: ${response.status}`);
        }
        
        const blob = await response.blob();
        const file = new File([blob], fileName, { type: fileType });
        
        console.log('远程文件下载完成:', {
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type
        });
        
        // 根据文件类型处理内容
        if (fileType === 'text/plain') {
            await processTextFileContent(file);
        } else if (fileType.startsWith('image/')) {
            // 图片文件不需要内容处理，直接使用
            window.currentFileInfo.content = `图片文件: ${fileName}`;
        } else if (fileType === 'application/pdf') {
            await processPDFFileContent(file);
        } else if (fileType.includes('word') || 
                   fileType === 'application/msword' ||
                   fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            await processWordFileContent(file);
        } else if (fileType.includes('excel') || fileType.includes('spreadsheet') ||
                   fileType === 'application/vnd.ms-excel' ||
                   fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
            await processExcelFileContent(file);
        } else if (fileType.includes('powerpoint') || fileType.includes('presentation') ||
                   fileType === 'application/vnd.ms-powerpoint' ||
                   fileType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
            await processPPTFileContent(file);
        } else if (fileType === 'text/csv') {
            await processCSVFileContent(file);
        } else if (fileType === 'application/json') {
            await processJSONFileContent(file);
        } else {
            // 不支持的文件类型
            window.currentFileInfo.content = `文件: ${fileName}\n文件大小: ${formatFileSize(file.size)}\n文件类型: ${fileType}\n\n这是一个二进制文件，无法直接解析其内容。`;
        }
        
        console.log('远程文件处理完成:', {
            fileName: fileName,
            hasContent: !!window.currentFileInfo.content,
            contentLength: window.currentFileInfo.content ? window.currentFileInfo.content.length : 0
        });
        
        showToast('远程文件处理完成，可以进行AI分析', 'success');
        
    } catch (error) {
        console.error('处理远程文件失败:', error);
        showToast(`处理远程文件失败: ${error.message}`, 'error');
        
        // 设置占位符内容
        window.currentFileInfo.content = `远程文件处理失败: ${error.message}`;
    }
}

// 辅助函数：处理各类文件内容（不包含UI更新）
async function processTextFileContent(file) {
    const text = await file.text();
    window.currentFileInfo.content = `文本文件: ${file.name}\n文件大小: ${formatFileSize(file.size)}\n\n内容：\n${text}`;
}

async function processPDFFileContent(file) {
    if (typeof pdfjsLib === 'undefined') {
        throw new Error('PDF.js库未加载');
    }
    
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    let fullText = '';
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + '\n\n';
    }
    
    window.currentFileInfo.content = fullText.trim() || 'PDF文档内容为空';
}

async function processWordFileContent(file) {
    if (typeof mammoth === 'undefined') {
        throw new Error('Mammoth.js库未加载');
    }
    
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    window.currentFileInfo.content = result.value.trim() || 'Word文档内容为空';
}

async function processExcelFileContent(file) {
    if (typeof XLSX === 'undefined') {
        throw new Error('XLSX.js库未加载');
    }
    
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    
    let allSheetsContent = '';
    const sheetNames = workbook.SheetNames;
    
    for (let i = 0; i < sheetNames.length; i++) {
        const sheetName = sheetNames[i];
        const worksheet = workbook.Sheets[sheetName];
        
        try {
            let sheetContent = '';
            
            if (typeof XLSX.utils.sheet_to_csv === 'function') {
                const csvData = XLSX.utils.sheet_to_csv(worksheet);
                if (csvData && csvData.trim()) {
                    sheetContent = csvData.trim();
                }
            }
            
            if (!sheetContent && typeof XLSX.utils.sheet_to_json === 'function') {
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                if (jsonData && jsonData.length > 0) {
                    sheetContent = jsonData.map(row => (row || []).join('\t')).filter(line => line.trim()).join('\n');
                }
            }
            
            if (sheetContent && sheetContent.trim()) {
                allSheetsContent += `\n=== 工作表: ${sheetName} ===\n`;
                allSheetsContent += sheetContent.trim() + '\n';
            }
        } catch (sheetError) {
            console.warn(`处理工作表 ${sheetName} 失败:`, sheetError);
        }
    }
    
    const content = `Excel文件: ${file.name}\n文件大小: ${formatFileSize(file.size)}\n工作表数量: ${sheetNames.length}\n\n内容：${allSheetsContent.trim()}`;
    window.currentFileInfo.content = content;
}

async function processPPTFileContent(file) {
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const isZipFormat = uint8Array[0] === 0x50 && uint8Array[1] === 0x4B;
    
    let content = `PowerPoint文件: ${file.name}\n文件大小: ${formatFileSize(file.size)}\n文件类型: ${file.type}\n\n`;
    
    if (isZipFormat) {
        content += `文件格式：PowerPoint 2007+ (.pptx)\n压缩格式：是（基于XML）\n\n`;
        content += `内容摘要：这是一个现代PowerPoint演示文稿文件。由于PPT文件结构复杂，无法直接提取文本内容，但您可以使用AI工具进行智能分析。`;
    } else {
        content += `文件格式：PowerPoint 97-2003 (.ppt)\n压缩格式：否（二进制格式）\n\n`;
        content += `内容摘要：这是一个传统PowerPoint演示文稿文件。建议转换为.pptx格式以获得更好的兼容性，或使用AI工具进行内容分析。`;
    }
    
    window.currentFileInfo.content = content;
}

async function processCSVFileContent(file) {
    const text = await file.text();
    window.currentFileInfo.content = `CSV文件: ${file.name}\n文件大小: ${formatFileSize(file.size)}\n\n内容：\n${text}`;
}

async function processJSONFileContent(file) {
    const text = await file.text();
    try {
        const jsonObj = JSON.parse(text);
        const formattedJson = JSON.stringify(jsonObj, null, 2);
        window.currentFileInfo.content = `JSON文件: ${file.name}\n文件大小: ${formatFileSize(file.size)}\n\n格式化内容：\n${formattedJson}`;
    } catch (error) {
        window.currentFileInfo.content = `JSON文件: ${file.name}\n文件大小: ${formatFileSize(file.size)}\n\n原始内容：\n${text}`;
    }
}

// 将函数暴露到全局作用域
window.showAIToolbar = showAIToolbar;
window.performOCR = performOCR;
window.translateText = translateText;
window.summarizeText = summarizeText;
window.extractKeywords = extractKeywords;
window.testXLSXLibrary = testXLSXLibrary;
window.processRemoteFile = processRemoteFile;

// 修改renderMessage函数以支持文件消息
const originalRenderMessage = renderMessage;
renderMessage = function(message) {
    if (message.type === 'file' || message.type === 'ocr' || message.type === 'text') {
        renderFileMessage(message);
    } else {
        originalRenderMessage(message);
    }
};

// 页面加载完成后初始化应用
document.addEventListener('DOMContentLoaded', init);

// 语音相关全局变量
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let audioContext = null;
let recognition = null;
let isTranscribing = false;
let currentAudioBlob = null;
let audioQueue = [];
let isPlayingAudio = false;

// 语音通话相关变量
let localStream = null;
let remoteStreams = new Map(); // userId -> MediaStream
let peerConnections = new Map(); // userId -> RTCPeerConnection
let isInCall = false;
let isMuted = false;
let isSpeakerOn = true;
let callParticipants = new Set();
let callStartTime = null;
let callDuration = null;

// ==================== 转录面板控制函数 ====================

// 转录面板现在固定显示，此函数用于兼容性
function toggleTranscriptionPanel() {
    // 转录面板现在固定在右侧栏中，总是可见
    showToast('转录面板已固定在右侧', 'info');
    return;
    
    const panel = document.getElementById('transcriptionPanel');
    const btn = document.getElementById('transcribeBtn');
    
    if (panel && btn) {
        if (panel.style.display === 'none' || !panel.style.display) {
            panel.style.display = 'flex';
            btn.classList.add('active');
            btn.style.background = '#10b981';
            showToast('转录面板已打开', 'info');
        } else {
            panel.style.display = 'none';
            btn.classList.remove('active');
            btn.style.background = '';
            
            // 如果正在录音，停止录音
            if (window.transcriptionClient && window.transcriptionClient.isRecording) {
                window.transcriptionClient.stopRecording();
            }
            showToast('转录面板已关闭', 'info');
        }
    }
}

// 关闭转录面板
function closeTranscription() {
    const panel = document.getElementById('transcriptionPanel');
    const btn = document.getElementById('transcribeBtn');
    
    if (panel) {
        panel.style.display = 'none';
    }
    
    if (btn) {
        btn.classList.remove('active');
        btn.style.background = '';
    }
    
    // 如果正在录音，停止录音
    if (window.transcriptionClient && window.transcriptionClient.isRecording) {
        window.transcriptionClient.stopRecording();
    }
    
    showToast('转录面板已关闭', 'info');
}

// 测试麦克风功能
async function testMicrophone() {
    const btn = document.getElementById('testMicBtn');
    
    if (!btn) return;
    
    try {
        // 更新按钮状态
        btn.classList.add('testing');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        btn.title = '正在测试麦克风...';
        
        // 检查浏览器支持 - 兼容多种API
        const getUserMedia = getCompatibleGetUserMedia();
        if (!getUserMedia) {
            throw new Error('浏览器不支持麦克风访问，请使用Chrome、Firefox或Safari浏览器');
        }
        
        // 检查环境安全性
        if (!isSecureEnvironment()) {
            throw new Error('非安全环境无法访问麦克风，请使用localhost访问或部署HTTPS');
        }
        
        // 尝试获取麦克风权限（不保存流）
        console.log('正在测试麦克风权限...');
        const testStream = await getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        // 立即停止测试流
        testStream.getTracks().forEach(track => track.stop());
        
        console.log('✅ 麦克风权限测试通过');
        showToast('✅ 麦克风权限测试通过，可以正常使用转录功能', 'success');
        
        // 更新按钮状态为成功
        btn.classList.remove('testing');
        btn.classList.add('success');
        btn.innerHTML = '<i class="fas fa-check"></i>';
        btn.title = '麦克风权限正常';
        
        // 3秒后恢复原始状态
        setTimeout(() => {
            btn.classList.remove('success');
            btn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
            btn.title = '测试麦克风';
        }, 3000);
        
    } catch (error) {
        console.warn('⚠️ 麦克风权限测试失败:', error);
        
        let warningMessage = '麦克风权限测试失败';
        
        if (error.name === 'NotAllowedError') {
            warningMessage = '麦克风权限被拒绝，请点击地址栏的麦克风图标并选择"允许"';
        } else if (error.name === 'NotFoundError') {
            warningMessage = '未找到麦克风设备，请检查麦克风连接';
        } else if (error.name === 'NotSupportedError') {
            warningMessage = '浏览器不支持麦克风功能';
        } else if (error.name === 'NotReadableError') {
            warningMessage = '麦克风被其他应用占用，请关闭其他使用麦克风的应用';
        } else if (error.name === 'OverconstrainedError') {
            warningMessage = '麦克风配置不兼容，请尝试刷新页面';
        } else {
            warningMessage = `麦克风测试失败: ${error.message}`;
        }
        
        showToast(warningMessage, 'error');
        
        // 更新按钮状态为失败
        btn.classList.remove('testing');
        btn.classList.add('error');
        btn.innerHTML = '<i class="fas fa-times"></i>';
        btn.title = '麦克风权限测试失败';
        
        // 3秒后恢复原始状态
        setTimeout(() => {
            btn.classList.remove('error');
            btn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
            btn.title = '测试麦克风';
        }, 3000);
    }
}

// 开始转录函数
function startTranscription() {
    if (window.transcriptionClient) {
        window.transcriptionClient.startStreamingMode(roomId);
        
        // 记录开始时间
        window.transcriptionClient.transcriptionStartTime = new Date();
        
        // 重置累积内容
        window.transcriptionClient.fullTranscriptionText = '';
        
        // 更新UI
        document.getElementById('startRecordBtn').style.display = 'none';
        document.getElementById('stopRecordBtn').style.display = 'block';
        document.getElementById('downloadBtn').style.display = 'none';
        
        // 更新状态
        const statusDiv = document.getElementById('transcriptionStatus');
        if (statusDiv) {
            const iconSpan = statusDiv.querySelector('i');
            const textSpan = statusDiv.querySelector('span');
            if (iconSpan && textSpan) {
                iconSpan.className = 'fas fa-microphone';
                textSpan.textContent = '正在转录...';
                statusDiv.style.color = '#22c55e';
            }
        }
        
        showToast('开始语音转录', 'success');
    } else {
        showToast('转录服务未初始化，请刷新页面', 'error');
    }
}

// 停止转录函数
function stopTranscription() {
    if (window.transcriptionClient) {
        window.transcriptionClient.stopStreamingMode();
        
        // 更新UI
        document.getElementById('startRecordBtn').style.display = 'block';
        document.getElementById('stopRecordBtn').style.display = 'none';
        
        // 更新状态
        const statusDiv = document.getElementById('transcriptionStatus');
        if (statusDiv) {
            const iconSpan = statusDiv.querySelector('i');
            const textSpan = statusDiv.querySelector('span');
            if (iconSpan && textSpan) {
                iconSpan.className = 'fas fa-microphone-slash';
                textSpan.textContent = '转录已停止';
                statusDiv.style.color = '#6b7280';
            }
        }
        
        // 如果有转录内容，显示下载按钮
        if (window.transcriptionClient.fullTranscriptionText.length > 0) {
            document.getElementById('downloadBtn').style.display = 'block';
        }
        
        showToast('转录已停止', 'info');
    } else {
        showToast('转录服务未初始化，请刷新页面', 'error');
    }
}

// 下载转录文档函数
function downloadTranscription() {
    if (!window.transcriptionClient || !window.transcriptionClient.fullTranscriptionText) {
        showToast('没有可下载的转录内容', 'warning');
        return;
    }
    
    const content = window.transcriptionClient.fullTranscriptionText;
    const startTime = window.transcriptionClient.transcriptionStartTime || new Date();
    const timestamp = startTime.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).replace(/[/\\:*?"<>|]/g, '-');
    
    // 创建文档内容
    const documentContent = `会议转录文档
===================

房间: ${roomId || '未知'}
开始时间: ${startTime.toLocaleString('zh-CN')}
结束时间: ${new Date().toLocaleString('zh-CN')}
转录内容长度: ${content.length} 字符

转录内容:
===================

${content}

===================
此文档由 Vibe Meeting 实时转录功能生成
`;
    
    // 创建并下载文件
    const blob = new Blob([documentContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `会议转录-${timestamp}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('转录文档已下载', 'success');
}

// 兼容函数：保持向后兼容
function toggleTranscription() {
    // 检查当前状态并切换
    const startBtn = document.getElementById('startRecordBtn');
    const stopBtn = document.getElementById('stopRecordBtn');
    
    if (startBtn && startBtn.style.display !== 'none') {
        startTranscription();
    } else if (stopBtn && stopBtn.style.display !== 'none') {
        stopTranscription();
    }
}
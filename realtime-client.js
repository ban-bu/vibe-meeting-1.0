// 实时通信客户端模块
// 这个文件用于集成到现有的 app.js 中，实现WebSocket实时通信功能

class RealtimeClient {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 2000; // 增加初始重连延迟到2秒
        this.maxReconnectDelay = 30000; // 最大重连延迟30秒
        this.serverUrl = this.getServerUrl();
        this.currentRoomId = null;
        this.currentUserId = null;
        this.currentUsername = null;
        this.reconnectTimer = null;
        this.isReconnecting = false;
        
        // 连接质量监控
        this.connectionQuality = 'unknown'; // good, fair, poor, unknown
        this.failedAttempts = 0;
        this.lastSuccessfulConnection = null;
        
        // 事件回调
        this.onMessageReceived = null;
        this.onParticipantsUpdate = null;
        this.onUserJoined = null;
        this.onUserLeft = null;
        this.onConnectionChange = null;
        this.onError = null;
        this.onRoomData = null;
        this.onUserTyping = null;
        
        // 科大讯飞转录回调
        this.onXfyunConnected = null;
        this.onXfyunResult = null;
        this.onXfyunError = null;
        
        // 通话状态回调
        this.onCallStateUpdate = null;
        this.onJoinCallSuccess = null;
        this.onUserJoinedCall = null;
        
        // 检测运行环境
        this.isHuggingFace = window.location.hostname.includes('huggingface.co');
        this.isRailway = window.location.hostname.includes('railway.app') || window.location.hostname.includes('up.railway.app');
        this.isLanEnvironment = this.isLanAddress(window.location.hostname);
        this.latencyTimer = null;
        this.lastLatencyMs = null;
        
        this.init();
    }
    
    getServerUrl() {
        // 根据部署环境自动检测服务器地址
        const hostname = window.location.hostname;
        const protocol = window.location.protocol;
        const port = window.location.port;
        
        // 检查是否为局域网IP地址
        const isLanIp = this.isLanAddress(hostname);
        
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            // 本地开发环境
            if (port === '8080' || port === '3000') {
                // 如果前端运行在8080或3000端口，后端运行在3001
                return 'http://localhost:3001';
            } else if (port === '3001') {
                // 如果前端运行在3001端口，使用当前域名（统一部署）
                return `${protocol}//${hostname}${port ? ':' + port : ''}`;
            } else {
                // 如果是统一部署，使用当前域名
                return `${protocol}//${hostname}${port ? ':' + port : ''}`;
            }
        } else if (isLanIp) {
            // 局域网环境 - 始终使用当前页面的协议与端口（例如 https://IP:3443）
            return `${protocol}//${hostname}${port ? ':' + port : ''}`;
        } else if (hostname.includes('railway.app') || hostname.includes('up.railway.app')) {
            // Railway环境 - 使用当前域名，因为前后端部署在同一个服务
            return `${protocol}//${hostname}`;
        } else if (hostname.includes('huggingface.co')) {
            // Hugging Face环境 - 需要用户配置或使用公共服务器
            return localStorage.getItem('vibe_server_url') || 'wss://your-deployed-server.com';
        } else {
            // 其他生产环境
            // 首先尝试使用当前域名（适用于统一部署）
            const currentOrigin = `${protocol}//${hostname}${port ? ':' + port : ''}`;
            return localStorage.getItem('vibe_server_url') || currentOrigin;
        }
    }
    
    // 检查IP地址是否为局域网地址
    isLanAddress(ip) {
        // IPv4局域网地址范围：
        // 192.168.0.0/16 (192.168.0.0 to 192.168.255.255)
        // 10.0.0.0/8 (10.0.0.0 to 10.255.255.255)
        // 172.16.0.0/12 (172.16.0.0 to 172.31.255.255)
        return /^192\.168\.\d{1,3}\.\d{1,3}$/.test(ip) ||
               /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) ||
               /^172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(ip);
    }
    
    init() {
        if (this.isHuggingFace) {
            // 在Hugging Face环境中显示服务器配置提示
            this.showServerConfigModal();
        } else if (this.isRailway) {
            // Railway环境直接连接
            console.log('检测到Railway环境，使用统一部署模式');
            this.connect();
        } else {
            this.connect();
        }
    }
    
    showServerConfigModal() {
        const savedUrl = localStorage.getItem('vibe_server_url');
        if (savedUrl) {
            this.serverUrl = savedUrl;
            this.connect();
            return;
        }
        
        // 显示服务器配置模态框
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'block';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>配置实时服务器</h3>
                </div>
                <div class="modal-body">
                    <p>为了实现多端实时聊天，请配置您的WebSocket服务器地址：</p>
                    <div class="input-group">
                        <label for="serverUrlInput">服务器地址</label>
                        <input 
                            type="url" 
                            id="serverUrlInput" 
                            placeholder="wss://your-server.com 或 ws://localhost:3001"
                            value=""
                        />
                        <small>可以使用Railway、Vercel、Heroku等平台部署后端服务</small>
                    </div>
                    <div class="server-options">
                        <button class="btn-secondary" onclick="window.realtimeClient.useLocalMode()">
                            暂时使用本地模式
                        </button>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-primary" onclick="window.realtimeClient.saveServerConfig()">
                        连接服务器
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    saveServerConfig() {
        const input = document.getElementById('serverUrlInput');
        const url = input.value.trim();
        
        if (!url) {
            alert('请输入服务器地址');
            return;
        }
        
        // 验证URL格式
        try {
            new URL(url);
        } catch {
            alert('服务器地址格式不正确');
            return;
        }
        
        localStorage.setItem('vibe_server_url', url);
        this.serverUrl = url;
        
        // 关闭模态框
        const modal = document.querySelector('.modal');
        modal.remove();
        
        // 连接服务器
        this.connect();
    }
    
    useLocalMode() {
        // 关闭模态框，继续使用本地存储模式
        const modal = document.querySelector('.modal');
        modal.remove();
        
        showToast('已切换到本地模式，无法实现多端实时同步', 'warning');
        
        // 设置标记，表示使用本地模式
        this.localMode = true;
        
        if (this.onConnectionChange) {
            this.onConnectionChange(false);
        }
    }
    
    connect() {
        if (this.localMode) return;
        
        // 防止重复连接
        if (this.isConnected || this.isReconnecting) {
            console.log('⚠️ 连接已存在或正在连接中，跳过重复连接');
            return;
        }
        
        try {
            // 尝试加载Socket.IO客户端
            if (typeof io === 'undefined') {
                this.loadSocketIOClient(() => this.establishConnection());
            } else {
                // 延迟一帧，确保DOM和事件处理器先完成注册
                setTimeout(() => this.establishConnection(), 0);
            }
        } catch (error) {
            console.error('连接失败:', error);
            this.handleConnectionError(error);
        }
    }
    
    loadSocketIOClient(callback) {
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.4/socket.io.min.js';
        script.onload = callback;
        script.onerror = () => {
            console.error('无法加载Socket.IO客户端');
            this.handleConnectionError(new Error('无法加载Socket.IO客户端'));
        };
        document.head.appendChild(script);
    }
    
    establishConnection() {
        // 如果正在重连，不要重复连接
        if (this.isReconnecting) {
            console.log('正在重连中，跳过重复连接');
            return;
        }
        
        this.isReconnecting = true;
        
        console.log('🔗 尝试连接到服务器:', this.serverUrl);
        console.log('🌍 当前环境信息:', {
            hostname: window.location.hostname,
            protocol: window.location.protocol,
            port: window.location.port,
            isRailway: this.isRailway,
            isLanEnvironment: this.isLanEnvironment,
            serverUrl: this.serverUrl
        });
        
        // 连接配置
        const socketConfig = {
            timeout: 30000, // 增加超时时间到30秒，Railway环境较慢
            reconnection: false, // 禁用自动重连，使用自定义重连逻辑
            reconnectionAttempts: 0,
            reconnectionDelay: 0,
            forceNew: true, // 强制创建新连接
            upgrade: true,
            rememberUpgrade: false,
            transports: ['websocket', 'polling'],
            withCredentials: true
        };
        
        if (this.isLanEnvironment) {
            // 局域网环境：使用Polling专用传输方式，并缩短首次超时，加快失败重试
            socketConfig.transports = ['polling'];
            socketConfig.upgrade = false;
            socketConfig.timeout = 8000; // 首次连接8秒超时，避免长时间卡"连接中"
            socketConfig.pingTimeout = 20000;
            socketConfig.pingInterval = 10000;
            console.log('🏠 局域网环境：使用Polling专用传输方式（更稳定，快速超时重试）');
        } else if (this.isRailway) {
            // Railway环境优先使用polling，然后升级到WebSocket
            socketConfig.transports = ['polling', 'websocket'];
            socketConfig.upgrade = true;
            socketConfig.rememberUpgrade = true;
            console.log('🚂 Railway环境：使用polling优先的传输方式');
        } else {
            // 其他环境使用WebSocket优先
            socketConfig.transports = ['websocket', 'polling'];
            console.log('🌐 标准环境：使用WebSocket优先的传输方式');
        }
        
        this.socket = io(this.serverUrl, socketConfig);
        
        this.setupSocketEvents();
    }
    
    setupSocketEvents() {
        this.socket.on('connect', () => {
            console.log('WebSocket连接成功');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.failedAttempts = 0;
            this.lastSuccessfulConnection = new Date();
            this.updateConnectionQuality('good');
            
            // 更新加载进度
            if (typeof updateLoadProgress === 'function') {
                updateLoadProgress('连接服务器成功');
            }
            this.isReconnecting = false;
            
            // 清除重连定时器
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
            
            if (this.onConnectionChange) {
                this.onConnectionChange(true);
            }
            
            showToast('实时连接已建立', 'success');

            // 在连接成功后，如果有待加入的房间且之前延迟了join，立即发起
            if (this.currentRoomId && this.currentUserId && this.currentUsername) {
                this.joinRoom(this.currentRoomId, this.currentUserId, this.currentUsername);
            }
            
            // 如果已经有房间信息，重新加入
            if (this.currentRoomId && this.currentUserId && this.currentUsername) {
                this.joinRoom(this.currentRoomId, this.currentUserId, this.currentUsername);
            }

            // 启动延迟测量
            this.startLatencyProbe();
        });
        
        this.socket.on('disconnect', (reason) => {
            console.log('WebSocket连接断开，原因:', reason);
            this.isConnected = false;
            this.isReconnecting = false;
            
            if (this.onConnectionChange) {
                this.onConnectionChange(false);
            }
            
            // 只有在非主动断开的情况下才重连
            if (reason !== 'io client disconnect') {
                this.scheduleReconnect();
            }

            // 停止延迟测量
            this.stopLatencyProbe();
        });
        
        this.socket.on('connect_error', (error) => {
            console.error('❌ Socket.IO连接错误:', error);
            console.error('❌ 错误详情:', {
                message: error.message,
                description: error.description,
                context: error.context,
                type: error.type
            });
            console.error('❌ 服务器URL:', this.serverUrl);
            console.error('❌ 环境信息:', {
                hostname: window.location.hostname,
                protocol: window.location.protocol,
                isRailway: this.isRailway
            });
            this.isReconnecting = false;
            this.failedAttempts++;
            this.updateConnectionQuality();
            // 首次失败时，立即快速重试一次，避免用户必须手动刷新
            if (this.reconnectAttempts === 0) {
                console.log('⚡ 首次连接失败，立即快速重试...');
                this.scheduleReconnect(1500);
            } else {
                this.handleConnectionError(error);
            }
        });
        
        this.socket.on('error', (error) => {
            console.error('Socket错误:', error);
            // 如果是速率限制错误，增加更长的延迟
            if (error && error.message && error.message.includes('频率过高')) {
                this.reconnectAttempts++;
                const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
                console.log(`速率限制触发，${delay/1000}秒后重试`);
                this.scheduleReconnect(delay);
            }
        });

        // 接收服务端延迟回应
        this.socket.on('latency-pong', (data) => {
            const { clientTimestamp, serverTimestamp } = data || {};
            const now = Date.now();
            const rtt = now - clientTimestamp; // 往返时延
            const oneWay = Math.max(0, Math.round(rtt / 2));
            this.lastLatencyMs = { rtt, oneWay };
            if (typeof window.updateNetworkLatency === 'function') {
                window.updateNetworkLatency(this.lastLatencyMs);
            }
        });
        
        // 业务事件
        this.socket.on('roomData', (data) => {
            if (this.onRoomData) {
                this.onRoomData(data);
            }
        });
        
        this.socket.on('newMessage', (message) => {
            if (this.onMessageReceived) {
                this.onMessageReceived(message);
            }
        });
        
        this.socket.on('participantsUpdate', (participants) => {
            if (this.onParticipantsUpdate) {
                this.onParticipantsUpdate(participants);
            }
        });
        
        this.socket.on('userJoined', (user) => {
            if (this.onUserJoined) {
                this.onUserJoined(user);
            }
        });
        
        this.socket.on('userLeft', (data) => {
            if (this.onUserLeft) {
                this.onUserLeft(data);
            }
        });
        
        this.socket.on('userTyping', (data) => {
            if (this.onUserTyping) {
                this.onUserTyping(data);
            }
        });
        
        // 科大讯飞转录事件
        this.socket.on('xfyun-connected', (data) => {
            if (this.onXfyunConnected) {
                this.onXfyunConnected(data);
            }
        });
        
        this.socket.on('xfyun-result', (data) => {
            if (this.onXfyunResult) {
                this.onXfyunResult(data);
            }
        });
        
        this.socket.on('xfyun-error', (data) => {
            if (this.onXfyunError) {
                this.onXfyunError(data);
            }
        });
        
        this.socket.on('xfyun-disconnected', (data) => {
            console.log('🔌 科大讯飞连接已断开:', data);
        });
        
        this.socket.on('xfyun-stopped', (data) => {
            console.log('🛑 科大讯飞转录已停止:', data);
        });
        
        // 通话相关事件
        this.socket.on('callStateUpdate', (data) => {
            if (this.onCallStateUpdate) {
                this.onCallStateUpdate(data);
            }
        });
        
        this.socket.on('joinCallSuccess', (data) => {
            if (this.onJoinCallSuccess) {
                this.onJoinCallSuccess(data);
            }
        });
        
        this.socket.on('userJoinedCall', (data) => {
            if (this.onUserJoinedCall) {
                this.onUserJoinedCall(data);
            }
        });
        
        this.socket.on('error', (error) => {
            console.error('服务器错误:', error);
            if (this.onError) {
                this.onError(error);
            }
            showToast(error.message || '服务器错误', 'error');
        });
        
        // 会议结束事件
        this.socket.on('meetingEnded', (data) => {
            if (this.onMeetingEnded) {
                this.onMeetingEnded(data);
            }
        });
        
        // 会议结束成功事件
        this.socket.on('endMeetingSuccess', (data) => {
            if (this.onEndMeetingSuccess) {
                this.onEndMeetingSuccess(data);
            }
        });
        
        // 语音通话事件
        this.socket.on('callInvite', (data) => {
            console.log('📞 realtime-client 收到 callInvite 事件:', data);
            if (this.onCallInvite) {
                this.onCallInvite(data);
            } else {
                console.warn('⚠️ onCallInvite 回调未设置');
            }
        });
        
        this.socket.on('callAccept', (data) => {
            if (this.onCallAccept) {
                this.onCallAccept(data);
            }
        });
        
        this.socket.on('callReject', (data) => {
            if (this.onCallReject) {
                this.onCallReject(data);
            }
        });
        
        this.socket.on('callEnd', (data) => {
            if (this.onCallEnd) {
                this.onCallEnd(data);
            }
        });
        
        this.socket.on('callOffer', (data) => {
            if (this.onCallOffer) {
                this.onCallOffer(data);
            }
        });
        
        this.socket.on('callAnswer', (data) => {
            if (this.onCallAnswer) {
                this.onCallAnswer(data);
            }
        });
        
        this.socket.on('iceCandidate', (data) => {
            if (this.onIceCandidate) {
                this.onIceCandidate(data);
            }
        });
        
        this.socket.on('muteStatus', (data) => {
            if (this.onMuteStatus) {
                this.onMuteStatus(data);
            }
        });
        
        // 转录事件
        this.socket.on('transcriptionStatusChange', (data) => {
            console.log('🔧 realtime-client 收到 transcriptionStatusChange:', data);
            if (this.onTranscriptionStatusChange) {
                this.onTranscriptionStatusChange(data);
            } else {
                console.warn('⚠️ onTranscriptionStatusChange 回调未设置');
            }
        });
        
        this.socket.on('transcriptionResult', (data) => {
            console.log('🔧 realtime-client 收到 transcriptionResult:', data);
            if (this.onTranscriptionResult) {
                this.onTranscriptionResult(data);
            } else {
                console.warn('⚠️ onTranscriptionResult 回调未设置');
            }
        });
    }

    // 启动/停止延迟测量
    startLatencyProbe() {
        if (!this.socket) return;
        this.stopLatencyProbe();
        this.latencyTimer = setInterval(() => {
            try {
                this.socket.emit('latency-ping', Date.now());
            } catch {}
        }, 5000); // 每5秒一次
    }
    stopLatencyProbe() {
        if (this.latencyTimer) {
            clearInterval(this.latencyTimer);
            this.latencyTimer = null;
        }
    }
    
    // 更新连接质量
    updateConnectionQuality(quality = null) {
        if (quality) {
            this.connectionQuality = quality;
        } else {
            // 根据失败次数和时间间隔评估连接质量
            const now = new Date();
            const timeSinceLastSuccess = this.lastSuccessfulConnection ? 
                (now - this.lastSuccessfulConnection) / 1000 : Infinity;
            
            if (this.failedAttempts === 0 && timeSinceLastSuccess < 300) { // 5分钟内
                this.connectionQuality = 'good';
            } else if (this.failedAttempts <= 2 && timeSinceLastSuccess < 600) { // 10分钟内
                this.connectionQuality = 'fair';
            } else {
                this.connectionQuality = 'poor';
            }
        }
        
        // 更新UI显示连接质量
        this.updateConnectionQualityUI();
    }
    
    // 更新连接质量UI
    updateConnectionQualityUI() {
        const indicator = document.getElementById('network-indicator');
        if (!indicator) return;
        
        const qualityText = {
            'good': '良好',
            'fair': '一般', 
            'poor': '较差',
            'unknown': '未知'
        };
        
        const qualityColor = {
            'good': '#28a745',
            'fair': '#ffc107',
            'poor': '#dc3545',
            'unknown': '#6c757d'
        };
        
        // 添加连接质量显示
        const qualitySpan = indicator.querySelector('#connection-quality') || 
            (() => {
                const span = document.createElement('span');
                span.id = 'connection-quality';
                span.style.marginLeft = '8px';
                indicator.appendChild(span);
                return span;
            })();
        
        qualitySpan.textContent = `连接: ${qualityText[this.connectionQuality]}`;
        qualitySpan.style.color = qualityColor[this.connectionQuality];
    }
    
    scheduleReconnect(customDelay = null) {
        // 防止重复重连
        if (this.isReconnecting) {
            console.log('⚠️ 重连已在进行中，跳过重复重连');
            return;
        }
        
        // 如果已经达到最大重连次数，停止重连
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('❌ 达到最大重连次数，停止重连');
            this.updateConnectionQuality('poor');
            showToast('连接失败，请刷新页面重试', 'error');
            return;
        }
        
        // 计算重连延迟（使用更温和的指数退避）
        let baseDelay = this.isLanEnvironment ? 3000 : this.reconnectDelay; // 局域网使用3秒基础延迟
        const delay = customDelay || Math.min(
            baseDelay * Math.pow(1.5, this.reconnectAttempts), // 使用1.5的指数增长
            this.isLanEnvironment ? 20000 : this.maxReconnectDelay // 局域网最大20秒延迟
        );
        
        console.log(`📶 安排重连，${delay/1000}秒后重试 (${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
        
        // 清除之前的定时器
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        
        this.isReconnecting = true; // 设置重连状态标志
        
        // 设置新的重连定时器
        this.reconnectTimer = setTimeout(() => {
            this.reconnectAttempts++;
            this.isReconnecting = false; // 重置重连状态
            this.connect();
        }, delay);
        
        showToast(`🔄 连接断开，${Math.round(delay/1000)}秒后重连...`, 'warning');
    }
    
    handleConnectionError(error) {
        console.error('处理连接错误:', error);
        this.isReconnecting = false;
        
        // 检查是否是速率限制错误
        if (error && error.message && error.message.includes('频率过高')) {
            console.log('检测到速率限制错误，增加重连延迟');
            this.scheduleReconnect(this.maxReconnectDelay);
        } else {
            this.scheduleReconnect();
        }
    }
    
    // 公共API方法
    joinRoom(roomId, userId, username) {
        this.currentRoomId = roomId;
        this.currentUserId = userId;
        this.currentUsername = username;
        
        if (this.isConnected && this.socket) {
            this.socket.emit('joinRoom', { roomId, userId, username });
        }
    }
    
    leaveRoom() {
        if (this.isConnected && this.socket && this.currentRoomId && this.currentUserId) {
            this.socket.emit('leaveRoom', { 
                roomId: this.currentRoomId, 
                userId: this.currentUserId 
            });
        }
        
        this.currentRoomId = null;
        this.currentUserId = null;
        this.currentUsername = null;
    }
    
    sendMessage(messageData) {
        if (this.isConnected && this.socket) {
            this.socket.emit('sendMessage', {
                ...messageData,
                roomId: this.currentRoomId
            });
            return true; // 消息通过WebSocket发送
        }
        return false; // 消息需要通过本地存储发送
    }
    
    sendTypingIndicator(isTyping) {
        if (this.isConnected && this.socket && this.currentRoomId) {
            this.socket.emit('typing', {
                roomId: this.currentRoomId,
                userId: this.currentUserId,
                username: this.currentUsername,
                isTyping
            });
        }
    }
    
    // 结束会议（仅创建者可调用）
    endMeeting(roomId, userId) {
        if (this.socket && this.isConnected) {
            this.socket.emit('endMeeting', {
                roomId,
                userId
            });
            return true;
        }
        return false;
    }
    
    // 语音通话相关方法
    sendCallInvite(data) {
        console.log('📞 realtime-client 发送 callInvite:', data);
        if (this.socket && this.isConnected) {
            this.socket.emit('callInvite', data);
            return true;
        }
        console.warn('⚠️ 无法发送 callInvite: socket 未连接');
        return false;
    }
    
    sendCallAccept(data) {
        if (this.socket && this.isConnected) {
            this.socket.emit('callAccept', data);
            return true;
        }
        return false;
    }
    
    sendCallReject(data) {
        if (this.socket && this.isConnected) {
            this.socket.emit('callReject', data);
            return true;
        }
        return false;
    }
    
    sendCallEnd(data) {
        if (this.socket && this.isConnected) {
            this.socket.emit('callEnd', data);
            return true;
        }
        return false;
    }
    
    sendCallOffer(data) {
        if (this.socket && this.isConnected) {
            this.socket.emit('callOffer', data);
            return true;
        }
        return false;
    }
    
    sendCallAnswer(data) {
        if (this.socket && this.isConnected) {
            this.socket.emit('callAnswer', data);
            return true;
        }
        return false;
    }
    
    sendIceCandidate(data) {
        if (this.socket && this.isConnected) {
            this.socket.emit('iceCandidate', data);
            return true;
        }
        return false;
    }
    
    sendMuteStatus(data) {
        if (this.socket && this.isConnected) {
            this.socket.emit('muteStatus', data);
            return true;
        }
        return false;
    }
    
    // 转录相关方法
    sendXfyunTranscriptionStart(data) {
        if (this.socket && this.isConnected) {
            this.socket.emit('xfyunTranscriptionStart', data);
            return true;
        }
        return false;
    }
    
    sendXfyunTranscriptionStop(data) {
        if (this.socket && this.isConnected) {
            this.socket.emit('xfyunTranscriptionStop', data);
            return true;
        }
        return false;
    }
    
    sendXfyunTranscriptionResult(data) {
        if (this.socket && this.isConnected) {
            this.socket.emit('xfyunTranscriptionResult', data);
            return true;
        }
        return false;
    }
    
    // 配置回调函数
    setEventHandlers(handlers) {
        this.onMessageReceived = handlers.onMessageReceived;
        this.onParticipantsUpdate = handlers.onParticipantsUpdate;
        this.onUserJoined = handlers.onUserJoined;
        this.onUserLeft = handlers.onUserLeft;
        this.onConnectionChange = handlers.onConnectionChange;
        this.onError = handlers.onError;
        this.onRoomData = handlers.onRoomData;
        this.onUserTyping = handlers.onUserTyping;
        this.onMeetingEnded = handlers.onMeetingEnded;
        this.onEndMeetingSuccess = handlers.onEndMeetingSuccess;
        
        // 语音通话事件处理器
        this.onCallInvite = handlers.onCallInvite;
        this.onCallAccept = handlers.onCallAccept;
        this.onCallReject = handlers.onCallReject;
        this.onCallEnd = handlers.onCallEnd;
        this.onCallOffer = handlers.onCallOffer;
        this.onCallAnswer = handlers.onCallAnswer;
        this.onIceCandidate = handlers.onIceCandidate;
        this.onMuteStatus = handlers.onMuteStatus;
        
        // 通话状态事件处理器 - 这些是缺失的关键回调！
        this.onCallStateUpdate = handlers.onCallStateUpdate;
        this.onJoinCallSuccess = handlers.onJoinCallSuccess;
        this.onUserJoinedCall = handlers.onUserJoinedCall;
        
        // 科大讯飞转录事件处理器
        this.onXfyunConnected = handlers.onXfyunConnected;
        this.onXfyunResult = handlers.onXfyunResult;
        this.onXfyunError = handlers.onXfyunError;
        
        // 转录事件处理器
        this.onTranscriptionStatusChange = handlers.onTranscriptionStatusChange;
        this.onTranscriptionResult = handlers.onTranscriptionResult;
    }
    
    // 状态查询
    isOnline() {
        return this.isConnected && !this.localMode;
    }
    
    getConnectionStatus() {
        if (this.localMode) return 'local';
        if (this.isConnected) return 'online';
        return 'offline';
    }
    
    // 测试连接状态
    testConnection() {
        console.log('🔧 测试Socket.IO连接状态...');
        console.log('连接信息:', {
            serverUrl: this.serverUrl,
            isConnected: this.isConnected,
            socketId: this.socket?.id,
            socketConnected: this.socket?.connected,
            transport: this.socket?.io?.engine?.transport?.name,
            isRailway: this.isRailway,
            environment: {
                hostname: window.location.hostname,
                protocol: window.location.protocol,
                port: window.location.port
            }
        });
        
        if (this.socket) {
            console.log('Socket状态:', {
                connected: this.socket.connected,
                disconnected: this.socket.disconnected,
                id: this.socket.id,
                transport: this.socket.io?.engine?.transport?.name
            });
        }
        
        return this.isConnected;
    }
    
    // 清理资源
    disconnect() {
        // 清除重连定时器
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.isConnected = false;
        this.currentRoomId = null;
        this.currentUserId = null;
        this.currentUsername = null;
    }
}

// 初始化实时客户端
window.realtimeClient = new RealtimeClient();
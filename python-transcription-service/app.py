#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI语音转录服务
基于Whisper模型的实时语音转录API
"""

import asyncio
import json
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Optional

import torch
import whisper
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydub import AudioSegment
import redis
import pymongo
from pymongo import MongoClient

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class TranscriptionService:
    def __init__(self):
        self.app = FastAPI(
            title="AI语音转录服务",
            description="实时语音转录和AI处理服务",
            version="1.0.0"
        )
        
        # 配置CORS
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],  # 生产环境应该配置具体域名
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        
        # 初始化Whisper模型
        self.whisper_model = None
        self.init_whisper_model()
        
        # 连接数据库
        self.mongo_client = None
        self.redis_client = None
        self.init_database()
        
        # WebSocket连接管理
        self.active_connections = {}
        
        # 注册路由
        self.register_routes()
    
    def init_whisper_model(self):
        """初始化Whisper模型"""
        try:
            # 根据可用资源选择模型大小
            device = "cuda" if torch.cuda.is_available() else "cpu"
            model_size = os.getenv("WHISPER_MODEL_SIZE", "base")  # tiny, base, small, medium, large
            
            logger.info(f"加载Whisper模型: {model_size} on {device}")
            self.whisper_model = whisper.load_model(model_size, device=device)
            logger.info("Whisper模型加载成功")
            
        except Exception as e:
            logger.error(f"Whisper模型加载失败: {e}")
            # 降级到在线API模式
            self.whisper_model = None
    
    def init_database(self):
        """初始化数据库连接"""
        try:
            # MongoDB连接 (与Node.js服务共享)
            mongo_uri = os.getenv("MONGODB_URI")
            if mongo_uri:
                self.mongo_client = MongoClient(mongo_uri)
                self.db = self.mongo_client.get_default_database()
                logger.info("MongoDB连接成功")
            
            # Redis连接 (用于缓存和WebSocket通信)
            redis_url = os.getenv("REDIS_URL")
            if redis_url:
                self.redis_client = redis.from_url(redis_url)
                logger.info("Redis连接成功")
                
        except Exception as e:
            logger.error(f"数据库连接失败: {e}")
    
    def register_routes(self):
        """注册API路由"""
        
        @self.app.get("/health")
        async def health_check():
            """健康检查"""
            return {
                "status": "ok",
                "whisper_model": "loaded" if self.whisper_model else "not_loaded",
                "mongodb": "connected" if self.mongo_client else "disconnected",
                "redis": "connected" if self.redis_client else "disconnected"
            }
        
        @self.app.post("/transcribe/audio")
        async def transcribe_audio(audio_file: UploadFile = File(...)):
            """音频文件转录"""
            try:
                # 保存临时文件
                with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_file:
                    content = await audio_file.read()
                    temp_file.write(content)
                    temp_path = temp_file.name
                
                # 转录音频
                result = await self.transcribe_audio_file(temp_path)
                
                # 清理临时文件
                os.unlink(temp_path)
                
                return {
                    "success": True,
                    "text": result["text"],
                    "language": result.get("language", "zh"),
                    "segments": result.get("segments", [])
                }
                
            except Exception as e:
                logger.error(f"音频转录失败: {e}")
                raise HTTPException(status_code=500, detail=str(e))
        
        @self.app.websocket("/ws/transcribe/{room_id}")
        async def websocket_transcribe(websocket: WebSocket, room_id: str):
            """WebSocket实时转录"""
            await self.handle_websocket_transcription(websocket, room_id)
        
        @self.app.post("/transcribe/realtime")
        async def start_realtime_transcription(room_id: str, user_id: str):
            """启动实时转录"""
            try:
                # 在数据库中记录转录会话
                if self.mongo_client:
                    session_data = {
                        "room_id": room_id,
                        "user_id": user_id,
                        "status": "active",
                        "created_at": time.time(),
                        "transcriptions": []
                    }
                    self.db.transcription_sessions.insert_one(session_data)
                
                return {"success": True, "session_id": str(session_data.get("_id"))}
                
            except Exception as e:
                logger.error(f"启动实时转录失败: {e}")
                raise HTTPException(status_code=500, detail=str(e))
    
    async def transcribe_audio_file(self, file_path: str) -> dict:
        """转录音频文件"""
        try:
            if self.whisper_model:
                # 使用本地Whisper模型
                result = self.whisper_model.transcribe(file_path, language="zh")
                return result
            else:
                # 降级到其他转录服务
                return await self.fallback_transcription(file_path)
                
        except Exception as e:
            logger.error(f"音频转录失败: {e}")
            return {"text": "转录失败", "language": "zh"}
    
    async def fallback_transcription(self, file_path: str) -> dict:
        """备用转录方案"""
        try:
            # 可以集成其他转录API，如百度、阿里云、腾讯云等
            # 这里演示一个简单的实现
            import speech_recognition as sr
            
            r = sr.Recognizer()
            
            # 转换音频格式
            audio = AudioSegment.from_file(file_path)
            audio = audio.set_frame_rate(16000).set_channels(1)
            
            with tempfile.NamedTemporaryFile(suffix=".wav") as temp_wav:
                audio.export(temp_wav.name, format="wav")
                
                with sr.AudioFile(temp_wav.name) as source:
                    audio_data = r.record(source)
                    
                # 使用Google Web Speech API (需要网络)
                try:
                    text = r.recognize_google(audio_data, language='zh-CN')
                    return {"text": text, "language": "zh"}
                except sr.UnknownValueError:
                    return {"text": "[无法识别语音]", "language": "zh"}
                except sr.RequestError:
                    return {"text": "[网络错误]", "language": "zh"}
                    
        except Exception as e:
            logger.error(f"备用转录失败: {e}")
            return {"text": "[转录服务不可用]", "language": "zh"}
    
    async def handle_websocket_transcription(self, websocket: WebSocket, room_id: str):
        """处理WebSocket实时转录"""
        await websocket.accept()
        connection_id = f"{room_id}_{time.time()}"
        self.active_connections[connection_id] = websocket
        
        logger.info(f"新的转录WebSocket连接: {connection_id}")
        
        try:
            while True:
                # 接收音频数据
                data = await websocket.receive_bytes()
                
                # 处理音频数据
                result = await self.process_audio_chunk(data, room_id)
                
                # 发送转录结果
                if result.get("text"):
                    await websocket.send_json({
                        "type": "transcription",
                        "text": result["text"],
                        "language": result.get("language", "zh"),
                        "timestamp": time.time(),
                        "room_id": room_id
                    })
                    
                    # 广播给同房间的其他连接
                    await self.broadcast_transcription(room_id, result, connection_id)
        
        except WebSocketDisconnect:
            logger.info(f"WebSocket连接断开: {connection_id}")
            del self.active_connections[connection_id]
        except Exception as e:
            logger.error(f"WebSocket处理错误: {e}")
            await websocket.close()
            if connection_id in self.active_connections:
                del self.active_connections[connection_id]
    
    async def process_audio_chunk(self, audio_data: bytes, room_id: str) -> dict:
        """处理音频块"""
        try:
            # 保存临时音频文件
            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_file:
                temp_file.write(audio_data)
                temp_path = temp_file.name
            
            # 转录音频
            result = await self.transcribe_audio_file(temp_path)
            
            # 清理临时文件
            os.unlink(temp_path)
            
            # 保存转录结果到数据库
            if self.mongo_client and result.get("text"):
                transcription_record = {
                    "room_id": room_id,
                    "text": result["text"],
                    "language": result.get("language", "zh"),
                    "timestamp": time.time(),
                    "type": "realtime"
                }
                self.db.transcriptions.insert_one(transcription_record)
            
            return result
            
        except Exception as e:
            logger.error(f"音频块处理失败: {e}")
            return {"text": "", "language": "zh"}
    
    async def broadcast_transcription(self, room_id: str, result: dict, sender_id: str):
        """广播转录结果给同房间用户"""
        message = {
            "type": "transcription_broadcast",
            "room_id": room_id,
            "text": result["text"],
            "language": result.get("language", "zh"),
            "timestamp": time.time()
        }
        
        # 发送给同房间的其他WebSocket连接
        for conn_id, websocket in self.active_connections.items():
            if conn_id != sender_id and room_id in conn_id:
                try:
                    await websocket.send_json(message)
                except:
                    # 连接已断开，从活跃连接中移除
                    if conn_id in self.active_connections:
                        del self.active_connections[conn_id]
    
    def run(self, host="0.0.0.0", port=8000):
        """启动服务"""
        import uvicorn
        uvicorn.run(self.app, host=host, port=port)


# 创建服务实例
transcription_service = TranscriptionService()
app = transcription_service.app

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    transcription_service.run(port=port)
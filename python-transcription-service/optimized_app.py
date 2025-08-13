#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
优化的AI语音转录服务 - Railway部署版本
专为Railway 8GB内存环境优化的Whisper模型服务
"""

import asyncio
import json
import logging
import os
import tempfile
import time
import gc
from pathlib import Path
from typing import Optional, Dict, Any

# 优化PyTorch设置
import torch
torch.set_num_threads(2)  # 限制线程数以节省资源
if torch.cuda.is_available():
    torch.cuda.empty_cache()

import whisper
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydub import AudioSegment
import uvicorn
from pymongo import MongoClient
import numpy as np
import io

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class OptimizedTranscriptionService:
    """优化的转录服务类"""
    
    def __init__(self):
        self.model = None
        self.model_size = os.getenv('WHISPER_MODEL_SIZE', 'tiny')  # 默认使用最小模型
        self.mongodb_client = None
        self.db = None
        
        # 模型大小配置（针对Railway资源优化）
        self.model_config = {
            'tiny': {'memory': '~1GB', 'speed': 'fastest', 'accuracy': 'good'},
            'base': {'memory': '~1.5GB', 'speed': 'fast', 'accuracy': 'better'},
            'small': {'memory': '~2GB', 'speed': 'medium', 'accuracy': 'very good'},
            'medium': {'memory': '~5GB', 'speed': 'slow', 'accuracy': 'excellent'}
        }
        
        logger.info(f"初始化转录服务，模型大小: {self.model_size}")
        logger.info(f"模型配置: {self.model_config.get(self.model_size, 'unknown')}")
        
    async def initialize(self):
        """异步初始化服务"""
        try:
            # 初始化Whisper模型
            await self._load_whisper_model()
            
            # 初始化MongoDB连接
            await self._init_mongodb()
            
            logger.info("转录服务初始化完成")
            
        except Exception as e:
            logger.error(f"转录服务初始化失败: {e}")
            raise
    
    async def _load_whisper_model(self):
        """加载Whisper模型"""
        try:
            logger.info(f"开始加载Whisper模型: {self.model_size}")
            
            # 设置模型设备
            device = "cuda" if torch.cuda.is_available() else "cpu"
            logger.info(f"使用设备: {device}")
            
            # 加载模型（使用较小的模型以适应Railway限制）
            self.model = whisper.load_model(
                self.model_size, 
                device=device,
                download_root=tempfile.gettempdir()  # 使用临时目录存储模型
            )
            
            # 内存优化
            if hasattr(self.model, 'eval'):
                self.model.eval()  # 设置为评估模式
            
            # 清理内存
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                
            logger.info(f"Whisper模型加载成功: {self.model_size}")
            
        except Exception as e:
            logger.error(f"Whisper模型加载失败: {e}")
            # 降级到最小模型
            if self.model_size != 'tiny':
                logger.info("尝试加载tiny模型作为降级选项")
                self.model_size = 'tiny'
                self.model = whisper.load_model('tiny', device="cpu")
            else:
                raise
    
    async def _init_mongodb(self):
        """初始化MongoDB连接"""
        try:
            mongodb_uri = os.getenv('MONGODB_URI')
            if mongodb_uri:
                self.mongodb_client = MongoClient(mongodb_uri)
                self.db = self.mongodb_client.vibe_meeting
                # 测试连接
                self.mongodb_client.admin.command('ismaster')
                logger.info("MongoDB连接成功")
            else:
                logger.warning("未配置MONGODB_URI，跳过数据库连接")
        except Exception as e:
            logger.error(f"MongoDB连接失败: {e}")
            self.mongodb_client = None
            self.db = None
    
    async def transcribe_audio_file(self, audio_file: UploadFile) -> Dict[str, Any]:
        """转录音频文件"""
        try:
            if not self.model:
                raise HTTPException(status_code=503, detail="Whisper模型未加载")
            
            # 读取音频文件
            audio_data = await audio_file.read()
            
            # 预处理音频
            processed_audio = await self._preprocess_audio(audio_data)
            
            # 执行转录
            start_time = time.time()
            result = await self._perform_transcription(processed_audio)
            processing_time = time.time() - start_time
            
            # 清理内存
            del processed_audio
            gc.collect()
            
            logger.info(f"转录完成，耗时: {processing_time:.2f}秒")
            
            return {
                "success": True,
                "text": result["text"],
                "language": result.get("language", "zh"),
                "confidence": self._calculate_confidence(result),
                "processing_time": processing_time,
                "model": self.model_size
            }
            
        except Exception as e:
            logger.error(f"音频转录失败: {e}")
            return {
                "success": False,
                "text": "",
                "language": "zh",
                "error": str(e),
                "model": self.model_size
            }
    
    async def _preprocess_audio(self, audio_data: bytes) -> np.ndarray:
        """预处理音频数据"""
        try:
            # 使用pydub处理音频
            audio_segment = AudioSegment.from_file(io.BytesIO(audio_data))
            
            # 转换为单声道，16kHz采样率（Whisper要求）
            audio_segment = audio_segment.set_channels(1).set_frame_rate(16000)
            
            # 转换为numpy数组
            audio_array = np.array(audio_segment.get_array_of_samples(), dtype=np.float32)
            audio_array = audio_array / np.max(np.abs(audio_array))  # 归一化
            
            return audio_array
            
        except Exception as e:
            logger.error(f"音频预处理失败: {e}")
            raise HTTPException(status_code=400, detail=f"音频预处理失败: {e}")
    
    async def _perform_transcription(self, audio_array: np.ndarray) -> Dict[str, Any]:
        """执行转录"""
        try:
            # 使用线程池执行转录（避免阻塞异步事件循环）
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None, 
                lambda: self.model.transcribe(
                    audio_array,
                    language="zh",
                    task="transcribe",
                    temperature=0.0,  # 更确定性的输出
                    best_of=1,       # 减少计算量
                    beam_size=1      # 减少计算量
                )
            )
            
            return result
            
        except Exception as e:
            logger.error(f"Whisper转录执行失败: {e}")
            raise
    
    def _calculate_confidence(self, result: Dict[str, Any]) -> float:
        """计算转录置信度"""
        try:
            if "segments" in result and result["segments"]:
                # 计算所有段的平均置信度
                total_confidence = sum(
                    segment.get("avg_logprob", 0) for segment in result["segments"]
                )
                avg_confidence = total_confidence / len(result["segments"])
                # 转换为0-1范围的置信度
                confidence = max(0, min(1, (avg_confidence + 1) / 2))
                return confidence
            return 0.8  # 默认置信度
        except:
            return 0.8

# 创建FastAPI应用
app = FastAPI(
    title="优化的AI语音转录服务",
    description="基于Whisper模型的语音转录API - Railway优化版本",
    version="2.0.0"
)

# 添加CORS中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局服务实例
transcription_service = OptimizedTranscriptionService()

@app.on_event("startup")
async def startup_event():
    """应用启动时初始化服务"""
    logger.info("启动转录服务...")
    await transcription_service.initialize()
    logger.info("转录服务启动完成")

@app.on_event("shutdown")
async def shutdown_event():
    """应用关闭时清理资源"""
    logger.info("关闭转录服务...")
    
    # 清理模型
    if transcription_service.model:
        del transcription_service.model
    
    # 关闭数据库连接
    if transcription_service.mongodb_client:
        transcription_service.mongodb_client.close()
    
    # 清理内存
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    
    logger.info("转录服务已关闭")

@app.get("/health")
async def health_check():
    """健康检查端点"""
    try:
        status = {
            "status": "ok",
            "service": "optimized-whisper-transcription",
            "whisper_model": transcription_service.model_size,
            "model_loaded": transcription_service.model is not None,
            "mongodb": "connected" if transcription_service.db else "disconnected",
            "timestamp": time.time(),
            "memory_info": {
                "model_config": transcription_service.model_config.get(transcription_service.model_size, {}),
                "device": "cuda" if torch.cuda.is_available() else "cpu"
            }
        }
        
        return JSONResponse(content=status)
        
    except Exception as e:
        logger.error(f"健康检查失败: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "error": str(e)
            }
        )

@app.post("/transcribe/audio")
async def transcribe_audio(audio_file: UploadFile = File(...)):
    """音频转录端点"""
    try:
        logger.info(f"收到转录请求: {audio_file.filename}, 大小: {audio_file.size} bytes")
        
        # 检查文件大小（限制为50MB以适应Railway资源）
        if audio_file.size and audio_file.size > 50 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="音频文件过大，请压缩后重试")
        
        # 执行转录
        result = await transcription_service.transcribe_audio_file(audio_file)
        
        return JSONResponse(content=result)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"转录请求处理失败: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "text": "",
                "language": "zh",
                "error": f"转录处理失败: {str(e)}"
            }
        )

@app.get("/")
async def root():
    """根端点"""
    return {
        "service": "AI语音转录服务",
        "version": "2.0.0",
        "description": "基于Whisper模型的语音转录API - Railway优化版本",
        "model": transcription_service.model_size,
        "endpoints": {
            "health": "/health",
            "transcribe": "/transcribe/audio"
        }
    }

if __name__ == "__main__":
    # 启动服务
    port = int(os.getenv("PORT", 8000))
    
    uvicorn.run(
        "optimized_app:app",
        host="0.0.0.0",
        port=port,
        log_level="info",
        workers=1,  # 单进程以节省内存
        loop="asyncio"
    )
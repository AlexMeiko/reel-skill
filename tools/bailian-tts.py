#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
阿里云百炼（Model Studio）实时语音合成 —— 仅支持以下两个模型：

    * qwen-audio-3.0-tts-plus
    * qwen-audio-3.1-tts-flash

文档来源（抽取自以下页面）：
    https://docs.bailian.console.aliyun.com/zh/model-studio/realtime-tts-user-guide
    https://docs.bailian.console.aliyun.com/zh/model-studio/non-realtime-tts-user-guide
    https://docs.bailian.console.aliyun.com/zh/model-studio/cosyvoice-websocket-api
    https://docs.bailian.console.aliyun.com/zh/model-studio/cosyvoice-client-events
    https://docs.bailian.console.aliyun.com/zh/model-studio/cosyvoice-server-events
    https://docs.bailian.console.aliyun.com/zh/model-studio/cosyvoice-tts-http-api
    https://docs.bailian.console.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list

两种调用方式（--mode 切换，默认 http）：

  【http】非实时合成 —— 一次 POST，服务端返回音频 URL（有效期 24h），脚本自动下载。
          POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com
               /api/v1/services/audio/tts/SpeechSynthesizer
          Authorization: Bearer <API_KEY>
          加 X-DashScope-SSE: enable 可切成 SSE 流式，逐段返回 base64 音频。
          优点：简单、稳、无长连接；缺点：不支持连接复用/中途取消，仅北京地域。

  【ws】实时合成 —— WebSocket 长连接，双向流式，首包延迟低（实测 ~0.8-1.0s）。
          1. wss 建连，鉴权走握手请求头 Authorization: bearer <API_KEY>
          2. 客户端发 run-task     -> 服务端回 task-started
          3. 客户端发 continue-task（可多次，携带 text）-> result-generated + binary 音频帧
          4. 客户端发 finish-task  -> 服务端回 task-finished
          5. 一个连接可复用：task-finished 后重新发 run-task 即可（task_id 必须换新）
          优点：低延迟、可复用、可取消；缺点：协议复杂，需自己维护长连接。

本文件不依赖任何第三方库（HTTP 用 urllib，WebSocket 用标准库实现了 RFC6455），
也无需安装 dashscope。

自定义音色（两个模型均支持，限北京地域）：
    * 声音复刻：--create-voice <音频URL>   上传 10~20 秒干净人声，绑定 target_model
    * 声音设计：--design-voice "<声音描述>" 用自然语言描述生成音色
    * 基础音色：qwen-audio-3.0-tts-plus / -flash 各有 500+ 个预置复刻音色，
                命名形如 qwen-audio-3.0-tts-plus-xxxx，直接用 -v 传入即可
    创建音色的 target_model 必须与合成用的 -m 完全一致，音色不能跨模型使用。
    -v 传入未知音色时默认放行（按自定义音色提交），加 --strict-voice 可改为严格校验。

用法示例：
    export DASHSCOPE_API_KEY=sk-xxxxxxxx      # 必填（或用 --api-key）
    export DASHSCOPE_WORKSPACE=ws-xxxxxxxx    # 必填（或用 --workspace）
    python3 bailian-tts.py "今天天气怎么样？"                        # 默认 plus + longanlingxin，http 非实时
    python3 bailian-tts.py "今天天气怎么样？" --stream               # http + SSE 流式
    python3 bailian-tts.py "今天天气怎么样？" --mode ws              # 实时 WebSocket
    python3 bailian-tts.py "床前明月光" -m qwen-audio-3.0-tts-plus -v longanlingxin -o poem.wav
    python3 bailian-tts.py "[excited]今天真不错！[laughing]出去玩吧！" --instruction "请用四川话表达"
    python3 bailian-tts.py --create-voice https://xxx/voice.wav --target-model qwen-audio-3.1-tts-flash
    python3 bailian-tts.py --design-voice "沉稳的中年男性播音员，音色低沉浑厚" --prefix announcer
    python3 bailian-tts.py --list-voices
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import socket
import ssl
import struct
import sys
import time
import urllib.error
import urllib.request
import uuid
from typing import Callable, Iterable

# --------------------------------------------------------------------------- #
# 1. 模型与音色
# --------------------------------------------------------------------------- #

MODEL_PLUS = "qwen-audio-3.0-tts-plus"
MODEL_FLASH = "qwen-audio-3.1-tts-flash"

# 文档明确：本文件只支持这两个模型
SUPPORTED_MODELS = (MODEL_PLUS, MODEL_FLASH)

# qwen-audio-3.0-tts-plus 系统音色（2 个旗舰音色）
VOICES_PLUS = (
    "longanlingxin",  # 龙安灵心 · 知心温暖音 · 25岁 · 女 · 中文（普通话）、英文
    "longanlufeng",   # 龙安鲁风 · 明亮开朗音 · 25岁 · 男 · 中文（普通话）、英文
)

# qwen-audio-3.1-tts-flash 系统音色（74 个）
VOICES_FLASH = (
    # 多语种与方言音色（支持 8 种方言 + 8 种语言）
    "longanhuan_v3.1",
    "longanlingxin_v3.1",
    "longanfengyue_v3.1",
    "xunanchuan",
    # 精品中文音色
    "yuxiaoyun_v3.1",
    "qiaoxiaojiao_v3.1",
    "luxiaoyan_v3.1",
    "xiaxiaochen_v3.1",
    "anmingyuan_v3.1",
    "wenhuaiqing_v3.1",
    "anxiaolan_v3.1",
    "xuruyuan_v3.1",
    "xieshurou_v3.1",
    "yianning_v3.1",
    "baiqinglan_v3.1",
    "xuyuyuan_v3.1",
    "anruorou_v3.1",
    "wenhuaizhi_v3.1",
    "xiaoxingzhi_v3.1",
    "guyunshu_v3.1",
    "huozhuoshi_v3.1",
    "yeqinghe_v3.1",
    "yunhuanhuan_v3.1",
    "xuxiaoqiao_v3.1",
    "baianran_v3.1",
    "xuyanchu_v3.1",
    "chujingchuan_v3.1",
    "guxiaoran_v3.1",
    "yezhiqing_v3.1",
    "lingxinglang_v3.1",
    "andi_v3.1",
    "anyuqing_v3.1",
    # 精品英文音色
    "Emily_v3.1",
    "Luna_v3.1",
    "Eric_v3.1",
    "Luca_v3.1",
    "Abby_v3.1",
    "Annie_v3.1",
    "Ava_v3.1",
    "Beth_v3.1",
    "Betty_v3.1",
    "Cally_v3.1",
    "Cindy_v3.1",
    "Donna_v3.1",
    "Andy_v3.1",
    "Brian_v3.1",
    "David_v3.1",
    # 其他系统音色
    "longanyuanfei_v3.1",
    "longjielidou_v3.1",
    "longanlingxi_v3.1",
    "longhuohuo_v3.1",
    "longyingtao_v3.1",
    "longanya_v3.1",
    "longwan_v3.1",
    "longxing_v3.1",
    "longhua_v3.1",
    "longhan_v3.1",
    "longanzhi_v3.1",
    "longzhe_v3.1",
    "longanyang_v3.1",
    "libai_v3.1",
    "longling_v3.1",
    "longniuniu_v3.1",
    "longshanshan_v3.1",
    "longpaopao_v3.1",
    "loongstella_v3.1",
    "longyuan_v3.1",
    "longmiao_v3.1",
    "longsanshu_v3.1",
    "longanli_v3.1",
    "longanwen_v3.1",
    "longanlang_v3.1",
    "longxiaoxia_v3.1",
    "longanchong_v3.1",
)

VOICES = {
    MODEL_PLUS: VOICES_PLUS,
    MODEL_FLASH: VOICES_FLASH,
}

DEFAULT_MODEL = MODEL_PLUS
DEFAULT_VOICE = {
    MODEL_PLUS: "longanlingxin",
    MODEL_FLASH: "longanhuan_v3.1",
}

# --------------------------------------------------------------------------- #
# 2. 接入点
# --------------------------------------------------------------------------- #

# 业务空间专属域名（推荐）。{WorkspaceId} 即控制台业务空间 ID。
# 不内置：用 --workspace 或环境变量 DASHSCOPE_WORKSPACE 提供。
WORKSPACE_ID = os.environ.get("DASHSCOPE_WORKSPACE", "")

# 不内置密钥：用 --api-key 或环境变量 DASHSCOPE_API_KEY 提供。
DEFAULT_API_KEY = ""

WS_URL_TEMPLATE = {
    # 华北2（北京）
    "beijing": "wss://{workspace}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
    # 新加坡
    "singapore": "wss://{workspace}.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/inference",
    # 旧域名（仍可用）
    "beijing-legacy": "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
    "singapore-legacy": "wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference",
}

# 非实时（HTTP）接口：一次性把整段文本转成音频，返回音频 URL（有效期 24 小时）。
# 仅华北2（北京）地域提供，Qwen-Audio-TTS 与 CosyVoice 共用此端点。
HTTP_URL_TEMPLATE = {
    "beijing": "https://{workspace}.cn-beijing.maas.aliyuncs.com"
               "/api/v1/services/audio/tts/SpeechSynthesizer",
    "beijing-legacy": "https://dashscope.aliyuncs.com"
                      "/api/v1/services/audio/tts/SpeechSynthesizer",
}

# 注意：qwen-audio-3.1-tts-flash 目前仅在华北2（北京）地域提供；
#       qwen-audio-3.0-tts-plus 在北京和新加坡均提供。
REGION_MODELS = {
    "beijing": SUPPORTED_MODELS,
    "singapore": (MODEL_PLUS,),
}

# 支持的音频编码格式与采样率
AUDIO_FORMATS = ("mp3", "pcm", "wav", "opus")
SAMPLE_RATES = (8000, 16000, 22050, 24000, 44100, 48000)

# 富语言标签 / 控制类标签（qwen-audio-3.1-tts-flash、qwen-audio-3.0-tts-plus 均支持）
EMOTION_TAGS = (
    "sad", "amazed", "deep and loud shouting", "trembling", "angry", "excited",
    "sarcastic", "curious", "like dracula", "bored", "tired", "scornful",
    "shouting", "asmr", "panicked", "mischievously", "empathetic", "whispers",
    "reluctantly", "crying", "serious", "very slowly", "very fast",
)
RICH_TAGS = ("gasp", "sighing", "clears throat", "giggles", "laughing", "cough", "snorts")

# 单次 continue-task 最多 20000 字符，累计最多 200000 字符
MAX_CHARS_PER_CONTINUE = 20000
MAX_CHARS_TOTAL = 200000
DEFAULT_RETRIES = 4


def _retryable(exc: BaseException) -> bool:
    if isinstance(exc, urllib.error.HTTPError):
        return exc.code in (408, 409, 425, 429, 500, 502, 503, 504)
    if isinstance(exc, urllib.error.URLError):
        return True
    if isinstance(exc, (TimeoutError, socket.timeout, socket.gaierror, ConnectionError, OSError)):
        return True
    if isinstance(exc, WebSocketError):
        msg = str(exc).lower()
        return any(s in msg for s in ("timeout", "timed out", "closed", "dns", "try again",
                                      "errno -3", "http 429", "http 5", "http 502", "http 503", "http 504"))
    return False


def retry_call(fn, retries: int = DEFAULT_RETRIES, what: str = "request"):
    last: BaseException | None = None
    n = max(1, int(retries))
    for i in range(n):
        try:
            return fn()
        except Exception as e:
            last = e
            if i + 1 >= n or not _retryable(e):
                raise
            delay = min(8.0, 0.4 * (2 ** i))
            print(f"[重试 {i + 1}/{n - 1}] {what}: {e}  {delay:.1f}s", file=sys.stderr)
            time.sleep(delay)
    raise last  # pragma: no cover


# --------------------------------------------------------------------------- #
# 3. 极简 WebSocket 客户端（RFC 6455，纯标准库）
# --------------------------------------------------------------------------- #

OP_CONT, OP_TEXT, OP_BINARY, OP_CLOSE, OP_PING, OP_PONG = 0x0, 0x1, 0x2, 0x8, 0x9, 0xA


class WebSocketError(RuntimeError):
    pass


class _WebSocket:
    """仅实现客户端所需的最小帧协议：文本/二进制/分片/ping-pong/close。"""

    def __init__(self, sock: ssl.SSLSocket, initial: bytes = b"") -> None:
        self._sock = sock
        self._buf = initial
        self._closed = False

    # -- 底层读取 ---------------------------------------------------------- #
    def _read_exact(self, n: int) -> bytes:
        while len(self._buf) < n:
            chunk = self._sock.recv(max(65536, n - len(self._buf)))
            if not chunk:
                raise WebSocketError("连接已被服务端关闭")
            self._buf += chunk
        data, self._buf = self._buf[:n], self._buf[n:]
        return data

    # -- 发送 -------------------------------------------------------------- #
    def send(self, data, opcode: int = OP_TEXT) -> None:
        if isinstance(data, str):
            data = data.encode("utf-8")
        header = bytearray()
        header.append(0x80 | opcode)          # FIN + opcode
        n = len(data)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        mask = os.urandom(4)
        header += mask
        masked = bytes(b ^ mask[i & 3] for i, b in enumerate(data))
        self._sock.sendall(bytes(header) + masked)

    # -- 接收（自动处理分片与 ping） --------------------------------------- #
    def recv(self) -> tuple[int, bytes]:
        opcode = None
        payload = b""
        while True:
            b1, b2 = self._read_exact(2)
            fin = b1 & 0x80
            op = b1 & 0x0F
            masked = b2 & 0x80
            length = b2 & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._read_exact(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._read_exact(8))[0]
            mask = self._read_exact(4) if masked else None
            chunk = self._read_exact(length) if length else b""
            if mask:
                chunk = bytes(b ^ mask[i & 3] for i, b in enumerate(chunk))

            if op == OP_CLOSE:
                self._closed = True
                return OP_CLOSE, chunk
            if op == OP_PING:
                self.send(chunk, OP_PONG)
                continue
            if op == OP_PONG:
                continue
            if op != OP_CONT:
                opcode = op
            payload += chunk
            if fin:
                return opcode or OP_TEXT, payload

    def close(self, code: int = 1000, reason: str = "bye") -> None:
        if self._closed:
            return
        try:
            self.send(struct.pack(">H", code) + reason.encode("utf-8"), OP_CLOSE)
        except Exception:
            pass
        try:
            self._sock.close()
        except Exception:
            pass
        self._closed = True


def ws_connect(url: str, headers: dict, timeout: float = 30.0) -> _WebSocket:
    """建立 wss 连接并完成 WebSocket 握手。"""
    m = re.match(r"^wss://([^/:]+)(?::(\d+))?(/.*)?$", url)
    if not m:
        raise ValueError(f"非法的 WebSocket URL: {url}")
    host, port, path = m.group(1), int(m.group(2) or 443), m.group(3) or "/"

    ctx = ssl.create_default_context()
    # create_connection 会自动遍历全部解析结果（含 IPv6/IPv4 回退）
    raw = socket.create_connection((host, port), timeout=timeout)
    sock = ctx.wrap_socket(raw, server_hostname=host)
    sock.settimeout(timeout)

    key = base64.b64encode(os.urandom(16)).decode("ascii")
    lines = [
        f"GET {path} HTTP/1.1",
        f"Host: {host}",
        "Upgrade: websocket",
        "Connection: Upgrade",
        f"Sec-WebSocket-Key: {key}",
        "Sec-WebSocket-Version: 13",
    ]
    for k, v in headers.items():
        lines.append(f"{k}: {v}")
    sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode("utf-8"))

    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = sock.recv(4096)
        if not chunk:
            raise WebSocketError("握手阶段连接被关闭")
        buf += chunk
    head, rest = buf.split(b"\r\n\r\n", 1)
    text = head.decode("utf-8", "replace")
    status_line = text.split("\r\n", 1)[0]
    if " 101" not in status_line:
        raise WebSocketError(f"WebSocket 握手失败：{status_line}\n{text}")
    return _WebSocket(sock, rest)


# --------------------------------------------------------------------------- #
# 4. 实时语音合成客户端
# --------------------------------------------------------------------------- #

class TTSResult:
    """一次合成任务的结果。"""

    def __init__(self) -> None:
        self.audio: bytes = b""          # 拼接后的完整音频
        self.words: list[dict] = []      # 字级时间戳（需 word_timestamp_enabled=True）
        self.characters: int = 0         # 计费字符数
        self.request_uuid: str = ""
        self.chunks: int = 0

    def __repr__(self) -> str:  # pragma: no cover
        return (f"<TTSResult {len(self.audio)} bytes, {self.chunks} chunks, "
                f"{self.characters} chars, {len(self.words)} words>")


class BailianTTS:
    """
    百炼实时语音合成（Qwen-Audio-TTS 协议）。

    典型用法::

        tts = BailianTTS(api_key="sk-xxx", workspace="your-workspace-id")
        result = tts.synthesize("你好世界", model="qwen-audio-3.0-tts-plus",
                                voice="longanlingxin")
        open("out.mp3", "wb").write(result.audio)
        tts.close()
    """

    def __init__(
        self,
        api_key: str | None = None,
        workspace: str = WORKSPACE_ID,
        region: str = "beijing",
        data_inspection: bool = False,
        workspace_header: str | None = None,
        timeout: float = 60.0,
        strict_voice: bool = False,
    ) -> None:
        api_key = api_key or os.environ.get("DASHSCOPE_API_KEY") or DEFAULT_API_KEY
        if not api_key:
            raise ValueError(
                "缺少 API Key：请设置环境变量 DASHSCOPE_API_KEY，或传入 api_key=..."
            )
        if region not in WS_URL_TEMPLATE:
            raise ValueError(f"未知地域 {region!r}，可选：{list(WS_URL_TEMPLATE)}")

        self.api_key = api_key
        self.workspace = workspace
        self.region = region
        self.data_inspection = data_inspection
        self.workspace_header = workspace_header
        self.timeout = timeout
        self.strict_voice = strict_voice
        self.retries = max(1, int(os.environ.get("REEL_TTS_RETRIES", DEFAULT_RETRIES)))
        self._ws: _WebSocket | None = None

    # -- 连接管理 ---------------------------------------------------------- #
    @property
    def url(self) -> str:
        return WS_URL_TEMPLATE[self.region].format(workspace=self.workspace)

    def _headers(self) -> dict:
        headers = {"Authorization": f"bearer {self.api_key}", "user-agent": "bailian-tts.py"}
        if self.data_inspection:
            headers["X-DashScope-DataInspection"] = "enable"
        if self.workspace_header:
            headers["X-DashScope-WorkSpace"] = self.workspace_header
        return headers

    def connect(self) -> None:
        if self._ws is None:
            self._ws = ws_connect(self.url, self._headers(), self.timeout)

    def close(self) -> None:
        if self._ws is not None:
            self._ws.close()
            self._ws = None

    def __enter__(self) -> "BailianTTS":
        self.connect()
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # -- 任务事件 ---------------------------------------------------------- #
    @staticmethod
    def _command(action: str, task_id: str, payload: dict) -> str:
        return json.dumps(
            {"header": {"action": action, "task_id": task_id, "streaming": "duplex"},
             "payload": payload},
            ensure_ascii=False,
        )

    @staticmethod
    def _build_params(
        voice: str,
        audio_format: str,
        sample_rate: int,
        volume: int,
        rate: float,
        pitch: float,
        bit_rate: int | None,
        instruction: str | None,
        language_hints: Iterable[str] | None,
        seed: int | None,
        enable_ssml: bool,
        word_timestamp_enabled: bool,
        enable_aigc_tag: bool,
        aigc_propagator: str | None,
        aigc_propagate_id: str | None,
        hot_fix: dict | None,
        text_type: bool = True,
    ) -> dict:
        """构造合成参数；实时（WebSocket）与非实时（HTTP）共用同一套字段。"""
        params: dict = {}
        if text_type:                      # 仅 WebSocket 协议的 run-task 需要 text_type
            params["text_type"] = "PlainText"
        params.update({
            "voice": voice,
            "format": audio_format,
            "sample_rate": sample_rate,
            "volume": volume,
            "rate": rate,
            "pitch": pitch,
            "enable_ssml": enable_ssml,
        })
        if bit_rate is not None:
            params["bit_rate"] = bit_rate
        if instruction:
            params["instruction"] = instruction
        if language_hints:
            params["language_hints"] = list(language_hints)
        if seed is not None:
            params["seed"] = seed
        if word_timestamp_enabled:
            params["word_timestamp_enabled"] = True
        if enable_aigc_tag:
            params["enable_aigc_tag"] = True
            if aigc_propagator:
                params["aigc_propagator"] = aigc_propagator
            if aigc_propagate_id:
                params["aigc_propagate_id"] = aigc_propagate_id
        if hot_fix:
            params["hot_fix"] = hot_fix
        return params

    def _run_task_payload(
        self,
        model: str,
        voice: str,
        audio_format: str,
        sample_rate: int,
        volume: int,
        rate: float,
        pitch: float,
        bit_rate: int | None,
        instruction: str | None,
        language_hints: Iterable[str] | None,
        seed: int | None,
        enable_ssml: bool,
        word_timestamp_enabled: bool,
        enable_aigc_tag: bool,
        aigc_propagator: str | None,
        aigc_propagate_id: str | None,
        hot_fix: dict | None,
    ) -> dict:
        params = self._build_params(
            voice=voice, audio_format=audio_format, sample_rate=sample_rate,
            volume=volume, rate=rate, pitch=pitch, bit_rate=bit_rate,
            instruction=instruction, language_hints=language_hints, seed=seed,
            enable_ssml=enable_ssml, word_timestamp_enabled=word_timestamp_enabled,
            enable_aigc_tag=enable_aigc_tag, aigc_propagator=aigc_propagator,
            aigc_propagate_id=aigc_propagate_id, hot_fix=hot_fix, text_type=True,
        )

        return {
            "task_group": "audio",
            "task": "tts",
            "function": "SpeechSynthesizer",
            "model": model,
            "parameters": params,
            "input": {},
        }

    # -- 主流程 ------------------------------------------------------------ #
    def synthesize(
        self,
        text: str,
        model: str = DEFAULT_MODEL,
        voice: str | None = None,
        audio_format: str = "mp3",
        sample_rate: int = 22050,
        volume: int = 50,
        rate: float = 1.0,
        pitch: float = 1.0,
        bit_rate: int | None = None,
        instruction: str | None = None,
        language_hints: Iterable[str] | None = None,
        seed: int | None = None,
        enable_ssml: bool = False,
        word_timestamp_enabled: bool = False,
        enable_aigc_tag: bool = False,
        aigc_propagator: str | None = None,
        aigc_propagate_id: str | None = None,
        hot_fix: dict | None = None,
        on_audio: Callable[[bytes], None] | None = None,
        on_event: Callable[[dict], None] | None = None,
        split: bool = True,
    ) -> TTSResult:
        """
        合成一段文本，返回 TTSResult（含完整音频字节）。

        on_audio: 每收到一个音频帧回调一次（流式播放/落盘用）。
        split:    是否按标点切分文本后分多次 continue-task 发送，可降低首包延迟。
        """
        self._check_args(model, voice, audio_format, sample_rate, volume, rate,
                         pitch, bit_rate)
        voice = voice or DEFAULT_VOICE[model]

        text = text.strip()
        if not text:
            raise ValueError("文本不能为空")
        if len(text) > MAX_CHARS_TOTAL:
            raise ValueError(f"文本累计不能超过 {MAX_CHARS_TOTAL} 字符")

        self.connect()
        assert self._ws is not None

        task_id = str(uuid.uuid4())          # 每个任务必须使用新的 task_id
        result = TTSResult()

        # 1) run-task
        payload = self._run_task_payload(
            model=model, voice=voice, audio_format=audio_format, sample_rate=sample_rate,
            volume=volume, rate=rate, pitch=pitch, bit_rate=bit_rate,
            instruction=instruction, language_hints=language_hints, seed=seed,
            enable_ssml=enable_ssml, word_timestamp_enabled=word_timestamp_enabled,
            enable_aigc_tag=enable_aigc_tag, aigc_propagator=aigc_propagator,
            aigc_propagate_id=aigc_propagate_id, hot_fix=hot_fix,
        )
        self._ws.send(self._command("run-task", task_id, payload))

        started = False
        finished = False
        while not finished:
            opcode, data = self._ws.recv()

            # 二进制帧 = 音频数据（sentence-synthesis 之后紧跟着一帧）
            if opcode == OP_BINARY:
                result.audio += data
                result.chunks += 1
                if on_audio:
                    on_audio(data)
                continue

            if opcode == OP_CLOSE:
                raise WebSocketError("服务端提前关闭了连接")

            try:
                msg = json.loads(data.decode("utf-8"))
            except Exception:
                continue
            if on_event:
                on_event(msg)

            header = msg.get("header", {})
            event = header.get("event", "")

            if event == "task-started":
                started = True
                # 2) continue-task：把文本按标点切片后依次发送
                for piece in (split_text(text) if split else [text]):
                    self._ws.send(self._command(
                        "continue-task", task_id, {"input": {"text": piece}}))
                # 3) finish-task：通知文本发送完毕（不可省略，否则音频可能不完整）
                self._ws.send(self._command("finish-task", task_id, {"input": {}}))

            elif event == "result-generated":
                out = msg.get("payload", {}).get("output", {})
                if out.get("type") == "sentence-end":
                    result.words.extend(out.get("sentence", {}).get("words") or [])
                    result.characters = (
                        msg.get("payload", {}).get("usage", {}).get("characters",
                                                                  result.characters)
                    )

            elif event == "task-finished":
                result.characters = (
                    msg.get("payload", {}).get("usage", {}).get("characters",
                                                              result.characters)
                )
                result.request_uuid = header.get("attributes", {}).get("request_uuid", "")
                finished = True

            elif event == "task-failed":
                # 任务失败时服务端会关闭连接，该连接不可复用
                self.close()
                raise WebSocketError(
                    f"合成失败 [{header.get('error_code')}] {header.get('error_message')}"
                )

        if not started:
            raise WebSocketError("未收到 task-started 事件")
        return result

    # -- 取消当前任务 ------------------------------------------------------ #
    def cancel(self, task_id: str) -> None:
        """取消当前轮次合成：finish-task + input.directive=cancel。"""
        if self._ws is None:
            return
        self._ws.send(self._command("finish-task", task_id, {"input": {"directive": "cancel"}}))

    # ------------------------------------------------------------------ #
    # 非实时（HTTP）合成：一次 POST 拿回音频 URL，无需 WebSocket
    # ------------------------------------------------------------------ #
    @property
    def http_url(self) -> str:
        if self.region not in HTTP_URL_TEMPLATE:
            raise ValueError(
                f"非实时接口仅在北京地域提供，当前 region={self.region!r}；"
                f"可用：{list(HTTP_URL_TEMPLATE)}"
            )
        return HTTP_URL_TEMPLATE[self.region].format(workspace=self.workspace)

    def synthesize_http(
        self,
        text: str,
        model: str = DEFAULT_MODEL,
        voice: str | None = None,
        audio_format: str = "wav",
        sample_rate: int = 24000,
        volume: int = 50,
        rate: float = 1.0,
        pitch: float = 1.0,
        bit_rate: int | None = None,
        instruction: str | None = None,
        language_hints: Iterable[str] | None = None,
        seed: int | None = None,
        enable_ssml: bool = False,
        word_timestamp_enabled: bool = False,
        enable_aigc_tag: bool = False,
        aigc_propagator: str | None = None,
        aigc_propagate_id: str | None = None,
        hot_fix: dict | None = None,
        stream: bool = False,
        on_audio: Callable[[bytes], None] | None = None,
        on_event: Callable[[dict], None] | None = None,
        timeout: float = 120.0,
    ) -> TTSResult:
        """
        非实时合成（HTTP POST）。返回的 TTSResult.audio 是完整音频字节。

        stream=False：服务端合成完成后返回音频 URL（有效期 24h），本方法会下载它。
        stream=True ：加 X-DashScope-SSE: enable，逐段返回 base64 音频（可配合 on_audio 边收边播）。
        """
        self._check_args(model, voice, audio_format, sample_rate, volume, rate,
                         pitch, bit_rate)
        voice = voice or DEFAULT_VOICE[model]
        text = text.strip()
        if not text:
            raise ValueError("文本不能为空")

        params = self._build_params(
            voice=voice, audio_format=audio_format, sample_rate=sample_rate,
            volume=volume, rate=rate, pitch=pitch, bit_rate=bit_rate,
            instruction=instruction, language_hints=language_hints, seed=seed,
            enable_ssml=enable_ssml, word_timestamp_enabled=word_timestamp_enabled,
            enable_aigc_tag=enable_aigc_tag, aigc_propagator=aigc_propagator,
            aigc_propagate_id=aigc_propagate_id, hot_fix=hot_fix, text_type=False,
        )
        body = json.dumps({"model": model, "input": {**params, "text": text}},
                          ensure_ascii=False).encode("utf-8")

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "user-agent": "bailian-tts.py",
        }
        if stream:
            headers["X-DashScope-SSE"] = "enable"

        result = TTSResult()
        req = urllib.request.Request(self.http_url, data=body, headers=headers, method="POST")

        def open_once():
            try:
                return urllib.request.urlopen(req, timeout=timeout)
            except urllib.error.HTTPError as e:
                raise WebSocketError(
                    f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')}"
                ) from None

        resp = retry_call(open_once, retries=self.retries, what="http-tts")

        with resp:
            if not stream:
                data = json.loads(resp.read().decode("utf-8"))
                if on_event:
                    on_event(data)
                out = data.get("output", {})
                result.characters = data.get("usage", {}).get("characters", 0)
                result.request_uuid = data.get("request_id", "")
                url = out.get("audio", {}).get("url")
                if not url:
                    raise WebSocketError(f"响应中没有音频 URL：{data}")
                result.audio = download(url, timeout=timeout)
                if audio_format == "wav":
                    result.audio = fix_wav_size(result.audio)
                result.chunks = 1
                if on_audio:
                    on_audio(result.audio)
                return result

            # SSE 流式：逐行读取 "data:{...}"，sentence-synthesis 里带 base64 音频
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if not payload or payload == "[DONE]":
                    continue
                try:
                    msg = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                if on_event:
                    on_event(msg)
                out = msg.get("output", {})
                result.request_uuid = msg.get("request_id", result.request_uuid)
                result.characters = msg.get("usage", {}).get("characters", result.characters)

                chunk = out.get("audio", {}).get("data") or ""
                if chunk:
                    blob = base64.b64decode(chunk)
                    result.audio += blob
                    result.chunks += 1
                    if on_audio:
                        on_audio(blob)

                if out.get("type") == "sentence-end":
                    result.words.extend(out.get("sentence", {}).get("words") or [])
                if out.get("finish_reason") == "stop":
                    url = out.get("audio", {}).get("url")
                    if not result.audio and url:
                        result.audio = download(url, timeout=timeout)
                        result.chunks = 1
                        if on_audio:
                            on_audio(result.audio)
        if audio_format == "wav":
            result.audio = fix_wav_size(result.audio)
        return result

    # -- 参数校验（两种模式共用） ------------------------------------------ #
    def _check_args(self, model, voice, audio_format, sample_rate,
                    volume, rate, pitch, bit_rate) -> None:
        if model not in SUPPORTED_MODELS:
            raise ValueError(f"本脚本仅支持 {SUPPORTED_MODELS}，收到 {model!r}")
        allowed = REGION_MODELS.get(self.region)
        if allowed and model not in allowed:
            raise ValueError(f"地域 {self.region} 不支持模型 {model!r}")
        # 音色：内置系统音色表只用于“提示”，不用于拦截。
        # 声音复刻/声音设计生成的专属音色 ID、以及 500+ 基础音色都不在表里，
        # 必须放行；拼错时由服务端返回 InvalidParameter。
        if voice and voice not in VOICES[model]:
            if self.strict_voice:
                raise ValueError(
                    f"音色 {voice!r} 不在模型 {model} 的内置系统音色表中"
                    f"（--strict-voice 已开启）。可用音色见 --list-voices"
                )
            print(f"[提示] 音色 {voice!r} 不在内置系统音色表中，"
                  f"将按自定义音色（复刻/设计/基础音色）直接提交。", file=sys.stderr)
        if audio_format not in AUDIO_FORMATS:
            raise ValueError(f"format 必须是 {AUDIO_FORMATS}")
        if sample_rate not in SAMPLE_RATES:
            raise ValueError(f"sample_rate 必须是 {SAMPLE_RATES}")
        if not (0 <= volume <= 100):
            raise ValueError("volume 取值范围 [0, 100]")
        if not (0.5 <= rate <= 2.0):
            raise ValueError("rate 取值范围 [0.5, 2.0]")
        if not (0.5 <= pitch <= 2.0):
            raise ValueError("pitch 取值范围 [0.5, 2.0]")
        if bit_rate is not None and not (6 <= bit_rate <= 510):
            raise ValueError("bit_rate 取值范围 [6, 510]")

    # ------------------------------------------------------------------ #
    # 自定义音色：声音复刻（上传音频）/ 声音设计（文字描述）
    # ------------------------------------------------------------------ #
    @property
    def customization_url(self) -> str:
        """音色管理端点（create/query/delete），与合成端点不同。"""
        region = self.region.replace("-legacy", "")
        if region == "beijing":
            host = f"{self.workspace}.cn-beijing.maas.aliyuncs.com"
        elif region == "singapore":
            host = f"{self.workspace}.ap-southeast-1.maas.aliyuncs.com"
        else:
            raise ValueError(f"不支持的地域 {self.region!r}")
        return f"https://{host}/api/v1/services/audio/tts/customization"

    def _customization(self, payload: dict, timeout: float = 120.0) -> dict:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            self.customization_url, data=body, method="POST",
            headers={"Authorization": f"Bearer {self.api_key}",
                     "Content-Type": "application/json",
                     "user-agent": "bailian-tts.py"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            if e.code == 403 and "API-Key restrictions" in detail:
                detail += (
                    "\n  → 当前 API Key 被「权限限制」挡在了音色管理接口之外。"
                    "合成接口可用，但创建/删除音色需要一把未限制"
                    "（或已勾选 语音合成-音色管理）的业务空间 API Key。"
                )
            raise WebSocketError(f"HTTP {e.code}: {detail}") from None

    def create_voice(
        self,
        audio_url: str,
        target_model: str = DEFAULT_MODEL,
        prefix: str = "myvoice",
        timeout: float = 120.0,
    ) -> str:
        """
        声音复刻：上传一段音频（可访问 URL）创建专属音色，返回 voice_id。

        音频要求（Qwen-Audio-TTS）：WAV(16bit)/MP3/M4A，10~20 秒最佳、≤60 秒、
        ≤10MB、采样率 ≥16kHz、至少 5 秒连续清晰朗读、无背景音。

        注意：target_model 必须与后续合成用的 model 完全一致，音色不能跨模型使用。
        """
        resp = self._customization({
            "model": "voice-enrollment",
            "input": {"action": "create_voice", "target_model": target_model,
                      "prefix": prefix, "url": audio_url},
        }, timeout=timeout)
        return _extract_voice_id(resp)

    def design_voice(
        self,
        voice_prompt: str,
        target_model: str = DEFAULT_MODEL,
        prefix: str = "mydesign",
        preview_text: str | None = None,
        sample_rate: int = 24000,
        response_format: str = "wav",
        timeout: float = 120.0,
    ) -> str:
        """
        声音设计：用自然语言描述生成音色，返回 voice_id。

        voice_prompt 建议写明性别、年龄、音调、语速、情感、特点、用途等维度，
        例如“沉稳的中年男性播音员，音色低沉浑厚，富有磁性，语速平稳，吐字清晰”。
        """
        inp = {"action": "create_voice", "target_model": target_model,
               "prefix": prefix, "voice_prompt": voice_prompt}
        if preview_text:
            inp["preview_text"] = preview_text
        resp = self._customization({
            "model": "voice-enrollment",
            "input": inp,
            "parameters": {"sample_rate": sample_rate,
                           "response_format": response_format},
        }, timeout=timeout)
        return _extract_voice_id(resp)

    def delete_voice(self, voice_id: str, timeout: float = 60.0) -> dict:
        """删除自定义音色。"""
        return self._customization({
            "model": "voice-enrollment",
            "input": {"action": "delete_voice", "voice_id": voice_id},
        }, timeout=timeout)


def download(url: str, timeout: float = 120.0, retries: int = DEFAULT_RETRIES) -> bytes:
    """下载音频 URL（OSS 直链，有效期 24 小时）。DNS/超时自动重试。"""
    def once() -> bytes:
        req = urllib.request.Request(url, headers={"user-agent": "bailian-tts.py"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    return retry_call(once, retries=retries, what="download")


def _extract_voice_id(resp: dict) -> str:
    """音色 ID 字段名不统一：Qwen-TTS 系列在 output.voice，其他在 output.voice_id。"""
    out = resp.get("output", {}) or {}
    vid = out.get("voice_id") or out.get("voice")
    if not vid:
        raise WebSocketError(f"创建音色失败，响应中没有 voice_id：{resp}")
    return vid


def fix_wav_size(data: bytes) -> bytes:
    """
    修正 wav 头部长度字段。

    服务端流式生成的 wav，其 RIFF/data 长度是占位值（2147483583），
    严格解析器（如 Python 的 wave 模块）会因此算出 44739 秒的假时长。
    这里按实际字节数回填，让文件可正常播放与 seek。
    """
    if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return data
    out = bytearray(data)
    struct.pack_into("<I", out, 4, len(data) - 8)
    i = 12
    while i + 8 <= len(data):
        cid = bytes(out[i:i + 4])
        size = struct.unpack_from("<I", out, i + 4)[0]
        if cid == b"data":
            struct.pack_into("<I", out, i + 4, len(data) - i - 8)
            break
        if size > len(data):
            break
        i += 8 + size + (size & 1)
    return bytes(out)


# --------------------------------------------------------------------------- #
# 5. 工具函数
# --------------------------------------------------------------------------- #

_SENTENCE_RE = re.compile(r"[^。！？!?；;\n]+[。！？!?；;\n]?")


def split_text(text: str, max_len: int = 200) -> list[str]:
    """
    按标点把长文本切成若干片段，逐个 continue-task 发送以降低首包延迟。
    服务端本身也会分句，这里只是让文本更早到达。
    """
    pieces: list[str] = []
    for m in _SENTENCE_RE.finditer(text):
        s = m.group(0)
        while len(s) > max_len:
            pieces.append(s[:max_len])
            s = s[max_len:]
        if s:
            pieces.append(s)
    # 保证每片不超过单次上限
    out: list[str] = []
    for p in pieces or [text]:
        while len(p) > MAX_CHARS_PER_CONTINUE:
            out.append(p[:MAX_CHARS_PER_CONTINUE])
            p = p[MAX_CHARS_PER_CONTINUE:]
        out.append(p)
    return [p for p in out if p]


def list_voices() -> str:
    lines = []
    for model in SUPPORTED_MODELS:
        vs = VOICES[model]
        lines.append(f"{model}  （{len(vs)} 个系统音色）")
        lines.append("  " + ", ".join(vs))
        lines.append("")
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# 6. 命令行入口
# --------------------------------------------------------------------------- #

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="阿里云百炼实时语音合成（仅 qwen-audio-3.0-tts-plus / qwen-audio-3.1-tts-flash）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("text", nargs="?", help="待合成文本")
    p.add_argument("-m", "--model", default=DEFAULT_MODEL, choices=list(SUPPORTED_MODELS),
                   help=f"模型，默认 {DEFAULT_MODEL}")
    p.add_argument("-v", "--voice", default=None,
                   help=f"音色，默认 {DEFAULT_VOICE[DEFAULT_MODEL]}")
    p.add_argument("-o", "--output", default=None, help="输出文件，默认 output.<format>")
    p.add_argument("-f", "--format", dest="audio_format", default="mp3", choices=list(AUDIO_FORMATS))
    p.add_argument("--force", action="store_true", help="输出已存在也重新合成（默认跳过）")
    p.add_argument("--retries", type=int, default=DEFAULT_RETRIES,
                   help=f"网络/服务重试次数，默认 {DEFAULT_RETRIES}（可用 REEL_TTS_RETRIES）")
    p.add_argument("--sample-rate", type=int, default=22050, choices=list(SAMPLE_RATES))
    p.add_argument("--volume", type=int, default=50, help="音量 [0,100]，默认 50")
    p.add_argument("--rate", type=float, default=1.0, help="语速 [0.5,2.0]，默认 1.0")
    p.add_argument("--pitch", type=float, default=1.0, help="音调 [0.5,2.0]，默认 1.0")
    p.add_argument("--bit-rate", type=int, default=None, help="码率 kbps [6,510]（mp3/opus）")
    p.add_argument("--instruction", default=None, help="指令控制，如“请用四川话表达”")
    p.add_argument("--language-hints", default=None, help="目标语言，如 zh / en")
    p.add_argument("--seed", type=int, default=None, help="随机种子 [0,65535]")
    p.add_argument("--enable-ssml", action="store_true", help="开启 SSML（只允许一次 continue-task）")
    p.add_argument("--word-timestamps", action="store_true", help="返回字级时间戳")
    p.add_argument("--aigc-tag", action="store_true", help="在音频中嵌入 AIGC 隐性标识")
    p.add_argument("--workspace", default=WORKSPACE_ID,
                   help="业务空间 ID（必填，或用 DASHSCOPE_WORKSPACE）")
    p.add_argument("--region", default="beijing", choices=list(WS_URL_TEMPLATE))
    p.add_argument("--api-key", default=None,
                   help="API Key（必填，或用 DASHSCOPE_API_KEY）")
    p.add_argument("--data-inspection", action="store_true", help="启用数据合规检测")
    p.add_argument("--no-split", action="store_true", help="不做标点切分，一次性发送全文")
    p.add_argument("--mode", default="http", choices=("http", "ws"),
                   help="http=非实时（一次 POST，默认）；ws=实时 WebSocket（低延迟流式）")
    p.add_argument("--stream", action="store_true",
                   help="仅 --mode http：开启 SSE 流式，边合成边返回音频")
    p.add_argument("--list-voices", action="store_true", help="列出两个模型的全部系统音色")
    p.add_argument("--list-tags", action="store_true", help="列出情感与富语言标签")
    p.add_argument("--strict-voice", action="store_true",
                   help="音色必须是内置系统音色，否则报错（默认放行自定义音色）")
    p.add_argument("--create-voice", metavar="AUDIO_URL",
                   help="声音复刻：用一段音频 URL 创建专属音色，打印 voice_id 后退出")
    p.add_argument("--design-voice", metavar="PROMPT",
                   help="声音设计：用一段声音描述创建专属音色，打印 voice_id 后退出")
    p.add_argument("--target-model", default=None,
                   help="创建音色时绑定的模型，默认取 -m；必须与后续合成模型一致")
    p.add_argument("--prefix", default="myvoice", help="音色名前缀，默认 myvoice")
    p.add_argument("--preview-text", default=None, help="声音设计的试听文本")
    p.add_argument("--delete-voice", metavar="VOICE_ID", help="删除自定义音色")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.list_voices:
        print(list_voices())
        return 0
    if args.list_tags:
        print("控制类标签（作用于其后文本）：")
        print("  " + "  ".join(f"[{t}]" for t in EMOTION_TAGS))
        print("\n富语言类标签（在该位置插入拟声）：")
        print("  " + "  ".join(f"[{t}]" for t in RICH_TAGS))
        return 0

    # -- 自定义音色管理（声音复刻 / 声音设计 / 删除） -------------------- #
    if args.create_voice or args.design_voice or args.delete_voice:
        tts = BailianTTS(api_key=args.api_key, workspace=args.workspace,
                         region=args.region)
        target = args.target_model or args.model
        if args.create_voice:
            vid = tts.create_voice(args.create_voice, target_model=target,
                                   prefix=args.prefix)
            print(f"声音复刻成功，绑定模型 {target}")
        elif args.design_voice:
            vid = tts.design_voice(args.design_voice, target_model=target,
                                   prefix=args.prefix, preview_text=args.preview_text)
            print(f"声音设计成功，绑定模型 {target}")
        else:
            tts.delete_voice(args.delete_voice)
            print(f"已删除音色 {args.delete_voice}")
            return 0
        print(f"voice_id: {vid}")
        print(f"\n合成时使用： python3 {os.path.basename(__file__)} \"文本\" "
              f"-m {target} -v {vid}")
        return 0

    if not args.text:
        build_parser().print_help()
        return 1

    out_path = args.output or f"output.{args.audio_format}"
    if os.path.exists(out_path) and os.path.getsize(out_path) > 0 and not args.force:
        print(f"已存在，跳过：{out_path}（--force 可覆盖）")
        return 0
    t0 = time.time()
    first_packet = [None]

    def _on_audio(chunk: bytes) -> None:
        if first_packet[0] is None:
            first_packet[0] = (time.time() - t0) * 1000

    common = dict(
        model=args.model,
        voice=args.voice,
        audio_format=args.audio_format,
        sample_rate=args.sample_rate,
        volume=args.volume,
        rate=args.rate,
        pitch=args.pitch,
        bit_rate=args.bit_rate,
        instruction=args.instruction,
        language_hints=[args.language_hints] if args.language_hints else None,
        seed=args.seed,
        enable_ssml=args.enable_ssml,
        word_timestamp_enabled=args.word_timestamps,
        enable_aigc_tag=args.aigc_tag,
        on_audio=_on_audio,
    )

    tts = BailianTTS(
        api_key=args.api_key,
        workspace=args.workspace,
        region=args.region,
        data_inspection=args.data_inspection,
        strict_voice=args.strict_voice,
    )
    tts.retries = args.retries
    if args.mode == "http":
        result = tts.synthesize_http(args.text, stream=args.stream, **common)
    else:
        def _ws_once():
            with tts:
                return tts.synthesize(args.text, split=not args.no_split, **common)
        result = retry_call(_ws_once, retries=args.retries, what="ws-tts")

    with open(out_path, "wb") as f:
        f.write(result.audio)

    print(f"模式   : {'http(非实时)' + (' + SSE 流式' if args.stream else '') if args.mode == 'http' else 'ws(实时)'}")
    print(f"模型   : {args.model}")
    print(f"音色   : {args.voice or DEFAULT_VOICE[args.model]}")
    print(f"输出   : {out_path}  ({len(result.audio)} 字节, {result.chunks} 个音频帧)")
    if first_packet[0] is not None:
        print(f"首包延迟: {first_packet[0]:.0f} ms")
    print(f"总耗时 : {(time.time() - t0) * 1000:.0f} ms")
    if result.characters:
        print(f"计费字符: {result.characters}")
    if result.request_uuid:
        print(f"request_uuid: {result.request_uuid}")
    if result.words:
        print(f"字级时间戳: {len(result.words)} 条，前 5 条：")
        for w in result.words[:5]:
            print(f"  {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

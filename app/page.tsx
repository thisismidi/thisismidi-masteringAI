import os
import uuid
import shutil
import math
import pyloudnorm as pyln
import numpy as np
from scipy.signal import resample_poly
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import pedalboard
from pedalboard.io import AudioFile

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TEMP_DIR = "temp_audio"
os.makedirs(TEMP_DIR, exist_ok=True)

@app.post("/master")
async def process_audio(
    file: UploadFile = File(...),
    target_lufs: float = Form(-14.0),
    true_peak: float = Form(-1.0),
    warmth: float = Form(0.0),
    stereo_width: float = Form(100.0),
    mono_bass: float = Form(0.0),
    out_format: str = Form("MP3"),
    out_sample_rate: int = Form(44100),
    out_bit_depth: int = Form(16)
):
    file_id = str(uuid.uuid4())
    input_path = os.path.join(TEMP_DIR, f"in_{file_id}.wav")
    
    # 출력 확장자 동적 설정 (mp3, wav, flac)
    ext = out_format.lower()
    output_path = os.path.join(TEMP_DIR, f"out_{file_id}.{ext}")

    try:
        # 1. 원본 파일 저장
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # 2. 오디오 로드
        with AudioFile(input_path) as f:
            audio = f.read(f.frames)
            orig_sr = f.samplerate

        # [PRO] 톤 캐릭터 & 스테레오 제어
        if warmth > 0:
            sat_amt = (warmth / 100) * 4.0 
            audio = pedalboard.Pedalboard([
                pedalboard.Gain(gain_db=sat_amt), 
                pedalboard.Clipping(threshold_db=-1.0), 
                pedalboard.Gain(gain_db=-sat_amt/2)
            ])(audio, orig_sr)

        if stereo_width != 100.0:
            wf = stereo_width / 100.0
            mid = (audio[0] + audio[1]) / 2.0
            side = (audio[0] - audio[1]) / 2.0 * wf
            audio = np.array([mid + side, mid - side])

        if mono_bass > 0:
            cutoff = (mono_bass / 100) * 100
            audio = pedalboard.Pedalboard([
                pedalboard.HighPassFilter(cutoff_frequency_hz=cutoff)
            ])(audio, orig_sr)

        # 3. 라우드니스 타겟 매칭 (LUFS)
        meter = pyln.Meter(orig_sr)
        current_lufs = meter.integrated_loudness(audio.T)
        loudness_normalized = pyln.normalize.loudness(audio.T, current_lufs, target_lufs)
        
        # 4. 트루 피크 리미터 (True Peak)
        board = pedalboard.Pedalboard([
            pedalboard.Compressor(threshold_db=-18, ratio=1.5), 
            pedalboard.Limiter(threshold_db=true_peak)
        ])
        mastered_audio = board(loudness_normalized.T, orig_sr)

        # 5. 고음질 리샘플링 (Resampling)
        # 사용자가 요청한 샘플레이트(48kHz, 96kHz 등)가 원본과 다를 경우 변환
        final_sr = out_sample_rate
        if final_sr != orig_sr:
            gcd = math.gcd(final_sr, orig_sr)
            up = final_sr // gcd
            down = orig_sr // gcd
            # scipy의 polyphase 필터를 사용해 앨리어싱 없이 깔끔하게 리샘플링
            mastered_audio = resample_poly(mastered_audio, up, down, axis=1)

        # 6. 최종 포맷 렌더링 (Bit Depth 및 포맷 적용)
        with AudioFile(
            output_path, 
            'w', 
            samplerate=final_sr, 
            num_channels=mastered_audio.shape[0], 
            bit_depth=out_bit_depth
        ) as f:
            f.write(mastered_audio)
            
        return FileResponse(path=output_path, media_type=f"audio/{ext}", headers={"Access-Control-Allow-Origin": "*"})

    except Exception as e:
        return {"error": str(e)}

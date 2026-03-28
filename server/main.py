import asyncio
import json
import os
import subprocess
import tempfile
import audalign as ad
from fastapi import FastAPI, Form, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from openai import OpenAI
from pydantic import BaseModel
from typing import List
import anthropic

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        with open(tmp_path, "rb") as audio_file:
            result = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
            )
        return {"transcript": result.text}
    finally:
        os.unlink(tmp_path)


@app.post("/timelapse")
async def timelapse(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(await file.read())
        input_path = tmp.name

    output_path = input_path + "_timelapse.mp4"

    try:
        # Probe the duration of the input video
        probe = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                input_path,
            ],
            capture_output=True, text=True,
        )
        duration = float(probe.stdout.strip())
        target = 15.0
        speed = duration / target if duration > target else 1.0

        # Build ffmpeg filter: setpts for video speed, atempo chain for audio
        video_filter = f"setpts={1/speed}*PTS"

        # atempo only accepts [0.5, 100], so chain multiple if needed
        atempo_filters = []
        remaining = speed
        while remaining > 100.0:
            atempo_filters.append("atempo=100.0")
            remaining /= 100.0
        while remaining > 2.0:
            atempo_filters.append("atempo=2.0")
            remaining /= 2.0
        if remaining >= 0.5:
            atempo_filters.append(f"atempo={remaining:.4f}")
        audio_filter = ",".join(atempo_filters) if atempo_filters else "atempo=1.0"

        subprocess.run(
            [
                "ffmpeg", "-y", "-i", input_path,
                "-filter_complex",
                f"[0:v]{video_filter}[v];[0:a]{audio_filter}[a]",
                "-map", "[v]", "-map", "[a]",
                "-c:v", "libx264", "-preset", "fast",
                "-c:a", "aac",
                "-movflags", "+faststart",
                output_path,
            ],
            capture_output=True, text=True, check=True,
        )

        return FileResponse(
            output_path,
            media_type="video/mp4",
            filename="timelapse.mp4",
            background=None,
        )
    finally:
        os.unlink(input_path)
        # Note: FileResponse will serve the file, then we can't easily clean up.
        # In production, use a cleanup task. For dev this is fine.


@app.post("/remove-silence")
async def remove_silence(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(await file.read())
        input_path = tmp.name

    output_path = input_path + "_nosilence.mp4"

    try:
        # Use silencedetect to find silent segments
        detect = subprocess.run(
            [
                "ffmpeg", "-i", input_path,
                "-af", "silencedetect=noise=-30dB:d=0.5",
                "-f", "null", "-",
            ],
            capture_output=True, text=True,
        )
        stderr = detect.stderr

        # Parse silence intervals from ffmpeg output
        silence_starts = []
        silence_ends = []
        for line in stderr.split("\n"):
            if "silence_start:" in line:
                val = line.split("silence_start:")[1].strip().split()[0]
                silence_starts.append(float(val))
            if "silence_end:" in line:
                val = line.split("silence_end:")[1].strip().split()[0]
                silence_ends.append(float(val))

        # Get total duration
        probe = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                input_path,
            ],
            capture_output=True, text=True,
        )
        total_duration = float(probe.stdout.strip())

        # Build non-silent segments
        # Pair up starts/ends. If silence_starts has one more, the last silence goes to end.
        silences = list(zip(silence_starts, silence_ends))
        if len(silence_starts) > len(silence_ends):
            silences.append((silence_starts[-1], total_duration))

        if not silences:
            # No silence detected, return original as mp4
            subprocess.run(
                ["ffmpeg", "-y", "-i", input_path, "-c:v", "libx264",
                 "-preset", "fast", "-c:a", "aac", "-movflags", "+faststart",
                 output_path],
                capture_output=True, text=True, check=True,
            )
            return FileResponse(output_path, media_type="video/mp4",
                                filename="no_silence.mp4", background=None)

        # Compute non-silent segments
        segments = []
        cursor = 0.0
        for s_start, s_end in silences:
            if s_start > cursor:
                segments.append((cursor, s_start))
            cursor = s_end
        if cursor < total_duration:
            segments.append((cursor, total_duration))

        if not segments:
            # Entire video is silence
            return {"error": "The entire video is silent."}

        # Build ffmpeg filter_complex to concat non-silent segments
        filter_parts = []
        for i, (start, end) in enumerate(segments):
            filter_parts.append(
                f"[0:v]trim=start={start:.3f}:end={end:.3f},setpts=PTS-STARTPTS[v{i}];"
                f"[0:a]atrim=start={start:.3f}:end={end:.3f},asetpts=PTS-STARTPTS[a{i}];"
            )

        concat_inputs = "".join(f"[v{i}][a{i}]" for i in range(len(segments)))
        filter_parts.append(f"{concat_inputs}concat=n={len(segments)}:v=1:a=1[outv][outa]")
        filter_complex = "".join(filter_parts)

        subprocess.run(
            [
                "ffmpeg", "-y", "-i", input_path,
                "-filter_complex", filter_complex,
                "-map", "[outv]", "-map", "[outa]",
                "-c:v", "libx264", "-preset", "fast",
                "-c:a", "aac",
                "-movflags", "+faststart",
                output_path,
            ],
            capture_output=True, text=True, check=True,
        )

        return FileResponse(
            output_path,
            media_type="video/mp4",
            filename="no_silence.mp4",
            background=None,
        )
    finally:
        os.unlink(input_path)


def _srt_timestamp(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds - int(seconds)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


@app.post("/add-captions")
async def add_captions(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(await file.read())
        input_path = tmp.name

    srt_path = input_path + ".srt"
    output_path = input_path + "_captioned.mp4"

    try:
        # Transcribe with segment-level timestamps via Whisper
        with open(input_path, "rb") as audio_file:
            result = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="verbose_json",
                timestamp_granularities=["segment"],
            )

        # Build SRT from segments
        segments = result.segments if hasattr(result, "segments") else []
        srt_lines = []
        for i, seg in enumerate(segments):
            start = seg["start"] if isinstance(seg, dict) else seg.start
            end = seg["end"] if isinstance(seg, dict) else seg.end
            text = seg["text"] if isinstance(seg, dict) else seg.text
            srt_lines.append(f"{i + 1}")
            srt_lines.append(f"{_srt_timestamp(start)} --> {_srt_timestamp(end)}")
            srt_lines.append(text.strip())
            srt_lines.append("")

        if not srt_lines:
            subprocess.run(
                ["ffmpeg", "-y", "-i", input_path, "-c", "copy", output_path],
                capture_output=True, text=True, check=True,
            )
            return FileResponse(output_path, media_type="video/mp4",
                                filename="captioned.mp4", background=None)

        with open(srt_path, "w") as f:
            f.write("\n".join(srt_lines))

        # Burn in subtitles with ffmpeg
        escaped_srt = srt_path.replace("\\", "\\\\").replace(":", "\\:")
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", input_path,
                "-vf", f"subtitles={escaped_srt}",
                "-c:v", "libx264", "-preset", "fast",
                "-c:a", "aac",
                "-movflags", "+faststart",
                output_path,
            ],
            capture_output=True, text=True, check=True,
        )

        return FileResponse(
            output_path,
            media_type="video/mp4",
            filename="captioned.mp4",
            background=None,
        )
    finally:
        os.unlink(input_path)
        if os.path.exists(srt_path):
            os.unlink(srt_path)


@app.post("/add-music")
async def add_music(
    file: UploadFile = File(...),
    music: UploadFile = File(...),
    volume: float = Form(0.15),
):
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(await file.read())
        input_path = tmp.name

    music_ext = os.path.splitext(music.filename or "track.mp3")[1] or ".mp3"
    with tempfile.NamedTemporaryFile(suffix=music_ext, delete=False) as mtmp:
        mtmp.write(await music.read())
        music_path = mtmp.name

    output_path = input_path + "_withmusic.mp4"

    try:
        # Get video duration to trim/loop the music track
        probe = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                input_path,
            ],
            capture_output=True, text=True,
        )
        duration = float(probe.stdout.strip())

        # Mix: keep original audio at full volume, add music at `volume` level,
        # loop music if shorter than video, fade out last 2 seconds
        fade_start = max(0, duration - 2)
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", input_path,
                "-stream_loop", "-1", "-i", music_path,
                "-filter_complex",
                (
                    f"[1:a]atrim=0:{duration:.3f},asetpts=PTS-STARTPTS,"
                    f"afade=t=in:st=0:d=1,afade=t=out:st={fade_start:.3f}:d=2,"
                    f"volume={volume}[bg];"
                    f"[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[outa]"
                ),
                "-map", "0:v", "-map", "[outa]",
                "-c:v", "copy",
                "-c:a", "aac",
                "-movflags", "+faststart",
                "-shortest",
                output_path,
            ],
            capture_output=True, text=True, check=True,
        )

        return FileResponse(
            output_path,
            media_type="video/mp4",
            filename="with_music.mp4",
            background=None,
        )
    finally:
        os.unlink(input_path)
        os.unlink(music_path)


PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUTPUT_DIR = os.path.join(PROJECT_DIR, "output")
CONVERSATIONS_DIR = os.path.join(PROJECT_DIR, ".claude", "conversations")
os.makedirs(CONVERSATIONS_DIR, exist_ok=True)

WORKFLOW_PATH = os.path.join(PROJECT_DIR, ".claude", "workflow.json")


class WorkflowUpdate(BaseModel):
    nodes: list[dict]
    edges: list[dict]


@app.get("/workflow")
async def get_workflow():
    if os.path.isfile(WORKFLOW_PATH):
        with open(WORKFLOW_PATH) as f:
            return json.load(f)
    return None


@app.post("/workflow")
async def save_workflow(body: WorkflowUpdate):
    with open(WORKFLOW_PATH, "w") as f:
        json.dump({"nodes": body.nodes, "edges": body.edges}, f)
    return {"ok": True}


def _conv_path(conv_id: str) -> str:
    return os.path.join(CONVERSATIONS_DIR, f"{conv_id}.json")


def _load_conversations() -> list[dict]:
    convos = []
    if os.path.isdir(CONVERSATIONS_DIR):
        for f in os.listdir(CONVERSATIONS_DIR):
            if f.endswith(".json"):
                with open(os.path.join(CONVERSATIONS_DIR, f)) as fh:
                    convos.append(json.load(fh))
    convos.sort(key=lambda c: c.get("createdAt", 0))
    return convos


class ConversationUpdate(BaseModel):
    name: str | None = None
    sessionId: str | None = None
    messages: list[dict] | None = None


@app.get("/conversations")
async def list_conversations():
    return _load_conversations()


@app.post("/conversations")
async def create_conversation(body: ConversationUpdate | None = None):
    import random, string
    conv_id = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    conv = {
        "id": conv_id,
        "name": (body and body.name) or f"Conversation",
        "sessionId": None,
        "messages": [],
        "createdAt": int(__import__("time").time() * 1000),
    }
    with open(_conv_path(conv_id), "w") as f:
        json.dump(conv, f)
    return conv


@app.patch("/conversations/{conv_id}")
async def update_conversation(conv_id: str, body: ConversationUpdate):
    path = _conv_path(conv_id)
    if not os.path.exists(path):
        return {"error": "not found"}
    with open(path) as f:
        conv = json.load(f)
    if body.name is not None:
        conv["name"] = body.name
    if body.sessionId is not None:
        conv["sessionId"] = body.sessionId
    if body.messages is not None:
        conv["messages"] = body.messages
    with open(path, "w") as f:
        json.dump(conv, f)
    return conv


@app.delete("/conversations/{conv_id}")
async def delete_conversation(conv_id: str):
    path = _conv_path(conv_id)
    if os.path.exists(path):
        os.unlink(path)
    return {"ok": True}


@app.get("/pick-folder")
async def pick_folder():
    """Open a native folder picker dialog and return the selected path."""
    script = (
        'tell application "System Events"\n'
        '  activate\n'
        'end tell\n'
        'set chosenFolder to POSIX path of (choose folder with prompt "Select output folder")\n'
        'return chosenFolder'
    )
    proc = await asyncio.create_subprocess_exec(
        "osascript", "-e", script,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        return {"path": None}
    return {"path": stdout.decode().strip()}


class SaveVideoRequest(BaseModel):
    directory: str | None = None


@app.post("/save-video")
async def save_video(
    file: UploadFile = File(...),
    directory: str = Form(None),
):
    import time as _time
    out_dir = directory or DEFAULT_OUTPUT_DIR
    os.makedirs(out_dir, exist_ok=True)

    timestamp = _time.strftime("%Y%m%d_%H%M%S")
    filename = f"video_{timestamp}.mp4"
    dest = os.path.join(out_dir, filename)

    with open(dest, "wb") as f:
        f.write(await file.read())

    return {"path": dest, "filename": filename}


@app.get("/saved-videos")
async def list_saved_videos(directory: str = None):
    out_dir = directory or DEFAULT_OUTPUT_DIR
    if not os.path.isdir(out_dir):
        return []
    files = sorted(
        [f for f in os.listdir(out_dir) if f.endswith(".mp4")],
        reverse=True,
    )
    return [{"filename": f, "path": os.path.join(out_dir, f)} for f in files]


VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".mts", ".m4v"}

MIME_TYPES = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".mts": "video/mp2t",
    ".m4v": "video/x-m4v",
}


@app.get("/list-videos")
async def list_videos(directory: str):
    """List all video files in a directory."""
    if not os.path.isdir(directory):
        return []
    files = []
    for f in sorted(os.listdir(directory)):
        ext = os.path.splitext(f)[1].lower()
        if ext in VIDEO_EXTENSIONS:
            files.append({"filename": f, "path": os.path.join(directory, f)})
    return files



def _identify_cameras(video_paths: list[str]) -> tuple[str, str]:
    """
    Identify which video is DJI and which is Canon based on filename or metadata.
    Returns (dji_path, canon_path).
    """
    dji_path = None
    canon_path = None

    for path in video_paths:
        fname = os.path.basename(path).upper()
        if "DJI" in fname:
            dji_path = path
        elif any(tag in fname for tag in ["CANON", "MVI_", "IMG_", "EOS"]):
            canon_path = path

    # If we couldn't identify by name, try ffprobe metadata
    if not dji_path or not canon_path:
        for path in video_paths:
            if path == dji_path or path == canon_path:
                continue
            probe = subprocess.run(
                ["ffprobe", "-v", "quiet", "-print_format", "json",
                 "-show_format", path],
                capture_output=True, text=True,
            )
            meta = json.loads(probe.stdout).get("format", {}).get("tags", {})
            make = " ".join(str(v) for v in meta.values()).upper()
            if "DJI" in make and not dji_path:
                dji_path = path
            elif not canon_path:
                canon_path = path

    # Fallback: first = DJI, second = Canon
    if not dji_path and not canon_path:
        dji_path = video_paths[0]
        canon_path = video_paths[1]
    elif not dji_path:
        dji_path = [p for p in video_paths if p != canon_path][0]
    elif not canon_path:
        canon_path = [p for p in video_paths if p != dji_path][0]

    return dji_path, canon_path


class SyncMergeRequest(BaseModel):
    videos: List[str]
    directory: str | None = None


@app.post("/sync-merge")
async def sync_merge(req: SyncMergeRequest):
    """
    Sync two videos (DJI + Canon) using audalign for audio alignment,
    then output Canon video with DJI audio. Streams progress as SSE.
    """
    if len(req.videos) < 2:
        return {"error": "Need at least 2 videos"}

    dji_path, canon_path = _identify_cameras(req.videos[:2])

    def get_duration(path):
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True,
        )
        return float(probe.stdout.strip())

    async def stream():
        # Phase 1: Audio sync
        yield f"data: {json.dumps({'phase': 'sync', 'status': 'started'})}\n\n"

        rec = ad.FingerprintRecognizer()
        rec.config.set_accuracy(3)
        results = ad.recognize(dji_path, canon_path, recognizer=rec)

        match_info = results.get("match_info", {})
        offset = None
        for key, info in match_info.items():
            if info and "offset_seconds" in info and info["offset_seconds"]:
                offset = info["offset_seconds"][0]
                break

        if offset is None:
            yield f"data: {json.dumps({'phase': 'sync', 'status': 'error', 'error': 'Could not find audio alignment'})}\n\n"
            return

        yield f"data: {json.dumps({'phase': 'sync', 'status': 'done', 'offset': offset})}\n\n"

        dji_dur = get_duration(dji_path)
        canon_dur = get_duration(canon_path)

        if offset >= 0:
            dji_start = 0.0
            canon_start = offset
        else:
            dji_start = -offset
            canon_start = 0.0

        dji_remaining = dji_dur - dji_start
        canon_remaining = canon_dur - canon_start
        overlap_dur = min(dji_remaining, canon_remaining)

        if overlap_dur <= 0:
            yield f"data: {json.dumps({'phase': 'encode', 'status': 'error', 'error': 'No overlapping region'})}\n\n"
            return

        # Phase 2: FFmpeg merge
        # Try stream copy first, fall back to re-encode if it fails
        yield f"data: {json.dumps({'phase': 'encode', 'status': 'started', 'duration': overlap_dur})}\n\n"

        output_path = tempfile.mktemp(suffix="_synced.mp4")

        # Try copy first (fast)
        cmd_copy = [
            "ffmpeg", "-y",
            "-ss", f"{canon_start:.3f}", "-i", canon_path,
            "-ss", f"{dji_start:.3f}", "-i", dji_path,
            "-t", f"{overlap_dur:.3f}",
            "-map", "0:v",
            "-map", "1:a",
            "-c:v", "copy",
            "-c:a", "copy",
            "-movflags", "+faststart",
            "-shortest",
            output_path,
        ]

        result = subprocess.run(cmd_copy, capture_output=True, text=True)

        if result.returncode != 0:
            # Copy failed, re-encode
            yield f"data: {json.dumps({'phase': 'encode', 'status': 'progress', 'percent': 0, 'note': 'Re-encoding required'})}\n\n"

            progress_path = tempfile.mktemp(suffix="_progress.log")
            cmd_encode = [
                "ffmpeg", "-y",
                "-progress", progress_path,
                "-ss", f"{canon_start:.3f}", "-i", canon_path,
                "-ss", f"{dji_start:.3f}", "-i", dji_path,
                "-t", f"{overlap_dur:.3f}",
                "-map", "0:v",
                "-map", "1:a",
                "-vf", "scale=-2:1080",
                "-c:v", "libx264", "-preset", "slow", "-crf", "18",
                "-c:a", "aac", "-b:a", "320k",
                "-movflags", "+faststart",
                "-shortest",
                output_path,
            ]

            proc = await asyncio.create_subprocess_exec(
                *cmd_encode,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            last_pct = -1
            while True:
                try:
                    await asyncio.wait_for(proc.wait(), timeout=0.5)
                except asyncio.TimeoutError:
                    pass

                try:
                    with open(progress_path, "r") as f:
                        content = f.read()
                    for line in reversed(content.split("\n")):
                        if line.startswith("out_time_us="):
                            us = int(line.split("=")[1])
                            current_sec = us / 1_000_000
                            pct = min(100, int((current_sec / overlap_dur) * 100))
                            if pct != last_pct:
                                last_pct = pct
                                yield f"data: {json.dumps({'phase': 'encode', 'status': 'progress', 'percent': pct})}\n\n"
                            break
                except Exception:
                    pass

                if proc.returncode is not None:
                    break

            try:
                os.unlink(progress_path)
            except Exception:
                pass

            if proc.returncode != 0:
                stderr = await proc.stderr.read()
                yield f"data: {json.dumps({'phase': 'encode', 'status': 'error', 'error': stderr.decode()[:300]})}\n\n"
                return

        import base64
        with open(output_path, "rb") as f:
            video_bytes = f.read()
        b64 = base64.b64encode(video_bytes).decode()
        yield f"data: {json.dumps({'phase': 'encode', 'status': 'done', 'video_b64': b64})}\n\n"
        os.unlink(output_path)

    return StreamingResponse(stream(), media_type="text/event-stream")


DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY", "")


class DetectSilenceRequest(BaseModel):
    video_path: str
    min_silence_duration: float = 0.5


@app.get("/waveform")
async def waveform(path: str, samples: int = 1000):
    """Extract audio waveform peaks for visualization."""
    import numpy as np
    if not os.path.isfile(path):
        return {"error": "File not found"}

    proc = subprocess.run(
        [
            "ffmpeg", "-i", path,
            "-vn", "-ac", "1", "-ar", "8000",
            "-f", "f32le", "-acodec", "pcm_f32le", "-",
        ],
        capture_output=True,
    )
    if proc.returncode != 0:
        return {"error": "Failed to extract audio"}

    audio = np.frombuffer(proc.stdout, dtype=np.float32)
    if len(audio) == 0:
        return {"peaks": [], "duration": 0, "sample_rate": 8000}

    # Get duration
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True,
    )
    duration = float(probe.stdout.strip())

    # Downsample to requested number of peaks
    chunk_size = max(1, len(audio) // samples)
    peaks = []
    for i in range(0, len(audio), chunk_size):
        chunk = audio[i:i + chunk_size]
        peaks.append(float(np.max(np.abs(chunk))))

    # Normalize peaks to 0-1
    max_peak = max(peaks) if peaks else 1
    if max_peak > 0:
        peaks = [p / max_peak for p in peaks]

    return {"peaks": peaks, "duration": duration, "sample_rate": 8000}


@app.post("/detect-silences")
async def detect_silences(req: DetectSilenceRequest):
    """Detect silences using Deepgram speech-to-text word timestamps."""
    import httpx

    if not os.path.isfile(req.video_path):
        return {"error": "File not found"}

    # Extract audio as wav for Deepgram
    audio_path = tempfile.mktemp(suffix=".wav")
    subprocess.run(
        ["ffmpeg", "-y", "-i", req.video_path, "-vn", "-ac", "1", "-ar", "16000", audio_path],
        capture_output=True, text=True,
    )

    # Get total duration
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", req.video_path],
        capture_output=True, text=True,
    )
    total_duration = float(probe.stdout.strip())

    try:
        # Send to Deepgram
        with open(audio_path, "rb") as f:
            audio_data = f.read()

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&utterances=true&utt_split=0.8",
                headers={
                    "Authorization": f"Token {DEEPGRAM_API_KEY}",
                    "Content-Type": "audio/wav",
                },
                content=audio_data,
            )
            resp.raise_for_status()
            dg_result = resp.json()

        # Extract utterances (speech segments) from Deepgram
        utterances = dg_result.get("results", {}).get("utterances", [])

        if not utterances:
            # Fallback: try words from first alternative
            words = (
                dg_result.get("results", {})
                .get("channels", [{}])[0]
                .get("alternatives", [{}])[0]
                .get("words", [])
            )
            # Group words into segments based on gaps
            segments = []
            if words:
                seg_start = words[0]["start"]
                seg_end = words[0]["end"]
                for w in words[1:]:
                    gap = w["start"] - seg_end
                    if gap >= req.min_silence_duration:
                        segments.append({"start": round(seg_start, 3), "end": round(seg_end, 3)})
                        seg_start = w["start"]
                    seg_end = w["end"]
                segments.append({"start": round(seg_start, 3), "end": round(seg_end, 3)})
        else:
            segments = [
                {"start": round(u["start"], 3), "end": round(u["end"], 3)}
                for u in utterances
            ]

        return {
            "segments": segments,
            "total_duration": total_duration,
        }
    finally:
        if os.path.exists(audio_path):
            os.unlink(audio_path)


class RenderTimelineRequest(BaseModel):
    video_path: str
    segments: list  # list of {"start": float, "end": float}


@app.post("/render-timeline")
async def render_timeline(req: RenderTimelineRequest):
    """Render a video from a list of segments, streaming progress."""
    if not os.path.isfile(req.video_path):
        return {"error": "File not found"}

    if not req.segments:
        return {"error": "No segments provided"}

    total_dur = sum(s["end"] - s["start"] for s in req.segments)

    async def stream():
        yield f"data: {json.dumps({'status': 'started', 'duration': total_dur})}\n\n"

        output_path = tempfile.mktemp(suffix="_timeline.mp4")
        progress_path = tempfile.mktemp(suffix="_progress.log")

        # Build filter_complex to concat segments
        filter_parts = []
        for i, seg in enumerate(req.segments):
            filter_parts.append(
                f"[0:v]trim=start={seg['start']:.3f}:end={seg['end']:.3f},setpts=PTS-STARTPTS[v{i}];"
                f"[0:a]atrim=start={seg['start']:.3f}:end={seg['end']:.3f},asetpts=PTS-STARTPTS[a{i}];"
            )
        concat_inputs = "".join(f"[v{i}][a{i}]" for i in range(len(req.segments)))
        filter_parts.append(f"{concat_inputs}concat=n={len(req.segments)}:v=1:a=1[outv][outa];")
        filter_parts.append("[outv]scale=-2:1080[outvs]")
        filter_complex = "".join(filter_parts)

        cmd = [
            "ffmpeg", "-y",
            "-progress", progress_path,
            "-i", req.video_path,
            "-filter_complex", filter_complex,
            "-map", "[outvs]", "-map", "[outa]",
            "-c:v", "libx264", "-preset", "slow", "-crf", "18",
            "-c:a", "aac", "-b:a", "320k",
            "-movflags", "+faststart",
            output_path,
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        last_pct = -1
        while True:
            try:
                await asyncio.wait_for(proc.wait(), timeout=0.5)
            except asyncio.TimeoutError:
                pass

            try:
                with open(progress_path, "r") as f:
                    content = f.read()
                for line in reversed(content.split("\n")):
                    if line.startswith("out_time_us="):
                        us = int(line.split("=")[1])
                        current_sec = us / 1_000_000
                        pct = min(100, int((current_sec / total_dur) * 100))
                        if pct != last_pct:
                            last_pct = pct
                            yield f"data: {json.dumps({'status': 'progress', 'percent': pct})}\n\n"
                        break
            except Exception:
                pass

            if proc.returncode is not None:
                break

        try:
            os.unlink(progress_path)
        except Exception:
            pass

        if proc.returncode != 0:
            stderr = await proc.stderr.read()
            yield f"data: {json.dumps({'status': 'error', 'error': stderr.decode()[:300]})}\n\n"
        else:
            import base64
            with open(output_path, "rb") as f:
                video_bytes = f.read()
            b64 = base64.b64encode(video_bytes).decode()
            yield f"data: {json.dumps({'status': 'done', 'video_b64': b64})}\n\n"
            os.unlink(output_path)

    return StreamingResponse(stream(), media_type="text/event-stream")


class TranscribeTimestampsRequest(BaseModel):
    video_path: str


@app.post("/transcribe-timestamps")
async def transcribe_timestamps(req: TranscribeTimestampsRequest):
    """Get timestamped transcript using Deepgram."""
    import httpx

    if not os.path.isfile(req.video_path):
        return {"error": "File not found"}

    audio_path = tempfile.mktemp(suffix=".wav")
    subprocess.run(
        ["ffmpeg", "-y", "-i", req.video_path, "-vn", "-ac", "1", "-ar", "16000", audio_path],
        capture_output=True, text=True,
    )

    try:
        with open(audio_path, "rb") as f:
            audio_data = f.read()

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true&paragraphs=true&utterances=true&utt_split=0.4",
                headers={
                    "Authorization": f"Token {DEEPGRAM_API_KEY}",
                    "Content-Type": "audio/wav",
                },
                content=audio_data,
            )
            resp.raise_for_status()
            dg = resp.json()

        # Use words to build sentence-level segments split on punctuation
        words = (
            dg.get("results", {})
            .get("channels", [{}])[0]
            .get("alternatives", [{}])[0]
            .get("words", [])
        )

        transcript_lines = []
        if words:
            seg_words = []
            seg_start = words[0]["start"]
            for w in words:
                seg_words.append(w["punctuated_word"] if "punctuated_word" in w else w["word"])
                # Split on sentence-ending punctuation
                pw = seg_words[-1]
                if pw.endswith(('.', '!', '?', ',')) and len(seg_words) >= 3:
                    transcript_lines.append({
                        "start": round(seg_start, 2),
                        "end": round(w["end"], 2),
                        "text": " ".join(seg_words),
                    })
                    seg_words = []
                    seg_start = w["end"]
            # Remaining words
            if seg_words:
                transcript_lines.append({
                    "start": round(seg_start, 2),
                    "end": round(words[-1]["end"], 2),
                    "text": " ".join(seg_words),
                })

        full_text = dg.get("results", {}).get("channels", [{}])[0].get("alternatives", [{}])[0].get("transcript", "")

        return {
            "lines": transcript_lines,
            "full_text": full_text,
        }
    finally:
        if os.path.exists(audio_path):
            os.unlink(audio_path)


class BRollRequest(BaseModel):
    transcript_lines: list  # list of {start, end, text}
    custom_prompt: str = ""
    context: str = ""


@app.post("/suggest-broll")
async def suggest_broll(req: BRollRequest):
    """Use Claude to suggest b-roll shots for each clip."""
    claude = anthropic.Anthropic()

    if req.custom_prompt:
        prompt = req.custom_prompt
    else:
        transcript_text = "\n".join(
            f"[{line['start']:.1f}s - {line['end']:.1f}s] {line['text']}"
            for line in req.transcript_lines
        )
        prompt = f"""You are a professional video editor. Below is a timestamped transcript of a video. For each timestamped segment, suggest ONE specific b-roll shot that would visually support what's being said.

Be specific and practical — describe shots that could realistically be filmed or sourced from stock footage. Include the type of shot (close-up, wide, over-the-shoulder, screen recording, etc.).

Format your response as a list with one suggestion per segment, using this exact format:
[START - END] B-roll: <your suggestion>

Transcript:
{transcript_text}

{f"Additional context: {req.context}" if req.context else ""}"""

    message = claude.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    response_text = message.content[0].text

    # Parse suggestions
    suggestions = []
    for line in response_text.strip().split("\n"):
        line = line.strip()
        if line.startswith("[") and "B-roll:" in line:
            try:
                time_part = line.split("]")[0].strip("[")
                broll_part = line.split("B-roll:")[1].strip()
                times = time_part.replace("s", "").split(" - ")
                suggestions.append({
                    "start": float(times[0]),
                    "end": float(times[1]),
                    "suggestion": broll_part,
                })
            except (IndexError, ValueError):
                suggestions.append({"start": 0, "end": 0, "suggestion": line})
        elif line and not line.startswith("["):
            suggestions.append({"start": 0, "end": 0, "suggestion": line})

    return {
        "suggestions": suggestions,
        "raw": response_text,
    }


class SaveTextRequest(BaseModel):
    content: str
    filename: str
    directory: str = ""


@app.post("/save-text")
async def save_text(req: SaveTextRequest):
    out_dir = req.directory or DEFAULT_OUTPUT_DIR
    os.makedirs(out_dir, exist_ok=True)
    dest = os.path.join(out_dir, req.filename)
    with open(dest, "w") as f:
        f.write(req.content)
    return {"path": dest}


@app.post("/rotate-video")
async def rotate_video(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(await file.read())
        input_path = tmp.name

    output_path = input_path + "_rotated.mp4"

    try:
        # Try lossless rotation via metadata (no re-encode)
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-i", input_path,
                "-c", "copy",
                "-metadata:s:v:0", "rotate=90",
                "-movflags", "+faststart",
                output_path,
            ],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            # Fallback: re-encode with high quality
            subprocess.run(
                [
                    "ffmpeg", "-y", "-i", input_path,
                    "-vf", "transpose=1",
                    "-c:v", "libx264", "-preset", "slow", "-crf", "18",
                    "-c:a", "copy",
                    "-movflags", "+faststart",
                    output_path,
                ],
                capture_output=True, text=True, check=True,
            )
        return FileResponse(
            output_path,
            media_type="video/mp4",
            filename="rotated.mp4",
            background=None,
        )
    finally:
        os.unlink(input_path)


@app.get("/serve-video")
async def serve_video(path: str):
    if not os.path.isfile(path):
        return {"error": "not found"}
    ext = os.path.splitext(path)[1].lower()
    mime = MIME_TYPES.get(ext, "video/mp4")
    return FileResponse(path, media_type=mime)


class AutoNameRequest(BaseModel):
    message: str


@app.post("/conversations/{conv_id}/auto-name")
async def auto_name_conversation(conv_id: str, body: AutoNameRequest):
    path = _conv_path(conv_id)
    if not os.path.exists(path):
        return {"error": "not found"}

    result = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "Generate a short title (3-5 words max) for this conversation based on the user's first message. Return ONLY the title, nothing else."},
            {"role": "user", "content": body.message},
        ],
        max_tokens=20,
    )
    name = result.choices[0].message.content.strip().strip('"')

    with open(path) as f:
        conv = json.load(f)
    conv["name"] = name
    with open(path, "w") as f:
        json.dump(conv, f)
    return {"name": name}


class ChatRequest(BaseModel):
    message: str
    conversation_id: str | None = None


@app.post("/claude")
async def claude_chat(req: ChatRequest):
    cmd = [
        "claude", "-p", req.message,
        "--output-format", "stream-json", "--verbose",
        "--permission-mode", "acceptEdits",
    ]
    if req.conversation_id:
        cmd += ["-r", req.conversation_id]

    async def stream():
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=PROJECT_DIR,
        )
        async for line in proc.stdout:
            text = line.decode().strip()
            if not text:
                continue
            yield f"data: {text}\n\n"
        await proc.wait()
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")

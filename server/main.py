import asyncio
import json
import os
import subprocess
import tempfile
from fastapi import FastAPI, Form, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from openai import OpenAI
from pydantic import BaseModel

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


@app.get("/serve-video")
async def serve_video(path: str):
    if not os.path.isfile(path) or not path.endswith(".mp4"):
        return {"error": "not found"}
    return FileResponse(path, media_type="video/mp4")


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

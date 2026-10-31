import os
import shutil
import tempfile
from fastapi import FastAPI, UploadFile, File, HTTPException, status
from faster_whisper import WhisperModel

app = FastAPI(title="Video Transcription Service")

model = WhisperModel("base", device="cpu", compute_type="int8")

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".mkv", ".mp3", ".wav", ".m4a"}

@app.post("/transcribe")
async def transcribe_video(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename)[1].lower() if file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported format '{ext}'. Allowed: {sorted(list(ALLOWED_EXTENSIONS))}"
        )

    temp_video_path = os.path.join(tempfile.gettempdir(), file.filename)

    try:
        with open(temp_video_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        if os.path.getsize(temp_video_path) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File is empty"
            )

        segments, info = model.transcribe(temp_video_path, beam_size=5)
        full_transcript = " ".join([segment.text.strip() for segment in segments])

        return {
            "filename": file.filename,
            "language": info.language,
            "duration": round(info.duration, 2),
            "transcript": full_transcript
        }

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Transcription failed: {str(e)}"
        )

    finally:
        if os.path.exists(temp_video_path):
            os.remove(temp_video_path)

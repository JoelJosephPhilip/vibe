#!/usr/bin/env python3
"""
Optional fast-path for the genAI AUDIO_EXTRACTION/TRANSCRIPT_GENERATION
fallback (see LocalAudioExtractionService.ts), tried before falling back to
downloading audio via yt-dlp and transcribing it with whisper.

YouTube already generates (or hosts uploader-provided) captions for most
videos. When they exist, this fetches them directly via youtube-transcript-api
-- no audio download, no yt-dlp, no cookies/PO-token/bot-check machinery at
all. This only covers videos that already have captions; videos without any
still need the full yt-dlp+whisper path.

Same caveat as yt-dlp itself: youtube-transcript-api's own docs warn that
YouTube blocks most cloud/datacenter provider IPs for this too, recommending
a residential proxy as the reliable fix. This is a lighter-weight endpoint
than full video extraction, so it may fare better in practice, but that's
unconfirmed -- any failure here (blocked, no captions, network error) just
falls through to the existing yt-dlp path, so it's a free attempt either way.

Input (stdin): {"videoId": str}
Output (stdout): {"chunks": [{"timestamp": [start, end], "text": str}, ...]}
                  on success, {"error": str} (exit code 1) on failure.
"""
import json
import sys

from youtube_transcript_api import YouTubeTranscriptApi


def main():
    payload = json.loads(sys.stdin.read())
    video_id = payload["videoId"]

    snippets = YouTubeTranscriptApi().fetch(video_id).to_raw_data()

    chunks = [
        {
            "timestamp": [snippet["start"], snippet["start"] + snippet["duration"]],
            "text": snippet["text"].strip(),
        }
        for snippet in snippets
        if snippet.get("text", "").strip()
    ]

    if not chunks:
        print(json.dumps({"error": "No non-empty caption chunks found"}))
        sys.exit(1)

    print(json.dumps({"chunks": chunks}))


if __name__ == "__main__":
    try:
        main()
    except Exception as err:  # noqa: BLE001 -- any failure here just means "fall back to yt-dlp"
        print(json.dumps({"error": str(err)}))
        sys.exit(1)

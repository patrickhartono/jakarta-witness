# Video footage

Place the Jakarta traffic video here as:

```
public/video/jakarta.mp4
```

Requirements:

- **Filename must be exactly `jakarta.mp4`** (the app loads this path).
- Muted, loopable traffic footage. 1080p or 720p recommended.
- Keep it reasonably small — if it is over ~50 MB, compress it first,
  e.g.: `ffmpeg -i input.mov -vf scale=1280:-2 -c:v libx264 -crf 26 -an jakarta.mp4`
- It is committed to the repository and deployed with the site, so it
  must be footage you have the right to publish.

Any traffic video works for local testing of the pipeline.

# Charge Theatre

A tiny self-hosted video site for watching **your own** shows and movies from the browser in a parked (charging) Tesla – or any phone, tablet or laptop.

You drop video files in a folder, run one Docker command, and open the site in the car.

- **No database, no accounts, no setup beyond one password.** The library is just a folder.
- **Full quality whenever possible.** Files the browser can decode play untouched ("Direct"). Everything else (MKV, AC3/DTS audio, 10-bit, HEVC…) is transcoded on the fly at source resolution.
- **Quality menu in the player:** Auto, Original file, Source, 1080p, 720p, 480p, 360p. Switch mid-episode without losing your place.
- **Built for a car touchscreen:** big buttons, fullscreen, ±10 s skip, tap-to-seek bar, "Up next" countdown.
- **Continue watching + Now watching:** progress is stored on the server, so the car, phone and laptop share it. Pin the shows you're on right now.
- Subtitles (embedded text subs and `.srt/.vtt/.ass` files), audio-track switching, playback speed, thumbnails.
- Zero npm dependencies. The only third-party file is the bundled [hls.js](https://github.com/video-dev/hls.js) player.

> Not affiliated with or endorsed by Tesla. Use only with media you have the right to watch. Tesla only allows browser video while parked.

## The quick version

1. Install **Docker** on the computer that will run it, and open a terminal in this project's folder.
2. Put your videos in the **`media`** folder (it's inside this project folder).
3. Run `docker compose up -d --build`.
4. Run `docker compose logs` to see your password, then open `http://<that-computer's-ip>:8080`.

That's the **local** version – perfect to try it out. To use it in the **car** you need the **HTTPS** version (a domain name, a free certificate that sets itself up, and two router settings). Step 3 below walks through it one click at a time.

---

## Contents

1. [What you need](#1-what-you-need)
2. [Get the code and add your videos](#2-get-the-code-and-add-your-videos)
3. [Start it – online with HTTPS (default, what the car needs)](#3-start-it--online-with-https-default-what-the-car-needs)
4. [Start it – local only (no domain)](#4-start-it--local-only-no-domain)
5. [Everyday commands](#5-everyday-commands)
6. [Using it in the car](#6-using-it-in-the-car)
7. [Organising your library](#7-organising-your-library)
8. [Quality and transcoding](#8-quality-and-transcoding)
9. [Settings](#9-settings)
10. [HTTPS certificates explained](#10-https-certificates-explained)
11. [Troubleshooting](#11-troubleshooting)
12. [Moving to another computer](#12-moving-to-another-computer)

---

## 1. What you need

| | Online (HTTPS) | Local only |
|---|---|---|
| A computer that stays on (home server, NAS, mini PC, spare laptop) running **Docker** with Compose v2 | ✅ | ✅ |
| Your video files | ✅ | ✅ |
| A **domain name** you control (or a free dynamic-DNS name) | ✅ | – |
| Router access to forward **ports 80 and 443** to the computer | ✅ | – |
| An ISP that doesn't block ports 80/443 | ✅ | – |

**Why HTTPS?** The Tesla browser needs a secure (`https://`) address, and it can't join your home network or a VPN, so the site has to be reachable from the internet with a real certificate. This project includes [Caddy](https://caddyserver.com/), which gets and renews the free certificate for you automatically. **Local-only mode is plain HTTP** – good for testing from a phone or laptop on your Wi-Fi, but expect the car to want the HTTPS version.

Install Docker: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/Mac), [OrbStack](https://orbstack.dev/) (Mac), or the Docker Engine packages on Linux. Check it works: `docker compose version`.

## 2. Get the code and add your videos

### Get the project

Either click the green **Code → Download ZIP** button on GitHub and unzip it, or use git:

```bash
git clone https://github.com/iLeet/charge-theatre.git
cd charge-theatre
```

Whatever you do, you end up with a folder called `charge-theatre`. This is **"the project folder"** – every command in this guide is typed *inside* it.

> **How do I open a terminal in that folder?**
> - **Windows:** open the folder in File Explorer, click the address bar, type `cmd`, press Enter.
> - **Mac:** right-click the folder → *New Terminal at Folder* (or open Terminal and type `cd ` then drag the folder onto the window and press Enter).
> - **Linux:** right-click inside the folder → *Open in Terminal*.

### Where do my videos go?

Inside the project folder you'll see an empty folder named **`media`**. **Put your shows and movies in there.** That's it.

```
charge-theatre/            <- the project folder
  media/                   <- PUT YOUR VIDEOS HERE
    Severance/             <- one folder per show
      Season 1/
        Severance.S01E01.1080p.WEB-DL.mkv
        Severance.S01E02.mkv
    Another Show/
      Another.Show.S02E05.mp4
    Some Movie (2019).mkv  <- movies can just sit loose in media
  docker-compose.yml
  ...
```

- One folder per show; you can use `Season 1`, `Season 2` sub-folders or just dump all episodes in the show's folder.
- Movies: a single video file directly in `media`.
- File names like `Show.S01E02.mkv` or `Show - 02 - Title.mp4` work. The `S01E02` part is what puts episodes in the right order.
- You can add, rename or remove videos any time – no restart needed. Just tap the refresh button on the site.
- The app only **reads** your files. It never changes or deletes them.

### My videos are already somewhere else (external drive, another folder, a NAS)

You don't have to move them. Tell the app where they are by creating a file named `.env` (leading dot, no `.txt`) in the project folder with one line:

| Your computer | Example line in `.env` |
|---|---|
| Windows | `MEDIA_PATH=D:/Videos/TV` (use forward slashes) |
| Mac | `MEDIA_PATH=/Users/yourname/Movies/TV` |
| Linux / NAS | `MEDIA_PATH=/mnt/media/tv` |

Then start (or restart) with `docker compose up -d`. On Windows and Mac, Docker may ask for permission to access that drive or folder the first time (Docker Desktop → *Settings → Resources → File sharing*).

## 3. Start it – online with HTTPS (default, what the car needs)

### 3a. One-time setup outside the computer

1. **DNS:** create an `A` record for a subdomain, e.g. `theatre.yourdomain.com`, pointing at your home's **public IP**. (Find it by searching "what is my IP". If your home IP changes now and then, use a dynamic-DNS service/updater for this record.)
2. **Router:** forward **TCP 80 → this computer, port 80** and **TCP 443 → this computer, port 443**. (Port 80 is needed too – that is how the certificate is issued and renewed.)
3. Make sure nothing else on that computer is already using ports 80/443.
4. Double-check DNS has spread: `nslookup theatre.yourdomain.com` should show your public IP. Don't start Caddy before this works.

### 3b. Create your `.env` file

In the project folder, create a file named exactly `.env` (with the leading dot) containing **these three lines** – edit the password and domain:

```
PASSWORD=pick-something-you-can-type-on-the-car-screen
DOMAIN=theatre.yourdomain.com
COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml
```

macOS/Linux shortcut:

```bash
cat > .env <<'EOF'
PASSWORD=pick-something-you-can-type-on-the-car-screen
DOMAIN=theatre.yourdomain.com
COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml
EOF
```

On Windows create `.env` in a text editor and use a **semicolon** instead of the colon: `COMPOSE_FILE=docker-compose.yml;docker-compose.caddy.yml`. (Make sure the editor doesn't save it as `.env.txt`.)

> **Important – this is the part people get wrong.**
> The `COMPOSE_FILE` line is what tells Docker to start Caddy (the HTTPS part) *together* with the app. With it, the normal start command does everything. Don't type `-f` flags and don't start `docker-compose.caddy.yml` by itself – it is an add-on to `docker-compose.yml`, not a standalone file.

### 3c. Start

```bash
docker compose up -d --build
```

The first run builds the image (a minute or two) and Caddy requests your certificate (a few seconds).

### 3d. Check it worked

```bash
docker compose ps
```

You should see **two** containers running: `charge-theater` (healthy) and `…-caddy-1`. If you only see one, Docker isn't reading your `.env` – see [Troubleshooting](#11-troubleshooting).

```bash
docker compose logs caddy
```

Look for `certificate obtained successfully`. Then open **`https://theatre.yourdomain.com`**, sign in, and you're done. In the car, sign in once; the browser remembers you for 90 days.

> In this mode the app's own port 8080 is **not** exposed; everything goes through Caddy. If you also want plain-HTTP access on your LAN, add `ports: ["8080:8080"]` to the `charge-theater` service in `docker-compose.yml` and remove the `ports: !reset []` line from `docker-compose.caddy.yml`.

## 4. Start it – local only (no domain)

No domain, no port forwarding, no Caddy. Plain HTTP on port 8080 – for your home network, a phone, or just trying it out.

```bash
docker compose up -d --build
```

That's all – **do not create a `.env`** with `COMPOSE_FILE`/`DOMAIN` (those turn HTTPS on). A password is generated for you:

```bash
docker compose logs
```

prints the address(es) and the password (also saved in `data/password.txt`). Open `http://<computer-ip>:8080`.

Want to choose the password, or use a media folder elsewhere? Create a `.env` with just:

```
PASSWORD=your-password
MEDIA_PATH=/path/to/your/videos
```

Switching later from local to online is just step 3 – create the three-line `.env` and run `docker compose up -d --build` again.

## 5. Everyday commands

Run these in the project folder. You only need `--build` the first time or after updating the code.

| What you want | Command |
|---|---|
| Start | `docker compose up -d` |
| Stop | `docker compose down` |
| Update after pulling new code | `docker compose up -d --build` |
| See logs / the generated password | `docker compose logs` |
| Apply a changed `.env` | `docker compose up -d` |
| Check both containers are running | `docker compose ps` |

Adding or removing videos needs **no restart** – drop them in `media/` and tap the refresh button on the home page. The containers restart on their own after a reboot (as long as Docker starts at boot). **Never** use `docker compose down -v` – it deletes Caddy's certificate.

## 6. Using it in the car

1. Park, open the browser, go to your `https://` address and sign in.
2. Tap a show → tap an episode. It goes fullscreen and resumes where you left off.
3. Tap the screen to show controls. **Quality** button = change quality; **CC** = subtitles; **Audio** = track; **1×** = speed.
4. The badge top-right says whether you're playing **Direct** (original file) or **transcoding** at a given quality.
5. At the bottom of the home page, **Device check** lists exactly which codecs your car's browser can decode.

If the car can't play something directly it automatically falls back to transcoding, so a file never "just fails".

## 7. Organising your library

- Every top-level folder is a show; every video loose in `media/` is a movie.
- Recognised names: `S01E02`, `1x02`, `Show - 02 - Title`, or folders called `Season 2`. Release junk (`1080p`, `WEB-DL`, `x264`…) is stripped from titles.
- Optional cover art: put `poster.jpg` (or `folder.jpg`, `cover.jpg`) in a show's folder.
- External subtitles: `Episode.srt` or `Episode.en.srt` next to the video.
- **Continue watching** shows where you stopped, or the next episode once you finish one. **Now watching:** open a show and tap *Add to Now watching* to pin it to the top.
- Supported file types: mkv, mp4, m4v, mov, webm, avi, ts, m2ts, wmv, flv, mpg.

## 8. Quality and transcoding

| Situation | What happens |
|---|---|
| MP4/WebM with H.264/VP9 + AAC/Opus (and anything else the browser says it can decode) | **Direct** – the file is sent untouched. No quality loss, no CPU use. |
| MKV/AVI, AC3/DTS audio, 10-bit, etc. | Transcoded to H.264/AAC at **source resolution** (high quality, ≤ 30 Mbps) |
| You choose 1080p / 720p / 480p / 360p | Transcoded to that height (never upscaled) with a bitrate cap – useful on weak cell signal |

Transcoding only runs while you watch: it pauses when it's far enough ahead and stops when you leave. A modern 4-core CPU handles 1080p comfortably. On weaker machines set `ENCODER` to `h264_nvenc` (NVIDIA) or `h264_qsv` (Intel) – both need GPU passthrough into Docker. (`h264_videotoolbox` is for running on a Mac without Docker.)

Not supported yet: image-based subtitles (PGS/VobSub – skipped) and burned-in subs. HDR sources are tone-mapped to SDR when ffmpeg has the needed filters (the Docker image does).

## 9. Settings

All optional, all in `.env`. Copy `env.example` for a commented template.

| Variable | Default | Meaning |
|---|---|---|
| `PASSWORD` | generated | Login password. Changing it signs everyone out. |
| `DOMAIN` | – | Your domain (online mode) |
| `COMPOSE_FILE` | – | Turns on HTTPS (see step 3b) |
| `MEDIA_PATH` | `./media` | Folder with your videos (Docker) |
| `DATA_PATH` | `./data` | Where watch progress, thumbnails and caches live |
| `SITE_NAME` | Charge Theatre | Header title |
| `ENCODER` | `libx264` | `h264_nvenc`, `h264_qsv`, `h264_videotoolbox` |
| `X264_PRESET` | `veryfast` | Slower presets = better compression, more CPU |
| `MAX_TRANSCODES` | `2` | Simultaneous encodes |
| `SESSION_DAYS` | `90` | How long a sign-in lasts |

## 10. HTTPS certificates explained

You don't manage them – Caddy does.

- Certificates come free from Let's Encrypt, last 90 days, and Caddy renews them automatically about a month before expiry. They live in a Docker volume (`caddy_data`), so restarts and rebuilds reuse them.
- Renewal needs ports 80/443 to keep reaching the computer. If you change routers or your ISP blocks them, renewal fails – check `docker compose logs caddy`.
- Rate limits only matter if you keep misconfiguring things (e.g. 5 failed validations per hour). Hitting one costs nothing; requests resume when the window passes and your current certificate keeps working.
- **Only one computer can host the domain at a time** (your router forwards 80/443 to one machine). A second machine gets its own certificate the first time it runs, then reuses it.
- Check expiry any time:
  ```bash
  echo | openssl s_client -connect theatre.yourdomain.com:443 -servername theatre.yourdomain.com 2>/dev/null | openssl x509 -noout -enddate
  ```

## 11. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `docker compose ps` shows only **one** container; domain doesn't load | Your `.env` is missing, misnamed (`.env.txt`?), or lacks the `COMPOSE_FILE=` line. Fix it and run `docker compose up -d --build`. |
| `Set DOMAIN in .env` error | You have `COMPOSE_FILE` set but no `DOMAIN=` line. Add it (or remove `COMPOSE_FILE` for local-only). |
| Caddy log: certificate / challenge errors | DNS doesn't point at your public IP yet, ports 80/443 aren't forwarded to this computer, another program uses them, or your ISP blocks them. Fix, then `docker compose restart caddy`. Don't restart repeatedly – failed attempts are rate-limited. |
| Works at home, not from outside | Port forwarding. Test from mobile data. Some routers don't allow reaching your own public IP from inside the LAN ("NAT loopback") – test from outside. |
| Can't reach `http://<ip>:8080` while in HTTPS mode | By design – only Caddy is exposed. See the note in 3d to also publish 8080. |
| Nothing plays / "ffmpeg not found" | Only happens outside Docker – install ffmpeg, or use Docker. |
| Long wait when starting or seeking | The transcoder is starting – choose a lower quality or a hardware `ENCODER`. |
| Library looks stale | Tap the refresh button. Check the files have a supported extension. |
| Wrong titles/episodes | Rename to `Show/Season 1/Show.S01E02.mkv`. |
| Forgot the password | Look in `.env`, or `data/password.txt` if it was generated. |

## 12. Moving to another computer

Copy the project folder (or clone again) – you don't need to copy `data/` or `media/` unless you want them. On the new machine create `.env` (step 3b or 4) and run `docker compose up -d --build`.

- Keep your place: copy `data/state.json`.
- Switching which computer hosts the HTTPS site: stop the old one (`docker compose down`), point your router's 80/443 forwards at the new one, then start it. It gets its own certificate on first start.

---

## How it's built

```
server.js          HTTP server, routes, login gate
lib/library.js     folder scan, show/episode parsing
lib/probe.js       ffprobe + cache
lib/transcoder.js  on-demand HLS with ffmpeg (seek-aware, pauses when ahead)
lib/tools.js       thumbnails, subtitle conversion
lib/state.js       watch progress + pinned shows
public/            the web app (plain HTML/CSS/JS, no build step)
Dockerfile         Node + ffmpeg image
docker-compose.yml           the app
docker-compose.caddy.yml     add-on that puts Caddy (HTTPS) in front
```

## License

MIT – see [LICENSE](LICENSE). The bundled hls.js player is Apache-2.0 (`public/vendor/hls.js.LICENSE`).

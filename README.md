# 🎬 StreamFlix — Live Streaming Platform

A premium entertainment streaming platform built with Node.js, featuring live streaming support via OBS Studio (RTMP), real-time chat with Socket.IO, and a beautiful Netflix-inspired dark UI.

## ✨ Features

- 🔴 **Live Streaming** — Stream via OBS Studio using RTMP protocol
- 💬 **Real-time Chat** — Interactive live chat powered by Socket.IO
- 📺 **Web Series Catalog** — Browse trending shows and series
- 🎨 **Premium Dark UI** — Glassmorphism, neon accents, and smooth animations
- 📡 **HLS Playback** — Watch live streams via HLS in any modern browser
- 📱 **Responsive Design** — Works across all devices

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start
```

Then open `http://localhost:3000` in your browser.

## 📡 OBS Studio Setup

1. Open OBS Studio → Settings → Stream
2. Service: **Custom...**
3. Server: `rtmp://localhost:1935/live`
4. Stream Key: Any unique name (e.g., `mystream`)
5. Click **Start Streaming**

## 🌐 Deployment (Render)

This app is ready for deployment on Render:

1. Create a **Web Service** on Render
2. Connect your GitHub repository
3. Build Command: `npm install`
4. Start Command: `npm start`
5. The `PORT` environment variable is automatically set by Render

> **Note:** RTMP streaming requires port 1935 which may not be available on all hosting platforms. The web app will still function without RTMP.

## 🛠 Tech Stack

- **Backend:** Node.js, Express, Socket.IO
- **RTMP Server:** node-media-server
- **Transcoding:** FFmpeg (RTMP → HLS)
- **Frontend:** Vanilla HTML/CSS/JS with premium design system

## 📁 Project Structure

```
streamflix/
├── server.js          # Main server (Express + RTMP + Socket.IO)
├── package.json       # Dependencies & scripts
├── public/
│   ├── index.html     # Homepage
│   ├── watch.html     # Live stream viewer
│   ├── golive.html    # OBS setup guide
│   ├── css/style.css  # Premium dark theme CSS
│   └── js/app.js      # Frontend JavaScript
└── media/live/        # HLS output directory (auto-created)
```

## 📜 License

MIT

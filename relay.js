#!/usr/bin/env node
// ============================================
// StreamFlix Local Relay
// ============================================
// This script runs on YOUR PC and relays OBS Studio's
// RTMP stream to the Render server via WebSocket.
//
// How it works:
//   OBS → RTMP (localhost:1935) → FFmpeg → WebSocket → Render → HLS
//
// Usage:
//   node relay.js [RENDER_URL]
//
// Example:
//   node relay.js https://live-stream-pn2g.onrender.com
// ============================================

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ============================================
// Configuration
// ============================================
const RENDER_URL = process.argv[2] || 'https://live-stream-pn2g.onrender.com';
const LOCAL_RTMP_PORT = 1935;
const LOCAL_HTTP_PORT = 8888;

console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🔄 StreamFlix Local Relay                                ║
║                                                            ║
║   This relay connects OBS Studio to your Render server.    ║
║                                                            ║
║   Render URL: ${RENDER_URL.padEnd(43)}║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

// ============================================
// Dynamic import of socket.io-client
// ============================================
let ioClient;
try {
  ioClient = require('socket.io-client');
} catch (e) {
  console.error('❌ socket.io-client not found. Installing...');
  const { execSync } = require('child_process');
  execSync('npm install socket.io-client', { stdio: 'inherit', cwd: __dirname });
  ioClient = require('socket.io-client');
}

// ============================================
// Start Local RTMP Server
// ============================================
const NodeMediaServer = require('node-media-server');

const mediaDir = path.join(__dirname, 'media');
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

const nmsConfig = {
  logType: 2, // Warnings only
  rtmp: {
    port: LOCAL_RTMP_PORT,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60
  },
  http: {
    port: LOCAL_HTTP_PORT,
    mediaroot: mediaDir,
    allow_origin: '*'
  }
};

const nms = new NodeMediaServer(nmsConfig);
const activeRelays = new Map(); // StreamPath -> { socket, ffmpeg }

// ============================================
// FFmpeg Path Resolution (same as server.js)
// ============================================
function findFFmpegPath() {
  const isWindows = process.platform === 'win32';
  const { execSync } = require('child_process');
  try {
    const cmd = isWindows ? 'where ffmpeg' : 'which ffmpeg';
    const result = execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();
    if (result) return result.split('\n')[0].trim();
  } catch (e) {}

  if (isWindows) {
    const wingetDir = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
    if (fs.existsSync(wingetDir)) {
      const dirs = fs.readdirSync(wingetDir);
      for (const dir of dirs) {
        if (dir.toLowerCase().includes('ffmpeg')) {
          const ffmpegDir = path.join(wingetDir, dir);
          const found = findFileRecursive(ffmpegDir, 'ffmpeg.exe', 3);
          if (found) return found;
        }
      }
    }
    for (const p of ['C:\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe']) {
      if (fs.existsSync(p)) return p;
    }
  }
  return 'ffmpeg';
}

function findFileRecursive(dir, filename, maxDepth) {
  if (maxDepth <= 0) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return fullPath;
      if (entry.isDirectory()) {
        const found = findFileRecursive(fullPath, filename, maxDepth - 1);
        if (found) return found;
      }
    }
  } catch (e) {}
  return null;
}

const FFMPEG_PATH = findFFmpegPath();
console.log(`[FFmpeg] Using: ${FFMPEG_PATH}`);

// ============================================
// Handle OBS Publishing
// ============================================
nms.on('prePublish', (id, StreamPath, args) => {
  const streamKey = StreamPath.split('/').pop();

  console.log(`\n${'='.repeat(55)}`);
  console.log(`🔴 OBS STREAM DETECTED: "${streamKey}"`);
  console.log(`   Connecting to Render server...`);
  console.log(`${'='.repeat(55)}\n`);

  // Connect to the Render server via Socket.IO
  const socket = ioClient(RENDER_URL, {
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionAttempts: 10,
    timeout: 30000,
    transports: ['websocket'],
  });

  socket.on('connect', () => {
    console.log(`✅ Connected to Render server!`);
    console.log(`   Sending stream "${streamKey}" to ${RENDER_URL}...`);

    // Tell the Render server to start a browser stream
    socket.emit('browser_stream_start', { streamKey });
  });

  socket.on('browser_stream_ready', ({ streamKey: key }) => {
    console.log(`✅ Render server ready for stream "${key}"`);
    console.log(`   Starting FFmpeg relay...\n`);

    // Give the RTMP source a moment to fully initialize
    setTimeout(() => {
      startFFmpegRelay(StreamPath, streamKey, socket, id);
    }, 2000);
  });

  socket.on('connect_error', (err) => {
    console.error(`❌ Connection error: ${err.message}`);
  });

  socket.on('disconnect', (reason) => {
    console.log(`⚠️  Disconnected from Render: ${reason}`);
  });

  activeRelays.set(StreamPath, { socket, ffmpeg: null, streamKey });
});

nms.on('donePublish', (id, StreamPath, args) => {
  const relay = activeRelays.get(StreamPath);
  if (relay) {
    const streamKey = StreamPath.split('/').pop();
    console.log(`\n⏹  OBS STREAM ENDED: "${streamKey}"`);

    // Stop FFmpeg
    if (relay.ffmpeg) {
      try { relay.ffmpeg.stdin.end(); } catch (e) {}
      setTimeout(() => {
        try { relay.ffmpeg.kill('SIGTERM'); } catch (e) {}
      }, 2000);
    }

    // Tell Render to stop
    if (relay.socket && relay.socket.connected) {
      relay.socket.emit('browser_stream_stop');
      setTimeout(() => {
        relay.socket.disconnect();
      }, 3000);
    }

    activeRelays.delete(StreamPath);
    console.log(`   Relay cleaned up.\n`);
  }
});

// ============================================
// FFmpeg Relay: RTMP → WebM chunks → Socket.IO
// ============================================
function startFFmpegRelay(streamPath, streamKey, socket, sessionId) {
  const inputUrl = `rtmp://localhost:${LOCAL_RTMP_PORT}${streamPath}`;

  const ffmpegArgs = [
    '-re',                         // Read at native framerate
    '-i', inputUrl,                // Input from local RTMP
    '-c:v', 'libx264',            // Re-encode video
    '-preset', 'ultrafast',       // Fastest encoding
    '-tune', 'zerolatency',       // Minimize latency
    '-g', '30',                   // Keyframe every 30 frames
    '-sc_threshold', '0',         // Disable scene change detection
    '-b:v', '1500k',              // Video bitrate
    '-maxrate', '1500k',
    '-bufsize', '3000k',
    '-c:a', 'aac',                // Audio codec
    '-b:a', '128k',               // Audio bitrate
    '-ar', '44100',               // Sample rate
    '-f', 'matroska',             // Output as Matroska/WebM container
    '-'                            // Output to stdout
  ];

  console.log(`[FFmpeg] Starting relay: ${inputUrl} → Render`);

  const ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs, {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let bytesSent = 0;
  let chunkCount = 0;

  ffmpeg.stdout.on('data', (chunk) => {
    if (socket.connected) {
      socket.emit('browser_stream_data', chunk);
      bytesSent += chunk.length;
      chunkCount++;
      if (chunkCount % 100 === 0) {
        const mb = (bytesSent / 1024 / 1024).toFixed(1);
        console.log(`[Relay] Sent ${chunkCount} chunks (${mb} MB) for "${streamKey}"`);
      }
    }
  });

  ffmpeg.stderr.on('data', (data) => {
    const msg = data.toString();
    // Show only key FFmpeg info
    if (msg.includes('frame=') && chunkCount % 150 === 0) {
      const frameMatch = msg.match(/frame=\s*(\d+)/);
      const fpsMatch = msg.match(/fps=\s*([\d.]+)/);
      if (frameMatch) {
        console.log(`[FFmpeg] frame=${frameMatch[1]} fps=${fpsMatch ? fpsMatch[1] : '?'} | ${(bytesSent/1024/1024).toFixed(1)} MB sent`);
      }
    }
    if (msg.includes('Error') || msg.includes('error')) {
      console.error(`[FFmpeg] ${msg.trim()}`);
    }
  });

  ffmpeg.on('close', (code) => {
    console.log(`[FFmpeg] Relay process exited (code ${code})`);
  });

  ffmpeg.on('error', (err) => {
    console.error(`[FFmpeg] Error: ${err.message}`);
  });

  // Store FFmpeg reference
  const relay = activeRelays.get(streamPath);
  if (relay) relay.ffmpeg = ffmpeg;
}

// ============================================
// Start Everything
// ============================================
nms.run();

console.log(`
┌──────────────────────────────────────────────────────┐
│  ✅ Local RTMP relay is running!                     │
│                                                      │
│  OBS Studio Settings:                                │
│    Server:     rtmp://localhost:${LOCAL_RTMP_PORT}/live               │
│    Stream Key: mystream  (or any unique name)        │
│                                                      │
│  Target:  ${RENDER_URL.padEnd(42)} │
│                                                      │
│  Click "Start Streaming" in OBS to begin!            │
└──────────────────────────────────────────────────────┘
`);

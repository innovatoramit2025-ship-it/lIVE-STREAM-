const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const NodeMediaServer = require('node-media-server');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6,
});

// ============================================
// CORS & Middleware
// ============================================
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ============================================
// FFmpeg Path Resolution
// ============================================
function findFFmpegPath() {
  const isWindows = process.platform === 'win32';
  const { execSync } = require('child_process');

  // Check if ffmpeg is in PATH (cross-platform)
  try {
    const cmd = isWindows ? 'where ffmpeg' : 'which ffmpeg';
    const result = execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();
    if (result) {
      const firstPath = result.split('\n')[0].trim();
      console.log(`[FFmpeg] Found in PATH: ${firstPath}`);
      return firstPath;
    }
  } catch (e) { /* not in PATH */ }

  if (isWindows) {
    // Try common FFmpeg locations on Windows
    const candidates = [
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
    ];

    // Check winget packages directory
    const wingetDir = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
    if (fs.existsSync(wingetDir)) {
      try {
        const dirs = fs.readdirSync(wingetDir);
        for (const dir of dirs) {
          if (dir.toLowerCase().includes('ffmpeg')) {
            const ffmpegDir = path.join(wingetDir, dir);
            const found = findFileRecursive(ffmpegDir, 'ffmpeg.exe', 3);
            if (found) {
              console.log(`[FFmpeg] Found at: ${found}`);
              return found;
            }
          }
        }
      } catch (e) { /* ignore */ }
    }

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        console.log(`[FFmpeg] Found at: ${p}`);
        return p;
      }
    }
  } else {
    // Linux/macOS common paths
    const linuxPaths = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/snap/bin/ffmpeg'];
    for (const p of linuxPaths) {
      if (fs.existsSync(p)) {
        console.log(`[FFmpeg] Found at: ${p}`);
        return p;
      }
    }
  }

  console.warn('[FFmpeg] WARNING: FFmpeg not found! HLS transcoding will not work.');
  console.warn('[FFmpeg] Install with: apt-get install ffmpeg (Linux) or winget install Gyan.FFmpeg (Windows)');
  return 'ffmpeg'; // fallback to PATH
}

function findFileRecursive(dir, filename, maxDepth) {
  if (maxDepth <= 0) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        const found = findFileRecursive(fullPath, filename, maxDepth - 1);
        if (found) return found;
      }
    }
  } catch (e) { /* permission error, etc */ }
  return null;
}

const FFMPEG_PATH = findFFmpegPath();

// ============================================
// Ensure Media Directories
// ============================================
const mediaDir = path.join(__dirname, 'media');
const hlsDir = path.join(mediaDir, 'live');
[mediaDir, hlsDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ============================================
// RTMP Media Server Configuration (for OBS)
// ============================================
const RTMP_PORT = parseInt(process.env.RTMP_PORT) || 1935;
const NMS_HTTP_PORT = parseInt(process.env.NMS_HTTP_PORT) || 8888;

const nmsConfig = {
  logType: 3, // 1=error, 2=warn, 3=info, 4=debug
  rtmp: {
    port: RTMP_PORT,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60
  },
  http: {
    port: NMS_HTTP_PORT,
    mediaroot: mediaDir,
    allow_origin: '*'
  },
  trans: {
    ffmpeg: FFMPEG_PATH,
    tasks: [
      {
        app: 'live',
        hls: true,
        hlsFlags: '[hls_time=2:hls_list_size=3:hls_flags=delete_segments]',
        hlsKeep: false,
        dash: false,
      }
    ]
  }
};

let nms;
try {
  nms = new NodeMediaServer(nmsConfig);
} catch (e) {
  console.warn('[RTMP] Could not initialize NodeMediaServer:', e.message);
  nms = null;
}

// ============================================
// Track Active Streams
// ============================================
const activeStreams = new Map();

if (nms) {
  nms.on('preConnect', (id, args) => {
    console.log(`[RTMP] Client connecting: ${id} from ${args.ip}`);
  });

  nms.on('postConnect', (id, args) => {
    console.log(`[RTMP] Client connected: ${id}`);
  });

  nms.on('doneConnect', (id, args) => {
    console.log(`[RTMP] Client disconnected: ${id}`);
  });

  nms.on('prePublish', (id, StreamPath, args) => {
    const streamKey = StreamPath.split('/').pop();
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🔴 STREAM STARTED: "${streamKey}"`);
    console.log(`   Session ID: ${id}`);
    console.log(`   Stream Path: ${StreamPath}`);
    console.log(`   Time: ${new Date().toLocaleString()}`);
    console.log(`${'='.repeat(50)}\n`);

    activeStreams.set(streamKey, {
      id,
      streamKey,
      streamPath: StreamPath,
      startTime: new Date(),
      viewers: 0,
      status: 'live'
    });

    // Notify all connected clients
    io.emit('stream_started', {
      streamKey,
      startTime: new Date().toISOString()
    });
  });

  nms.on('donePublish', (id, StreamPath, args) => {
    const streamKey = StreamPath.split('/').pop();
    console.log(`\n${'='.repeat(50)}`);
    console.log(`⏹  STREAM ENDED: "${streamKey}"`);
    console.log(`   Session ID: ${id}`);
    console.log(`   Time: ${new Date().toLocaleString()}`);
    console.log(`${'='.repeat(50)}\n`);

    activeStreams.delete(streamKey);

    // Notify all connected clients
    io.emit('stream_ended', { streamKey });

    // Clean up HLS files after a delay
    setTimeout(() => {
      const streamDir = path.join(hlsDir, streamKey);
      if (fs.existsSync(streamDir)) {
        try {
          fs.rmSync(streamDir, { recursive: true, force: true });
          console.log(`[Cleanup] Removed HLS files for: ${streamKey}`);
        } catch (e) {
          console.error(`[Cleanup] Failed to remove: ${e.message}`);
        }
      }
    }, 10000); // Wait 10s before cleaning
  });

  nms.on('prePlay', (id, StreamPath, args) => {
    console.log(`[RTMP] Viewer connecting to: ${StreamPath}`);
  });
}

// ============================================
// API Routes
// ============================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    ffmpeg: FFMPEG_PATH,
    activeStreams: activeStreams.size,
    timestamp: new Date().toISOString()
  });
});

// Get all active streams
app.get('/api/streams', (req, res) => {
  const streams = [];
  activeStreams.forEach((stream, key) => {
    streams.push({
      streamKey: key,
      startTime: stream.startTime,
      viewers: stream.viewers,
      status: stream.status,
      duration: Math.floor((Date.now() - stream.startTime.getTime()) / 1000)
    });
  });
  res.json(streams);
});

// Get single stream status
app.get('/api/stream/:key', (req, res) => {
  const stream = activeStreams.get(req.params.key);
  if (stream) {
    // Also check if HLS files exist
    const hlsPath = path.join(hlsDir, req.params.key, 'index.m3u8');
    const hlsReady = fs.existsSync(hlsPath);
    res.json({
      live: true,
      hlsReady,
      streamKey: stream.streamKey,
      startTime: stream.startTime,
      viewers: stream.viewers,
      duration: Math.floor((Date.now() - stream.startTime.getTime()) / 1000)
    });
  } else {
    res.json({ live: false, hlsReady: false });
  }
});

// Check HLS file availability directly
app.get('/api/hls-check/:key', (req, res) => {
  const hlsPath = path.join(hlsDir, req.params.key, 'index.m3u8');
  const exists = fs.existsSync(hlsPath);
  res.json({ available: exists, path: `/live/${req.params.key}/index.m3u8` });
});

// Serve HLS files with proper CORS headers
app.use('/live', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');

  // Set proper content types for HLS files
  if (req.url.endsWith('.m3u8')) {
    res.header('Content-Type', 'application/vnd.apple.mpegurl');
  } else if (req.url.endsWith('.ts')) {
    res.header('Content-Type', 'video/mp2t');
  }
  next();
}, express.static(hlsDir));

// Web Series catalog
app.get('/api/series', (req, res) => {
  res.json([
    {
      id: 1, title: "Neon Horizons", genre: "Sci-Fi", rating: 4.8, episodes: 12,
      description: "In a cyberpunk metropolis, a rogue AI discovers emotions and must decide between serving humanity or pursuing freedom.",
      thumbnail: "https://picsum.photos/seed/neon/400/225"
    },
    {
      id: 2, title: "Dark Tides", genre: "Thriller", rating: 4.6, episodes: 8,
      description: "A marine biologist uncovers a conspiracy beneath the ocean's surface that threatens to reshape the world's power dynamics.",
      thumbnail: "https://picsum.photos/seed/dark/400/225"
    },
    {
      id: 3, title: "Queens Gambit II", genre: "Drama", rating: 4.9, episodes: 10,
      description: "The chess world is shaken when a street hustler from Brooklyn challenges the reigning world champion.",
      thumbnail: "https://picsum.photos/seed/chess/400/225"
    },
    {
      id: 4, title: "Phantom Code", genre: "Action", rating: 4.5, episodes: 6,
      description: "An elite hacker collective races against time to prevent a digital apocalypse orchestrated by a shadowy corporation.",
      thumbnail: "https://picsum.photos/seed/phantom/400/225"
    },
    {
      id: 5, title: "Eternal Bloom", genre: "Fantasy", rating: 4.7, episodes: 14,
      description: "In a world where flowers grant magical powers, a botanist discovers the legendary Eternal Bloom.",
      thumbnail: "https://picsum.photos/seed/bloom/400/225"
    },
    {
      id: 6, title: "The Last Signal", genre: "Sci-Fi", rating: 4.4, episodes: 8,
      description: "A deep-space communication station receives a mysterious signal from a civilization thought to be extinct.",
      thumbnail: "https://picsum.photos/seed/signal/400/225"
    },
    {
      id: 7, title: "Crimson Dynasty", genre: "Historical Drama", rating: 4.8, episodes: 16,
      description: "A sweeping saga of betrayal, love, and ambition set in a fictional ancient empire on the brink of revolution.",
      thumbnail: "https://picsum.photos/seed/crimson/400/225"
    },
    {
      id: 8, title: "Mindscape", genre: "Psychological Thriller", rating: 4.6, episodes: 10,
      description: "A neuroscientist develops technology to enter patients' dreams, but the line between reality and illusion begins to blur.",
      thumbnail: "https://picsum.photos/seed/mind/400/225"
    }
  ]);
});

// ============================================
// Socket.IO - Live Chat & Real-time Events
// ============================================
const chatMessages = new Map();
const viewerSockets = new Map(); // socketId -> streamKey

io.on('connection', (socket) => {
  console.log(`[Socket] Viewer connected: ${socket.id}`);

  // Send current active streams on connect
  const streams = [];
  activeStreams.forEach((stream, key) => {
    streams.push({ streamKey: key, startTime: stream.startTime, viewers: stream.viewers });
  });
  socket.emit('active_streams', streams);

  socket.on('join_stream', (streamKey) => {
    // Leave previous stream if any
    const prevKey = viewerSockets.get(socket.id);
    if (prevKey && prevKey !== streamKey) {
      socket.leave(prevKey);
      const prevStream = activeStreams.get(prevKey);
      if (prevStream) {
        prevStream.viewers = Math.max(0, prevStream.viewers - 1);
        io.to(prevKey).emit('viewer_count', prevStream.viewers);
      }
    }

    socket.join(streamKey);
    viewerSockets.set(socket.id, streamKey);

    const stream = activeStreams.get(streamKey);
    if (stream) {
      stream.viewers++;
      io.to(streamKey).emit('viewer_count', stream.viewers);
      console.log(`[Viewer] ${socket.id} joined "${streamKey}" (${stream.viewers} viewers)`);
    }

    // Send chat history
    const history = chatMessages.get(streamKey) || [];
    socket.emit('chat_history', history);
  });

  socket.on('leave_stream', (streamKey) => {
    socket.leave(streamKey);
    viewerSockets.delete(socket.id);
    const stream = activeStreams.get(streamKey);
    if (stream) {
      stream.viewers = Math.max(0, stream.viewers - 1);
      io.to(streamKey).emit('viewer_count', stream.viewers);
    }
  });

  socket.on('chat_message', ({ streamKey, username, message }) => {
    if (!streamKey || !username || !message) return;
    if (message.length > 500) return; // Limit message length

    const msg = {
      username: username.substring(0, 30),
      message: message.substring(0, 500),
      timestamp: new Date().toISOString()
    };

    if (!chatMessages.has(streamKey)) {
      chatMessages.set(streamKey, []);
    }
    const msgs = chatMessages.get(streamKey);
    msgs.push(msg);
    if (msgs.length > 200) msgs.shift(); // Keep last 200

    io.to(streamKey).emit('new_message', msg);
  });

  socket.on('disconnect', () => {
    const streamKey = viewerSockets.get(socket.id);
    if (streamKey) {
      const stream = activeStreams.get(streamKey);
      if (stream) {
        stream.viewers = Math.max(0, stream.viewers - 1);
        io.to(streamKey).emit('viewer_count', stream.viewers);
      }
      viewerSockets.delete(socket.id);
    }
    console.log(`[Socket] Viewer disconnected: ${socket.id}`);
  });
});

// ============================================
// Error Handling
// ============================================
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Handle uncaught exceptions gracefully
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});

// ============================================
// Start Servers
// ============================================
const HTTP_PORT = parseInt(process.env.PORT) || 3000;

server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🎬  StreamFlix - Entertainment Streaming Platform        ║
║                                                            ║
║   🌐 Website:     http://0.0.0.0:${String(HTTP_PORT).padEnd(24)}║
║   📡 RTMP:        rtmp://localhost:${RTMP_PORT}/live/<stream-key>  ║
║   📺 HLS:         http://0.0.0.0:${String(HTTP_PORT).padEnd(19)}  ║
║   🔧 FFmpeg:      ${FFMPEG_PATH.length > 35 ? '...' + FFMPEG_PATH.slice(-35) : FFMPEG_PATH.padEnd(38)}║
║                                                            ║
║   ┌─ OBS Studio Settings ───────────────────────────────┐  ║
║   │  Server:  rtmp://<YOUR-IP>:${RTMP_PORT}/live${' '.repeat(19)}│  ║
║   │  Key:     any-unique-key (e.g., mystream)            │  ║
║   └──────────────────────────────────────────────────────┘  ║
║                                                            ║
║   Status: ✅ Ready for streaming                           ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});

if (nms) {
  try {
    nms.run();
    console.log('\n[Server] RTMP server started on port', RTMP_PORT);
  } catch (e) {
    console.warn('[RTMP] Failed to start RTMP server:', e.message);
    console.warn('[RTMP] Live streaming via OBS will not be available, but the web app will still work.');
  }
}

console.log('\n[Server] StreamFlix is ready!\n');

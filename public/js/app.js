// ============================================
// StreamFlix - Main Application JavaScript
// ============================================

const socket = io();

// ============================================
// State
// ============================================
let allSeries = [];
let activeCategory = 'all';

// ============================================
// Initialize
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  loadSeries();
  loadLiveStreams();
  setupNavScroll();
  setupCategoryFilters();
  setupIntersectionObserver();

  // Refresh live streams every 5 seconds
  setInterval(loadLiveStreams, 5000);
});

// ============================================
// Load Web Series
// ============================================
async function loadSeries() {
  try {
    const res = await fetch('/api/series');
    allSeries = await res.json();
    renderSeries(allSeries);
    renderContinueWatching(allSeries);
    renderTopRated(allSeries);
  } catch (err) {
    console.error('Failed to load series:', err);
  }
}

function renderSeries(series) {
  const grid = document.getElementById('series-grid');
  if (!grid) return;

  grid.innerHTML = series.map((s, i) => `
    <div class="series-card animate-in" style="animation-delay: ${i * 0.05}s">
      <div class="series-poster">
        <img src="${s.thumbnail}" alt="${s.title}" loading="lazy">
        <div class="series-poster-overlay">
          <div class="play-btn-overlay">▶</div>
        </div>
        <div class="series-rating">⭐ ${s.rating}</div>
      </div>
      <div class="series-card-info">
        <div class="series-card-title">${s.title}</div>
        <div class="series-card-genre">${s.genre} • ${s.episodes} episodes</div>
      </div>
    </div>
  `).join('');
}

function renderContinueWatching(series) {
  const row = document.getElementById('continue-row');
  if (!row) return;

  // Simulate "continue watching" with random progress
  const shuffled = [...series].sort(() => Math.random() - 0.5).slice(0, 5);
  row.innerHTML = shuffled.map((s, i) => `
    <div class="series-card" style="min-width: 200px;">
      <div class="series-poster">
        <img src="${s.thumbnail}" alt="${s.title}" loading="lazy">
        <div class="series-poster-overlay">
          <div class="play-btn-overlay">▶</div>
        </div>
        <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: var(--bg-tertiary);">
          <div style="height: 100%; width: ${30 + Math.random() * 60}%; background: var(--accent-gradient); border-radius: 2px;"></div>
        </div>
      </div>
      <div class="series-card-info">
        <div class="series-card-title">${s.title}</div>
        <div class="series-card-genre">Episode ${Math.ceil(Math.random() * s.episodes)}</div>
      </div>
    </div>
  `).join('');
}

function renderTopRated(series) {
  const row = document.getElementById('top-rated-row');
  if (!row) return;

  const sorted = [...series].sort((a, b) => b.rating - a.rating);
  row.innerHTML = sorted.map((s, i) => `
    <div class="series-card" style="min-width: 200px;">
      <div class="series-poster">
        <img src="${s.thumbnail}" alt="${s.title}" loading="lazy">
        <div class="series-poster-overlay">
          <div class="play-btn-overlay">▶</div>
        </div>
        <div class="series-rating">⭐ ${s.rating}</div>
        <div style="position: absolute; top: 8px; left: 8px; background: var(--accent-gradient); padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; color: white;">
          #${i + 1}
        </div>
      </div>
      <div class="series-card-info">
        <div class="series-card-title">${s.title}</div>
        <div class="series-card-genre">${s.genre}</div>
      </div>
    </div>
  `).join('');
}

// ============================================
// Load Live Streams
// ============================================
async function loadLiveStreams() {
  try {
    const res = await fetch('/api/streams');
    const streams = await res.json();
    renderLiveStreams(streams);
    updateStats(streams);
  } catch (err) {
    console.error('Failed to load streams:', err);
  }
}

function renderLiveStreams(streams) {
  const grid = document.getElementById('live-streams-grid');
  if (!grid) return;

  if (streams.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-icon">📡</div>
        <h3>No live streams right now</h3>
        <p>Be the first to go live! Set up OBS Studio and start streaming.</p>
        <a href="golive.html" class="btn btn-primary" style="margin-top: var(--space-lg); display: inline-flex;">
          🎥 Go Live Now
        </a>
      </div>
    `;
    return;
  }

  grid.innerHTML = streams.map((s, i) => `
    <a href="watch.html?key=${s.streamKey}" class="stream-card animate-in" style="animation-delay: ${i * 0.1}s">
      <div class="stream-thumbnail">
        <img src="https://picsum.photos/seed/${s.streamKey}/640/360" alt="Stream ${s.streamKey}" loading="lazy">
        <div class="stream-live-badge">
          <span class="dot"></span>
          LIVE
        </div>
        <div class="stream-viewers">
          👁 ${s.viewers} viewers
        </div>
      </div>
      <div class="stream-info">
        <div class="stream-title">${s.streamKey}'s Stream</div>
        <div class="stream-meta">
          <span class="streamer">📡 ${s.streamKey}</span>
          <span>🕐 ${getStreamDuration(s.startTime)}</span>
        </div>
      </div>
    </a>
  `).join('');
}

function updateStats(streams) {
  const statStreams = document.getElementById('stat-streams');
  const statViewers = document.getElementById('stat-viewers');
  if (statStreams) statStreams.textContent = streams.length;
  if (statViewers) {
    const totalViewers = streams.reduce((sum, s) => sum + s.viewers, 0);
    statViewers.textContent = totalViewers;
  }
}

function getStreamDuration(startTime) {
  const diff = Date.now() - new Date(startTime).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

// ============================================
// Category Filtering
// ============================================
function setupCategoryFilters() {
  const pills = document.querySelectorAll('.category-pill');
  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeCategory = pill.dataset.category;
      filterSeries();
    });
  });
}

function filterSeries() {
  if (activeCategory === 'all') {
    renderSeries(allSeries);
  } else {
    const filtered = allSeries.filter(s => s.genre === activeCategory);
    renderSeries(filtered);
  }
}

// ============================================
// Navigation Scroll Effect
// ============================================
function setupNavScroll() {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;

  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 50);
  });
}

// ============================================
// Intersection Observer (Animate on scroll)
// ============================================
function setupIntersectionObserver() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  // Observe sections
  document.querySelectorAll('.section').forEach(section => {
    section.style.opacity = '0';
    section.style.transform = 'translateY(20px)';
    section.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(section);
  });

  document.querySelectorAll('.stat-card').forEach(card => {
    observer.observe(card);
  });
}

// ============================================
// Socket Events
// ============================================
socket.on('stream_started', () => {
  loadLiveStreams();
});

socket.on('stream_ended', () => {
  loadLiveStreams();
});

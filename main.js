/* ============================================
   SHOOTKNG - Complete Game Engine
   ============================================ */

// ===== Global Game State =====
let currentDifficulty = '';
let score = 0;
let lives = 3;
let gameRunning = false;
let isPaused = false;
let animationFrameId = null;
let autoShootInterval = null;
let enemySpawnInterval = null;
let powerupSpawnInterval = null;    // Timer for power-up spawning
let difficultyLevel = 0;           // Increases every 10 points
let bulletSoundCounter = 0;        // Counter for bullet sound frequency

// ===== Power-up State =====
let isSpeedUpActive = false;
let isLaserActive = false;
let isSlowActive = false;
let isShieldActive = false;

// Expiration timestamps
let speedUpEndTime = 0;
let laserEndTime = 0;
let slowEndTime = 0;
let shieldEndTime = 0;

// Timeout handles to prevent overlapping/leaking effects
let speedUpTimeout = null;
let laserTimeout = null;
let slowTimeout = null;
let shieldTimeout = null;

// DOM for Power-up HUD (fetched at runtime to ensure it exists)
let powerupHud = null;

// ===== Configurable Colors =====
const BULLET_COLOR = '#00e5ff';
const BULLET_GLOW_COLOR = 'rgba(0, 229, 255, 0.4)';
const PLAYER_BODY_COLOR = '#c0c8e0';
const PLAYER_ACCENT_COLOR = '#00e5ff';
const PLAYER_COCKPIT_COLOR = '#0a0e1a';
const ENGINE_FLAME_COLOR = '#ff6b2b';

// ============================================
//  AUDIO MANAGER (Sound Pool System)
// ============================================
class SoundManager {
  constructor() {
    this.bgmVolume = 0.3;
    this.sfxVolume = 0.6;
    
    // Store original Audio objects
    this.sounds = {
      menuBGM: new Audio('assets/sounds/menu_bgm.mp3'),
      gameplayBGM: new Audio('assets/sounds/gameplay_bgm.mp3'),
      hover: new Audio('assets/sounds/hover.mp3'),
      click: new Audio('assets/sounds/click.mp3'),
      close: new Audio('assets/sounds/close.mp3'),
      shoot: new Audio('assets/sounds/shoot.mp3'),
      hitEnemy: new Audio('assets/sounds/hit_enemy.mp3'),
      playerHit: new Audio('assets/sounds/player_hit.mp3'),
      powerUp: new Audio('assets/sounds/powerup.mp3'),
      pause: new Audio('assets/sounds/pause.mp3'),
      gameOver: new Audio('assets/sounds/gameover.mp3'),
      laser: new Audio('assets/sounds/laser.mp3')
    };

    // Configure BGM
    this.sounds.menuBGM.loop = true;
    this.sounds.gameplayBGM.loop = true;
    this.sounds.menuBGM.volume = 0.6;      // Increased menu BGM
    this.sounds.gameplayBGM.volume = 0.8;  // Increased gameplay BGM

    // Apply SFX volume
    for (let key in this.sounds) {
      if (key !== 'menuBGM' && key !== 'gameplayBGM') {
        this.sounds[key].volume = this.sfxVolume;
      }
    }
    
    // Custom fine-tuning for specific SFX
    this.sounds.hover.volume = 0.3; // Increased hover volume

    // Audio Pool for overlapping sounds (e.g. shoot)
    this.pools = {
      shoot: []
    };
    // Pre-fill pool with 10 clones
    for (let i = 0; i < 10; i++) {
      let clone = this.sounds.shoot.cloneNode();
      clone.volume = 0.05; // Decreased shoot volume even further
      this.pools.shoot.push(clone);
    }
    this.poolIndices = { shoot: 0 };
    
    this.isMuted = false;
  }

  playBGM(name) {
    if (this.isMuted) return;
    const bgm = this.sounds[name];
    if (bgm) {
      bgm.currentTime = 0;
      bgm.play().catch(e => console.warn('BGM auto-play blocked:', e));
    }
  }

  pauseBGM(name) {
    if (this.sounds[name]) {
      this.sounds[name].pause();
    }
  }

  playSFX(name) {
    if (this.isMuted) return;
    
    // Use pool if it exists (for rapid overlapping sounds)
    if (this.pools[name]) {
      const pool = this.pools[name];
      const idx = this.poolIndices[name];
      const sound = pool[idx];
      sound.currentTime = 0;
      sound.play().catch(e => console.warn('SFX play blocked:', e));
      this.poolIndices[name] = (idx + 1) % pool.length;
    } 
    // Otherwise play normal sound
    else if (this.sounds[name]) {
      const sound = this.sounds[name];
      sound.currentTime = 0;
      sound.play().catch(e => console.warn('SFX play blocked:', e));
    }
  }

  stopSFX(name) {
    if (this.sounds[name]) {
      this.sounds[name].pause();
      this.sounds[name].currentTime = 0;
    }
  }
}

const audioManager = new SoundManager();

// Auto-play Policy Handler
let hasInteracted = false;
function initAudioOnInteraction() {
  if (hasInteracted) return;
  hasInteracted = true;
  // Start menu BGM only if we are not already in game
  if (!gameRunning) {
    audioManager.playBGM('menuBGM');
  }
  document.removeEventListener('click', initAudioOnInteraction);
  document.removeEventListener('keydown', initAudioOnInteraction);
}
document.addEventListener('click', initAudioOnInteraction);
document.addEventListener('keydown', initAudioOnInteraction);

// ===== Base Config per Difficulty (intentionally SLOW at start) =====
const BASE_SHOOT_RATE = { easy: 500, medium: 400, hard: 280 };
const BASE_BULLET_SPEED = { easy: 5, medium: 6, hard: 8 };
const BASE_ENEMY_SPEED = { easy: 0.8, medium: 1.2, hard: 2.0 };
const BASE_SPAWN_RATE = { easy: 2000, medium: 1500, hard: 1000 };

// Dynamic difficulty multiplier constants
const ENEMY_SCALE_FACTOR = 0.10;    // 10% harder per level
const PLAYER_SCALE_FACTOR = 0.06;   // 6% stronger per level (6/10 ratio)

// Wave spawn thresholds per difficulty
// Medium & Hard: +1 meteor at each milestone
const WAVE_THRESHOLDS = {
  easy: [
    { score: 0, count: 1 }, { score: 50, count: 2 },
    { score: 100, count: 3 }, { score: 200, count: 4 },
  ],
  medium: [
    { score: 0, count: 1 }, { score: 5, count: 2 },
    { score: 10, count: 3 }, { score: 20, count: 4 },
    { score: 50, count: 5 }, { score: 100, count: 6 },
    { score: 200, count: 7 }, { score: 300, count: 8 },
    { score: 400, count: 9 }, { score: 500, count: 10 },
    { score: 1000, count: 12 },
  ],
  hard: [
    { score: 0, count: 1 }, { score: 5, count: 2 },
    { score: 10, count: 3 }, { score: 20, count: 4 },
    { score: 50, count: 5 }, { score: 100, count: 6 },
    { score: 200, count: 7 }, { score: 300, count: 8 },
    { score: 400, count: 9 }, { score: 500, count: 10 },
    { score: 1000, count: 12 },
  ],
};

// ===== DOM References =====
const menuContainer = document.getElementById('menu-container');
const difficultyScreen = document.getElementById('difficulty-screen');
const gameCanvas = document.getElementById('gameCanvas');
const btnPlay = document.getElementById('btn-play');
const btnTutorial = document.getElementById('btn-tutorial');
const btnHighscore = document.getElementById('btn-highscore');
const btnBack = document.getElementById('btn-back');
const btnEasy = document.getElementById('btn-easy');
const btnMedium = document.getElementById('btn-medium');
const btnHard = document.getElementById('btn-hard');
const modalTutorial = document.getElementById('modal-tutorial');
const modalHighscore = document.getElementById('modal-highscore');
const closeTutorial = document.getElementById('close-tutorial');
const closeHighscore = document.getElementById('close-highscore');
const gameHud = document.getElementById('game-hud');
const scoreDisplay = document.getElementById('score-display');
const livesContainer = document.getElementById('lives-container');
const btnPause = document.getElementById('btn-pause');
const pauseOverlay = document.getElementById('pause-overlay');
const btnResume = document.getElementById('btn-resume');
const btnQuit = document.getElementById('btn-quit');
const gameoverOverlay = document.getElementById('gameover-overlay');
const finalScoreEl = document.getElementById('final-score');
const btnPlayAgain = document.getElementById('btn-play-again');
const btnQuitGameover = document.getElementById('btn-quit-gameover');
const ctx = gameCanvas.getContext('2d');

// ===== Game Object Arrays =====
let bullets = [];
let enemies = [];
let powerups = [];
let explosions = [];  // Explosion particle effects
let stars = [];
let player = null;
let mouseX = 0;
let mouseY = 0;

// ============================================
//  HELPER FUNCTIONS (UI)
// ============================================
function showScreen(s) { s.classList.add('active'); }
function hideScreen(s) { s.classList.remove('active'); }
function openModal(m) { m.classList.add('active'); }
function closeModal(m) { m.classList.remove('active'); }

function resizeCanvas() {
  gameCanvas.width = window.innerWidth;
  gameCanvas.height = window.innerHeight;
  if (gameRunning) generateStars();
}

function updateScoreDisplay() { scoreDisplay.textContent = score; }

function updateLivesDisplay() {
  const icons = livesContainer.querySelectorAll('.life-icon');
  icons.forEach((icon, i) => {
    icon.classList.toggle('lost', i >= lives);
  });
}

/** Returns current enemy speed factoring in dynamic difficulty (Base speed only) */
function getEnemySpeed() {
  const base = BASE_ENEMY_SPEED[currentDifficulty] || 1.2;
  return base * (1 + difficultyLevel * ENEMY_SCALE_FACTOR);
}

/** Returns current spawn interval (ms) factoring in dynamic difficulty and Slow Down */
function getSpawnRate() {
  const base = BASE_SPAWN_RATE[currentDifficulty] || 1500;
  let rate = base / (1 + difficultyLevel * ENEMY_SCALE_FACTOR);
  
  // If Slow Down is active, enemies spawn slower
  if (isSlowActive) rate *= 2;
  
  return Math.max(250, rate);
}

/** Returns current shoot interval (ms) factoring in dynamic difficulty and Speed Up */
function getShootRate() {
  const base = BASE_SHOOT_RATE[currentDifficulty] || 400;
  let rate = base / (1 + difficultyLevel * PLAYER_SCALE_FACTOR);
  
  // Speed Up power-up: 2x faster firing rate (Adjusted from 4x)
  if (isSpeedUpActive) rate *= 0.5;
  
  return Math.max(50, rate);
}

/** How many meteors to spawn per wave based on current score and difficulty */
function getWaveCount() {
  const thresholds = WAVE_THRESHOLDS[currentDifficulty] || WAVE_THRESHOLDS.easy;
  let count = 1;
  for (const w of thresholds) {
    if (score >= w.score) count = w.count;
  }
  return count;
}

/**
 * Called every 10 points to escalate difficulty.
 * Restarts spawn and shoot intervals with new rates.
 */
function escalateDifficulty() {
  difficultyLevel = Math.floor(score / 10);

  if (enemySpawnInterval) clearInterval(enemySpawnInterval);
  enemySpawnInterval = setInterval(spawnEnemy, getSpawnRate());

  if (autoShootInterval) clearInterval(autoShootInterval);
  autoShootInterval = setInterval(spawnBullet, getShootRate());
}

// ============================================
//  STARFIELD
// ============================================
function generateStars() {
  stars = [];
  const count = Math.floor((gameCanvas.width * gameCanvas.height) / 3000);
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * gameCanvas.width,
      y: Math.random() * gameCanvas.height,
      radius: Math.random() * 1.5 + 0.3,
      brightness: Math.random() * 0.6 + 0.4,
      speed: Math.random() * 0.4 + 0.1
    });
  }
}

function drawStarfield() {
  for (const s of stars) {
    if (!isPaused) {
      s.y += s.speed;
      if (s.y > gameCanvas.height) { s.y = 0; s.x = Math.random() * gameCanvas.width; }
    }
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(200, 220, 255, ${s.brightness})`;
    ctx.fill();
  }
}

// ============================================
//  PLAYER CLASS
// ============================================
class Player {
  constructor(cw, ch) {
    this.width = 40; this.height = 50;
    this.x = cw / 2; this.y = ch - this.height - 20;
    this.targetX = this.x; this.targetY = this.y;
    this.smoothing = 0.12;
    this.barrelLength = 14; this.barrelWidth = 4;
    // Hitbox radius for circle collision
    this.hitRadius = 16;
  }

  update() {
    this.x += (this.targetX - this.x) * this.smoothing;
    this.y += (this.targetY - this.y) * this.smoothing;
    const halfW = this.width / 2;
    if (this.x < halfW) this.x = halfW;
    if (this.x > gameCanvas.width - halfW) this.x = gameCanvas.width - halfW;
    const minY = gameCanvas.height * (2 / 3);
    const maxY = gameCanvas.height - this.height * 0.6;
    if (this.y < minY) this.y = minY;
    if (this.y > maxY) this.y = maxY;
  }

  getBarrelTip() {
    return { x: this.x, y: this.y - this.barrelLength };
  }

  /** Returns center point for collision */
  getCenter() {
    return { x: this.x, y: this.y + this.height * 0.15 };
  }

  draw() {
    const x = this.x, y = this.y, hw = this.width / 2, h = this.height;
    ctx.save();

    // Barrel
    ctx.fillStyle = '#8090a8';
    ctx.shadowColor = PLAYER_ACCENT_COLOR; ctx.shadowBlur = 4;
    ctx.fillRect(x - this.barrelWidth / 2, y - h * 0.3 - this.barrelLength, this.barrelWidth, this.barrelLength + 2);
    ctx.beginPath(); ctx.arc(x, y - h * 0.3 - this.barrelLength, 3, 0, Math.PI * 2);
    ctx.fillStyle = BULLET_COLOR; ctx.shadowBlur = 10; ctx.fill(); ctx.shadowBlur = 0;

    // Hull
    ctx.beginPath();
    ctx.moveTo(x, y - h * 0.3); ctx.lineTo(x + hw, y + h * 0.55);
    ctx.lineTo(x + hw * 0.15, y + h * 0.5); ctx.lineTo(x - hw * 0.15, y + h * 0.5);
    ctx.lineTo(x - hw, y + h * 0.55); ctx.closePath();
    const hg = ctx.createLinearGradient(x, y - h * 0.3, x, y + h * 0.55);
    hg.addColorStop(0, '#d0d8e8'); hg.addColorStop(0.5, PLAYER_BODY_COLOR); hg.addColorStop(1, '#6070a0');
    ctx.fillStyle = hg; ctx.fill();
    ctx.strokeStyle = 'rgba(0,229,255,0.3)'; ctx.lineWidth = 1; ctx.stroke();

    // Wings
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + dir * hw * 0.6, y + h * 0.25);
      ctx.lineTo(x + dir * hw * 1.35, y + h * 0.6);
      ctx.lineTo(x + dir * hw * 0.5, y + h * 0.5);
      ctx.closePath(); ctx.fillStyle = '#8090b0'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,229,255,0.2)'; ctx.stroke();
    }

    // Cockpit
    ctx.beginPath(); ctx.ellipse(x, y + h * 0.05, 5, 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = PLAYER_COCKPIT_COLOR; ctx.fill();
    ctx.strokeStyle = PLAYER_ACCENT_COLOR; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x - 1.5, y + h * 0.02, 2, 4, -0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,229,255,0.25)'; ctx.fill();

    // Engines
    const fh = 10 + Math.random() * 6;
    this._drawFlame(x - hw * 0.35, y + h * 0.5, fh);
    this._drawFlame(x + hw * 0.35, y + h * 0.5, fh);
    ctx.restore();
  }

  _drawFlame(fx, fy, fh) {
    const fw = 5;
    ctx.beginPath(); ctx.moveTo(fx - fw, fy); ctx.lineTo(fx, fy + fh); ctx.lineTo(fx + fw, fy); ctx.closePath();
    const fg = ctx.createLinearGradient(fx, fy, fx, fy + fh);
    fg.addColorStop(0, ENGINE_FLAME_COLOR); fg.addColorStop(0.6, '#ff3300'); fg.addColorStop(1, 'rgba(255,100,0,0)');
    ctx.fillStyle = fg; ctx.shadowColor = ENGINE_FLAME_COLOR; ctx.shadowBlur = 12; ctx.fill(); ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.moveTo(fx - fw * 0.4, fy); ctx.lineTo(fx, fy + fh * 0.6); ctx.lineTo(fx + fw * 0.4, fy);
    ctx.closePath(); ctx.fillStyle = '#ffe0a0'; ctx.fill();
  }
}

// ============================================
//  BULLET CLASS
// ============================================
class Bullet {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.width = 3; this.height = 22;
    this.speed = (BASE_BULLET_SPEED[currentDifficulty] || 10) * (1 + difficultyLevel * PLAYER_SCALE_FACTOR);
    this.active = true;
  }

  update() {
    this.y -= this.speed;
    if (this.y + this.height < 0) this.active = false;
  }

  draw() {
    ctx.save();
    ctx.shadowColor = BULLET_GLOW_COLOR; ctx.shadowBlur = 15;
    ctx.fillStyle = BULLET_GLOW_COLOR;
    ctx.fillRect(this.x - this.width * 1.5, this.y, this.width * 3, this.height);
    ctx.shadowBlur = 8; ctx.shadowColor = BULLET_COLOR;
    const bg = ctx.createLinearGradient(this.x, this.y, this.x, this.y + this.height);
    bg.addColorStop(0, '#ffffff'); bg.addColorStop(0.3, BULLET_COLOR); bg.addColorStop(1, 'rgba(0,229,255,0.3)');
    ctx.fillStyle = bg;
    ctx.fillRect(this.x - this.width / 2, this.y, this.width, this.height);
    ctx.beginPath(); ctx.arc(this.x, this.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.shadowBlur = 12; ctx.fill();
    ctx.restore();
  }
}

// ============================================
//  ENEMY (METEORITE) CLASS
// ============================================
class Enemy {
  constructor(canvasWidth) {
    this.radius = 15 + Math.random() * 25;  // 15-40px
    this.x = this.radius + Math.random() * (canvasWidth - this.radius * 2);
    this.y = -this.radius;
    this.baseSpeed = getEnemySpeed() + Math.random() * 0.8;
    this.speed = this.baseSpeed;
    this.rotation = Math.random() * Math.PI * 2;
    this.rotSpeed = (Math.random() - 0.5) * 0.03;
    this.active = true;

    // HP based on size: small(<=20)=1, medium(<=30)=2, large(>30)=3
    if (this.radius <= 20) this.hp = 1;
    else if (this.radius <= 30) this.hp = 2;
    else this.hp = 3;
    this.maxHp = this.hp;

    // Polygon vertices (6-9 sides)
    this.vertices = [];
    const sides = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2;
      const dist = this.radius * (0.7 + Math.random() * 0.35);
      this.vertices.push({ angle, dist });
    }

    const g = 80 + Math.floor(Math.random() * 60);
    this.baseGrey = g;
    this.color = `rgb(${g + 20}, ${g}, ${g - 10})`;
    this.darkColor = `rgb(${g - 10}, ${g - 20}, ${g - 30})`;

    // Flash timer for hit effect
    this.flashTimer = 0;
  }

  /** Take 1 damage. Returns true if destroyed. */
  takeDamage() {
    this.hp--;
    this.flashTimer = 6; // Flash white for 6 frames
    if (this.hp <= 0) { this.active = false; return true; }
    return false;
  }

  update() {
    this.speed = isSlowActive ? this.baseSpeed * 0.4 : this.baseSpeed;
    this.y += this.speed;
    this.rotation += this.rotSpeed;
    if (this.flashTimer > 0) this.flashTimer--;
    if (this.y - this.radius > gameCanvas.height) this.active = false;
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);

    // Polygon path
    ctx.beginPath();
    for (let i = 0; i < this.vertices.length; i++) {
      const v = this.vertices[i];
      const px = Math.cos(v.angle) * v.dist;
      const py = Math.sin(v.angle) * v.dist;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();

    // Flash white on hit, otherwise gradient
    if (this.flashTimer > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.shadowColor = '#fff'; ctx.shadowBlur = 15;
    } else {
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, this.radius);
      grad.addColorStop(0, this.color); grad.addColorStop(1, this.darkColor);
      ctx.fillStyle = grad;
    }
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1; ctx.stroke();

    // Craters
    ctx.beginPath();
    ctx.arc(this.radius * 0.2, -this.radius * 0.15, this.radius * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fill();
    ctx.beginPath();
    ctx.arc(-this.radius * 0.25, this.radius * 0.3, this.radius * 0.12, 0, Math.PI * 2);
    ctx.fill();

    // HP bar (only for multi-hp enemies)
    if (this.maxHp > 1) {
      ctx.rotate(-this.rotation); // Un-rotate for horizontal bar
      const bw = this.radius * 1.2, bh = 3;
      const bx = -bw / 2, by = -this.radius - 8;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = this.hp / this.maxHp > 0.5 ? '#4ade80' : '#ff6b2b';
      ctx.fillRect(bx, by, bw * (this.hp / this.maxHp), bh);
    }

    ctx.restore();
  }
}

// ============================================
//  EXPLOSION PARTICLE EFFECT
// ============================================
class Explosion {
  constructor(x, y, radius, color) {
    this.particles = [];
    const count = 8 + Math.floor(radius * 0.6);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 3;
      const size = 2 + Math.random() * 3;
      this.particles.push({
        x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        size, alpha: 1, color, decay: 0.02 + Math.random() * 0.03
      });
    }
    this.active = true;
  }

  update() {
    let alive = false;
    for (const p of this.particles) {
      p.x += p.vx; p.y += p.vy;
      p.alpha -= p.decay; p.size *= 0.97;
      if (p.alpha > 0) alive = true;
    }
    if (!alive) this.active = false;
  }

  draw() {
    ctx.save();
    for (const p of this.particles) {
      if (p.alpha <= 0) continue;
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

// ============================================
//  POWER-UP CLASS
// ============================================
class PowerUp {
  constructor(canvasWidth) {
    this.radius = 20;
    this.x = this.radius + Math.random() * (canvasWidth - this.radius * 2);
    this.y = -this.radius;
    this.baseSpeed = BASE_ENEMY_SPEED[currentDifficulty] || 1.5;
    this.speed = this.baseSpeed;
    this.hp = 3;
    this.active = true;

    // Pick random type
    const types = ['speed', 'laser', 'slow', 'life', 'shield'];
    this.type = types[Math.floor(Math.random() * types.length)];
    
    // Visual config
    switch(this.type) {
      case 'speed': this.color = '#fbbf24'; this.label = 'S'; break; // Yellow
      case 'laser': this.color = '#ef4444'; this.label = 'L'; break; // Red
      case 'slow':  this.color = '#3b82f6'; this.label = 'D'; break; // Blue
      case 'life':  this.color = '#10b981'; this.label = '+'; break; // Green
      case 'shield':this.color = '#7dd3fc'; this.label = 'O'; break; // Pastel Blue
    }
  }

  update() {
    this.speed = isSlowActive ? this.baseSpeed * 0.4 : this.baseSpeed;
    this.y += this.speed;
    if (this.y - this.radius > gameCanvas.height) this.active = false;
  }

  draw() {
    ctx.save();
    
    // Outer glow
    ctx.shadowBlur = 15;
    ctx.shadowColor = this.color;
    
    // Sphere
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 14, 30, 0.8)';
    ctx.fill();
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 3;
    ctx.stroke();
    
    // Icon Label
    ctx.shadowBlur = 0;
    ctx.fillStyle = this.color;
    ctx.font = `900 ${this.radius}px var(--font-display)`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.label, this.x, this.y + 1);
    
    // HP Pips (small dots to show 3 lives)
    for(let i=0; i<3; i++) {
      ctx.beginPath();
      ctx.arc(this.x - 10 + i*10, this.y + this.radius + 8, 3, 0, Math.PI * 2);
      ctx.fillStyle = (i < this.hp) ? this.color : '#333';
      ctx.fill();
    }

    ctx.restore();
  }

  activate() {
    this.active = false;
    if (this.type !== 'laser') {
      audioManager.playSFX('powerUp');
    }
    explosions.push(new Explosion(this.x, this.y, 25, this.color));
    
    if (this.type === 'speed') activateSpeedUp();
    else if (this.type === 'laser') activateLaser();
    else if (this.type === 'slow') activateSlowDown();
    else if (this.type === 'life') activateExtraLife();
    else if (this.type === 'shield') activateShield();
  }
}

/** 5s of rapid fire (Adjusted duration and speed) */
function activateSpeedUp() {
  isSpeedUpActive = true;
  speedUpEndTime = Date.now() + 5000;
  if (speedUpTimeout) clearTimeout(speedUpTimeout);
  console.log("POWER-UP: SPEED UP!");
  
  // Refresh auto-shoot with new speed
  escalateDifficulty(); 
  
  speedUpTimeout = setTimeout(() => {
    isSpeedUpActive = false;
    speedUpEndTime = 0;
    escalateDifficulty(); // Reset rate
    console.log("SPEED UP expired.");
  }, 5000);
}

/** 3s of mass destruction (Adjusted duration) */
function activateLaser() {
  isLaserActive = true;
  laserEndTime = Date.now() + 3000;
  if (laserTimeout) { clearTimeout(laserTimeout); audioManager.stopSFX('laser'); }
  console.log("POWER-UP: LASER!");
  
  audioManager.playSFX('laser');
  
  laserTimeout = setTimeout(() => {
    isLaserActive = false;
    laserEndTime = 0;
    audioManager.stopSFX('laser');
    console.log("LASER expired.");
  }, 3000);
}

/** 5s of slowed time */
function activateSlowDown() {
  isSlowActive = true;
  slowEndTime = Date.now() + 5000;
  if (slowTimeout) clearTimeout(slowTimeout);
  console.log("POWER-UP: SLOW DOWN!");
  
  escalateDifficulty(); // Apply slower spawn rate immediately
  
  slowTimeout = setTimeout(() => {
    isSlowActive = false;
    slowEndTime = 0;
    escalateDifficulty(); // Revert back to normal spawn rate
    console.log("SLOW DOWN expired.");
  }, 5000);
}

/** Adds 1 life (max 3) */
function activateExtraLife() {
  console.log("POWER-UP: EXTRA LIFE!");
  if (lives < 3) {
    lives++;
    updateLivesDisplay();
  }
}

/** 3s of invulnerability */
function activateShield() {
  isShieldActive = true;
  shieldEndTime = Date.now() + 3000;
  if (shieldTimeout) clearTimeout(shieldTimeout);
  console.log("POWER-UP: SHIELD!");
  
  shieldTimeout = setTimeout(() => {
    isShieldActive = false;
    shieldEndTime = 0;
    console.log("SHIELD expired.");
  }, 3000);
}

/**
 * Updates the Power-up HUD with countdown timers.
 */
function updatePowerUpHUD() {
  if (!powerupHud) powerupHud = document.getElementById('powerup-hud');
  if (!powerupHud) return;
  
  const now = Date.now();
  
  updateOrRemoveBadge('speed', 'Speed Up', isSpeedUpActive, speedUpEndTime, now);
  updateOrRemoveBadge('laser', 'Laser Beam', isLaserActive, laserEndTime, now);
  updateOrRemoveBadge('slow', 'Slow Motion', isSlowActive, slowEndTime, now);
  updateOrRemoveBadge('shield', 'Shield', isShieldActive, shieldEndTime, now);
}

function updateOrRemoveBadge(type, label, isActive, endTime, now) {
  let badge = document.getElementById(`pu-badge-${type}`);
  
  if (isActive && endTime > now) {
    const remaining = ((endTime - now) / 1000).toFixed(1);
    if (!badge) {
      // Create new badge
      badge = document.createElement('div');
      badge.id = `pu-badge-${type}`;
      badge.className = `pu-badge ${type}`;
      badge.innerHTML = `<span>${label}</span> <span class="pu-timer" id="pu-timer-${type}">${remaining}s</span>`;
      powerupHud.appendChild(badge);
    } else {
      // Update existing timer text
      document.getElementById(`pu-timer-${type}`).textContent = `${remaining}s`;
    }
  } else if (badge) {
    // Remove badge if expired
    badge.remove();
  }
}

function drawLaser() {
  if (!isLaserActive || !player) return;
  const tip = player.getBarrelTip();
  
  ctx.save();
  // Outer Beam (Wide & Transparent)
  ctx.shadowBlur = 25;
  ctx.shadowColor = '#ef4444';
  ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
  ctx.fillRect(tip.x - 15, 0, 30, tip.y);
  
  // Core Beam (Narrow & Bright)
  ctx.fillStyle = '#fff';
  ctx.fillRect(tip.x - 4, 0, 8, tip.y);
  
  // Spark at tip
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 10 + Math.random()*5, 0, Math.PI*2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  
  ctx.restore();
}

function drawShield() {
  if (!isShieldActive || !player) return;
  const pc = player.getCenter();
  const remaining = shieldEndTime - Date.now();
  if (remaining <= 0) return;
  
  let alpha = 0.8;
  // Blinking effect in the last 1000ms
  if (remaining <= 1000) {
    alpha = (Math.floor(remaining / 100) % 2 === 0) ? 0.8 : 0.1;
  }
  
  const r = player.hitRadius + 25;
  ctx.save();
  ctx.beginPath();
  ctx.arc(pc.x, pc.y, r, 0, Math.PI * 2);
  
  // 3D bubble effect using radial gradient
  const grad = ctx.createRadialGradient(pc.x - r * 0.3, pc.y - r * 0.3, r * 0.1, pc.x, pc.y, r);
  grad.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.9})`); // Specular highlight
  grad.addColorStop(0.3, `rgba(125, 211, 252, ${alpha * 0.2})`); // Transparent middle
  grad.addColorStop(0.8, `rgba(125, 211, 252, ${alpha * 0.5})`); // Inner edge
  grad.addColorStop(1, `rgba(125, 211, 252, ${alpha * 0.8})`); // Outer solid edge
  
  ctx.fillStyle = grad;
  ctx.fill();
  
  ctx.strokeStyle = `rgba(125, 211, 252, ${alpha})`;
  ctx.lineWidth = 2;
  ctx.shadowBlur = 20;
  ctx.shadowColor = '#7dd3fc';
  ctx.stroke();
  ctx.restore();
}

// ============================================
//  COLLISION DETECTION
// ============================================
function checkCollisions() {
  const pc = player.getCenter();

  // --- LASER COLLISION (Enemy & PowerUp) ---
  if (isLaserActive && player) {
    const laserX = player.getBarrelTip().x;
    
    // 1. Laser vs Enemies
    for (let e of enemies) {
      if (e.active && Math.abs(e.x - laserX) < e.radius + 15) {
        e.active = false;
        audioManager.playSFX('hitEnemy');
        explosions.push(new Explosion(e.x, e.y, e.radius, '#ff6b2b'));
        score += e.maxHp;
        updateScoreDisplay();
        if (score % 10 === 0) escalateDifficulty();
      }
    }
    
    // 2. Laser vs PowerUps
    for (let pu of powerups) {
      if (pu.active && Math.abs(pu.x - laserX) < pu.radius + 15) {
        pu.hp = 0;
        pu.activate(); // Instantly destroy and activate
      }
    }
  }

  // --- Enemy Collisions ---
  for (let ei = enemies.length - 1; ei >= 0; ei--) {
    const e = enemies[ei];
    if (!e.active) continue;

    // --- 1. Bullet vs Enemy ---
    for (let bi = bullets.length - 1; bi >= 0; bi--) {
      const b = bullets[bi];
      if (!b.active) continue;

      const dx = b.x - e.x;
      const dy = (b.y + b.height / 2) - e.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < e.radius + 4) {
        b.active = false;
        audioManager.playSFX('hitEnemy');
        explosions.push(new Explosion(b.x, b.y, 8, '#ffcc44'));

        const destroyed = e.takeDamage();
        if (destroyed) {
          explosions.push(new Explosion(e.x, e.y, e.radius, '#ff6b2b'));
          score += e.maxHp;
          updateScoreDisplay();
          if (score % 10 === 0) escalateDifficulty();
        }
        break;
      }
    }

    if (!e.active) continue;

    // --- 2. Enemy vs Player ---
    const dx = pc.x - e.x;
    const dy = pc.y - e.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < e.radius + player.hitRadius) {
      if (isShieldActive) {
        // Shield destroys enemy, protects player
        audioManager.playSFX('hitEnemy');
        explosions.push(new Explosion(e.x, e.y, e.radius, '#a855f7'));
        e.active = false;
        score += e.maxHp;
        updateScoreDisplay();
        if (score % 10 === 0) escalateDifficulty();
      } else {
        audioManager.playSFX('playerHit');
        explosions.push(new Explosion(e.x, e.y, e.radius, '#ff2d55'));
        e.active = false;
        lives--;
        updateLivesDisplay();
        if (lives <= 0) { triggerGameOver(); return; }
      }
    }
  }

  // --- PowerUp Collisions (Bullet only) ---
  for (let pu of powerups) {
    if (!pu.active) continue;
    
    for (let b of bullets) {
      if (!b.active) continue;
      const dx = b.x - pu.x;
      const dy = b.y - pu.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < pu.radius + 5) {
        b.active = false;
        pu.hp--;
        explosions.push(new Explosion(b.x, b.y, 10, pu.color));
        if (pu.hp <= 0) pu.activate();
      }
    }
  }
}

// ============================================
//  GAME OVER & LOCAL STORAGE
// ============================================

function triggerGameOver() {
  gameRunning = false;
  
  audioManager.pauseBGM('gameplayBGM');
  audioManager.playSFX('gameOver');

  // Stop intervals
  if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
  if (autoShootInterval) { clearInterval(autoShootInterval); autoShootInterval = null; }
  if (enemySpawnInterval) { clearInterval(enemySpawnInterval); enemySpawnInterval = null; }
  if (powerupSpawnInterval) { clearInterval(powerupSpawnInterval); powerupSpawnInterval = null; }

  // Clear power-up timers
  if (speedUpTimeout) clearTimeout(speedUpTimeout);
  if (laserTimeout) { clearTimeout(laserTimeout); audioManager.stopSFX('laser'); }
  if (slowTimeout) clearTimeout(slowTimeout);
  if (shieldTimeout) clearTimeout(shieldTimeout);
  isSpeedUpActive = isLaserActive = isSlowActive = isShieldActive = false;
  speedUpEndTime = laserEndTime = slowEndTime = shieldEndTime = 0;

  // Save score to local storage (Top 5 system)
  saveHighScore(score);

  // Show Game Over popup
  finalScoreEl.textContent = score;
  gameoverOverlay.classList.add('active');
  gameCanvas.style.cursor = 'default';

  console.log(`Game Over! Final Score: ${score}`);
}

/**
 * Saves current score to Top 5 list in localStorage.
 * @param {number} currentScore 
 */
function saveHighScore(currentScore) {
  const STORAGE_KEY = 'spaceShooterHighScores';
  let highScores = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  
  highScores.push(currentScore);
  highScores.sort((a, b) => b - a); // Descending
  highScores = highScores.slice(0, 5); // Keep Top 5
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(highScores));
}

/**
 * Renders the High Scores list into the modal UI.
 */
function renderHighScores() {
  const highscoreList = document.getElementById('highscore-list');
  if (!highscoreList) return;

  const STORAGE_KEY = 'spaceShooterHighScores';
  highscoreList.innerHTML = '';
  
  const highScores = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  
  if (highScores.length === 0) {
    highscoreList.innerHTML = '<li class="no-data">No records yet</li>';
    return;
  }
  
  highScores.forEach((s, index) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>Top ${index + 1}:</span> <strong>${s}</strong> pts`;
    highscoreList.appendChild(li);
  });
}

/** Returns to the difficulty selection screen to start a new game. */
function playAgain() {
  quitGame();
  menuContainer.style.display = 'none';
  showScreen(difficultyScreen);
}

/** Quits from Game Over screen back to Main Menu. */
function quitFromGameover() {
  gameoverOverlay.classList.remove('active');
  quitGame();
}

// ============================================
//  SPAWNERS
// ============================================

function spawnBullet() {
  if (!player || !gameRunning || isPaused || isLaserActive) return;
  const tip = player.getBarrelTip();
  bullets.push(new Bullet(tip.x, tip.y));
  
  // Frequency of sound: normally 1 in 2 shots, with SpeedUp 1 in 4 shots
  bulletSoundCounter++;
  const threshold = isSpeedUpActive ? 4 : 2;
  if (bulletSoundCounter >= threshold) {
    audioManager.playSFX('shoot');
    bulletSoundCounter = 0;
  }
}

function spawnEnemy() {
  if (!gameRunning || isPaused) return;
  const count = getWaveCount();
  for (let i = 0; i < count; i++) {
    enemies.push(new Enemy(gameCanvas.width));
  }
}

function spawnPowerUp() {
  if (!gameRunning || isPaused) return;
  // Only spawn on Medium and Hard
  if (currentDifficulty === 'medium' || currentDifficulty === 'hard') {
    powerups.push(new PowerUp(gameCanvas.width));
  }
}

// ============================================
//  GAME INITIALIZATION
// ============================================

function initGame() {
  resizeCanvas();
  score = 0; lives = 3;
  bullets = []; enemies = []; powerups = []; explosions = [];
  isPaused = false;
  difficultyLevel = 0;
  isSpeedUpActive = isLaserActive = isSlowActive = isShieldActive = false;
  speedUpEndTime = laserEndTime = slowEndTime = shieldEndTime = 0;
  if (powerupHud) powerupHud.innerHTML = '';
  gameRunning = true;
  
  audioManager.pauseBGM('menuBGM');
  audioManager.playBGM('gameplayBGM');

  updateScoreDisplay();
  updateLivesDisplay();
  showScreen(gameHud);
  generateStars();

  player = new Player(gameCanvas.width, gameCanvas.height);
  mouseX = gameCanvas.width / 2;
  mouseY = gameCanvas.height - player.height - 20;

  gameCanvas.addEventListener('mousemove', onMouseMove);

  // Start auto-shoot
  autoShootInterval = setInterval(spawnBullet, getShootRate());

  // Start enemy spawning
  enemySpawnInterval = setInterval(spawnEnemy, getSpawnRate());
  
  // Start Power-up spawning (every 5s)
  powerupSpawnInterval = setInterval(spawnPowerUp, 5000);

  console.log('Game Started — difficulty: ' + currentDifficulty);
  gameLoop();
}

function onMouseMove(e) {
  const rect = gameCanvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;
}

// ============================================
//  GAME LOOP
// ============================================

function gameLoop() {
  if (!gameRunning) return;

  // 1. Clear
  ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
  ctx.fillStyle = '#020408';
  ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

  // 2. Starfield
  drawStarfield();

  // ===== PAUSE GATE =====
  if (!isPaused) {
    // 3. Update player
    player.targetX = mouseX;
    player.targetY = mouseY;
    player.update();

    // 4. Update bullets
    for (const b of bullets) b.update();

    // 5. Update enemies
    for (const e of enemies) e.update();

    // 6. Update powerups
    for (const pu of powerups) pu.update();

    // 7. Update explosions
    for (const ex of explosions) ex.update();

    // 8. Collision detection
    checkCollisions();
    if (!gameRunning) return;

    // 9. Cleanup
    bullets = bullets.filter(b => b.active);
    enemies = enemies.filter(e => e.active);
    powerups = powerups.filter(pu => pu.active);
    explosions = explosions.filter(ex => ex.active);

    // 10. Update HUD (Timers)
    updatePowerUpHUD();
  }
  // ===== END PAUSE GATE =====

  // 11. Draw everything
  player.draw();
  drawShield(); // Draw shield if active
  drawLaser(); // Draw laser beam if active
  for (const b of bullets) b.draw();
  for (const e of enemies) e.draw();
  for (const pu of powerups) pu.draw();
  for (const ex of explosions) ex.draw();

  // 12. Next frame
  animationFrameId = requestAnimationFrame(gameLoop);
}

// ============================================
//  SCREEN TRANSITIONS
// ============================================

btnPlay.addEventListener('click', () => {
  menuContainer.style.display = 'none';
  showScreen(difficultyScreen);
});

btnBack.addEventListener('click', () => {
  hideScreen(difficultyScreen);
  menuContainer.style.display = 'flex';
});

function selectDifficulty(difficulty) {
  currentDifficulty = difficulty;
  hideScreen(difficultyScreen);
  showScreen(gameCanvas);
  initGame();
}

btnEasy.addEventListener('click', () => selectDifficulty('easy'));
btnMedium.addEventListener('click', () => selectDifficulty('medium'));
btnHard.addEventListener('click', () => selectDifficulty('hard'));

// ===== Modals =====
btnTutorial.addEventListener('click', () => openModal(modalTutorial));
btnHighscore.addEventListener('click', () => {
  renderHighScores();
  openModal(modalHighscore);
});
closeTutorial.addEventListener('click', () => closeModal(modalTutorial));
closeHighscore.addEventListener('click', () => closeModal(modalHighscore));
modalTutorial.addEventListener('click', (e) => { if (e.target === modalTutorial) closeModal(modalTutorial); });
modalHighscore.addEventListener('click', (e) => { if (e.target === modalHighscore) closeModal(modalHighscore); });

// ============================================
//  PAUSE / RESUME / QUIT
// ============================================

function pauseGame() {
  if (!gameRunning || isPaused) return;
  isPaused = true;
  pauseOverlay.classList.add('active');
  gameCanvas.style.cursor = 'default';
  audioManager.playSFX('pause');
}

function resumeGame() {
  if (!isPaused) return;
  isPaused = false;
  pauseOverlay.classList.remove('active');
  gameCanvas.style.cursor = 'none';
  audioManager.playSFX('click');
}

function quitGame() {
  gameRunning = false; isPaused = false;
  if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
  if (autoShootInterval) { clearInterval(autoShootInterval); autoShootInterval = null; }
  if (enemySpawnInterval) { clearInterval(enemySpawnInterval); enemySpawnInterval = null; }
  if (powerupSpawnInterval) { clearInterval(powerupSpawnInterval); powerupSpawnInterval = null; }
  
  if (speedUpTimeout) clearTimeout(speedUpTimeout);
  if (laserTimeout) { clearTimeout(laserTimeout); audioManager.stopSFX('laser'); }
  if (slowTimeout) clearTimeout(slowTimeout);
  if (shieldTimeout) clearTimeout(shieldTimeout);
  isSpeedUpActive = isLaserActive = isSlowActive = isShieldActive = false;
  speedUpEndTime = laserEndTime = slowEndTime = shieldEndTime = 0;
  if (powerupHud) powerupHud.innerHTML = '';

  gameCanvas.removeEventListener('mousemove', onMouseMove);

  score = 0; lives = 3; bullets = []; enemies = []; powerups = []; explosions = []; stars = [];
  player = null; currentDifficulty = ''; difficultyLevel = 0;

  pauseOverlay.classList.remove('active');
  gameoverOverlay.classList.remove('active');
  hideScreen(gameCanvas); hideScreen(gameHud);
  gameCanvas.style.cursor = 'default';
  menuContainer.style.display = 'flex';
  
  audioManager.pauseBGM('gameplayBGM');
  audioManager.playBGM('menuBGM');
}

btnPause.addEventListener('click', () => pauseGame());
btnResume.addEventListener('click', () => resumeGame());
btnQuit.addEventListener('click', () => quitGame());
btnPlayAgain.addEventListener('click', () => playAgain());
btnQuitGameover.addEventListener('click', () => quitFromGameover());

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && gameRunning) {
    isPaused ? resumeGame() : pauseGame();
  }
});

window.addEventListener('resize', resizeCanvas);

// ============================================
//  UI AUDIO SETUP
// ============================================
const uiButtons = document.querySelectorAll('.menu-btn, .diff-card, .pause-btn, .pause-action-btn, .modal-close');
uiButtons.forEach(btn => {
  btn.addEventListener('mouseenter', () => audioManager.playSFX('hover'));
  btn.addEventListener('click', () => {
    if (btn.classList.contains('modal-close')) {
      audioManager.playSFX('close');
    } else {
      audioManager.playSFX('click');
    }
  });
});

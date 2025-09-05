(() => {
  "use strict";

  // DOM references
  const gameEl = document.getElementById("game");
  const playerEl = document.getElementById("player");
  const platformsContainer = document.getElementById("platforms");
  const powerupsContainer = document.getElementById("powerups");
  const scoreEl = document.getElementById("score");
  const overlayEl = document.getElementById("overlay");
  const finalScoreEl = document.getElementById("final-score");
  const restartBtn = document.getElementById("restart");
  const restartBtn2 = document.getElementById("restart2");

  if (!gameEl || !playerEl || !platformsContainer || !powerupsContainer) {
    // Page not loaded or structure changed; nothing to run.
    return;
  }

  // Game constants
  const WIDTH = Math.round(gameEl.clientWidth);
  const HEIGHT = Math.round(gameEl.clientHeight);

  const GRAVITY = 0.36;
  const JUMP_VELOCITY = -11.8;
  const MAX_HSPEED = 3.4;
  const ACCEL = 0.28;
  const FRICTION = 0.90;

  const PLATFORM_MIN = 60;
  const PLATFORM_MAX = 110;
  const PLATFORM_H = 14;
  // Control vertical spacing between platforms.
  // Keep within player's jump capability to avoid impossible jumps.
  const MIN_GAP_Y = 70;
  const MAX_GAP_Y = 140;
  // Prevent \"same row\" overlaps (platforms at nearly identical y).
  const ROW_SEP = 22;

  // Power-up constants
  const POWERUP_SIZE = 28;
  const POWERUP_SPAWN_CHANCE = 0.2; // chance per platform to have a power-up
  const POWERUP_JUMP_VELOCITY = -21.5; // big upward boost

  // State
  const keys = { left: false, right: false, paused: false };
  let rafId = 0;
  let running = false;
  let camera = 0; // how much the world has scrolled down (in px)
  let score = 0;

  const player = {
    x: WIDTH * 0.5 - 23,
    y: HEIGHT * 0.65,
    w: 46,
    h: 56,
    vx: 0,
    vy: -6,
    prevY: 0
  };

  /** @type {Array<{x:number,y:number,w:number,h:number, vx:number, moving:boolean, el:HTMLElement, rot:number}>} */
  let platforms = [];
  /** @type {Array<{x:number,y:number,w:number,h:number, el:HTMLElement, type:string, rot:number, remove?:boolean}>} */
  let powerups = [];

  // Utilities
  const rnd = (min, max) => Math.random() * (max - min) + min;
  const rndi = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // True if no platform sits within ROW_SEP of the candidate y (ignoring one, e.g., when recycling).
  function rowFree(y, ignore = null) {
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      if (p === ignore) continue;
      if (Math.abs(p.y - y) < ROW_SEP) return false;
    }
    return true;
  }

  // Pick a y above the current topmost platform, constrained by [MIN_GAP_Y, MAX_GAP_Y],
  // and ensuring it doesn't land on an existing row.
  function findYAboveTop(ignore = null) {
    let minY = Infinity;
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      if (p === ignore) continue;
      if (p.y < minY) minY = p.y;
    }
    if (minY === Infinity) minY = HEIGHT;

    // Random attempts
    for (let t = 0; t < 24; t++) {
      const y = minY - rndi(MIN_GAP_Y, MAX_GAP_Y);
      if (rowFree(y, ignore)) return y;
    }

    // Fallback linear search in window
    for (let y = minY - MIN_GAP_Y; y >= minY - MAX_GAP_Y; y--) {
      if (rowFree(y, ignore)) return y;
    }

    return minY - MAX_GAP_Y;
  }

  function createPlatform(y) {
    const w = rndi(PLATFORM_MIN, PLATFORM_MAX);
    const x = rndi(6, WIDTH - w - 6);
    const moving = Math.random() < 0.23;
    const vx = moving ? (Math.random() < 0.5 ? -1 : 1) * rnd(0.6, 1.3) : 0;
    const rot = rnd(-3, 3);
    const srot = rnd(-1.6, 1.6);

    const el = document.createElement("div");
    el.className = "platform" + (moving ? " moving" : "");
    el.style.width = w + "px";
    el.style.setProperty("--x", x + "px");
    el.style.setProperty("--y", y + "px");
    el.style.setProperty("--rot", rot.toFixed(2) + "deg");
    el.style.setProperty("--sketch-rot", srot.toFixed(2) + "deg");

    platformsContainer.appendChild(el);

    return { x, y, w, h: PLATFORM_H, vx, moving, el, rot };
  }

  function resetPlatforms() {
    platformsContainer.innerHTML = "";
    platforms = [];

    // Base platform near bottom
    const base = createPlatform(HEIGHT - 30);
    platforms.push(base);
    maybeSpawnPowerupForPlatform(base);

    // Fill upwards with constrained gaps and unique rows (respect MAX_GAP_Y from the current top)
    while (true) {
      const nextY = findYAboveTop();
      if (nextY <= -HEIGHT) break;
      const p = createPlatform(nextY);
      platforms.push(p);
      maybeSpawnPowerupForPlatform(p);
    }
  }

  function updateScoreUI() {
    if (scoreEl) scoreEl.textContent = String(score);
  }

  function showOverlay() {
    if (overlayEl) overlayEl.classList.remove("hidden");
    if (restartBtn) restartBtn.classList.remove("hidden");
  }

  function hideOverlay() {
    if (overlayEl) overlayEl.classList.add("hidden");
    if (restartBtn) restartBtn.classList.add("hidden");
  }

  function gameOver() {
    running = false;
    cancelAnimationFrame(rafId);
    if (finalScoreEl) finalScoreEl.textContent = String(score);
    showOverlay();
  }

  function resetGame() {
    // Reset state
    camera = 0;
    score = 0;
    updateScoreUI();
    player.x = WIDTH * 0.5 - player.w / 2;
    player.y = HEIGHT * 0.65;
    player.vx = 0;
    player.vy = -6;

    hideOverlay();
    resetPowerups();
    resetPlatforms();
    // Ensure player is visually reset
    renderPlayer();
    platforms.forEach(renderPlatform);
    powerups.forEach(renderPowerup);

    running = true;
    rafId = requestAnimationFrame(loop);
  }

  function renderPlatform(p) {
    const el = p.el;
    el.style.setProperty("--x", p.x + "px");
    el.style.setProperty("--y", p.y + "px");
    el.style.setProperty("--rot", p.rot.toFixed(2) + "deg");
  }

  // --- Power-ups ---
  function renderPowerup(u) {
    const el = u.el;
    el.style.setProperty("--x", u.x + "px");
    el.style.setProperty("--y", u.y + "px");
    el.style.setProperty("--rot", u.rot.toFixed(2) + "deg");
  }

  function createPowerup(x, y, type = "donut") {
    const el = document.createElement("div");
    el.className = "powerup " + type;
    el.style.setProperty("--x", x + "px");
    el.style.setProperty("--y", y + "px");
    el.style.setProperty("--rot", (rnd(-8, 8)).toFixed(2) + "deg");
    powerupsContainer.appendChild(el);

    return { x, y, w: POWERUP_SIZE, h: POWERUP_SIZE, el, type, rot: rnd(-6, 6), remove: false };
  }

  function resetPowerups() {
    powerupsContainer.innerHTML = "";
    powerups = [];
  }

  function maybeSpawnPowerupForPlatform(p) {
    if (Math.random() < POWERUP_SPAWN_CHANCE) {
      const x = clamp(rndi(p.x + 4, p.x + p.w - POWERUP_SIZE - 4), 4, WIDTH - POWERUP_SIZE - 4);
      const y = p.y - POWERUP_SIZE - 10;
      const u = createPowerup(x, y, "donut");
      powerups.push(u);
    }
  }

  function renderPlayer() {
    const angle = clamp(player.vx * 4, -10, 10); // tilt based on movement
    playerEl.style.transform = `translate(${player.x}px, ${player.y}px) rotate(${angle}deg)`;
  }

  function platformBounceEffect(p) {
    p.el.classList.add("boop");
    // Reset the scale shortly after
    setTimeout(() => {
      p.el.classList.remove("boop");
    }, 120);
  }

  function loop() {
    if (!running || keys.paused) {
      rafId = requestAnimationFrame(loop);
      return;
    }

    // Horizontal movement
    if (keys.left && !keys.right) {
      player.vx = clamp(player.vx - ACCEL, -MAX_HSPEED, MAX_HSPEED);
    } else if (keys.right && !keys.left) {
      player.vx = clamp(player.vx + ACCEL, -MAX_HSPEED, MAX_HSPEED);
    } else {
      player.vx *= FRICTION;
      if (Math.abs(player.vx) < 0.02) player.vx = 0;
    }

    player.x += player.vx;

    // Wrap around
    if (player.x + player.w < 0) player.x = WIDTH;
    if (player.x > WIDTH) player.x = -player.w;

    // Vertical movement
    player.prevY = player.y;
    player.vy += GRAVITY;
    player.y += player.vy;

    // Check collisions (top surfaces only)
    const prevBottom = player.prevY + player.h;
    const bottom = player.y + player.h;

    if (player.vy > 0) {
      for (let i = 0; i < platforms.length; i++) {
        const p = platforms[i];
        const pTop = p.y;
        const pLeft = p.x;
        const pRight = p.x + p.w;

        const wasAbove = prevBottom <= pTop;
        const nowOnOrBelowTop = bottom >= pTop;
        const horizontallyOverlaps = player.x + player.w > pLeft && player.x < pRight;

        if (wasAbove && nowOnOrBelowTop && horizontallyOverlaps) {
          // Land on platform
          player.y = pTop - player.h;
          player.vy = JUMP_VELOCITY;
          platformBounceEffect(p);
          break;
        }
      }
    }

    // Power-up collisions (simple AABB)
    for (let i = 0; i < powerups.length; i++) {
      const u = powerups[i];
      if (u.remove) continue;
      const overlaps =
        player.x < u.x + u.w &&
        player.x + player.w > u.x &&
        player.y < u.y + u.h &&
        player.y + player.h > u.y;
      if (overlaps) {
        u.remove = true;
        if (u.el && u.el.parentNode) u.el.parentNode.removeChild(u.el);
        // Big upward boost
        player.vy = POWERUP_JUMP_VELOCITY;
      }
    }

    // Camera/scroll: keep the player near the upper third when moving up
    const threshold = HEIGHT * 0.35;
    if (player.y < threshold) {
      const dy = threshold - player.y;
      player.y = threshold;

      for (let i = 0; i < platforms.length; i++) {
        platforms[i].y += dy;
      }
      for (let i = 0; i < powerups.length; i++) {
        powerups[i].y += dy;
      }
      camera += dy;

      // Score increases with distance climbed
      const newScore = Math.max(score, Math.floor(camera / 10));
      if (newScore !== score) {
        score = newScore;
        updateScoreUI();
      }
    }

    // Move platforms that are "moving"
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      if (p.moving) {
        p.x += p.vx;
        if (p.x <= 0 || p.x + p.w >= WIDTH) {
          p.vx *= -1;
        }
      }

      // Recycle platforms that moved below the screen
      if (p.y > HEIGHT + 24) {
        // place above the current top platform with a safe, reachable gap
        p.y = findYAboveTop(p);
        p.w = rndi(PLATFORM_MIN, PLATFORM_MAX);
        p.x = rndi(6, WIDTH - p.w - 6);
        p.moving = Math.random() < 0.23;
        p.vx = p.moving ? (Math.random() < 0.5 ? -1 : 1) * rnd(0.6, 1.3) : 0;
        p.rot = rnd(-3, 3);
        p.el.className = "platform" + (p.moving ? " moving" : "");
        p.el.style.width = p.w + "px";
        p.el.style.setProperty("--sketch-rot", (rnd(-1.6, 1.6).toFixed(2) + "deg"));
        maybeSpawnPowerupForPlatform(p);
      }

      renderPlatform(p);
    }

    // Update power-ups: recycle/remove and render
    for (let i = 0; i < powerups.length; i++) {
      const u = powerups[i];
      if (u.y > HEIGHT + 24) {
        u.remove = true;
        if (u.el && u.el.parentNode) u.el.parentNode.removeChild(u.el);
      } else if (!u.remove) {
        renderPowerup(u);
      }
    }
    if (powerups.length) {
      powerups = powerups.filter(u => !u.remove);
    }

    // Game over if player falls below the bottom
    if (player.y > HEIGHT + 40) {
      gameOver();
      return;
    }

    renderPlayer();
    rafId = requestAnimationFrame(loop);
  }

  // Input handlers
  function onKeyDown(e) {
    const code = e.code || e.key;
    if (code === "ArrowLeft" || code === "KeyA") keys.left = true;
    if (code === "ArrowRight" || code === "KeyD") keys.right = true;
    if (code === "Space") {
      keys.paused = !keys.paused;
      if (!keys.paused && !running) {
        // If game over, restart
        resetGame();
      }
      e.preventDefault();
    }
  }

  function onKeyUp(e) {
    const code = e.code || e.key;
    if (code === "ArrowLeft" || code === "KeyA") keys.left = false;
    if (code === "ArrowRight" || code === "KeyD") keys.right = false;
  }

  // Bind events
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  document.addEventListener("visibilitychange", () => {
    keys.paused = document.hidden || keys.paused;
  });

  if (restartBtn) restartBtn.addEventListener("click", resetGame);
  if (restartBtn2) restartBtn2.addEventListener("click", resetGame);

  // Kick off
  resetGame();
})();
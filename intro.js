/* ==========================================================================
   Opening sequence (see intro.css).

   A photo drifts through deep space, lightning hits it, it falls toward Earth as a
   meteor, hits the ground (the whole screen shakes) and collapses into a PDF that
   opens until it is the landing page.

   Everything is drawn by one pure function, frame(t), so any moment can be shown
   again exactly (the UI checks and the "?introDebug" seek rely on this). three.js
   draws space and Earth, a 2D canvas draws the fire, lightning and impact, and the
   photo and the PDF are crisp SVG on top. GSAP supplies the clock and the easing.
   ========================================================================== */
function introMain() {
  'use strict';

  var html = document.documentElement;
  var root = document.getElementById('intro');
  if (!root || html.classList.contains('no-intro')) return;

  var stage = document.getElementById('intro-stage');
  var glCanvas = document.getElementById('intro-gl');
  var fxCanvas = document.getElementById('intro-fx');
  var photoEl = document.getElementById('intro-photo');
  var pdfEl = document.getElementById('intro-pdf');
  var pdfBack2 = document.getElementById('intro-pdf-back2');
  var pdfBack1 = document.getElementById('intro-pdf-back1');
  var pdfFront = document.getElementById('intro-pdf-front');
  var pageFace = document.getElementById('intro-page-face');
  var pageFold = document.getElementById('intro-page-fold');
  var pageArt = document.getElementById('intro-page-art');
  var wordEl = document.getElementById('intro-wordmark');
  var skipBtn = document.getElementById('intro-skip');
  var appEl = document.querySelector('.app-container');
  var params = new URLSearchParams(window.location.search);
  var debug = params.has('introDebug');
  var reduced = html.classList.contains('intro-reduced');

  var finished = false;
  var lockedScroll = false;

  /* ---------------------------------------------------------------- timing */
  var T = {
    strike: 1.05,    // first lightning hit
    restrike: 1.2,   // second, smaller
    launch: 1.05,    // the strike throws it: it starts crumpling and falling in the same instant
    atmo: 2.5,       // reaches the atmosphere
    impact: 3.4,     // hits the ground
    form: 3.55,      // the PDF forms
    open: 4.35,      // the PDF starts to open
    end: 5.05        // landing page
  };

  /* --------------------------------------------------------------- helpers */
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var lerp = function (a, b, u) { return a + (b - a) * u; };
  var easeCache = {};
  function E(name) {
    if (!easeCache[name]) easeCache[name] = (window.gsap && window.gsap.parseEase) ? window.gsap.parseEase(name) : function (u) { return u; };
    return easeCache[name];
  }
  function seg(t, a, b, ease) {
    var u = clamp((t - a) / (b - a), 0, 1);
    return ease ? E(ease)(u) : u;
  }
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var r = Math.imul(s ^ (s >>> 15), 1 | s);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  function wobble(t, f, ph) { return Math.sin(t * f + ph) * 0.6 + Math.sin(t * f * 1.73 + ph * 2.1 + 1.3) * 0.4; }
  function mixHex(a, b, u) {
    var pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
    var pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
    return 'rgb(' + Math.round(lerp(pa[0], pb[0], u)) + ',' + Math.round(lerp(pa[1], pb[1], u)) + ',' + Math.round(lerp(pa[2], pb[2], u)) + ')';
  }

  /* -------------------------------------------------------- landing reveal */
  function lockScroll() { lockedScroll = true; html.style.overflow = 'hidden'; if (appEl) appEl.inert = true; }
  function unlockScroll() {
    if (!lockedScroll) return;
    lockedScroll = false;
    html.style.overflow = '';
    if (appEl) appEl.inert = false;
  }

  function landingEntrance() {
    if (!window.gsap || reduced) return;
    var bar = document.querySelector('.top-bar');
    var work = document.querySelector('.main-workspace');
    if (bar) window.gsap.fromTo(bar, { y: -26, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out', clearProps: 'transform,opacity' });
    if (work) window.gsap.fromTo(work, { y: 34, opacity: 0 }, { y: 0, opacity: 1, duration: 0.95, delay: 0.08, ease: 'power3.out', clearProps: 'transform,opacity' });
  }

  var ticking = null;
  var renderer = null;

  function finish(fade) {
    if (finished) return;
    finished = true;
    if (window.gsap && ticking) window.gsap.ticker.remove(ticking);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
    var out = function () {
      html.classList.add('no-intro');
      if (renderer) { try { renderer.dispose(); renderer.forceContextLoss(); } catch (e) { /* already gone */ } }
      if (paper) { try { paper.renderer.dispose(); paper.renderer.forceContextLoss(); } catch (e) { /* already gone */ } }
      if (root.parentNode) root.parentNode.removeChild(root);
      unlockScroll();
      landingEntrance();
    };
    if (fade && window.gsap) window.gsap.to(root, { opacity: 0, duration: 0.45, ease: 'power2.out', onComplete: out });
    else out();
  }

  function onKey(e) {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(true); }
  }
  document.addEventListener('keydown', onKey);
  if (skipBtn) skipBtn.addEventListener('click', function () { finish(true); });
  lockScroll();

  /* ------------------------------------------- reduced motion: calm, short */
  if (reduced) {
    var calm = [photoEl, wordEl, pdfEl];
    calm.forEach(function (el) { if (el) el.style.visibility = 'hidden'; });
    if (skipBtn) skipBtn.style.display = 'none';
    var pdfBox = pdfEl;
    pdfBox.style.width = '120px';
    pdfBox.style.height = '162px';
    pdfBox.style.left = '50%';
    pdfBox.style.top = '46%';
    pdfBox.style.transform = 'translate(-50%,-50%)';
    pdfBox.style.visibility = 'visible';
    pdfBox.style.opacity = '0';
    wordEl.style.top = 'calc(46% + 110px)';
    wordEl.style.visibility = 'visible';
    pdfBox.style.transition = 'opacity .5s ease';
    wordEl.style.transition = 'opacity .5s ease';
    requestAnimationFrame(function () { pdfBox.style.opacity = '1'; wordEl.style.opacity = '1'; });
    setTimeout(function () { root.style.transition = 'opacity .45s ease'; root.style.opacity = '0'; }, 900);
    setTimeout(function () { finish(false); }, 1400);
    return;
  }

  /* ------------------------------------------------------------ no 3D, no show */
  if (!window.THREE || !window.gsap) { setTimeout(function () { finish(true); }, 200); return; }

  var THREE = window.THREE;
  var W = 0, H = 0, dpr = 1;
  var fx = fxCanvas.getContext('2d');
  var camera, scene, earthGroup, earth, clouds, halo, stars, sky;
  var uniforms = {};
  var currentT = 0;
  var glActive = true;

  var ASSET_BASE = 'assets/intro/';
  var V = window.__introVersion || '';

  /* ---------------------------------------------------------------- shaders */
  var NOISE = [
    'float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }',
    'float noise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),',
    '             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }',
    'float fbm(vec3 p){ float a = 0.5; float s = 0.0; for (int i = 0; i < 6; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }'
  ].join('\n');

  var SKY_VERT = 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var SKY_FRAG = [
    'precision highp float; varying vec3 vDir; uniform float uExposure;',
    NOISE,
    'void main(){',
    '  vec3 d = normalize(vDir);',
    '  vec3 n = normalize(vec3(0.38, 0.78, 0.5));',
    '  float lat = dot(d, n);',
    '  float band = exp(-pow(lat / 0.20, 2.0));',
    '  float broad = exp(-pow(lat / 0.55, 2.0));',
    '  float cloud = fbm(d * 3.6 + 3.0);',
    '  float fine = fbm(d * 13.0);',
    '  float dens = band * (0.30 + 1.0 * cloud) * (0.45 + 0.9 * fine);',
    '  float dust = smoothstep(0.46, 0.74, fbm(d * 6.5 + 9.0)) * band;',
    '  float core = exp(-pow(dot(d, normalize(vec3(-0.55, 0.15, -0.8))) - 1.0, 2.0) * 9.0);',
    '  vec3 cool = vec3(0.52, 0.60, 0.82);',
    '  vec3 warm = vec3(1.0, 0.78, 0.55);',
    '  vec3 col = mix(cool, warm, clamp(band * cloud * 1.3 + core * 0.7, 0.0, 1.0)) * dens * 0.66;',
    '  col += warm * core * band * 0.20;',
    '  col *= (1.0 - 0.78 * dust);',
    '  float neb1 = smoothstep(0.52, 0.88, fbm(d * 2.0 + vec3(5.0, 1.0, 2.0)));',
    '  float neb2 = smoothstep(0.50, 0.90, fbm(d * 1.6 + vec3(8.0, 3.0, 1.0)));',
    '  col += vec3(0.36, 0.13, 0.07) * neb1 * 0.15 * (0.4 + broad) + vec3(0.07, 0.10, 0.26) * neb2 * 0.17;',
    '  gl_FragColor = vec4(col * uExposure, 1.0);',
    '}'
  ].join('\n');

  var STAR_VERT = [
    'attribute float aSize; attribute vec3 aColor; attribute float aPhase; attribute float aSpeed;',
    'uniform float uTime; uniform float uPx; uniform float uExposure; varying vec3 vColor; varying float vTw;',
    'void main(){',
    '  vColor = aColor;',
    '  vTw = (0.78 + 0.22 * sin(uTime * aSpeed + aPhase)) * uExposure;',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_PointSize = aSize * uPx;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  var STAR_FRAG = [
    'precision highp float; varying vec3 vColor; varying float vTw;',
    'void main(){',
    '  float r = length(gl_PointCoord - 0.5);',
    '  float core = smoothstep(0.5, 0.0, r);',
    '  float a = core * core;',
    '  a += smoothstep(0.5, 0.08, r) * 0.18;',
    '  gl_FragColor = vec4(vColor * vTw, a * min(vTw, 1.4));',
    '}'
  ].join('\n');

  var EARTH_VERT = [
    'varying vec2 vUv; varying vec3 vN; varying vec3 vP;',
    'void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz;',
    '  gl_Position = projectionMatrix * viewMatrix * wp; }'
  ].join('\n');
  var EARTH_FRAG = [
    'precision highp float;',
    'varying vec2 vUv; varying vec3 vN; varying vec3 vP;',
    'uniform sampler2D uDay; uniform sampler2D uNight; uniform sampler2D uClouds;',
    'uniform vec3 uSun; uniform vec3 uCam; uniform float uTime; uniform vec3 uHit; uniform float uHitGlow; uniform float uCloudShift;',
    'void main(){',
    '  vec3 N = normalize(vN);',
    '  vec3 V = normalize(uCam - vP);',
    '  float ndl = dot(N, uSun);',
    '  float day = smoothstep(-0.10, 0.22, ndl);',
    '  vec3 dc = texture2D(uDay, vUv).rgb;',
    '  dc = pow(dc, vec3(0.98)) * 0.98;',
    '  float water = smoothstep(0.03, 0.10, dc.b - dc.r) * (1.0 - smoothstep(0.55, 0.9, dc.g));',
    '  vec3 R = reflect(-uSun, N);',
    '  float spec = pow(max(dot(R, V), 0.0), 70.0) * water * day;',
    '  vec3 lit = dc * (0.03 + 0.86 * max(ndl, 0.0));',
    '  float cl = texture2D(uClouds, vUv + vec2(uCloudShift, 0.0)).r;',
    '  float shade = 1.0 - 0.38 * smoothstep(0.35, 0.9, cl) * day;',
    '  lit *= shade;',
    '  lit += vec3(1.0, 0.93, 0.82) * spec * 0.85;',
    '  float term = smoothstep(-0.18, 0.0, ndl) * (1.0 - smoothstep(0.0, 0.26, ndl));',
    '  lit += vec3(0.95, 0.42, 0.14) * term * 0.16 * (1.0 - water * 0.5);',
    '  float lights = texture2D(uNight, vUv).r;',
    '  float nightMask = (1.0 - day) * (1.0 - smoothstep(0.25, 0.8, cl) * 0.85);',
    '  vec3 city = vec3(1.0, 0.72, 0.38) * pow(lights, 1.15) * 2.1 * nightMask;',
    '  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);',
    '  vec3 rim = vec3(0.30, 0.58, 1.0) * fres * (0.18 + 0.95 * smoothstep(-0.3, 0.5, ndl));',
    '  float hit = exp(-pow(acos(clamp(dot(N, uHit), -1.0, 1.0)) / 0.26, 2.0)) * uHitGlow;',
    '  vec3 fire = vec3(1.0, 0.42, 0.10) * hit * 0.85 + vec3(1.0, 0.8, 0.5) * hit * hit * hit * 0.7;',
    '  gl_FragColor = vec4(lit + city + rim + fire, 1.0);',
    '}'
  ].join('\n');

  var CLOUD_FRAG = [
    'precision highp float;',
    'varying vec2 vUv; varying vec3 vN; varying vec3 vP;',
    'uniform sampler2D uClouds; uniform vec3 uSun; uniform vec3 uCam; uniform float uCloudShift; uniform vec3 uHit; uniform float uHitGlow;',
    'void main(){',
    '  vec3 N = normalize(vN); vec3 V = normalize(uCam - vP);',
    '  float ndl = dot(N, uSun);',
    '  float day = smoothstep(-0.12, 0.25, ndl);',
    '  float c = texture2D(uClouds, vUv + vec2(uCloudShift, 0.0)).r;',
    '  float a = smoothstep(0.22, 0.92, c) * 0.92;',
    '  vec3 col = vec3(1.0, 0.99, 0.97) * (0.03 + 1.0 * max(ndl, 0.0)) ;',
    '  col += vec3(0.95, 0.45, 0.2) * (1.0 - day) * 0.04;',
    '  float hit = exp(-pow(acos(clamp(dot(N, uHit), -1.0, 1.0)) / 0.2, 2.0)) * uHitGlow;',
    '  col += vec3(1.0, 0.5, 0.18) * hit * 1.2;',
    '  float edge = pow(1.0 - max(dot(N, V), 0.0), 2.0);',
    '  gl_FragColor = vec4(col, a * (1.0 - edge * 0.35));',
    '}'
  ].join('\n');

  var HALO_VERT = 'varying vec3 vP; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }';
  var HALO_FRAG = [
    'precision highp float;',
    'varying vec3 vP; uniform vec3 uCam; uniform vec3 uCenter; uniform float uR; uniform vec3 uSun; uniform float uHitGlow;',
    'void main(){',
    '  vec3 rd = normalize(vP - uCam);',
    '  vec3 oc = uCenter - uCam;',
    '  float tca = dot(oc, rd);',
    '  float b = length(oc - rd * tca);',
    '  float alt = (b - uR) / uR;',
    '  if (alt <= 0.0) discard;',
    '  float dens = exp(-alt * 13.0);',
    '  vec3 closest = uCam + rd * tca;',
    '  vec3 radial = normalize(closest - uCenter);',
    '  float sunSide = dot(radial, uSun);',
    '  float lit = 0.14 + 0.86 * smoothstep(-0.38, 0.5, sunSide);',
    '  vec3 blue = vec3(0.22, 0.52, 1.0);',
    '  vec3 sky = vec3(0.45, 0.78, 1.0);',
    '  vec3 sunset = vec3(1.0, 0.46, 0.16);',
    '  float tw = (1.0 - smoothstep(0.0, 0.24, abs(sunSide))) * 0.9;',
    '  vec3 col = mix(blue, sky, smoothstep(0.0, 0.5, sunSide));',
    '  col = mix(col, sunset, tw * (1.0 - smoothstep(0.0, 0.5, alt * 6.0)));',
    '  col += vec3(1.0, 0.45, 0.15) * uHitGlow * 0.35;',
    '  gl_FragColor = vec4(col * dens * lit * 1.9, dens * lit);',
    '}'
  ].join('\n');

  /* ----------------------------------------------------------- 3D scene */
  var R = 6;                       // Earth radius in scene units
  var SUN = new THREE.Vector3(-0.82, 0.30, 0.48).normalize();
  var earthCenter = new THREE.Vector3(1.8, -13.5, -17);
  var camPos0 = new THREE.Vector3(0, 0, 0);
  var camLook0 = new THREE.Vector3(0, 0, -40);

  function loadTexture(name) {
    return new Promise(function (resolve, reject) {
      new THREE.TextureLoader().load(ASSET_BASE + name + V, function (tex) {
        tex.anisotropy = 8;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.wrapS = THREE.RepeatWrapping;
        resolve(tex);
      }, undefined, reject);
    });
  }

  function buildScene(tex) {
    renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance', alpha: false });
    renderer.setClearColor(0x02030a, 1);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, 1, 0.1, 600);

    uniforms.time = { value: 0 };
    uniforms.exposure = { value: 1 };
    uniforms.px = { value: 1 };

    // the Milky Way, nebulae and fine star dust
    sky = new THREE.Mesh(
      new THREE.SphereGeometry(300, 48, 32),
      new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, uniforms: { uExposure: uniforms.exposure } })
    );
    scene.add(sky);

    // individual stars: many faint, a few bright, with colour temperature
    var N = 3600;
    var pos = new Float32Array(N * 3), size = new Float32Array(N), col = new Float32Array(N * 3), ph = new Float32Array(N), sp = new Float32Array(N);
    var r = rng(7);
    for (var i = 0; i < N; i++) {
      var u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(a) * s * 250; pos[i * 3 + 1] = u * 250; pos[i * 3 + 2] = Math.sin(a) * s * 250;
      var m = Math.pow(r(), 6);                       // few bright ones
      size[i] = 1.7 + m * 5.0;
      var k = r(), c = k < 0.18 ? [0.65, 0.78, 1.0] : k < 0.78 ? [1.0, 0.98, 0.94] : k < 0.93 ? [1.0, 0.86, 0.66] : [1.0, 0.68, 0.5];
      var br = 0.55 + m * 0.9;
      col[i * 3] = c[0] * br; col[i * 3 + 1] = c[1] * br; col[i * 3 + 2] = c[2] * br;
      ph[i] = r() * 6.28; sp[i] = 0.6 + r() * 2.4;
    }
    var sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    sg.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    sg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    sg.setAttribute('aSpeed', new THREE.BufferAttribute(sp, 1));
    stars = new THREE.Points(sg, new THREE.ShaderMaterial({
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: uniforms.time, uPx: uniforms.px, uExposure: uniforms.exposure }
    }));
    scene.add(stars);

    // Earth: NASA Blue Marble day map, Black Marble city lights, cloud map, plus a physically-shaped atmosphere
    uniforms.cam = { value: new THREE.Vector3() };
    uniforms.sun = { value: SUN };
    uniforms.hit = { value: new THREE.Vector3(0, 1, 0) };
    uniforms.hitGlow = { value: 0 };
    uniforms.cloudShift = { value: 0 };
    uniforms.center = { value: earthCenter };
    uniforms.R = { value: R };

    earthGroup = new THREE.Group();
    earthGroup.position.copy(earthCenter);
    earth = new THREE.Mesh(
      new THREE.SphereGeometry(R, 128, 96),
      new THREE.ShaderMaterial({
        vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG,
        uniforms: {
          uDay: { value: tex.day }, uNight: { value: tex.night }, uClouds: { value: tex.clouds },
          uSun: uniforms.sun, uCam: uniforms.cam, uTime: uniforms.time, uHit: uniforms.hit, uHitGlow: uniforms.hitGlow, uCloudShift: uniforms.cloudShift
        }
      })
    );
    clouds = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.012, 96, 72),
      new THREE.ShaderMaterial({
        vertexShader: EARTH_VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false,
        uniforms: { uClouds: { value: tex.clouds }, uSun: uniforms.sun, uCam: uniforms.cam, uCloudShift: uniforms.cloudShift, uHit: uniforms.hit, uHitGlow: uniforms.hitGlow }
      })
    );
    halo = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.32, 96, 72),
      new THREE.ShaderMaterial({
        vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: { uCam: uniforms.cam, uCenter: uniforms.center, uR: uniforms.R, uSun: uniforms.sun, uHitGlow: uniforms.hitGlow }
      })
    );
    earthGroup.add(earth); earthGroup.add(clouds);
    scene.add(earthGroup);
    halo.position.copy(earthCenter);
    scene.add(halo);
  }

  /* ----------------------------------------------------------- fx sprites */
  function makeSprite(r, g, b) {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var x = c.getContext('2d');
    var gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',1)');
    gr.addColorStop(0.35, 'rgba(' + r + ',' + g + ',' + b + ',0.55)');
    gr.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return c;
  }
  var SPR = { hot: makeSprite(255, 238, 205), amber: makeSprite(255, 164, 64), terra: makeSprite(205, 74, 18), smoke: makeSprite(70, 40, 28) };

  /* ------------------------------------------------------------ the photo */
  var P = {
    start: [0.20, 0.20], hang: [0.36, 0.30], low: [0.56, 0.78]
  };
  function photoBase() { return clamp(Math.min(W, H) * 0.22, 96, 210); }

  // Each bolt comes from above and a little to one side of the photo; the push it gives points away from where it came from.
  var STRIKES = [{ t0: T.strike, seed: 11, dur: 0.36, dx: -0.17 }, { t0: T.restrike, seed: 29, dur: 0.30, dx: 0.05 }];
  function impulseDir(i) {
    var vx = -STRIKES[i].dx * W, vy = P.hang[1] * H + 30, l = Math.hypot(vx, vy) || 1;
    return [vx / l, vy / l];
  }

  function photoState(t) {
    var base = photoBase(), xp, yp, rot, s, u;
    if (t < T.strike) {
      u = E('sine.inOut')(clamp(t / T.strike, 0, 1));
      xp = (lerp(P.start[0], P.hang[0], u) + Math.sin(t * 1.3 + 1) * 0.006) * W;
      yp = (lerp(P.start[1], P.hang[1], u) + Math.sin(t * 2.1) * 0.012) * H;
      rot = lerp(-15, -6, u) + Math.sin(t * 1.6) * 2.2; s = 1;
    } else {
      // Momentum: the bolt's push is a hard shove along its own direction (fast, then it fades), on top of a fall that
      // starts slowly and drops faster and faster toward the ground.
      var uu = seg(t, T.launch, T.impact), f = 0.25 * uu + 0.35 * uu * uu + 0.40 * uu * uu * uu, g = 1 - f;
      var hx = P.hang[0] * W, hy = P.hang[1] * H, lx = P.low[0] * W, ly = P.low[1] * H;
      var d0 = impulseDir(0), reach = 0.5 * Math.hypot(lx - hx, ly - hy);
      var cx = hx + d0[0] * reach, cy = hy + d0[1] * reach;           // starts out heading the way it was hit
      xp = g * g * hx + 2 * g * f * cx + f * f * lx;
      yp = g * g * hy + 2 * g * f * cy + f * f * ly;
      var sc = Math.min(W, H);
      var jolt = 0.10 * sc * (1 - Math.exp(-(t - T.strike) / 0.09)) * (1 - uu);
      xp += d0[0] * jolt; yp += d0[1] * jolt;
      if (t > T.restrike) {
        var d1 = impulseDir(1), j2 = 0.04 * sc * (1 - Math.exp(-(t - T.restrike) / 0.08)) * (1 - uu);
        xp += d1[0] * j2; yp += d1[1] * j2;
      }
      rot = lerp(-6, 70, f); s = lerp(1, 0.07, Math.pow(f, 1.45));
    }
    // heat: lightning spikes it, then it keeps building as it falls
    var heat = 0, i;
    for (i = 0; i < 2; i++) if (t >= STRIKES[i].t0) heat = Math.max(heat, Math.exp(-(t - STRIKES[i].t0) * 5.5) * (i ? 0.8 : 1));
    if (t >= T.launch) heat = Math.max(heat, 0.30 + 0.70 * seg(t, T.launch, T.impact, 'power1.in'));
    return { x: xp, y: yp, rot: rot, s: s, w: base, heat: clamp(heat, 0, 1) };
  }

  /* ----------------------------------------------------------- the paper */
  // The photo is a sheet of paper (a flat 3D mesh). The strike crumples it: creases bite in first, then the sheet collapses
  // into a ball, while it is already being thrown and falling. Sizes are in "sheet widths"; the mesh is scaled to pixels.
  var NX = 56, NY = 68, SHEET_H = 140 / 116;
  var paper = null;      // { renderer, scene, camera, mesh, lights, data... } or null when unavailable

  function vnoise(x, y, z) {
    function h(i, j, k) { var n = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return n - Math.floor(n); }
    var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
    xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf); zf = zf * zf * (3 - 2 * zf);
    var a = lerp(lerp(h(xi, yi, zi), h(xi + 1, yi, zi), xf), lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), xf), yf);
    var b = lerp(lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), xf), lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), xf), yf);
    return lerp(a, b, zf);
  }

  function makePaperTexture() {
    return new Promise(function (resolve) {
      try {
        var svg = photoEl.querySelector('svg').cloneNode(true);
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); svg.setAttribute('width', '464'); svg.setAttribute('height', '560');
        var img = new Image();
        img.onload = function () {
          var c = document.createElement('canvas'); c.width = 464; c.height = 560;
          c.getContext('2d').drawImage(img, 0, 0, 464, 560);
          var tex = new THREE.CanvasTexture(c);
          tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4;
          resolve(tex);
        };
        img.onerror = function () { resolve(null); };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
      } catch (e) { resolve(null); }
    });
  }

  function buildPaper(tex) {
    var canvas = document.getElementById('intro-paper');
    var renderer2 = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer2.setClearColor(0x000000, 0);
    renderer2.outputEncoding = THREE.sRGBEncoding;
    renderer2.toneMapping = THREE.ACESFilmicToneMapping;
    renderer2.toneMappingExposure = 1.05;
    var scene2 = new THREE.Scene();
    var camera2 = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
    camera2.position.z = 2000;

    var n = (NX + 1) * (NY + 1), r = rng(5), i, j, k;
    var flat = new Float32Array(n * 2), uv = new Float32Array(n * 2), zPat = new Float32Array(n), creaseF = new Float32Array(n),
        chaos = new Float32Array(n * 3), ball = new Float32Array(n * 3), creaseB = new Float32Array(n);

    // fold lines across the sheet: the creases that appear first
    var folds = [];
    for (k = 0; k < 13; k++) folds.push({ c: Math.cos(r() * 3.1416), s: 0, d: (r() * 2 - 1) * 0.85, w: 0.10 + r() * 0.20, a: (r() < 0.5 ? -1 : 1) * (0.05 + r() * 0.10) });
    folds.forEach(function (f) { f.s = Math.sqrt(1 - f.c * f.c) * (r() < 0.5 ? -1 : 1); });
    // flat planes cut into the ball: a crumpled ball is a lumpy polyhedron
    var planes = [];
    for (k = 0; k < 24; k++) {
      var nx = r() * 2 - 1, ny = r() * 2 - 1, nz = r() * 2 - 1, l = Math.hypot(nx, ny, nz) || 1;
      planes.push({ x: nx / l, y: ny / l, z: nz / l, o: 0.76 + r() * 0.14 });
    }

    var R0 = 0.37;
    for (j = 0; j <= NY; j++) {
      for (i = 0; i <= NX; i++) {
        var id = j * (NX + 1) + i, u = -1 + 2 * i / NX, v = -1 + 2 * j / NY;
        flat[id * 2] = u * 0.5; flat[id * 2 + 1] = v * 0.5 * SHEET_H;
        uv[id * 2] = (u + 1) / 2; uv[id * 2 + 1] = (v + 1) / 2;
        var z = 0, cr = 0;
        for (k = 0; k < folds.length; k++) {
          var f = folds[k], tent = Math.max(0, 1 - Math.abs(u * f.c + v * f.s - f.d) / f.w);
          z += f.a * tent * tent; cr += tent * 0.8;
        }
        zPat[id] = z + 0.005 * (vnoise(u * 9, v * 9, 1.3) - 0.5);
        creaseF[id] = Math.min(1, cr);
        chaos[id * 3] = vnoise(u * 2.6, v * 2.6, 3.1) - 0.5; chaos[id * 3 + 1] = vnoise(u * 2.6 + 9, v * 2.6, 7.7) - 0.5; chaos[id * 3 + 2] = vnoise(u * 2.6, v * 2.6 + 5, 1.9) - 0.5;
        // equal-area map of the square sheet onto a sphere, so every part of the paper ends up somewhere on the ball
        var rr = Math.hypot(u, v) / 1.41421, cz = 1 - 2 * rr * rr, sz = Math.sqrt(Math.max(0, 1 - cz * cz)), ph = Math.atan2(v, u);
        var dx = sz * Math.cos(ph), dy = sz * Math.sin(ph), dz = cz;
        var rad = R0 * (1 + 0.20 * (vnoise(dx * 2.1 + 4, dy * 2.1, dz * 2.1) - 0.5) + 0.10 * (vnoise(dx * 5.5, dy * 5.5 + 3, dz * 5.5) - 0.5));
        for (k = 0; k < planes.length; k++) {
          var dd = dx * planes[k].x + dy * planes[k].y + dz * planes[k].z;
          if (dd > 0.05) rad = Math.min(rad, R0 * planes[k].o / dd);
        }
        var ridge = 1 - Math.abs(2 * vnoise(dx * 4.3, dy * 4.3 + 2, dz * 4.3) - 1);
        var ridge2 = 1 - Math.abs(2 * vnoise(dx * 9.5 + 1, dy * 9.5, dz * 9.5 + 6) - 1);
        rad *= 1 - 0.05 * ridge - 0.045 * ridge2;
        ball[id * 3] = dx * rad; ball[id * 3 + 1] = dy * rad; ball[id * 3 + 2] = dz * rad;
        creaseB[id] = Math.min(1, Math.pow(ridge, 3) + 0.6 * Math.pow(ridge2, 4));
      }
    }
    var idx = [];
    for (j = 0; j < NY; j++) for (i = 0; i < NX; i++) {
      var a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(n * 3), col = new Float32Array(n * 3).fill(1), emb = new Float32Array(n);
    var posAttr = new THREE.BufferAttribute(pos, 3); posAttr.setUsage(THREE.DynamicDrawUsage);
    var colAttr = new THREE.BufferAttribute(col, 3); colAttr.setUsage(THREE.DynamicDrawUsage);
    var embAttr = new THREE.BufferAttribute(emb, 1); embAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr); geo.setAttribute('color', colAttr); geo.setAttribute('aEmber', embAttr);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);

    var mat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, side: THREE.DoubleSide, flatShading: true, roughness: 0.92, metalness: 0, alphaTest: 0.5 });
    mat.onBeforeCompile = function (sh) {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aEmber;\nvarying float vEmber;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmber = aEmber;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vEmber;')
        .replace('#include <map_fragment>', '#include <map_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb = vec3(0.86, 0.83, 0.78);')   // the back of the print is plain paper
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.34, 0.06) * vEmber * 0.95;');
    };
    var mesh = new THREE.Mesh(geo, mat);
    scene2.add(mesh);
    var key = new THREE.DirectionalLight(0xfff2e2, 1.0); key.position.set(-0.5, 0.8, 1.0); scene2.add(key);
    var hemi = new THREE.HemisphereLight(0xc4d0ff, 0x4a362c, 0.7); scene2.add(hemi);
    var fire = new THREE.PointLight(0xff7a2a, 0, 0, 0); scene2.add(fire);
    paper = { renderer: renderer2, scene: scene2, camera: camera2, mesh: mesh, key: key, fire: fire, canvas: canvas, n: n,
              flat: flat, zPat: zPat, creaseF: creaseF, chaos: chaos, ball: ball, creaseB: creaseB, pos: pos, col: col, emb: emb, posAttr: posAttr, colAttr: colAttr, embAttr: embAttr };
  }

  function updatePaper(t, ph, strikeFlash) {
    var pp = paper, tp = Math.max(0, t - T.strike);
    // crease first (fast), then the whole sheet collapses; a small stutter makes the crunch feel violent
    var w = seg(t, T.strike, T.strike + 0.42, 'power2.out');
    var c = seg(t, T.strike + 0.04, T.strike + 0.80, 'power3.inOut');
    c = clamp(c + 0.035 * Math.sin(tp * 38) * Math.sin(Math.PI * c), 0, 1);
    var mid = Math.sin(Math.PI * c), shrink = 1 - 0.30 * w, pos = pp.pos, col = pp.col, emb = pp.emb, n = pp.n, i;
    for (i = 0; i < n; i++) {
      var fx0 = pp.flat[i * 2] * shrink, fy0 = pp.flat[i * 2 + 1] * shrink, fz0 = pp.zPat[i] * w * 1.15;
      pos[i * 3]     = lerp(fx0, pp.ball[i * 3], c) + pp.chaos[i * 3] * mid * 0.34;
      pos[i * 3 + 1] = lerp(fy0, pp.ball[i * 3 + 1], c) + pp.chaos[i * 3 + 1] * mid * 0.34;
      pos[i * 3 + 2] = lerp(fz0, pp.ball[i * 3 + 2], c) + pp.chaos[i * 3 + 2] * mid * 0.34;
      var shade = 1 - 0.42 * (pp.creaseF[i] * w * (1 - c) + pp.creaseB[i] * c);
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = shade;
      emb[i] = ph.heat * (0.15 + 0.85 * (pp.creaseF[i] * (1 - c) + pp.creaseB[i] * c)) * (0.35 + 0.65 * Math.max(w, c));
    }
    pp.posAttr.needsUpdate = true; pp.colAttr.needsUpdate = true; pp.embAttr.needsUpdate = true;
    pp.mesh.geometry.computeBoundingSphere();
    // it tumbles from the moment it is hit
    var ax = 0.10 * Math.sin(t * 1.3) + 2.4 * tp + 1.1 * tp * tp, ay = 0.12 * Math.sin(t * 0.9 + 1) + 1.5 * tp + 0.8 * tp * tp;
    pp.mesh.rotation.set(ax, ay, -ph.rot * Math.PI / 180, 'ZYX');
    pp.mesh.position.set(ph.x - W / 2, H / 2 - ph.y, 0);
    pp.mesh.scale.setScalar(ph.w * ph.s);
    pp.mesh.material.opacity = 1;
    pp.key.intensity = 1.0 + strikeFlash * 0.7;
    pp.fire.position.set(ph.x - W / 2, H / 2 - ph.y - ph.w * ph.s * 0.4, 220);
    pp.fire.intensity = ph.heat * 1.5;
    pp.renderer.render(pp.scene, pp.camera);
  }

  /* ------------------------------------------------- fixed random effects */
  var TRAIL = [], SPARKS = [], STREAKS = [], BURST = [];
  (function seedEffects() {
    var r = rng(21), i;
    for (i = 0; i < 300; i++) {
      var f = (i + r()) / 300;
      TRAIL.push({ b: lerp(T.launch - 0.04, T.impact - 0.02, Math.pow(f, 0.86)), life: 0.5 + r() * 0.65, a: r(), c: r(), sz: 0.7 + r() * 0.9 });
    }
    for (i = 0; i < 170; i++) SPARKS.push({ b: lerp(T.launch, T.impact - 0.05, r()), life: 0.35 + r() * 0.7, a: r() * 6.28, sp: 160 + r() * 520, r: r() });
    for (i = 0; i < 80; i++) STREAKS.push({ x: r(), y: r(), len: 70 + r() * 260, sp: 1.2 + r() * 2.8, w: 0.6 + r() * 1.6 });
    for (i = 0; i < 190; i++) BURST.push({ a: r() * 6.28, sp: 160 + Math.pow(r(), 1.5) * 1250, life: 0.45 + r() * 1.3, w: 0.8 + r() * 2.2, up: r() });
  })();

  /* ------------------------------------------------------------- lightning */
  function boltPath(r, x0, y0, x1, y1, disp, depth) {
    var pts = [[x0, y0], [x1, y1]], i, j;
    for (i = 0; i < depth; i++) {
      var np = [pts[0]];
      for (j = 0; j < pts.length - 1; j++) {
        var a = pts[j], b = pts[j + 1];
        var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        var off = (r() - 0.5) * disp;
        np.push([(a[0] + b[0]) / 2 - dy / len * off, (a[1] + b[1]) / 2 + dx / len * off]);
        np.push(b);
      }
      pts = np; disp *= 0.56;
    }
    return pts;
  }
  function strokePath(pts, widths, styles, alpha) {
    for (var k = 0; k < widths.length; k++) {
      fx.lineWidth = widths[k]; fx.strokeStyle = styles[k].replace('A', alpha.toFixed(3));
      fx.beginPath(); fx.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) fx.lineTo(pts[i][0], pts[i][1]);
      fx.stroke();
    }
  }
  var BOLT_STYLES = ['rgba(194,65,12,A)', 'rgba(255,160,70,A)', 'rgba(255,248,236,A)'];
  function drawLightning(t, ph) {
    var strikes = STRIKES;
    var flash = 0;
    for (var s = 0; s < strikes.length; s++) {
      var st = strikes[s], u = (t - st.t0) / st.dur;
      if (u < 0 || u > 1) continue;
      var env = Math.pow(1 - u, 1.6) * (0.62 + 0.38 * Math.sin(u * 70));
      flash = Math.max(flash, Math.pow(1 - u, 2.2));
      var r = rng(st.seed);
      var x0 = P.hang[0] * W + st.dx * W, y0 = -30;
      var main = boltPath(r, x0, y0, ph.x, ph.y, H * 0.20, 7);
      strokePath(main, [38, 14, 4.2], BOLT_STYLES, Math.min(1, env * 1.15));
      for (var b = 0; b < 7; b++) {
        var idx = Math.floor(r() * (main.length - 6)) + 3;
        var p = main[idx], ang = Math.PI / 2 + (r() - 0.5) * 2.0, len = H * (0.10 + r() * 0.2);
        var br = boltPath(r, p[0], p[1], p[0] + Math.cos(ang) * len, p[1] + Math.sin(ang) * len, len * 0.5, 5);
        strokePath(br, [16, 6, 2], BOLT_STYLES, env * 0.85);
      }
    }
    return flash;
  }

  /* ------------------------------------------------------------ shake */
  function shake(t) {
    var imp = [
      { t: T.strike, a: 10, d: 0.30 }, { t: T.restrike, a: 8, d: 0.26 },
      { t: T.impact, a: 52, d: 1.15 }, { t: T.form + 0.08, a: 13, d: 0.34 }
    ];
    var amp = 0, i;
    for (i = 0; i < imp.length; i++) if (t >= imp[i].t) amp += imp[i].a * Math.exp(-(t - imp[i].t) / (imp[i].d * 0.33));
    if (t < T.impact) amp += 15 * seg(t, T.atmo, T.impact, 'power2.in');   // the rumble builds, then the impact takes over
    amp *= clamp(Math.min(W, H) / 700, 0.55, 1.15);
    amp = Math.min(amp, Math.min(W, H) * 0.06);                           // never more than the spare edge around the stage
    return { x: amp * wobble(t, 43, 0.3), y: amp * wobble(t, 51, 1.7), r: amp * 0.028 * wobble(t, 29, 2.9), amp: amp };
  }

  /* ----------------------------------------------------------- the frame */
  var PDF_H = 0, PDF_W = 0;
  function pdfMetrics() {
    PDF_H = clamp(Math.min(W, H) * 0.50, 200, 420);
    PDF_W = PDF_H * (132 / 166);
  }

  function frame(t) {
    currentT = t;
    var ph = photoState(t);
    var sh = shake(t);
    if (skipBtn) skipBtn.style.opacity = String(Math.min(seg(t, 0.9, 1.4), 1 - seg(t, T.open - 0.25, T.open + 0.05)));
    stage.style.transform = 'translate3d(' + sh.x.toFixed(2) + 'px,' + sh.y.toFixed(2) + 'px,0) rotate(' + sh.r.toFixed(3) + 'deg)';

    /* ---- space and Earth (three.js) ---- */
    var strikeFlash = 0, kk = [T.strike, T.restrike];
    for (var q = 0; q < 2; q++) if (t >= kk[q]) strikeFlash = Math.max(strikeFlash, Math.exp(-(t - kk[q]) * 9));
    uniforms.exposure.value = 1 + strikeFlash * 0.5;
    uniforms.time.value = t;

    var rise = seg(t, T.launch - 0.1, T.atmo, 'power2.out');
    var ex = W < H ? 0.6 : 1.8;
    earthCenter.set(ex, lerp(-13.5, -8.1, rise), -17);
    earthGroup.position.copy(earthCenter); halo.position.copy(earthCenter);
    earthGroup.rotation.set(0.42, 3.62 + t * 0.012, 0.0, 'YXZ');
    uniforms.cloudShift.value = t * 0.0016;

    var dive = seg(t, T.atmo - 0.2, T.impact, 'power3.in');
    var dirF = new THREE.Vector3(0.02, 0.78, 0.62).normalize();
    var camEnd = earthCenter.clone().add(dirF.clone().multiplyScalar(R * 1.42));
    var lookEnd = earthCenter.clone().add(new THREE.Vector3(0.0, 0.50, 0.35).normalize().multiplyScalar(R));
    camera.position.copy(camPos0).lerp(camEnd, dive);
    var look = camLook0.clone().lerp(lookEnd, seg(t, T.atmo - 0.35, T.impact, 'power2.inOut'));
    camera.position.x += Math.sin(t * 0.35) * 0.05;
    camera.lookAt(look);
    camera.updateMatrixWorld();
    uniforms.cam.value.copy(camera.position);

    // where the meteor lands on the planet (screen point -> ray -> sphere)
    var hitGlow = seg(t, T.atmo - 0.1, T.impact, 'power2.in');
    if (t > T.impact) hitGlow = Math.max(0, 1 - (t - T.impact) * 2);
    uniforms.hitGlow.value = hitGlow;
    var hpState = photoState(Math.min(t, T.impact));
    var ndc = new THREE.Vector3(hpState.x / W * 2 - 1, -(hpState.y / H * 2 - 1), 0.5).unproject(camera);
    var rd = ndc.sub(camera.position).normalize();
    var oc = camera.position.clone().sub(earthCenter);
    var bq = oc.dot(rd), cq = oc.dot(oc) - R * R, disc = bq * bq - cq;
    if (disc > 0) {
      var hp = camera.position.clone().add(rd.multiplyScalar(-bq - Math.sqrt(disc)));
      // hit direction in the planet's own frame (the shader works in world space)
      uniforms.hit.value.copy(hp.sub(earthCenter).normalize());
    }

    if (glActive) renderer.render(scene, camera);

    /* ---- fire, lightning, impact (2D) ---- */
    fx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fx.globalCompositeOperation = 'source-over';
    fx.clearRect(0, 0, W, H);
    fx.lineCap = 'round'; fx.lineJoin = 'round';

    var bgAfter = seg(t, T.impact + 0.02, T.impact + 0.42);
    if (bgAfter > 0) {
      var g = fx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, 'rgba(70,24,8,' + bgAfter + ')'); g.addColorStop(0.5, 'rgba(14,7,5,' + bgAfter + ')'); g.addColorStop(1, 'rgba(3,2,4,' + bgAfter + ')');
      fx.fillStyle = g; fx.fillRect(0, 0, W, H);
      if (bgAfter >= 1) glActive = false; else glActive = true;
    } else glActive = true;

    var visible = t < T.impact + 0.001;
    fx.globalCompositeOperation = 'lighter';

    // atmosphere entry: plasma at the edges and rushing streaks
    var entry = seg(t, T.atmo, T.impact, 'power2.in');
    if (entry > 0 && t < T.impact + 0.05) {
      var vg = fx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.25, W / 2, H * 0.55, Math.max(W, H) * 0.8);
      vg.addColorStop(0, 'rgba(255,90,20,0)'); vg.addColorStop(1, 'rgba(255,100,30,' + (0.42 * entry).toFixed(3) + ')');
      fx.fillStyle = vg; fx.fillRect(0, 0, W, H);
      for (var i = 0; i < STREAKS.length; i++) {
        var sk = STREAKS[i];
        var yy = ((sk.y - (t - T.atmo) * sk.sp * (0.6 + entry)) % 1 + 1) % 1 * (H + 300) - 150;
        var len = sk.len * (0.35 + entry);
        var grd = fx.createLinearGradient(0, yy, 0, yy + len);
        grd.addColorStop(0, 'rgba(255,170,90,0)'); grd.addColorStop(1, 'rgba(255,200,140,' + (0.30 * entry).toFixed(3) + ')');
        fx.strokeStyle = grd; fx.lineWidth = sk.w;
        fx.beginPath(); fx.moveTo(sk.x * W, yy); fx.lineTo(sk.x * W, yy + len); fx.stroke();
      }
    }

    if (visible && t >= T.launch - 0.05) {
      var pi, tp, age, k, p0, p1, vx, vy, sz, spr, al, ex2, ey2;
      // smoke first (drawn normally), then fire (additive)
      fx.globalCompositeOperation = 'source-over';
      for (pi = 0; pi < TRAIL.length; pi++) {
        tp = TRAIL[pi]; age = t - tp.b; if (age < 0 || age > tp.life * 1.6 || tp.c < 0.55 || tp.b > T.atmo + 0.25) continue;
        k = age / (tp.life * 1.6); p0 = photoState(tp.b);
        sz = p0.w * (0.5 + 1.5 * k) * tp.sz * p0.s * 0.9;
        ex2 = p0.x + (tp.a - 0.5) * p0.w * 0.7 * k; ey2 = p0.y - 38 * k * k - 20 * k;
        fx.globalAlpha = (1 - k) * 0.16 * p0.heat;
        fx.drawImage(SPR.smoke, ex2 - sz, ey2 - sz, sz * 2, sz * 2);
      }
      fx.globalAlpha = 1; fx.globalCompositeOperation = 'lighter';
      for (pi = 0; pi < TRAIL.length; pi++) {
        tp = TRAIL[pi]; age = t - tp.b; if (age < 0 || age > tp.life) continue;
        k = age / tp.life; p0 = photoState(tp.b);
        sz = p0.w * (0.2 + 0.62 * k) * tp.sz * Math.max(p0.s, 0.16);
        ex2 = p0.x + (tp.a - 0.5) * p0.w * 0.55 * k * p0.s; ey2 = p0.y - 22 * k * k;
        spr = k < 0.18 ? SPR.hot : k < 0.52 ? SPR.amber : SPR.terra;
        al = Math.pow(1 - k, 1.2) * (0.5 + 0.4 * p0.heat);
        fx.globalAlpha = clamp(al, 0, 1);
        fx.drawImage(spr, ex2 - sz, ey2 - sz, sz * 2, sz * 2);
      }
      fx.globalAlpha = 1;
      // comet tail: the recent path of the photo drawn as one tapering ribbon of fire
      var tailLen = 0.65, steps = 16, prev = null;
      for (var ti = 0; ti <= steps; ti++) {
        var tt = t - tailLen * (1 - ti / steps); if (tt < T.launch - 0.04) continue;
        var tq = photoState(tt), kt = ti / steps;
        if (prev) {
          var wdt = Math.max(tq.w * Math.max(tq.s, 0.1) * 0.62 * kt, 1.5), ta = Math.pow(kt, 1.4);
          fx.lineCap = 'round';
          fx.strokeStyle = 'rgba(194,65,12,' + (0.34 * ta).toFixed(3) + ')'; fx.lineWidth = wdt * 1.9; fx.beginPath(); fx.moveTo(prev.x, prev.y); fx.lineTo(tq.x, tq.y); fx.stroke();
          fx.strokeStyle = 'rgba(255,150,60,' + (0.55 * ta).toFixed(3) + ')'; fx.lineWidth = wdt * 1.1; fx.beginPath(); fx.moveTo(prev.x, prev.y); fx.lineTo(tq.x, tq.y); fx.stroke();
          fx.strokeStyle = 'rgba(255,238,205,' + (0.8 * ta).toFixed(3) + ')'; fx.lineWidth = wdt * 0.45; fx.beginPath(); fx.moveTo(prev.x, prev.y); fx.lineTo(tq.x, tq.y); fx.stroke();
        }
        prev = tq;
      }
      // sparks: bright little streaks thrown backwards
      for (pi = 0; pi < SPARKS.length; pi++) {
        var sp = SPARKS[pi]; age = t - sp.b; if (age < 0 || age > sp.life) continue;
        k = age / sp.life; p0 = photoState(sp.b); p1 = photoState(sp.b + 0.03);
        vx = (p1.x - p0.x) / 0.03; vy = (p1.y - p0.y) / 0.03;
        var bx = p0.x + (-vx * 0.30 + Math.cos(sp.a) * sp.sp * 0.5) * age;
        var by = p0.y + (-vy * 0.30 + Math.sin(sp.a) * sp.sp * 0.5) * age + 260 * age * age;
        var tx = bx - (-vx * 0.30 + Math.cos(sp.a) * sp.sp * 0.5) * 0.045, ty = by - (-vy * 0.30 + Math.sin(sp.a) * sp.sp * 0.5 + 520 * age) * 0.045;
        fx.strokeStyle = 'rgba(255,' + Math.round(150 + 90 * (1 - k)) + ',' + Math.round(60 + 120 * (1 - k)) + ',' + (1 - k).toFixed(3) + ')';
        fx.lineWidth = 1.4 * (1 - k * 0.5);
        fx.beginPath(); fx.moveTo(tx, ty); fx.lineTo(bx, by); fx.stroke();
      }
      // heat bloom around the photo
      var gl = ph.w * (0.55 + 1.35 * ph.heat) * Math.max(ph.s, 0.12);
      var bg = fx.createRadialGradient(ph.x, ph.y, 0, ph.x, ph.y, gl);
      bg.addColorStop(0, 'rgba(255,225,170,' + (0.55 * ph.heat).toFixed(3) + ')'); bg.addColorStop(0.35, 'rgba(255,120,40,' + (0.30 * ph.heat).toFixed(3) + ')'); bg.addColorStop(1, 'rgba(194,65,12,0)');
      fx.fillStyle = bg; fx.fillRect(ph.x - gl, ph.y - gl, gl * 2, gl * 2);
    }

    var flash = drawLightning(t, ph);
    if (flash > 0) {
      fx.fillStyle = 'rgba(255,215,180,' + (0.20 * flash).toFixed(3) + ')'; fx.fillRect(0, 0, W, H);
    }

    // impact: white-out, shockwaves, debris
    var pre = seg(t, T.impact - 0.10, T.impact);
    var post = t >= T.impact ? Math.exp(-(t - T.impact) * 6.5) : 0;
    var whiteA = t < T.impact ? pre * pre : post;
    var ix = W * P.low[0], iy = H * P.low[1];
    if (t >= T.impact) {
      var wi, wr;
      for (wi = 0; wi < 3; wi++) {
        var wt = t - T.impact - wi * 0.09; if (wt < 0 || wt > 1.4) continue;
        wr = Math.pow(wt / 1.4, 0.62) * Math.max(W, H) * 1.05;
        fx.strokeStyle = 'rgba(255,' + (190 - wi * 30) + ',' + (130 - wi * 25) + ',' + (0.8 * (1 - wt / 1.4) * (1 - wi * 0.25)).toFixed(3) + ')';
        fx.lineWidth = (26 - wi * 7) * (1 - wt / 1.4) + 1;
        fx.beginPath(); fx.ellipse(ix, iy, wr, wr * 0.52, 0, 0, Math.PI * 2); fx.stroke();
      }
      for (var bi = 0; bi < BURST.length; bi++) {
        var bb = BURST[bi], ba = t - T.impact; if (ba > bb.life) continue;
        var bk = ba / bb.life, ease = 1 - Math.pow(1 - Math.min(ba * 2.2, 1), 3);
        var bx2 = ix + Math.cos(bb.a) * bb.sp * ba * (0.55 + 0.45 * ease);
        var by2 = iy + Math.sin(bb.a) * bb.sp * ba * 0.55 - 380 * bb.up * ba + 620 * ba * ba;
        var tl = 0.05;
        var bx3 = bx2 - Math.cos(bb.a) * bb.sp * tl, by3 = by2 - (Math.sin(bb.a) * bb.sp * 0.55 - 380 * bb.up + 1240 * ba) * tl;
        fx.strokeStyle = 'rgba(255,' + Math.round(170 + 70 * (1 - bk)) + ',' + Math.round(80 + 130 * (1 - bk)) + ',' + (1 - bk).toFixed(3) + ')';
        fx.lineWidth = bb.w * (1 - bk * 0.6);
        fx.beginPath(); fx.moveTo(bx3, by3); fx.lineTo(bx2, by2); fx.stroke();
      }
    }
    fx.globalCompositeOperation = 'source-over';
    if (whiteA > 0.004) { fx.fillStyle = 'rgba(255,240,222,' + clamp(whiteA, 0, 1).toFixed(3) + ')'; fx.fillRect(0, 0, W, H); }

    /* ---- the PDF forms ---- */
    var formU = seg(t, T.form, T.form + 0.62), openU = seg(t, T.open, T.end);
    if (t >= T.form - 0.05) {
      fx.globalCompositeOperation = 'lighter';
      var cx = W / 2, cy = H / 2;
      var coreA = seg(t, T.impact + 0.1, T.form + 0.1) * (1 - seg(t, T.form + 0.9, T.open + 0.1) * 0.55) * (1 - openU);
      var cg = fx.createRadialGradient(cx, cy, 0, cx, cy, PDF_H * 1.05);
      cg.addColorStop(0, 'rgba(255,225,170,' + (0.85 * coreA).toFixed(3) + ')'); cg.addColorStop(0.28, 'rgba(255,120,40,' + (0.5 * coreA).toFixed(3) + ')'); cg.addColorStop(1, 'rgba(194,65,12,0)');
      fx.fillStyle = cg; fx.fillRect(cx - PDF_H * 1.1, cy - PDF_H * 1.1, PDF_H * 2.2, PDF_H * 2.2);
      // slow light rays
      var rayA = seg(t, T.form, T.form + 0.7) * (1 - seg(t, T.open, T.open + 0.45));
      if (rayA > 0.01) {
        for (var ri = 0; ri < 16; ri++) {
          var ra = ri / 16 * 6.283 + t * 0.35, rw = 0.045 + 0.02 * Math.sin(ri * 2.3), rl = Math.max(W, H) * 0.7;
          var rg = fx.createLinearGradient(cx, cy, cx + Math.cos(ra) * rl, cy + Math.sin(ra) * rl);
          rg.addColorStop(0, 'rgba(255,190,120,' + (0.20 * rayA).toFixed(3) + ')'); rg.addColorStop(1, 'rgba(255,150,70,0)');
          fx.fillStyle = rg; fx.beginPath(); fx.moveTo(cx, cy);
          fx.lineTo(cx + Math.cos(ra - rw) * rl, cy + Math.sin(ra - rw) * rl); fx.lineTo(cx + Math.cos(ra + rw) * rl, cy + Math.sin(ra + rw) * rl);
          fx.closePath(); fx.fill();
        }
      }
      fx.globalCompositeOperation = 'source-over';
    }

    /* ---- DOM: the photo ---- */
    var showPhoto = t < T.impact + 0.02;
    if (paper) {
      photoEl.style.visibility = 'hidden';
      paper.canvas.style.visibility = showPhoto ? 'visible' : 'hidden';
      paper.canvas.style.opacity = String(seg(t, 0, 0.5));
      if (showPhoto) updatePaper(t, ph, strikeFlash);
    } else {
    photoEl.style.visibility = showPhoto ? 'visible' : 'hidden';
    if (showPhoto) {
      var pw = ph.w, phh = ph.w * 140 / 116;
      photoEl.style.width = pw + 'px'; photoEl.style.height = phh + 'px';
      photoEl.style.opacity = String(seg(t, 0, 0.5));
      photoEl.style.transform = 'translate3d(' + ph.x.toFixed(1) + 'px,' + ph.y.toFixed(1) + 'px,0) translate(-50%,-50%) rotate(' + ph.rot.toFixed(2) + 'deg) scale(' + ph.s.toFixed(3) + ')';
      var br = 1 + ph.heat * 0.42;
      photoEl.style.filter = 'brightness(' + br.toFixed(2) + ') saturate(' + (1 + ph.heat * 0.3).toFixed(2) + ') drop-shadow(0 0 ' + (8 + ph.heat * 34).toFixed(0) + 'px rgba(255,' + Math.round(150 + 90 * ph.heat) + ',' + Math.round(60 + 70 * ph.heat) + ',' + (0.35 + 0.6 * ph.heat).toFixed(2) + '))';
    }
    }

    /* ---- DOM: the PDF ---- */
    var showPdf = t >= T.form - 0.05;
    pdfEl.style.visibility = showPdf ? 'visible' : 'hidden';
    wordEl.style.visibility = showPdf ? 'visible' : 'hidden';
    if (showPdf) {
      var sc = lerp(0.18, 1, E('back.out(1.7)')(formU));
      var rot = lerp(-14, 0, E('power3.out')(formU));
      var cover = Math.max(2.6 * W / PDF_W, 2.6 * H / PDF_H);
      var openS = E('power4.in')(openU);
      var S = sc * (1 + (cover - 1) * openS);
      pdfEl.style.width = PDF_W + 'px'; pdfEl.style.height = PDF_H + 'px';
      pdfEl.style.opacity = String(seg(t, T.form - 0.05, T.form + 0.14));
      pdfEl.style.transform = 'translate3d(' + (W / 2).toFixed(1) + 'px,' + (H / 2).toFixed(1) + 'px,0) translate(-50%,-50%) rotate(' + rot.toFixed(2) + 'deg) scale(' + S.toFixed(4) + ')';
      pdfEl.style.filter = 'drop-shadow(0 0 ' + (30 * (1 - openU)).toFixed(0) + 'px rgba(255,140,60,0.65))';
      // the back pages fan out as it opens
      var fan = E('power3.out')(seg(t, T.form + 0.25, T.form + 0.9)) * 0.4 + E('power2.out')(seg(t, T.open - 0.05, T.open + 0.45)) * 0.6;
      pdfBack2.style.transform = 'rotate(' + (-fan * 17).toFixed(2) + 'deg) translateX(' + (-fan * 22).toFixed(1) + 'px)';
      pdfBack1.style.transform = 'rotate(' + (fan * 11).toFixed(2) + 'deg) translateX(' + (fan * 18).toFixed(1) + 'px)';
      var cream = seg(t, T.open + 0.05, T.open + 0.5);
      var face = mixHex('#ffffff', '#fbfaf7', cream);
      pageFace.setAttribute('fill', face); pageFold.setAttribute('fill', mixHex('#e6dfd3', '#fbfaf7', cream));
      pageFace.setAttribute('stroke-opacity', String(1 - cream));
      pageArt.setAttribute('opacity', String(1 - seg(t, T.open + 0.02, T.open + 0.34)));
      // wordmark under the page
      wordEl.style.top = (H / 2 + PDF_H / 2 + 30) + 'px';
      wordEl.style.opacity = String(seg(t, T.form + 0.35, T.form + 0.85) * (1 - seg(t, T.open - 0.1, T.open + 0.3)));
      wordEl.style.transform = 'translateY(' + (12 * (1 - seg(t, T.form + 0.35, T.form + 0.9, 'power3.out'))).toFixed(1) + 'px)';
    }
  }

  /* ---------------------------------------------------------------- sizing */
  function onResize() {
    if (finished) return;
    W = Math.round(stage.clientWidth); H = Math.round(stage.clientHeight);
    var cap = (W * H > 1400 * 800) ? 1.5 : 2;
    dpr = Math.min(window.devicePixelRatio || 1, cap);
    fxCanvas.width = Math.round(W * dpr); fxCanvas.height = Math.round(H * dpr);
    if (renderer) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(W, H, false);
      camera.aspect = W / H; camera.fov = W < H ? 52 : 38; camera.updateProjectionMatrix();
      uniforms.px.value = dpr;
    }
    if (paper) {
      paper.renderer.setPixelRatio(dpr);
      paper.renderer.setSize(W, H, false);
      paper.camera.left = -W / 2; paper.camera.right = W / 2; paper.camera.top = H / 2; paper.camera.bottom = -H / 2;
      paper.camera.updateProjectionMatrix();
    }
    pdfMetrics();
    if (renderer) frame(currentT);
  }
  window.addEventListener('resize', onResize);

  /* ------------------------------------------------------------------- go */
  function start() {
    if (finished) return;
    onResize();
    var t0 = performance.now(), slow = 0, last = t0;
    ticking = function () {
      var now = performance.now();
      var t = (now - t0) / 1000;
      // a struggling device gets a lighter picture instead of a stuttering one
      if (now - last > 46) slow++; else slow = Math.max(0, slow - 1);
      last = now;
      if (slow > 8 && dpr > 1) { dpr = 1; slow = 0; onResize(); }
      if (t >= T.end) { frame(T.end); finish(false); return; }
      frame(t);
    };
    if (debug) {
      window.gsap.ticker.remove(ticking);
      window.__introSeek = function (tt) { frame(tt); return true; };
      window.__introTimes = T;
      frame(0);
      window.__introReady = true;
      return;
    }
    window.gsap.ticker.add(ticking);
  }

  Promise.all([loadTexture('earth-day.jpg'), loadTexture('earth-night.jpg'), loadTexture('earth-clouds.jpg')])
    .then(function (tx) {
      try {
        buildScene({ day: tx[0], night: tx[1], clouds: tx[2] });
      } catch (e) { // no WebGL: never block the site
        finish(true); return;
      }
      makePaperTexture().then(function (tex) {
        try { if (tex) buildPaper(tex); } catch (e) { paper = null; }   // without it the photo is drawn flat, as plain SVG
        start();
      });
    })
    .catch(function () { finish(true); });

  // never keep people waiting on a slow network: after 5s without textures, just open the site
  setTimeout(function () { if (!renderer && !finished) finish(true); }, 5000);
}

// Loaded from the head while the page is still being parsed: wait for the overlay markup.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', introMain);
else introMain();

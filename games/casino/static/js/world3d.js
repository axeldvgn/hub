const SALON_CODE = window.CASINO_SALON_CODE;
const MY_USER_ID = window.CASINO_USER_ID;

const ROOM_W = 1320, ROOM_H = 900; // grande salle (avant: 900x600)

const zones = [
  {id:'slots',      name:'MACHINES A SOUS', x:70,  y:100, w:260, h:180, felt:'#5c1035', icon:'🎰'},
  {id:'roulette',   name:'ROULETTE',        x:990, y:100, w:260, h:180, felt:'#0b3d2e', icon:'🎡'},
  {id:'blackjack',  name:'BLACKJACK',       x:70,  y:620, w:260, h:180, felt:'#0b3d2e', icon:'🃏'},
  {id:'dice',       name:'DES',             x:990, y:620, w:260, h:180, felt:'#5c1035', icon:'🎲'},
  {id:'poker',      name:'POKER',           x:530, y:350, w:260, h:180, felt:'#3b2412', icon:'♠️'},
  {id:'boutique',   name:'BOUTIQUE',        x:590, y:70,  w:140, h:90,  felt:'#3c3489', icon:'🛍️'},
];
const promptLabels = {slots:'Machines à sous', roulette:'Roulette', blackjack:'Blackjack', dice:'Dés', poker:'Poker', boutique:'Boutique'};

const player = {x:660, y:750, r:13, speed:190, vel:{x:0,y:0}, speedMag:0, walkCycle:0, facing:{x:0,y:1}};
let nearbyZoneId = null;

const npcEmojis = ['🎩','👗','🕶️','👒','🥂','💃','🕺','🎭','👔','💍'];
const npcColors = ['#e0335c','#2ff1ff','#f3d67a','#8e6bff','#ff8c42','#5cd6c0','#ff6ec7','#c9b8e0','#ffd166','#7dd3a0'];

function circleRectCollide(cx,cy,cr,rx,ry,rw,rh){
  const nearestX = Math.max(rx, Math.min(cx, rx+rw));
  const nearestY = Math.max(ry, Math.min(cy, ry+rh));
  const dx = cx-nearestX, dy = cy-nearestY;
  return (dx*dx+dy*dy) < (cr*cr);
}
function randPosOutsideZones(r){
  let x=660, y=450, ok=false, tries=0;
  while(!ok && tries<200){
    x = 30 + Math.random()*(ROOM_W-60);
    y = 50 + Math.random()*(ROOM_H-100);
    ok = !zones.some(z => circleRectCollide(x,y,r+6,z.x,z.y,z.w,z.h));
    tries++;
  }
  return {x,y};
}
const npcs = [];
for(let i=0;i<12;i++){
  const pos = randPosOutsideZones(10);
  npcs.push({x:pos.x, y:pos.y, vx:0, vy:0, r:10, speedMag:0, walkCycle:0, changeTimer:Math.random()*2, emoji:npcEmojis[i%npcEmojis.length], color:npcColors[i%npcColors.length]});
}

const keys = {up:false, down:false, left:false, right:false};
function setKey(k, val){
  if(['arrowup','z','w'].includes(k)) keys.up = val;
  if(['arrowdown','s'].includes(k)) keys.down = val;
  if(['arrowleft','q','a'].includes(k)) keys.left = val;
  if(['arrowright','d'].includes(k)) keys.right = val;
}
function unlockSoundOnce(){
  if(window.CasinoSound) window.CasinoSound.unlock();
  window.removeEventListener('keydown', unlockSoundOnce);
  window.removeEventListener('pointerdown', unlockSoundOnce);
}
window.addEventListener('keydown', unlockSoundOnce, {once:true});
window.addEventListener('pointerdown', unlockSoundOnce, {once:true});

window.addEventListener('keydown', e=>{
  const k = e.key.toLowerCase();
  setKey(k, true);
  if(k==='e') handleInteract();
  if(k==='escape') closeModal();
});
window.addEventListener('keyup', e=> setKey(e.key.toLowerCase(), false));

function collidesAny(x,y){
  return zones.some(z => circleRectCollide(x,y,player.r,z.x,z.y,z.w,z.h));
}
function updatePlayer(dt){
  let inputForward = 0, inputRight = 0;
  if(keys.up) inputForward += 1;
  if(keys.down) inputForward -= 1;
  if(keys.right) inputRight += 1;
  if(keys.left) inputRight -= 1;

  const fwdX = Math.sin(camYaw), fwdY = Math.cos(camYaw);
  const rightX = -Math.cos(camYaw), rightY = Math.sin(camYaw);
  let dx = fwdX*inputForward + rightX*inputRight;
  let dy = fwdY*inputForward + rightY*inputRight;
  const inputMag = Math.hypot(dx,dy);
  if(inputMag > 1){ dx/=inputMag; dy/=inputMag; }

  const targetVX = dx*player.speed, targetVY = dy*player.speed;
  const accel = 12;
  player.vel.x += (targetVX-player.vel.x)*Math.min(1, accel*dt);
  player.vel.y += (targetVY-player.vel.y)*Math.min(1, accel*dt);
  player.speedMag = Math.hypot(player.vel.x, player.vel.y);
  if(player.speedMag > 4){
    player.facing.x = player.vel.x/player.speedMag;
    player.facing.y = player.vel.y/player.speedMag;
    player.walkCycle += dt*player.speedMag*0.05;
  }

  const nx = player.x + player.vel.x*dt;
  if(nx > player.r+8 && nx < ROOM_W-player.r-8 && !collidesAny(nx, player.y)) player.x = nx; else player.vel.x = 0;
  const ny = player.y + player.vel.y*dt;
  if(ny > player.r+8 && ny < ROOM_H-player.r-8 && !collidesAny(player.x, ny)) player.y = ny; else player.vel.y = 0;

  nearbyZoneId = null;
  for(const z of zones){
    if(circleRectCollide(player.x, player.y, player.r+38, z.x, z.y, z.w, z.h)){ nearbyZoneId = z.id; break; }
  }
}
function updateNPCs(dt){
  npcs.forEach(n=>{
    n.changeTimer -= dt;
    if(n.changeTimer <= 0){
      const angle = Math.random()*Math.PI*2;
      const speed = 18 + Math.random()*22;
      n.vx = Math.cos(angle)*speed;
      n.vy = Math.sin(angle)*speed;
      n.changeTimer = 2 + Math.random()*3;
    }
    n.speedMag = Math.hypot(n.vx, n.vy);
    if(n.speedMag > 3) n.walkCycle += dt*n.speedMag*0.05;
    let nx = n.x + n.vx*dt;
    let ny = n.y + n.vy*dt;
    if(nx < 20 || nx > ROOM_W-20){ n.vx *= -1; nx = n.x; }
    if(ny < 20 || ny > ROOM_H-20){ n.vy *= -1; ny = n.y; }
    if(zones.some(z => circleRectCollide(nx, ny, n.r, z.x, z.y, z.w, z.h))){
      n.vx *= -1; n.vy *= -1;
    } else { n.x = nx; n.y = ny; }
  });
}

const WORLD_SCALE = 30;
function toWorldX(x){ return x/WORLD_SCALE - ROOM_W/WORLD_SCALE/2; }
function toWorldZ(y){ return y/WORLD_SCALE - ROOM_H/WORLD_SCALE/2; }

function makeCarpetTexture(){
  const c = document.createElement('canvas'); c.width=128; c.height=128;
  const cx = c.getContext('2d');
  cx.fillStyle = '#241338'; cx.fillRect(0,0,128,128);
  cx.strokeStyle = 'rgba(212,175,55,0.14)'; cx.lineWidth = 2;
  for(let i=-128;i<256;i+=24){
    cx.beginPath(); cx.moveTo(i,0); cx.lineTo(i+128,128); cx.stroke();
    cx.beginPath(); cx.moveTo(i,128); cx.lineTo(i+128,0); cx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14,10);
  return tex;
}
function makeWallTexture(){
  const c = document.createElement('canvas'); c.width=256; c.height=256;
  const cx = c.getContext('2d');
  cx.fillStyle = '#241030'; cx.fillRect(0,0,256,256);
  cx.fillStyle = '#1c0c26'; cx.fillRect(0,150,256,106);
  cx.fillStyle = '#d4af37'; cx.fillRect(0,146,256,4);
  cx.strokeStyle = 'rgba(212,175,55,0.35)'; cx.lineWidth = 3;
  for(let x=0;x<=256;x+=64){
    cx.beginPath(); cx.moveTo(x,0); cx.lineTo(x,146); cx.stroke();
    cx.beginPath(); cx.moveTo(x,150); cx.lineTo(x,256); cx.stroke();
  }
  cx.strokeStyle = 'rgba(212,175,55,0.1)'; cx.lineWidth = 1;
  for(let i=-256;i<512;i+=32){
    cx.beginPath(); cx.moveTo(i,0); cx.lineTo(i+146,146); cx.stroke();
    cx.beginPath(); cx.moveTo(i,146); cx.lineTo(i+146,0); cx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(13,1);
  return tex;
}
function makeCeilingTexture(){
  const c = document.createElement('canvas'); c.width=256; c.height=256;
  const cx = c.getContext('2d');
  cx.fillStyle = '#150a22'; cx.fillRect(0,0,256,256);
  cx.strokeStyle = 'rgba(212,175,55,0.4)'; cx.lineWidth = 4;
  for(let i=0;i<=256;i+=64){
    cx.beginPath(); cx.moveTo(i,0); cx.lineTo(i,256); cx.stroke();
    cx.beginPath(); cx.moveTo(0,i); cx.lineTo(256,i); cx.stroke();
  }
  cx.fillStyle = 'rgba(0,0,0,0.3)';
  for(let x=6;x<256;x+=64){ for(let y=6;y<256;y+=64){ cx.fillRect(x,y,52,52); } }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9,6);
  return tex;
}
function makeArtTexture(hue1,hue2){
  const c = document.createElement('canvas'); c.width=128; c.height=96;
  const cx = c.getContext('2d');
  const grad = cx.createRadialGradient(64,48,4,64,48,80);
  grad.addColorStop(0,hue1); grad.addColorStop(1,hue2);
  cx.fillStyle = grad; cx.fillRect(0,0,128,96);
  cx.strokeStyle = 'rgba(212,175,55,0.5)'; cx.lineWidth = 2;
  for(let i=0;i<4;i++){
    cx.beginPath();
    cx.ellipse(30+Math.random()*68, 24+Math.random()*48, 14+Math.random()*16, 8+Math.random()*10, Math.random()*Math.PI, 0, Math.PI*2);
    cx.stroke();
  }
  return new THREE.CanvasTexture(c);
}
function makeFramedArt(x,y,z,rotY,hue1,hue2){
  const group = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5,1.1,0.06), new THREE.MeshStandardMaterial({color:0xd4af37, roughness:0.35, metalness:0.55}));
  group.add(frame);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(1.3,0.9), new THREE.MeshStandardMaterial({map:makeArtTexture(hue1,hue2), roughness:0.8}));
  art.position.z = 0.035;
  group.add(art);
  group.position.set(x,y,z);
  group.rotation.y = rotY;
  scene.add(group);
}
function makeSconce(x,y,z,rotY){
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.12,0.3,0.1), new THREE.MeshStandardMaterial({color:0xd4af37, roughness:0.4, metalness:0.5}));
  group.add(base);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09,8,8), new THREE.MeshStandardMaterial({color:0xfff3d0, emissive:0xf3d67a, emissiveIntensity:1.1}));
  bulb.position.set(0,0.05,0.12);
  group.add(bulb);
  group.position.set(x,y,z);
  group.rotation.y = rotY;
  scene.add(group);
}
function buildChandelier(x,y,z){
  const group = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1,0.06,8,24), new THREE.MeshStandardMaterial({color:0xd4af37, emissive:0x3a2c08, roughness:0.35, metalness:0.6}));
  ring.rotation.x = Math.PI/2;
  group.add(ring);
  for(let i=0;i<8;i++){
    const a = (i/8)*Math.PI*2;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08,8,8), new THREE.MeshStandardMaterial({color:0xfff3d0, emissive:0xf3d67a, emissiveIntensity:1.2}));
    bulb.position.set(Math.cos(a)*1.1, -0.05, Math.sin(a)*1.1);
    group.add(bulb);
  }
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,0.6,6), new THREE.MeshStandardMaterial({color:0x8a6d1f}));
  chain.position.y = 0.35;
  group.add(chain);
  group.position.set(x,y,z);
  scene.add(group);
  const light = new THREE.PointLight(0xf3d67a, 1.1, 13, 2);
  light.position.set(x, y-0.2, z);
  scene.add(light);
}
function makeLabelSprite(icon, text){
  const c = document.createElement('canvas'); c.width=256; c.height=160;
  const cx = c.getContext('2d');
  cx.textAlign = 'center';
  cx.font = '72px sans-serif';
  cx.fillText(icon, 128, 84);
  cx.font = "700 24px Inter, sans-serif";
  cx.fillStyle = '#f3d67a';
  cx.fillText(text, 128, 138);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({map:tex, transparent:true, depthWrite:false});
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.2, 2.0, 1);
  return sprite;
}
function makeFaceTexture(){
  const c = document.createElement('canvas'); c.width=128; c.height=128;
  const cx = c.getContext('2d');
  cx.clearRect(0,0,128,128);
  cx.fillStyle = '#1b1b1b';
  cx.beginPath(); cx.arc(44,54,9,0,Math.PI*2); cx.fill();
  cx.beginPath(); cx.arc(84,54,9,0,Math.PI*2); cx.fill();
  cx.fillStyle = '#ffffff';
  cx.beginPath(); cx.arc(47,51,3,0,Math.PI*2); cx.fill();
  cx.beginPath(); cx.arc(87,51,3,0,Math.PI*2); cx.fill();
  cx.strokeStyle = '#1b1b1b'; cx.lineWidth = 6; cx.lineCap = 'round';
  cx.beginPath(); cx.arc(64,58,26,0.15*Math.PI,0.85*Math.PI); cx.stroke();
  return new THREE.CanvasTexture(c);
}
function makeCharacter(colorHex){
  const group = new THREE.Group();
  const col = new THREE.Color(colorHex);
  const bodyMat = new THREE.MeshStandardMaterial({color:col, roughness:0.6, emissive:col.clone().multiplyScalar(0.15)});
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.34,0.5,12), bodyMat);
  body.position.y = 0.75;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26,12,10), bodyMat);
  head.position.y = 1.31;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3,0.3),
    new THREE.MeshBasicMaterial({map:makeFaceTexture(), transparent:true, depthWrite:false, side:THREE.DoubleSide})
  );
  face.position.set(0,1.32,0.25);

  function makeLimb(x, pivotY, length, radiusTop, radiusBottom){
    const pivot = new THREE.Group();
    pivot.position.set(x, pivotY, 0);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 8), bodyMat);
    mesh.castShadow = true;
    mesh.position.y = -length/2;
    pivot.add(mesh);
    return pivot;
  }
  const armL = makeLimb(-0.38, 1.0, 0.48, 0.07, 0.06);
  const armR = makeLimb(0.38, 1.0, 0.48, 0.07, 0.06);
  const legL = makeLimb(-0.14, 0.5, 0.5, 0.1, 0.08);
  const legR = makeLimb(0.14, 0.5, 0.5, 0.1, 0.08);

  group.add(body); group.add(head); group.add(face);
  group.add(armL); group.add(armR); group.add(legL); group.add(legR);
  group.userData.bodyMat = bodyMat;
  group.userData.armL = armL; group.userData.armR = armR;
  group.userData.legL = legL; group.userData.legR = legR;
  return group;
}
function makeBlobShadow(){
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 20),
    new THREE.MeshBasicMaterial({color:0x000000, transparent:true, opacity:0.32, depthWrite:false})
  );
  mesh.rotation.x = -Math.PI/2;
  mesh.position.y = 0.015;
  scene.add(mesh);
  return mesh;
}

const container = document.getElementById('floorContainer');
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setSize(container.clientWidth||900, container.clientHeight||600);
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x120a1e);
scene.fog = new THREE.Fog(0x120a1e, 22, 54);

const camera = new THREE.PerspectiveCamera(58, (container.clientWidth||900)/(container.clientHeight||600), 0.1, 200);

const resizeObserver = new ResizeObserver(entries=>{
  for(const entry of entries){
    const w = Math.round(entry.contentRect.width);
    const h = Math.round(entry.contentRect.height);
    if(w > 0 && h > 0){
      renderer.setSize(w, h);
      camera.aspect = w/h;
      camera.updateProjectionMatrix();
    }
  }
});
resizeObserver.observe(container);

scene.add(new THREE.AmbientLight(0x4b3866, 0.5));
scene.add(new THREE.HemisphereLight(0x6a4d99, 0x0a0512, 0.5));
const sun = new THREE.DirectionalLight(0xffe3b0, 0.6);
sun.position.set(8,14,6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024,1024);
sun.shadow.camera.left=-18; sun.shadow.camera.right=18; sun.shadow.camera.top=12; sun.shadow.camera.bottom=-12;
sun.shadow.camera.near=1; sun.shadow.camera.far=40;
scene.add(sun);
const pinkLight = new THREE.PointLight(0xff2e8f,0.6,10,2); pinkLight.position.set(-3,2,0); scene.add(pinkLight);
const cyanLight = new THREE.PointLight(0x2ff1ff,0.6,10,2); cyanLight.position.set(3,2,0); scene.add(cyanLight);

const FLOOR_W = ROOM_W/WORLD_SCALE, FLOOR_D = ROOM_H/WORLD_SCALE; // 44 x 30
const HALF_W = FLOOR_W/2, HALF_D = FLOOR_D/2;

const floorMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(FLOOR_W, FLOOR_D),
  new THREE.MeshStandardMaterial({map:makeCarpetTexture(), roughness:0.75, metalness:0.05})
);
floorMesh.rotation.x = -Math.PI/2;
floorMesh.receiveShadow = true;
scene.add(floorMesh);

const WALL_HEIGHT = 5.6; // salle beaucoup plus haute (avant: 3.2)
const ceilingMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(FLOOR_W, FLOOR_D),
  new THREE.MeshStandardMaterial({map:makeCeilingTexture(), roughness:0.95})
);
ceilingMesh.rotation.x = Math.PI/2;
ceilingMesh.position.y = WALL_HEIGHT;
scene.add(ceilingMesh);
buildChandelier(0, WALL_HEIGHT-0.5, 0);
buildChandelier(-HALF_W*0.45, WALL_HEIGHT-0.5, 0);
buildChandelier(HALF_W*0.45, WALL_HEIGHT-0.5, 0);

const wallMat = new THREE.MeshStandardMaterial({map:makeWallTexture(), roughness:0.85});
const trimMat = new THREE.MeshStandardMaterial({color:0xd4af37, emissive:0x2a1d05, roughness:0.4, metalness:0.5});
const wallSpecs = [
  {w:FLOOR_W, h:WALL_HEIGHT, d:0.3, x:0, z:-(HALF_D+0.15)},
  {w:FLOOR_W, h:WALL_HEIGHT, d:0.3, x:0, z:HALF_D+0.15},
  {w:0.3, h:WALL_HEIGHT, d:FLOOR_D, x:-(HALF_W+0.15), z:0},
  {w:0.3, h:WALL_HEIGHT, d:FLOOR_D, x:HALF_W+0.15, z:0},
];
wallSpecs.forEach(s=>{
  const wall = new THREE.Mesh(new THREE.BoxGeometry(s.w,s.h,s.d), wallMat);
  wall.position.set(s.x, s.h/2, s.z);
  wall.receiveShadow = true; wall.castShadow = true;
  scene.add(wall);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(s.w+0.05, 0.08, s.d+0.05), trimMat);
  trim.position.set(s.x, s.h+0.04, s.z);
  scene.add(trim);
});
const artZ = HALF_D - 0.03;
[-HALF_W*0.75, -HALF_W*0.35, HALF_W*0.35, HALF_W*0.75].forEach((x,i)=>{
  const hues = [['#a3294f','#241030'],['#0f6e56','#241030'],['#534ab7','#241030'],['#993c1d','#241030']];
  makeFramedArt(x, 2.6, -artZ, 0, hues[i][0], hues[i][1]);
  makeFramedArt(x, 2.6, artZ, Math.PI, hues[(i+2)%4][0], hues[(i+2)%4][1]);
});
const sconceXs = [-HALF_W*0.85, -HALF_W*0.5, -HALF_W*0.15, HALF_W*0.15, HALF_W*0.5, HALF_W*0.85];
sconceXs.forEach(x=>{
  makeSconce(x, 2.6, -(HALF_D-0.08), 0);
  makeSconce(x, 2.6, HALF_D-0.08, Math.PI);
});

// Piliers dorés aux quatre coins, du sol au plafond
[[-HALF_W+1.2,-HALF_D+1.2],[HALF_W-1.2,-HALF_D+1.2],[-HALF_W+1.2,HALF_D-1.2],[HALF_W-1.2,HALF_D-1.2]].forEach(([px,pz])=>{
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35,0.4,WALL_HEIGHT,10),
    new THREE.MeshStandardMaterial({color:0x2a1a3d, roughness:0.6, metalness:0.15})
  );
  pillar.position.set(px, WALL_HEIGHT/2, pz);
  pillar.castShadow = true; pillar.receiveShadow = true;
  scene.add(pillar);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.46,0.46,0.14,10), trimMat);
  cap.position.set(px, WALL_HEIGHT-0.07, pz);
  scene.add(cap);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.46,0.5,0.16,10), trimMat);
  base.position.set(px, 0.08, pz);
  scene.add(base);
});

zones.forEach(z=>{
  const wx = toWorldX(z.x+z.w/2), wz = toWorldZ(z.y+z.h/2);
  const ww = z.w/WORLD_SCALE, wh = z.h/WORLD_SCALE;
  const pit = new THREE.Mesh(new THREE.BoxGeometry(ww,0.06,wh), new THREE.MeshStandardMaterial({color:z.felt, roughness:0.9}));
  pit.position.set(wx,0.03,wz);
  pit.receiveShadow = true;
  scene.add(pit);

  const zLight = new THREE.PointLight(0xf3d67a, 0.9, 9, 2);
  zLight.position.set(wx, 2.6, wz);
  scene.add(zLight);

  const spot = new THREE.Mesh(new THREE.CircleGeometry(0.35,16), new THREE.MeshStandardMaterial({color:0xfff3d0, emissive:0xf3d67a, emissiveIntensity:0.9}));
  spot.rotation.x = Math.PI/2;
  spot.position.set(wx, WALL_HEIGHT-0.02, wz);
  scene.add(spot);

  const tableGeo = new THREE.BoxGeometry(ww*0.5, 0.85, wh*0.5);
  const table = new THREE.Mesh(tableGeo, new THREE.MeshStandardMaterial({color:z.felt, roughness:0.5, metalness:0.1}));
  table.position.set(wx, 0.425, wz);
  table.castShadow = true; table.receiveShadow = true;
  scene.add(table);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(tableGeo), new THREE.LineBasicMaterial({color:0xd4af37}));
  edges.position.copy(table.position);
  scene.add(edges);

  const label = makeLabelSprite(z.icon, z.name);
  label.position.set(wx, 2.35, wz);
  scene.add(label);
});

const MY_SKIN_COLOR = (typeof window.CASINO_MY_SKIN_COLOR === 'string') ? parseInt(window.CASINO_MY_SKIN_COLOR, 16) : 0xff2e8f;
const playerMesh = makeCharacter(MY_SKIN_COLOR);
playerMesh.traverse(o=>{ if(o.isMesh) o.castShadow = true; });
const playerRing = new THREE.Mesh(new THREE.TorusGeometry(0.5,0.05,8,24), new THREE.MeshStandardMaterial({color:0xf3d67a, emissive:0x6b551a}));
playerRing.rotation.x = Math.PI/2; playerRing.position.y = 0.05;
playerMesh.add(playerRing);
scene.add(playerMesh);
const playerBlob = makeBlobShadow();
window.__casinoApplySkin = function(colorValue){
  const hex = typeof colorValue === 'string' ? parseInt(colorValue, 16) : colorValue;
  if(!Number.isFinite(hex)) return;
  const mat = playerMesh.userData.bodyMat;
  mat.color.set(hex);
  mat.emissive.copy(new THREE.Color(hex)).multiplyScalar(0.15);
};

const npcMeshes = npcs.map(n=>{
  const m = makeCharacter(n.color);
  m.traverse(o=>{ if(o.isMesh) o.castShadow = true; });
  scene.add(m);
  return m;
});
const npcBlobs = npcs.map(()=> makeBlobShadow());

// Figurines assises aux tables, reconstruites depuis l'occupation reelle
// (sondee en tache de fond) : visibles en marchant, meme sans avoir encore
// ouvert la table.
const seatFigures = {};
function ensureSeatCapacity(gameType, count){
  seatFigures[gameType] = seatFigures[gameType] || [];
  const figs = seatFigures[gameType];
  while(figs.length < count){
    const mesh = makeCharacter(0x888888);
    mesh.scale.set(0.7,0.7,0.7);
    mesh.visible = false;
    scene.add(mesh);
    const blob = makeBlobShadow();
    blob.visible = false;
    figs.push({mesh, blob});
  }
}
function updateTableOccupancy(occupancyByGameType){
  zones.forEach(z=>{
    const list = (occupancyByGameType && occupancyByGameType[z.id]) || [];
    ensureSeatCapacity(z.id, 5);
    const figs = seatFigures[z.id];
    const cx = toWorldX(z.x+z.w/2), cz = toWorldZ(z.y+z.h/2);
    const radius = Math.max(z.w, z.h)/WORLD_SCALE/2 + 1.0;
    for(let i=0;i<5;i++){
      const fig = figs[i];
      const occ = list[i];
      if(!occ){ fig.mesh.visible = false; fig.blob.visible = false; continue; }
      const angle = (i/5)*Math.PI*2 - Math.PI/2;
      const wx = cx + Math.cos(angle)*radius;
      const wz = cz + Math.sin(angle)*radius;
      fig.mesh.position.set(wx, 0, wz);
      fig.mesh.rotation.y = Math.atan2(cx-wx, cz-wz);
      fig.mesh.visible = true;
      fig.blob.position.set(wx, 0.015, wz);
      fig.blob.visible = true;
      const color = occ.is_bot ? 0x8e6bff : (typeof occ.color === 'string' ? parseInt(occ.color, 16) : 0x2ff1ff);
      const mat = fig.mesh.userData.bodyMat;
      if(mat.color.getHex() !== color){
        mat.color.set(color);
        mat.emissive.copy(new THREE.Color(color)).multiplyScalar(0.15);
      }
    }
  });
}
async function pollOccupancy(){
  try{
    const res = await fetch(`/casino/api/salon/${SALON_CODE}/state`);
    if(res.ok){
      const data = await res.json();
      updateTableOccupancy(data.tables);
    }
  } catch(e){}
}
pollOccupancy();
setInterval(pollOccupancy, 3000);

let camYaw = 0;
let cameraDistance = 6.5;
let isDragging = false;
let dragLastX = 0;
const camLook = new THREE.Vector3();

const domEl = renderer.domElement;
domEl.style.touchAction = 'none';
domEl.style.cursor = 'grab';
domEl.addEventListener('pointerdown', e=>{ isDragging=true; dragLastX=e.clientX; domEl.style.cursor='grabbing'; });
window.addEventListener('pointermove', e=>{ if(!isDragging) return; const dx=e.clientX-dragLastX; dragLastX=e.clientX; camYaw -= dx*0.008; });
window.addEventListener('pointerup', ()=>{ isDragging=false; domEl.style.cursor='grab'; });
domEl.addEventListener('pointercancel', ()=>{ isDragging=false; domEl.style.cursor='grab'; });
domEl.addEventListener('wheel', e=>{ e.preventDefault(); cameraDistance = Math.min(14, Math.max(3, cameraDistance + e.deltaY*0.006)); }, {passive:false});

function updateCamera(dt, instant){
  const px = toWorldX(player.x), pz = toWorldZ(player.y);

  if(!isDragging && player.speedMag > 4){
    const targetYaw = Math.atan2(player.facing.x, player.facing.y);
    let diff = targetYaw - camYaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    camYaw += diff * Math.min(1, dt*2.2);
  }

  const fx = Math.sin(camYaw), fy = Math.cos(camYaw);

  const desiredPos = new THREE.Vector3(px - fx*cameraDistance, 1.7 + cameraDistance*0.13, pz - fy*cameraDistance);
  const desiredLook = new THREE.Vector3(px + fx*0.8, 1.05, pz + fy*0.8);
  if(instant){
    camera.position.copy(desiredPos);
    camLook.copy(desiredLook);
  } else {
    camera.position.lerp(desiredPos, 0.09);
    camLook.lerp(desiredLook, 0.12);
  }
  camera.lookAt(camLook);
}
updateCamera(1/60, true);

let lastNearby = undefined;
function updatePrompt(){
  if(nearbyZoneId === lastNearby) return;
  lastNearby = nearbyZoneId;
  const el = document.getElementById('interactPrompt');
  if(nearbyZoneId){
    el.textContent = '⌨ E — ' + promptLabels[nearbyZoneId];
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function swingLimbs(ud, walking, cycle, amp){
  const swing = walking ? Math.sin(cycle)*amp : 0;
  ud.armL.rotation.x = swing;
  ud.armR.rotation.x = -swing;
  ud.legL.rotation.x = -swing;
  ud.legR.rotation.x = swing;
}

function renderThree(dt){
  const pWalking = player.speedMag>4;
  const pBob = pWalking ? Math.abs(Math.sin(player.walkCycle))*0.09 : 0;
  playerMesh.position.set(toWorldX(player.x), pBob, toWorldZ(player.y));
  playerMesh.rotation.y = Math.atan2(player.facing.x, player.facing.y);
  playerMesh.rotation.z = pWalking ? Math.sin(player.walkCycle*1.3)*0.05 : 0;
  swingLimbs(playerMesh.userData, pWalking, player.walkCycle, 0.6);
  playerBlob.position.set(toWorldX(player.x), 0.015, toWorldZ(player.y));

  npcMeshes.forEach((mesh,i)=>{
    const n = npcs[i];
    const nWalking = n.speedMag>3;
    const bob = nWalking ? Math.abs(Math.sin(n.walkCycle))*0.07 : 0;
    mesh.position.set(toWorldX(n.x), bob, toWorldZ(n.y));
    if(nWalking) mesh.rotation.y = Math.atan2(n.vx, n.vy);
    swingLimbs(mesh.userData, nWalking, n.walkCycle, 0.5);
    npcBlobs[i].position.set(toWorldX(n.x), 0.015, toWorldZ(n.y));
  });

  updateCamera(dt, false);
  renderer.render(scene, camera);
}

let rafId = null;
let lastTime = performance.now();
function loop(now){
  const dt = Math.min((now-lastTime)/1000, 0.05);
  lastTime = now;
  updatePlayer(dt);
  updateNPCs(dt);
  updatePrompt();
  renderThree(dt);
  rafId = requestAnimationFrame(loop);
}
rafId = requestAnimationFrame(loop);

const modalOverlay = document.getElementById('modalOverlay');
const closeModalBtn = document.getElementById('closeModalBtn');
let currentGameHandle = null;
let currentGameType = null;

function handleInteract(){
  if(!nearbyZoneId) return;
  openGame(nearbyZoneId);
}
async function openGame(gameType){
  if(currentGameType === gameType && !modalOverlay.classList.contains('hidden')) return;
  cancelAnimationFrame(rafId);
  if(currentGameHandle){ currentGameHandle.stop(); currentGameHandle = null; }
  if(gameType !== 'boutique'){
    try {
      await fetch(`/casino/api/salon/${SALON_CODE}/${gameType}/sit`, {method:'POST'});
    } catch(e){}
  }
  document.querySelectorAll('.game-panel-mount').forEach(el => el.hidden = true);
  const root = document.getElementById('panel-' + gameType);
  root.hidden = false;
  modalOverlay.classList.remove('hidden');
  currentGameType = gameType;
  currentGameHandle = window.CasinoGames[gameType](root, SALON_CODE, MY_USER_ID);
}
function closeModal(){
  if(modalOverlay.classList.contains('hidden')) return;
  if(currentGameHandle){ currentGameHandle.stop(); currentGameHandle = null; }
  currentGameType = null;
  modalOverlay.classList.add('hidden');
  lastTime = performance.now();
  rafId = requestAnimationFrame(loop);
}
window.__casinoCloseModal = closeModal;
closeModalBtn.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e=>{ if(e.target === modalOverlay) closeModal(); });

const toastEl = document.getElementById('toast');
let toastTimer = null;
function showToast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> toastEl.classList.remove('show'), 2600);
}

const fullscreenBtn = document.getElementById('fullscreenBtn');
function isFullscreen(){
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}
function updateFullscreenBtn(){
  const active = isFullscreen();
  fullscreenBtn.textContent = active ? '⤢' : '⛶';
  fullscreenBtn.title = active ? 'Quitter le plein écran' : 'Plein écran';
}
fullscreenBtn.addEventListener('click', ()=>{
  if(!isFullscreen()){
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if(req) req.call(el);
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if(exit) exit.call(document);
  }
});
document.addEventListener('fullscreenchange', updateFullscreenBtn);
document.addEventListener('webkitfullscreenchange', updateFullscreenBtn);

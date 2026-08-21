const SALON_CODE = window.CASINO_SALON_CODE;
const MY_USER_ID = window.CASINO_USER_ID;

const zones = [
  {id:'slots',      name:'MACHINES A SOUS', x:40,  y:70,  w:220, h:150, felt:'#5c1035', icon:'🎰'},
  {id:'roulette',   name:'ROULETTE',        x:640, y:70,  w:220, h:150, felt:'#0b3d2e', icon:'🎡'},
  {id:'blackjack',  name:'BLACKJACK',       x:40,  y:390, w:220, h:150, felt:'#0b3d2e', icon:'🃏'},
  {id:'dice',       name:'DES',             x:640, y:390, w:220, h:150, felt:'#5c1035', icon:'🎲'},
  {id:'poker',      name:'POKER',           x:345, y:230, w:210, h:140, felt:'#3b2412', icon:'♠️'},
];
const promptLabels = {slots:'Machines à sous', roulette:'Roulette', blackjack:'Blackjack', dice:'Dés', poker:'Poker'};

const player = {x:450, y:560, r:13, speed:170, vel:{x:0,y:0}, speedMag:0, walkCycle:0, facing:{x:0,y:1}};
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
  let x=450, y=300, ok=false, tries=0;
  while(!ok && tries<200){
    x = 24 + Math.random()*852;
    y = 60 + Math.random()*500;
    ok = !zones.some(z => circleRectCollide(x,y,r+6,z.x,z.y,z.w,z.h));
    tries++;
  }
  return {x,y};
}
const npcs = [];
for(let i=0;i<8;i++){
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
  if(nx > player.r+8 && nx < 900-player.r-8 && !collidesAny(nx, player.y)) player.x = nx; else player.vel.x = 0;
  const ny = player.y + player.vel.y*dt;
  if(ny > player.r+8 && ny < 600-player.r-8 && !collidesAny(player.x, ny)) player.y = ny; else player.vel.y = 0;

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
    if(nx < 20 || nx > 880){ n.vx *= -1; nx = n.x; }
    if(ny < 20 || ny > 580){ n.vy *= -1; ny = n.y; }
    if(zones.some(z => circleRectCollide(nx, ny, n.r, z.x, z.y, z.w, z.h))){
      n.vx *= -1; n.vy *= -1;
    } else { n.x = nx; n.y = ny; }
  });
}

const WORLD_SCALE = 30;
function toWorldX(x){ return x/WORLD_SCALE - 15; }
function toWorldZ(y){ return y/WORLD_SCALE - 10; }

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
  tex.repeat.set(10,7);
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
  tex.repeat.set(9,1);
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
  tex.repeat.set(6,4);
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
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32,0.36,0.9,12), bodyMat);
  body.position.y = 0.55;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28,12,10), bodyMat);
  head.position.y = 1.15;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.32,0.32),
    new THREE.MeshBasicMaterial({map:makeFaceTexture(), transparent:true, depthWrite:false, side:THREE.DoubleSide})
  );
  face.position.set(0,1.16,0.27);
  group.add(body); group.add(head); group.add(face);
  group.userData.bodyMat = bodyMat;
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
scene.fog = new THREE.Fog(0x120a1e, 16, 38);

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

const floorMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(30,20),
  new THREE.MeshStandardMaterial({map:makeCarpetTexture(), roughness:1})
);
floorMesh.rotation.x = -Math.PI/2;
floorMesh.receiveShadow = true;
scene.add(floorMesh);

const WALL_HEIGHT = 3.2;
const ceilingMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(30,20),
  new THREE.MeshStandardMaterial({map:makeCeilingTexture(), roughness:0.95})
);
ceilingMesh.rotation.x = Math.PI/2;
ceilingMesh.position.y = WALL_HEIGHT;
scene.add(ceilingMesh);
buildChandelier(0, WALL_HEIGHT-0.3, 0);

const wallMat = new THREE.MeshStandardMaterial({map:makeWallTexture(), roughness:0.85});
const trimMat = new THREE.MeshStandardMaterial({color:0xd4af37, emissive:0x2a1d05, roughness:0.4, metalness:0.5});
const wallSpecs = [
  {w:30, h:WALL_HEIGHT, d:0.3, x:0, z:-10.15},
  {w:30, h:WALL_HEIGHT, d:0.3, x:0, z:10.15},
  {w:0.3, h:WALL_HEIGHT, d:20, x:-15.15, z:0},
  {w:0.3, h:WALL_HEIGHT, d:20, x:15.15, z:0},
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
makeFramedArt(-9, 1.7, -9.97, 0, '#a3294f', '#241030');
makeFramedArt(9, 1.7, -9.97, 0, '#0f6e56', '#241030');
makeFramedArt(-9, 1.7, 9.97, Math.PI, '#534ab7', '#241030');
makeFramedArt(9, 1.7, 9.97, Math.PI, '#993c1d', '#241030');
[-9,-4.5,4.5,9].forEach(x=>{
  makeSconce(x, 1.7, -9.9, 0);
  makeSconce(x, 1.7, 9.9, Math.PI);
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

const playerMesh = makeCharacter(0xff2e8f);
playerMesh.traverse(o=>{ if(o.isMesh) o.castShadow = true; });
const playerRing = new THREE.Mesh(new THREE.TorusGeometry(0.5,0.05,8,24), new THREE.MeshStandardMaterial({color:0xf3d67a, emissive:0x6b551a}));
playerRing.rotation.x = Math.PI/2; playerRing.position.y = 0.05;
playerMesh.add(playerRing);
scene.add(playerMesh);
const playerBlob = makeBlobShadow();

const npcMeshes = npcs.map(n=>{
  const m = makeCharacter(n.color);
  m.traverse(o=>{ if(o.isMesh) o.castShadow = true; });
  scene.add(m);
  return m;
});
const npcBlobs = npcs.map(()=> makeBlobShadow());

let camYaw = 0;
let cameraDistance = 5;
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
domEl.addEventListener('wheel', e=>{ e.preventDefault(); cameraDistance = Math.min(9, Math.max(3, cameraDistance + e.deltaY*0.006)); }, {passive:false});

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

function renderThree(dt){
  const pBob = player.speedMag>4 ? Math.abs(Math.sin(player.walkCycle))*0.09 : 0;
  playerMesh.position.set(toWorldX(player.x), pBob, toWorldZ(player.y));
  playerMesh.rotation.y = Math.atan2(player.facing.x, player.facing.y);
  playerMesh.rotation.z = player.speedMag>4 ? Math.sin(player.walkCycle*1.3)*0.05 : 0;
  playerBlob.position.set(toWorldX(player.x), 0.015, toWorldZ(player.y));

  npcMeshes.forEach((mesh,i)=>{
    const n = npcs[i];
    const bob = n.speedMag>3 ? Math.abs(Math.sin(n.walkCycle))*0.07 : 0;
    mesh.position.set(toWorldX(n.x), bob, toWorldZ(n.y));
    if(n.speedMag > 3) mesh.rotation.y = Math.atan2(n.vx, n.vy);
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
  try {
    await fetch(`/casino/api/salon/${SALON_CODE}/${gameType}/sit`, {method:'POST'});
  } catch(e){}
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

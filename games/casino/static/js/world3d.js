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

  // Bassin : relie les jambes au torse au lieu de les laisser flotter sous un cylindre unique.
  const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.27,0.22,0.22,12), bodyMat);
  hips.position.y = 0.55;
  hips.castShadow = true;

  // Torse plus large aux epaules qu'a la taille, pour une silhouette humaine.
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.32,0.25,0.5,12), bodyMat);
  torso.position.y = 0.9;
  torso.castShadow = true;

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.1,0.14,10), bodyMat);
  neck.position.y = 1.22;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24,14,12), bodyMat);
  head.position.y = 1.53;
  head.castShadow = true;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.28,0.28),
    new THREE.MeshBasicMaterial({map:makeFaceTexture(), transparent:true, depthWrite:false, side:THREE.DoubleSide})
  );
  face.position.set(0,1.54,0.22);

  function makeLimb(x, pivotY, length, radiusTop, radiusBottom, tipMesh){
    const pivot = new THREE.Group();
    pivot.position.set(x, pivotY, 0);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 8), bodyMat);
    mesh.castShadow = true;
    mesh.position.y = -length/2;
    pivot.add(mesh);
    tipMesh.position.y = -length;
    tipMesh.castShadow = true;
    pivot.add(tipMesh);
    return pivot;
  }
  const handL = new THREE.Mesh(new THREE.SphereGeometry(0.075,8,8), bodyMat);
  const handR = new THREE.Mesh(new THREE.SphereGeometry(0.075,8,8), bodyMat);
  const footL = new THREE.Mesh(new THREE.BoxGeometry(0.15,0.08,0.24), bodyMat);
  const footR = new THREE.Mesh(new THREE.BoxGeometry(0.15,0.08,0.24), bodyMat);
  const armL = makeLimb(-0.38, 1.08, 0.46, 0.07, 0.06, handL);
  const armR = makeLimb(0.38, 1.08, 0.46, 0.07, 0.06, handR);
  const legL = makeLimb(-0.14, 0.5, 0.5, 0.1, 0.08, footL);
  const legR = makeLimb(0.14, 0.5, 0.5, 0.1, 0.08, footR);
  footL.position.z = 0.05; footR.position.z = 0.05;
  footL.position.y += 0.04; footR.position.y += 0.04;

  group.add(hips); group.add(torso); group.add(neck); group.add(head); group.add(face);
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

// ---------------------------------------------------------------------------
// Décors spécifiques par jeu — chaque table a son propre mobilier détaillé
// ---------------------------------------------------------------------------
const wheelSpins = [];

function makeChipStack(x,y,z,colors){
  const group = new THREE.Group();
  colors.forEach((color,i)=>{
    const chip = new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.09,0.022,16), new THREE.MeshStandardMaterial({color, roughness:0.35, metalness:0.25}));
    chip.position.y = i*0.024;
    chip.castShadow = true;
    group.add(chip);
  });
  group.position.set(x,y,z);
  scene.add(group);
  return group;
}
function makeCardDeck(x,y,z,rotY){
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.26,0.05,0.38), new THREE.MeshStandardMaterial({color:0xf5f0e6, roughness:0.5}));
  deck.position.set(x,y,z);
  deck.rotation.y = rotY||0;
  deck.castShadow = true; deck.receiveShadow = true;
  scene.add(deck);
  const topCard = new THREE.Mesh(new THREE.PlaneGeometry(0.24,0.36), new THREE.MeshStandardMaterial({color:0xffffff, roughness:0.4}));
  topCard.rotation.x = -Math.PI/2;
  topCard.rotation.z = rotY||0;
  topCard.position.set(x, y+0.026, z);
  scene.add(topCard);
}
function makeDie(x,y,z,size){
  const die = new THREE.Mesh(new THREE.BoxGeometry(size,size,size), new THREE.MeshStandardMaterial({color:0xf5f0e6, roughness:0.4}));
  die.position.set(x,y,z);
  die.rotation.set(Math.random()*0.6-0.3, Math.random()*Math.PI, Math.random()*0.6-0.3);
  die.castShadow = true;
  scene.add(die);
}
function makeWheelTexture(){
  const c = document.createElement('canvas'); c.width=256; c.height=256;
  const cx = c.getContext('2d');
  cx.translate(128,128);
  const slices = 37;
  for(let i=0;i<slices;i++){
    const a0 = (i/slices)*Math.PI*2, a1 = ((i+1)/slices)*Math.PI*2;
    cx.beginPath(); cx.moveTo(0,0); cx.arc(0,0,124,a0,a1); cx.closePath();
    cx.fillStyle = i===0 ? '#0b6e46' : (i%2===0 ? '#7a1224' : '#161616');
    cx.fill();
  }
  cx.strokeStyle = '#d4af37'; cx.lineWidth = 5;
  cx.beginPath(); cx.arc(0,0,124,0,Math.PI*2); cx.stroke();
  cx.fillStyle = '#d4af37';
  cx.beginPath(); cx.arc(0,0,18,0,Math.PI*2); cx.fill();
  return new THREE.CanvasTexture(c);
}
function makeSlotScreenTexture(){
  const c = document.createElement('canvas'); c.width=128; c.height=96;
  const cx = c.getContext('2d');
  cx.fillStyle = '#0d0616'; cx.fillRect(0,0,128,96);
  const symbols = ['🍒','⭐','7️⃣','🔔'];
  cx.font = '38px sans-serif'; cx.textAlign='center'; cx.textBaseline='middle';
  for(let i=0;i<3;i++){
    cx.fillText(symbols[Math.floor(Math.random()*symbols.length)], 21+i*43, 48);
  }
  cx.strokeStyle = '#f3d67a'; cx.lineWidth=3; cx.strokeRect(2,2,124,92);
  return new THREE.CanvasTexture(c);
}
function makeSlotMachine(x,z,rotY){
  const group = new THREE.Group();
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.62,1.5,0.55), new THREE.MeshStandardMaterial({color:0x2a1030, roughness:0.5, metalness:0.3}));
  cabinet.position.y = 0.75; cabinet.castShadow = true; cabinet.receiveShadow = true;
  group.add(cabinet);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.44,0.32), new THREE.MeshStandardMaterial({map:makeSlotScreenTexture(), emissive:0x552244, emissiveIntensity:0.4}));
  screen.position.set(0,1.05,0.28);
  group.add(screen);
  const marquee = new THREE.Mesh(new THREE.BoxGeometry(0.64,0.18,0.58), new THREE.MeshStandardMaterial({color:0xf3d67a, emissive:0xf3d67a, emissiveIntensity:0.9}));
  marquee.position.y = 1.6;
  group.add(marquee);
  const armPivot = new THREE.Group();
  armPivot.position.set(0.33,1.15,0.05);
  const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,0.32,6), new THREE.MeshStandardMaterial({color:0xd4af37, metalness:0.7, roughness:0.3}));
  lever.position.y = -0.16;
  armPivot.add(lever);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055,8,8), new THREE.MeshStandardMaterial({color:0xe0335c, emissive:0xe0335c, emissiveIntensity:0.6}));
  knob.position.y = -0.32;
  armPivot.add(knob);
  armPivot.rotation.z = 0.35;
  group.add(armPivot);
  group.position.set(x,0,z);
  group.rotation.y = rotY||0;
  scene.add(group);
}
function makeClothingRack(x,z,rotY){
  const group = new THREE.Group();
  const legMat = new THREE.MeshStandardMaterial({color:0x8a6d1f, metalness:0.6, roughness:0.3});
  [-0.55,0.55].forEach(dx=>{
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,1.5,8), legMat);
    leg.position.set(dx,0.75,0);
    group.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.14,0.03,12), legMat);
    foot.position.set(dx,0.02,0);
    group.add(foot);
  });
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.025,1.2,8), legMat);
  bar.rotation.z = Math.PI/2;
  bar.position.set(0,1.45,0);
  group.add(bar);
  const garmentColors = [0xf3d67a,0x1d9e75,0x378add,0x7f77dd,0xd85a30];
  garmentColors.forEach((color,i)=>{
    const gx = -0.5 + i*0.25;
    const hanger = new THREE.Mesh(new THREE.ConeGeometry(0.03,0.06,6), legMat);
    hanger.position.set(gx,1.4,0);
    group.add(hanger);
    const garment = new THREE.Mesh(new THREE.ConeGeometry(0.14,0.42,8), new THREE.MeshStandardMaterial({color, roughness:0.6}));
    garment.position.set(gx,1.16,0);
    garment.rotation.x = Math.PI; // pointe vers le bas, epaules larges en haut sous le cintre
    garment.castShadow = true;
    group.add(garment);
  });
  group.position.set(x,0,z);
  group.rotation.y = rotY||0;
  scene.add(group);
}
function makeMirror(x,z,rotY){
  const group = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.7,1.5,0.06), new THREE.MeshStandardMaterial({color:0xd4af37, roughness:0.3, metalness:0.6}));
  frame.position.y = 0.85;
  group.add(frame);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.56,1.34), new THREE.MeshStandardMaterial({color:0xbfd8ff, roughness:0.05, metalness:0.9, emissive:0x1a2a44, emissiveIntensity:0.3}));
  glass.position.set(0,0.85,0.035);
  group.add(glass);
  const standBase = new THREE.Mesh(new THREE.CylinderGeometry(0.28,0.32,0.06,16), new THREE.MeshStandardMaterial({color:0xd4af37, metalness:0.5}));
  standBase.position.y = 0.03;
  group.add(standBase);
  group.position.set(x,0,z);
  group.rotation.y = rotY||0;
  scene.add(group);
}
function makeMannequin(x,z){
  const group = new THREE.Group();
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,1.0,8), new THREE.MeshStandardMaterial({color:0x8a6d1f, metalness:0.5}));
  stand.position.y = 0.5;
  group.add(stand);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.18,0.04,16), new THREE.MeshStandardMaterial({color:0x2a1a3d}));
  base.position.y = 0.02;
  group.add(base);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.2,0.55,12), new THREE.MeshStandardMaterial({color:0xe8d9c0, roughness:0.6}));
  torso.position.y = 1.28;
  torso.castShadow = true;
  group.add(torso);
  group.position.set(x,0,z);
  scene.add(group);
}

function buildZoneDecor(z, wx, wz, ww, wh){
  const woodMat = new THREE.MeshStandardMaterial({color:0x3b2412, roughness:0.5, metalness:0.1});
  const railMat = new THREE.MeshStandardMaterial({color:0xd4af37, roughness:0.35, metalness:0.6});

  if(z.id === 'roulette'){
    const r = Math.min(ww,wh)*0.32;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r,r*1.05,0.85,28), woodMat);
    base.position.set(wx,0.425,wz); base.castShadow = true; base.receiveShadow = true; scene.add(base);
    const rail = new THREE.Mesh(new THREE.TorusGeometry(r,0.04,8,28), railMat);
    rail.rotation.x = Math.PI/2; rail.position.set(wx,0.85,wz); scene.add(rail);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(r*0.65,r*0.65,0.08,28), new THREE.MeshStandardMaterial({map:makeWheelTexture(), roughness:0.4, metalness:0.3}));
    wheel.position.set(wx,0.9,wz); wheel.castShadow = true; scene.add(wheel);
    wheelSpins.push(wheel);
    const hub = new THREE.Mesh(new THREE.ConeGeometry(0.07,0.14,10), railMat);
    hub.position.set(wx,1.01,wz); scene.add(hub);
    makeChipStack(wx-r*0.9, 0.87, wz-r*0.4, [0xe0335c,0xf3d67a,0x2ff1ff]);
    makeChipStack(wx+r*0.9, 0.87, wz+r*0.4, [0x8e6bff,0xffd166,0x5cd6c0]);

  } else if(z.id === 'blackjack'){
    const r = Math.min(ww,wh)*0.34;
    const tableMat = new THREE.MeshStandardMaterial({color:z.felt, roughness:0.6});
    const tableGroup = new THREE.Group();
    const curved = new THREE.Mesh(new THREE.CylinderGeometry(r,r,0.85,24,1,false,0,Math.PI), tableMat);
    curved.castShadow = true; curved.receiveShadow = true;
    tableGroup.add(curved);
    // CylinderGeometry avec thetaStart=0/thetaLength=PI balaie x=r*sin(theta), z=r*cos(theta) :
    // la face plane coupee est donc dans le plan local x=0, sur toute la largeur en z.
    // La plaque de fermeture doit etre fine en x et large en z (r*2), pas l'inverse.
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.06,0.85,r*2), tableMat);
    cap.castShadow = true; cap.receiveShadow = true;
    tableGroup.add(cap);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r,0.045,8,24,Math.PI), woodMat);
    rim.rotation.x = Math.PI/2;
    rim.position.y = 0.425;
    tableGroup.add(rim);
    tableGroup.position.set(wx,0.425,wz);
    tableGroup.rotation.y = Math.PI/2;
    scene.add(tableGroup);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.3,0.2,0.22), woodMat);
    shoe.position.set(wx, 0.95, wz - r*0.6);
    shoe.rotation.x = -0.3;
    scene.add(shoe);
    makeCardDeck(wx, 0.89, wz - r*0.55, 0);
    makeChipStack(wx-r*0.5, 0.87, wz+r*0.5, [0xe0335c,0xf3d67a]);
    makeChipStack(wx+r*0.5, 0.87, wz+r*0.5, [0x2ff1ff,0x8e6bff]);

  } else if(z.id === 'dice'){
    const tw = ww*0.62, td = wh*0.5, th = 0.8;
    const topY = th; // surface superieure de la table (position.y=th/2 + demi-hauteur th/2)
    const table = new THREE.Mesh(new THREE.BoxGeometry(tw,th,td), new THREE.MeshStandardMaterial({color:z.felt, roughness:0.7}));
    table.position.set(wx,th/2,wz); table.castShadow = true; table.receiveShadow = true; scene.add(table);
    const railH = 0.14;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(tw+0.08,railH,td+0.08), railMat);
    rail.position.set(wx,topY+railH/2,wz); scene.add(rail);
    const boardH = 0.5, boardHalf = 0.03;
    const backboard = new THREE.Mesh(new THREE.BoxGeometry(tw*0.94,boardH,boardHalf*2), woodMat);
    backboard.position.set(wx,topY+railH+boardH/2,wz - td/2 + boardHalf);
    backboard.castShadow = true;
    scene.add(backboard);
    makeDie(wx-0.3, topY+railH+0.08, wz+0.15, 0.16);
    makeDie(wx+0.15, topY+railH+0.08, wz-0.05, 0.16);
    makeChipStack(wx+tw*0.32, topY+railH+0.02, wz+td*0.3, [0xffd166,0xe0335c,0x2ff1ff]);

  } else if(z.id === 'poker'){
    const rx = ww*0.34, rz = wh*0.26;
    const table = new THREE.Mesh(new THREE.CylinderGeometry(1,1,0.85,28), new THREE.MeshStandardMaterial({color:z.felt, roughness:0.55}));
    table.scale.set(rx,1,rz);
    table.position.set(wx,0.425,wz); table.castShadow = true; table.receiveShadow = true; scene.add(table);
    const rail = new THREE.Mesh(new THREE.TorusGeometry(1,0.07,8,28), new THREE.MeshStandardMaterial({color:0x5c3a1e, roughness:0.6}));
    rail.rotation.x = Math.PI/2; rail.scale.set(rx,rz,1); rail.position.set(wx,0.85+0.06,wz); scene.add(rail);
    makeCardDeck(wx, 0.89, wz, 0.3);
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.09,0.02,16), new THREE.MeshStandardMaterial({color:0xffffff}));
    button.position.set(wx+0.3, 0.87, wz+0.2); scene.add(button);
    makeChipStack(wx-rx*0.55, 0.87, wz-rz*0.5, [0xe0335c,0x2ff1ff,0xf3d67a]);
    makeChipStack(wx+rx*0.55, 0.87, wz+rz*0.5, [0x8e6bff,0x5cd6c0,0xffd166]);
    makeChipStack(wx, 0.87, wz-rz*0.75, [0xf3d67a,0xe0335c]);

  } else if(z.id === 'slots'){
    [[-ww*0.28,-wh*0.15],[0,-wh*0.22],[ww*0.28,-wh*0.15]].forEach(([dx,dz])=>{
      makeSlotMachine(wx+dx, wz+dz, 0);
    });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(ww*0.5,0.6,wh*0.22), woodMat);
    counter.position.set(wx,0.3,wz+wh*0.28); counter.castShadow = true; counter.receiveShadow = true; scene.add(counter);
    makeChipStack(wx-ww*0.15, 0.62, wz+wh*0.28, [0xf3d67a,0xe0335c]);
    makeChipStack(wx+ww*0.15, 0.62, wz+wh*0.28, [0x2ff1ff,0x8e6bff]);

  } else if(z.id === 'boutique'){
    makeClothingRack(wx-ww*0.2, wz+wh*0.15, 0);
    makeMirror(wx+ww*0.28, wz, 0);
    makeMannequin(wx, wz-wh*0.25);
  }
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

  buildZoneDecor(z, wx, wz, ww, wh);

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
  wheelSpins.forEach(w=> w.rotation.y += dt*0.4);
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

import Globe from 'globe.gl';
import * as THREE from 'three';

const FIELD_LABEL = {
  quantum_computing: '양자컴퓨팅',
  quantum_communication: '양자통신',
  quantum_sensing: '양자센싱',
};
const FIELD_COLOR = {
  quantum_computing: '#4f8cff',
  quantum_communication: '#a86bff',
  quantum_sensing: '#33d6a6',
};

const BASE = import.meta.env.BASE_URL;          // '/quantum-brain-map/' (prod) | '/' (dev)
const url  = p => BASE + p.replace(/^\//, ''); // '/photos/3.jpg' → BASE+'photos/3.jpg'

let maxPapers = 1;
const buildingObjs = new Map(); // inst → THREE.Group
const REFERENCE_ALT = 2.6;

const state = {
  institutions: [],
  nodeById: new Map(),
  geoPolygons: [],
  activeFields: new Set(['quantum_computing', 'quantum_communication', 'quantum_sensing']),
  activeTiers: new Set(['global_top1', 'korea_top10']),
  selectedInst: null,
  fromInst: null,
};

async function loadData() {
  const [insts, nodes, countriesGeo, statesGeo] = await Promise.all([
    fetch(url('/data/institutions.json')).then(r => r.json()),
    fetch(url('/data/nodes.json')).then(r => r.json()),
    fetch(url('/data/countries-50m.geojson')).then(r => r.json()),
    fetch(url('/data/states-50m.geojson')).then(r => r.json()),
  ]);

  state.institutions = insts.filter(i => i.lat != null && i.lon != null);
  state.nodeById    = new Map(nodes.map(n => [n.seq, n]));
  maxPapers = Math.max(1, ...state.institutions.map(i => i.papers_total || 0));

  // 두 레이어를 하나의 배열로 합침 (state 먼저, country 나중에 위에 그려짐)
  state.geoPolygons = [
    ...statesGeo.features.map(f => ({ ...f, _level: 'state' })),
    ...countriesGeo.features.map(f => ({ ...f, _level: 'country' })),
  ];
}

function instVisible(inst) {
  return inst.researchers.some(r => {
    const fieldOk = r.fields.length === 0 || r.fields.some(f => state.activeFields.has(f));
    const tierOk  = r.tiers.length  === 0 || r.tiers.some(t  => state.activeTiers.has(t));
    return fieldOk && tierOk;
  });
}

function visibleResearchers(inst) {
  return inst.researchers.filter(r => {
    const fieldOk = r.fields.length === 0 || r.fields.some(f => state.activeFields.has(f));
    const tierOk  = r.tiers.length  === 0 || r.tiers.some(t  => state.activeTiers.has(t));
    return fieldOk && tierOk;
  });
}

// ── 3D 빌딩 생성 ───────────────────────────────────────────────
function createBuilding(inst) {
  const group = new THREE.Group();

  const MAX_H = 8;    // world units (논문 1위 기관 최대 높이)
  const BW    = 0.25; // world units (좁은 정사각형 밑면)
  const GAP   = 0.02;

  const totalH = Math.max(0.04, (inst.papers_total || 0) / maxPapers * MAX_H);

  const floors = inst.researchers.map(r => ({
    papers: Math.max(1, state.nodeById.get(r.seq)?.papers_total || 1),
    color:  r.fields[0] ? FIELD_COLOR[r.fields[0]] : '#778899',
  }));
  const sumPapers = floors.reduce((s, f) => s + f.papers, 0);
  const usableH   = Math.max(0.03, totalH - GAP * floors.length);

  let zOffset = 0;
  floors.forEach(({ papers, color }) => {
    const fh = Math.max(0.015, (papers / sumPapers) * usableH);
    const geom = new THREE.BoxGeometry(BW, BW, fh);
    const mat  = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.9,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.baseColor = color;
    mesh.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(geom),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 })
    ));
    mesh.position.z = zOffset + fh / 2;
    zOffset += fh + GAP;
    group.add(mesh);
  });

  // 전체 클릭 영역 (투명 박스)
  const clickMesh = new THREE.Mesh(
    new THREE.BoxGeometry(BW * 1.2, BW * 1.2, totalH * 1.1),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  clickMesh.position.z = totalH / 2;
  group.add(clickMesh);

  return group;
}

// 줌에 따라 빌딩 크기 보정
// - 폭(X/Y): power 1.2 → 줌인 시 빠르게 좁아져 기관 간 겹침 방지
// - 높이(Z):  power 0.4 → 줌인해도 높이를 유지해 수직감 강조
function updateBuildingScales() {
  const alt         = globe.pointOfView().altitude;
  const ratio       = (1 + alt) / (1 + REFERENCE_ALT);
  const widthScale  = Math.pow(ratio, 1.2);
  const heightScale = Math.pow(ratio, 0.4);
  buildingObjs.forEach(obj => {
    obj.scale.x = widthScale;
    obj.scale.y = widthScale;
    obj.scale.z = heightScale;
  });
}

// 선택 강조
function applyHighlight(inst, on) {
  const obj = buildingObjs.get(inst);
  if (!obj) return;
  obj.children.forEach(mesh => {
    if (mesh.isMesh && mesh.material && mesh.userData.baseColor) {
      mesh.material.color.set(on ? 0xffe27a : mesh.userData.baseColor);
      mesh.material.opacity = on ? 1.0 : 0.9;
    }
  });
}

let globe;

function refreshGlobe() {
  const visible = state.institutions.filter(instVisible);
  buildingObjs.clear();
  globe
    .objectThreeObject(inst => {
      const obj = createBuilding(inst);
      buildingObjs.set(inst, obj);
      if (inst === state.selectedInst) applyHighlight(inst, true);
      return obj;
    })
    .objectsData(visible);

  updateBuildingScales();
  requestAnimationFrame(updateBuildingScales);

  const totalR = visible.reduce((s, i) => s + i.researcher_count, 0);
  document.getElementById('stats').textContent =
    `${visible.length}개 기관 · ${totalR.toLocaleString()}명 연구자`;
}

// ── 기관 패널 ──────────────────────────────────────────────────

function selectInst(inst, flyTo = true) {
  if (state.selectedInst) applyHighlight(state.selectedInst, false);
  state.selectedInst = inst;
  state.fromInst = null;
  applyHighlight(inst, true);

  renderInst(inst);
  document.getElementById('instPanel').classList.remove('hidden');
  document.getElementById('detailPanel').classList.add('hidden');

  if (flyTo) {
    // 위도(카메라 기울기)는 유지, 경도만 변경 → 지구가 제자리에서 회전만 함
    const pov = globe.pointOfView();
    globe.pointOfView({ lat: pov.lat, lng: inst.lon, altitude: pov.altitude }, 1200);
  }
}

function closeInst() {
  if (state.selectedInst) applyHighlight(state.selectedInst, false);
  state.selectedInst = null;
  document.getElementById('instPanel').classList.add('hidden');
  document.getElementById('detailPanel').classList.add('hidden');
}

function countryFlag(code) {
  if (!code || code.length < 2) return '';
  return [...code.slice(0, 2).toUpperCase()].map(c =>
    String.fromCodePoint(0x1F1E6 - 65 + c.charCodeAt(0))
  ).join('');
}

function initials(name) {
  if (!name) return '?';
  const skip = new Set(['of', 'and', 'the', 'at', 'for', 'in', 'de', 'la', 'le', 'du', 'des', 'von', 'van']);
  const words = name.split(/\s+/).filter(w => w.length > 1 && !skip.has(w.toLowerCase()));
  return (words.length ? words : name.split(/\s+/)).slice(0, 3).map(w => w[0].toUpperCase()).join('');
}

function fieldBadgesHtml(fields) {
  return fields.map(f =>
    `<span class="badge badge-field" style="background:${FIELD_COLOR[f]}">${FIELD_LABEL[f]}</span>`
  ).join('');
}

function tierBadgesHtml(tiers) {
  return tiers.map(t => t === 'global_top1'
    ? `<span class="badge badge-global">글로벌 상위 1%</span>`
    : `<span class="badge badge-korea">한국 상위 10%</span>`
  ).join('');
}

function renderInst(inst) {
  const rs   = visibleResearchers(inst);
  const loc  = [inst.city, inst.country].filter(Boolean).join(' · ');
  const flag = countryFlag(inst.country_code);

  const logoHtml = inst.homepage_domain
    ? `<img class="inst-logo" src="https://logo.clearbit.com/${inst.homepage_domain}"
         onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />`
    : '';
  const logoFbHtml = `<div class="inst-logo-placeholder" style="${inst.homepage_domain ? 'display:none' : 'display:flex'}">${initials(inst.name)}</div>`;

  const homepageHtml = inst.homepage_domain
    ? `<a class="inst-homepage" href="https://${inst.homepage_domain}" target="_blank" rel="noopener">🔗 홈페이지</a>`
    : '';

  const fieldRowsHtml = Object.entries(inst.fields || {})
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([f, v]) => `
      <div class="inst-field-row">
        <span class="dot" style="background:${FIELD_COLOR[f]}"></span>
        <span class="inst-field-name">${FIELD_LABEL[f]}</span>
        <span class="inst-field-count">${v}명</span>
      </div>`).join('');

  const cardsHtml = rs.map(r => {
    const photoHtml = r.photo
      ? `<img class="rc-photo" src="${url(r.photo)}" alt="${r.name}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
         <div class="rc-photo-fb" style="display:none">${initials(r.name)}</div>`
      : `<div class="rc-photo-fb" style="display:flex">${initials(r.name)}</div>`;

    const tierBadge = r.tiers.includes('global_top1')
      ? `<span class="badge badge-global rc-badge">글로벌 1%</span>`
      : r.tiers.includes('korea_top10')
      ? `<span class="badge badge-korea rc-badge">한국 10%</span>`
      : '';

    return `
      <div class="rc" data-seq="${r.seq}">
        <div class="rc-photo-wrap">${photoHtml}</div>
        <div class="rc-info">
          <div class="rc-name">${r.name}</div>
          <div class="rc-meta">${fieldBadgesHtml(r.fields)}${tierBadge}</div>
        </div>
      </div>`;
  }).join('');

  document.getElementById('instContent').innerHTML = `
    <div class="inst-header">
      <div class="inst-logo-wrap">${logoHtml}${logoFbHtml}</div>
      <div class="inst-header-info">
        <div class="inst-name">${inst.name}</div>
        <div class="inst-location">${flag} ${loc}</div>
        ${homepageHtml}
      </div>
    </div>
    <div class="inst-stats">
      <div class="stat-box"><div class="stat-num">${inst.researcher_count}</div><div class="stat-label">연구자</div></div>
      <div class="stat-box"><div class="stat-num">${(inst.papers_total || 0).toLocaleString()}</div><div class="stat-label">전체 논문</div></div>
      <div class="stat-box"><div class="stat-num">${(inst.papers_q1 || 0).toLocaleString()}</div><div class="stat-label">Q1 논문</div></div>
      ${inst.global_top1 > 0 ? `<div class="stat-box"><div class="stat-num">${inst.global_top1}</div><div class="stat-label">글로벌 1%</div></div>` : ''}
    </div>
    <div class="inst-fields">${fieldRowsHtml}</div>
    <div class="dp-section-title">소속 연구자 (${rs.length}명)</div>
    <div class="rc-list">${cardsHtml}</div>
  `;

  document.getElementById('instContent').querySelectorAll('.rc').forEach(el => {
    el.addEventListener('click', () => {
      const node = state.nodeById.get(parseInt(el.dataset.seq));
      if (node) selectNode(node, inst);
    });
  });
}

// ── 연구자 상세 패널 ────────────────────────────────────────────

function selectNode(node, fromInst = null) {
  state.fromInst = fromInst;
  renderDetail(node);
  document.getElementById('detailPanel').classList.remove('hidden');

  const backBtn = document.getElementById('backToInst');
  if (fromInst) {
    const label = fromInst.name.length > 24 ? fromInst.name.slice(0, 24) + '…' : fromInst.name;
    backBtn.textContent = `← ${label}`;
    backBtn.style.visibility = 'visible';
  } else {
    backBtn.style.visibility = 'hidden';
    document.getElementById('instPanel').classList.add('hidden');
    if (node.lat != null) {
      const pov = globe.pointOfView();
      globe.pointOfView({ lat: pov.lat, lng: node.lon, altitude: pov.altitude }, 1200);
    }
  }
}

function renderDetail(node) {
  const prim   = node.institutions.find(i => i.rank === 1);
  const others = node.institutions.filter(i => i.rank !== 1);

  const photoHtml = node.photo
    ? `<img class="dp-photo" src="${url(node.photo)}" alt="${node.name}" />`
    : `<div class="dp-photo-placeholder">${initials(node.name)}</div>`;

  const bioHtml = node.bio ? `<div class="dp-bio">${node.bio}</div>` : '';

  const otherInstHtml = others.length
    ? `<div class="dp-section-title">추가 소속</div>` +
      others.map(o =>
        `<div class="dp-inst-item">${o.name}${o.dept ? ' · ' + o.dept : ''}${o.country ? ' (' + o.country + ')' : ''}</div>`
      ).join('')
    : '';

  const links = [];
  if (node.website) links.push(`<a class="dp-link" href="${node.website}" target="_blank" rel="noopener">🔗 홈페이지 방문</a>`);
  if (node.email)   links.push(`<a class="dp-link" href="mailto:${node.email}">✉️ ${node.email}</a>`);

  document.getElementById('detailContent').innerHTML = `
    ${photoHtml}
    <div class="dp-name">${node.name || ''}</div>
    <div class="dp-inst">${prim ? prim.name : ''}</div>
    <div class="dp-dept">${prim?.dept || ''}</div>
    <div class="dp-addr">${node.institution_address || ''}</div>
    <div class="dp-badges">${fieldBadgesHtml(node.fields)}${tierBadgesHtml(node.tiers)}</div>
    ${bioHtml}
    <div class="dp-stats">
      <div class="stat-box"><div class="stat-num">${node.papers_total ?? 0}</div><div class="stat-label">전체 논문</div></div>
      <div class="stat-box"><div class="stat-num">${node.papers_q1 ?? 0}</div><div class="stat-label">Q1 논문</div></div>
      <div class="stat-box"><div class="stat-num">${node.papers_first ?? 0}</div><div class="stat-label">제1저자</div></div>
      <div class="stat-box"><div class="stat-num">${node.papers_corr ?? 0}</div><div class="stat-label">교신저자</div></div>
    </div>
    ${otherInstHtml}
    <div class="dp-links">${links.join('')}</div>
  `;
}

// ── 검색 ──────────────────────────────────────────────────────

function setupSearch() {
  const box     = document.getElementById('searchBox');
  const results = document.getElementById('searchResults');

  box.addEventListener('input', () => {
    const q = box.value.trim().toLowerCase();
    if (q.length < 1) { results.classList.remove('show'); results.innerHTML = ''; return; }

    const instMatches = state.institutions
      .filter(i => i.name.toLowerCase().includes(q) || (i.country || '').toLowerCase().includes(q))
      .slice(0, 8);

    const nodeMatches = [];
    for (const node of state.nodeById.values()) {
      if (nodeMatches.length >= 12) break;
      const instName = (node.institutions.find(i => i.rank === 1) || {}).name || '';
      if (node.name.toLowerCase().includes(q) || instName.toLowerCase().includes(q))
        nodeMatches.push(node);
    }

    const instHtml = instMatches.map(inst => `
      <div class="search-item" data-type="inst" data-name="${inst.name.replace(/"/g, '&quot;')}">
        <div class="si-icon">🏛</div>
        <div>
          <div class="si-name">${inst.name}</div>
          <div class="si-inst">${[inst.city, inst.country].filter(Boolean).join(' · ')} · ${inst.researcher_count}명</div>
        </div>
      </div>`).join('');

    const nodeHtml = nodeMatches.map(node => {
      const instName = (node.institutions.find(i => i.rank === 1) || {}).name || '';
      return `
        <div class="search-item" data-type="node" data-seq="${node.seq}">
          <div class="si-icon">👤</div>
          <div>
            <div class="si-name">${node.name}</div>
            <div class="si-inst">${instName}</div>
          </div>
        </div>`;
    }).join('');

    let html = '';
    if (instMatches.length) html += `<div class="search-group-title">기관</div>${instHtml}`;
    if (nodeMatches.length) html += `<div class="search-group-title">연구자</div>${nodeHtml}`;
    results.innerHTML = html;
    results.classList.toggle('show', !!(instMatches.length || nodeMatches.length));

    results.querySelectorAll('[data-type="inst"]').forEach(el => {
      el.addEventListener('click', () => {
        const inst = state.institutions.find(i => i.name === el.dataset.name);
        if (inst) { selectInst(inst); results.classList.remove('show'); box.value = inst.name; }
      });
    });
    results.querySelectorAll('[data-type="node"]').forEach(el => {
      el.addEventListener('click', () => {
        const node = state.nodeById.get(parseInt(el.dataset.seq));
        if (node) { selectNode(node, null); results.classList.remove('show'); box.value = node.name; }
      });
    });
  });

  document.addEventListener('click', e => {
    if (!document.getElementById('searchWrap').contains(e.target)) results.classList.remove('show');
  });
}

// ── 필터 ──────────────────────────────────────────────────────

function setupFilters() {
  document.querySelectorAll('.f-field').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.checked ? state.activeFields.add(cb.value) : state.activeFields.delete(cb.value);
      refreshGlobe();
      if (state.selectedInst) renderInst(state.selectedInst);
    });
  });
  document.querySelectorAll('.f-tier').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.checked ? state.activeTiers.add(cb.value) : state.activeTiers.delete(cb.value);
      refreshGlobe();
      if (state.selectedInst) renderInst(state.selectedInst);
    });
  });
}

// ── 패널 컨트롤 ───────────────────────────────────────────────

function setupPanelControls() {
  document.getElementById('closeInst').addEventListener('click', closeInst);

  document.getElementById('closeDetail').addEventListener('click', () => {
    document.getElementById('detailPanel').classList.add('hidden');
    if (!state.fromInst) {
      if (state.selectedInst) applyHighlight(state.selectedInst, false);
      state.selectedInst = null;
    }
    state.fromInst = null;
  });

  document.getElementById('backToInst').addEventListener('click', () => {
    document.getElementById('detailPanel').classList.add('hidden');
    state.fromInst = null;
  });
}

// ── 글로브 초기화 ──────────────────────────────────────────────

function initGlobe() {
  // 단색 바다색 이미지 (래스터 텍스처 대신 벡터 폴리곤 사용)
  const oceanCanvas = document.createElement('canvas');
  oceanCanvas.width = oceanCanvas.height = 2;
  const ctx2d = oceanCanvas.getContext('2d');
  ctx2d.fillStyle = '#030d1c';
  ctx2d.fillRect(0, 0, 2, 2);

  globe = Globe()(document.getElementById('globeViz'))
    .globeImageUrl(oceanCanvas.toDataURL())
    .backgroundImageUrl(url('/textures/night-sky.png'))
    .atmosphereColor('#4a7ab0')
    .atmosphereAltitude(0.18)
    // 벡터 행정 경계
    .polygonsData(state.geoPolygons)
    .polygonCapColor(f => f._level === 'country' ? '#0c1e36' : '#0b1a2e')
    .polygonSideColor(() => '#020810')
    .polygonStrokeColor(f => f._level === 'country' ? '#3a6ab0' : '#1a3460')
    .polygonAltitude(f => f._level === 'country' ? 0.001 : 0.0006)
    // 3D 빌딩
    .objectLat('lat')
    .objectLng('lon')
    .objectAltitude(0.002)
    .objectLabel(inst => `
      <div class="scene-tooltip">
        <b>${inst.name}</b><br/>
        <span style="color:#9fb0ff">${[inst.city, inst.country].filter(Boolean).join(', ')}</span><br/>
        <span style="color:#8a96c2">연구자 ${inst.researcher_count}명 · 논문 ${(inst.papers_total || 0).toLocaleString()}편</span>
      </div>`)
    .onObjectClick(inst => selectInst(inst))
    .enablePointerInteraction(true);

  // 초기 시점: 적도 근처 약간 남쪽에서 비스듬히 올려보는 각도
  // lat=5 → 북반구 기관(한국 lat≈37)이 화면 위쪽 ~32° 위치 → 빌딩 옆면 보임
  globe.pointOfView({ lat: 5, lng: 127, altitude: 2.6 });

  globe.renderer().setPixelRatio(window.devicePixelRatio);

  const controls = globe.controls();
  controls.autoRotate      = true;
  controls.autoRotateSpeed = 0.25;
  controls.enableDamping   = true;
  controls.minPolarAngle   = 0;
  controls.maxPolarAngle   = Math.PI;
  controls.addEventListener('change', updateBuildingScales);

  document.getElementById('globeViz').addEventListener('pointerdown', () => {
    controls.autoRotate = false;
  }, { once: true });
}

function setupFilterToggle() {
  const btn   = document.getElementById('filterToggle');
  const panel = document.getElementById('filterPanel');
  btn.addEventListener('click', () => panel.classList.toggle('open'));
}

async function main() {
  await loadData();
  initGlobe();
  refreshGlobe();
  setupSearch();
  setupFilters();
  setupFilterToggle();
  setupPanelControls();
  document.getElementById('loadingOverlay').classList.add('hide');
}

main();

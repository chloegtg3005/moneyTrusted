// ======== KONFIG ========
const API_BASE = "https://moneytrusted-production.up.railway.app"; 

// ======== UTIL ========
function show(el){ el.classList.remove('hide') }
function hide(el){ el.classList.add('hide') }
function rp(n){ return 'Rp ' + (n||0).toLocaleString('id-ID') }

function token(){ return localStorage.getItem('token') || '' }
function headersJSON(){
  const h = { 'content-type':'application/json' };
  if (token()) h['Authorization'] = 'Bearer ' + token();
  return h;
}

async function apiGet(path){
  const res = await fetch(API_BASE + path, { headers: headersJSON() });
  if (res.status === 401) { localStorage.removeItem('token'); location.reload(); return null; }
  return res.json();
}
async function apiPost(path, body){
  const res = await fetch(API_BASE + path, { method:'POST', headers: headersJSON(), body: JSON.stringify(body || {}) });
  if (res.status === 401) { localStorage.removeItem('token'); location.reload(); return null; }
  return res.json();
}

// ======== VARIABEL DOM ========
let authMode = "login"; // default

const authTitle = document.getElementById("authTitle");
const authBtn = document.getElementById("authBtn");
const authSwitch = document.getElementById("authSwitch");
const authMsg = document.getElementById("authMsg");
const inputIdentifier = document.getElementById("inputIdentifier");
const inputPassword = document.getElementById("inputPassword");
const inputInvite = document.getElementById("inputInvite");
const btnLogout = document.getElementById("btnLogout");

const authCard = document.getElementById("authCard");
const homeCard = document.getElementById("homeCard");
const topupCard = document.getElementById("topupCard");
const riwayatCard = document.getElementById("riwayatCard");
const sayaCard = document.getElementById("sayaCard");
const layananCard = document.getElementById("layananCard");
const wdCard = document.getElementById("wdCard");

const saldoAmount = document.getElementById("saldoAmount");
const userIdentifier = document.getElementById("userIdentifier");
const userInvite = document.getElementById("userInvite");
const userBank = document.getElementById("userBank");

const productList = document.getElementById("productList");
const btnRefreshProducts = document.getElementById("btnRefreshProducts");

const btnTopup = document.getElementById("btnTopup");
const btnTopupBack = document.getElementById("btnTopupBack");
const topupOptions = document.getElementById("topupOptions");
const btnPaid = document.getElementById("btnPaid");
const topupMsg = document.getElementById("topupMsg");

const btnWithdraw = document.getElementById("btnWithdraw");
const btnWdBack = document.getElementById("btnWdBack");
const btnWdSubmit = document.getElementById("btnWdSubmit");
const wdMsg = document.getElementById("wdMsg");
const wdAmount = document.getElementById("wdAmount");

const btnRiwayat = document.getElementById("btnRiwayat");
const btnRiwayatBack = document.getElementById("btnRiwayatBack");
const riwayatList = document.getElementById("riwayatList");

const btnSaya = document.getElementById("btnSaya");
const btnSayaBack = document.getElementById("btnSayaBack");
const btnTambahRek = document.getElementById("btnTambahRek");
const saveRek = document.getElementById("saveRek");
const rekForm = document.getElementById("rekForm");
const rekType = document.getElementById("rekType");
const rekNumber = document.getElementById("rekNumber");
const rekName = document.getElementById("rekName");

const btnUbahPass = document.getElementById("btnUbahPass");
const savePass = document.getElementById("savePass");
const passForm = document.getElementById("passForm");
const oldPass = document.getElementById("oldPass");
const newPass = document.getElementById("newPass");
const forgotPass = document.getElementById("forgotPass");

const btnLayanan = document.getElementById("btnLayanan");
const btnLayananBack = document.getElementById("btnLayananBack");

// ======== AUTH ========
function setAuthMode(mode){
  authMode = mode;
  if (mode === 'register') {
    authTitle.innerText = 'Daftar';
    authBtn.innerText = 'Daftar';
    inputInvite.style.display = 'block';
  } else {
    authTitle.innerText = 'Login';
    authBtn.innerText = 'Login';
    inputInvite.style.display = 'none';
  }
  authMsg.innerText = '';
}

authSwitch.addEventListener('click', (e)=>{ 
  e.preventDefault(); 
  setAuthMode(authMode==='register'?'login':'register'); 
});

authBtn.addEventListener('click', async ()=>{
  const id = inputIdentifier.value.trim();
  const pwd = inputPassword.value.trim();
  const invite = inputInvite.value.trim();
  if (!id || !pwd) { authMsg.innerText = 'Isi id & sandi'; return; }

  try{
    if (authMode === 'register'){
      const j = await apiPost('/auth/register', { identifier:id, password:pwd, invite });
      if (j.error || !j.token) { authMsg.innerText = j.message || 'Gagal daftar'; return; }
      localStorage.setItem('token', j.token);
      await afterLogin();
    } else {
      const j = await apiPost('/auth/login', { identifier:id, password:pwd });
      if (!j.token) { authMsg.innerText = j.message || 'Gagal login'; return; }
      localStorage.setItem('token', j.token);
      await afterLogin();
    }
  }catch(e){ authMsg.innerText = 'Terjadi kesalahan'; console.error(e); }
});

btnLogout.addEventListener('click', ()=>{ localStorage.removeItem('token'); location.reload(); });

async function afterLogin(){
  await apiPost('/wallet/claim');
  await loadHome();
}

// ======== HOME ========
async function loadHome(){
  const u = await apiGet('/auth/me');
  if (!u) return;
  hide(authCard); hide(topupCard); hide(riwayatCard); hide(sayaCard); hide(layananCard); hide(wdCard);
  show(homeCard);
  saldoAmount.innerText = rp(u.saldo || 0);
  userIdentifier.innerText = u.identifier;
  userInvite.innerText = u.inviteCode || '-';
  userBank.innerText = u.rekening ? `${u.rekening.type} • ${u.rekening.number} • ${u.rekening.name}` : '-';
  await loadProducts();
}

async function loadProducts(){
  const p = await apiGet('/products');
  productsCache = Array.isArray(p) ? p : [];
  productList.innerHTML = '';
  productsCache.forEach(prod=>{
    const el = document.createElement('div');
    el.className = 'product';
    el.innerHTML = `
      <img src="images/produk.png" alt="${prod.name}">
      <h5>${prod.name}</h5>
      <p>Harga: <strong>${rp(prod.price)}</strong></p>
      <p>Pendapatan Harian: <strong>${rp(prod.dailyIncome)}</strong></p>
      <p>Siklus: ${prod.cycleDays} hari • Total: <strong>${rp(prod.totalIncome)}</strong></p>
      <button data-id="${prod._id}" class="buyBtn">Beli</button>
    `;
    productList.appendChild(el);
  });
  document.querySelectorAll('.buyBtn').forEach(b=>{
    b.addEventListener('click', async (e)=>{
      const id = e.currentTarget.dataset.id;
      const res = await apiPost('/products/buy', { productId:id });
      alert(res.message || 'Done');
      await loadHome();
    });
  });
}
btnRefreshProducts.addEventListener('click', loadProducts);

// ======== TOPUP ========
btnTopup.addEventListener('click', ()=>{ hide(homeCard); show(topupCard); renderTopupOptions(); });
btnTopupBack.addEventListener('click', ()=>{ hide(topupCard); show(homeCard); });

const topupValues=[100000,150000,200000,250000,300000,350000,500000,1000000,2000000,3000000];
let selectedTopup = null;
function renderTopupOptions(){
  topupOptions.innerHTML='';
  topupValues.forEach(v=>{
    const btn=document.createElement('button');
    btn.className='ghost';
    btn.innerText=rp(v);
    btn.addEventListener('click',()=>{
      selectedTopup=v; document.querySelectorAll('#topupOptions button').forEach(x=>x.style.borderColor='#e5e7eb');
      btn.style.borderColor='#9fdfb1';
    });
    topupOptions.appendChild(btn);
  });
}
btnPaid.addEventListener('click', async ()=>{
  if(!selectedTopup){ topupMsg.innerText='Pilih jumlah topup dahulu'; return; }
  topupMsg.innerText='';
  const j = await apiPost('/wallet/topup', { amount:selectedTopup, method:'seabank' });
  alert((j && j.message) || 'Topup dibuat');
});

// ======== WITHDRAW ========
btnWithdraw.addEventListener('click', ()=>{ hide(homeCard); show(wdCard); wdMsg.innerText=''; wdAmount.value=''; });
btnWdBack.addEventListener('click', ()=>{ hide(wdCard); show(homeCard); });
btnWdSubmit.addEventListener('click', async ()=>{
  const amt = parseInt(wdAmount.value,10);
  if(!amt){ wdMsg.innerText='Masukkan nominal'; return; }
  const j = await apiPost('/wallet/withdraw', { amount: amt });
  if(j && j.message) alert(j.message);
  await loadHome();
});

// ======== RIWAYAT ========
btnRiwayat.addEventListener('click', async ()=>{
  hide(homeCard); show(riwayatCard);
  const list = await apiGet('/wallet/history');
  riwayatList.innerHTML='';
  if(!list || list.length===0){ riwayatList.innerHTML='<p class="small">Belum ada riwayat</p>'; return; }
  list.forEach(tx=>{
    const d = new Date(tx.createdAt);
    const div = document.createElement('div');
    div.className='card';
    div.style.marginBottom='8px';
    div.innerHTML = `<p><strong>${tx.type.toUpperCase()}</strong> • ${tx.status}</p>
                     <p>${rp(tx.amount||0)} • ${d.toLocaleString('id-ID')}</p>
                     <p class="small">${tx.note||''}</p>`;
    riwayatList.appendChild(div);
  });
});
btnRiwayatBack.addEventListener('click', ()=>{ hide(riwayatCard); show(homeCard); });

// ======== SAYA ========
btnSaya.addEventListener('click', ()=>{ hide(homeCard); show(sayaCard); });
btnSayaBack.addEventListener('click', ()=>{ hide(sayaCard); show(homeCard); });

btnTambahRek.addEventListener('click', ()=>{ rekForm.classList.toggle('hide'); });
saveRek.addEventListener('click', async ()=>{
  const body = { type:rekType.value, number:rekNumber.value.trim(), name:rekName.value.trim() };
  if(!body.number || !body.name) return alert('Lengkapi data rekening');
  const r = await apiPost('/auth/rekening', body);
  alert(r.message || 'Tersimpan');
  rekForm.classList.add('hide');
  await loadHome();
});

btnUbahPass.addEventListener('click', ()=>{ passForm.classList.toggle('hide'); });
savePass.addEventListener('click', async ()=>{
  const oldp = oldPass.value.trim(), newp = newPass.value.trim();
  if(!oldp || !newp) return alert('Isi sandi lama & baru');
  const r = await apiPost('/auth/change-password', { oldPassword:oldp, newPassword:newp });
  alert(r.message || 'OK');
  passForm.classList.add('hide');
});
forgotPass.addEventListener('click', async (e)=>{
  e.preventDefault();
  const id = prompt('Masukkan No HP/Email terdaftar:');
  if(!id) return;
  const r = await apiPost('/auth/forgot', { identifier:id });
  alert(r.message || 'OK');
});

// ======== LAYANAN ========
btnLayanan.addEventListener('click', ()=>{ hide(homeCard); show(layananCard); });
btnLayananBack.addEventListener('click', ()=>{ hide(layananCard); show(homeCard); });

// ======== ON LOAD ========
(async ()=>{
  if (token()) await afterLogin();
  else { setAuthMode('register'); show(authCard); }
})();

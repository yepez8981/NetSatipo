/***********************
 *  CONFIG
 ***********************/
const DB = {
  SS_ID: '1IyjENTHiG8uyF2jwH-Ub1u1C_Xz9Pn2rmjxD8MQ7Ex0',  // <-- PON AQUI EL ID DE TU HOJA DE CALCULO
  TABS: {
    CONFIG: 'CONFIG',
    PLANES: 'PLANES',
    CLIENTES: 'CLIENTES',
    SOLICITUDES: 'SOLICITUDES',
    VISITAS: 'VISITAS',
    PAGOS: 'PAGOS',
    FACTURAS: 'FACTURAS',
    FOTOS: 'FOTOS',
    AUDITORIA: 'AUDITORIA'
  },
  SOLICITUD_ESTADOS: ['PENDIENTE','EN_REVISION','APROBADA','INSTALADA','RECHAZADA','CANCELADA'],
  VISITA_ESTADOS: ['PENDIENTE','CONFIRMADA','REALIZADA','CANCELADA'],
  SOLICITUD_TIPOS: ['NUEVO_CONTRATO','AMPLIACION','REUBICACION','RECONEXION'],
  VISITA_TIPOS: ['INSTALACION','MANTENIMIENTO','FALLA','RECARGA','COBRO'],
  MONEDA: 'S/ '
};

/***********************
 *  HELPERS BASE
 ***********************/
function ss(){
  if (DB.SS_ID) return SpreadsheetApp.openById(DB.SS_ID);
  const s = SpreadsheetApp.getActiveSpreadsheet();
  if (!s) throw new Error('No hay hoja de calculo activa. Configura DB.SS_ID en Code.gs');
  return s;
}
function tab(name){ const sh = ss().getSheetByName(name); if (!sh) throw new Error('No existe la hoja: '+name+' (ejecuta initDB)'); return sh; }
function tz(){ return 'America/Lima'; }
function nowISO(){ return Utilities.formatDate(new Date(), tz(), "yyyy-MM-dd'T'HH:mm:ss"); }
function todayISO(){ return Utilities.formatDate(new Date(), tz(), 'yyyy-MM-dd'); }
function uid_(p){ return (p||'')+Utilities.getUuid().replace(/-/g,'').slice(0,10).toUpperCase(); }
function codeNum_(p, n){ return p+String(n||'').padStart(6,'0'); }
function fmtNum_(n){ return Math.round(Number(n||0)*100)/100; }
function escH_(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function normText_(s){ return String(s||'').trim().toLowerCase(); }
function withLock_(fn){
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function publicLimit_(key, tel, max, hours){
  try {
    const p = PropertiesService.getScriptProperties();
    const k = 'lim_'+key+'_'+String(tel||'x').replace(/\D/g,'').slice(-9);
    const now = Date.now();
    let cur = null;
    try { const j = JSON.parse(p.getProperty(k)||'null'); if (j && j.window > now) cur = j; } catch(_){}
    const cnt = (cur && Number(cur.cnt)) || 0;
    if (cnt >= max) return false;
    p.setProperty(k, JSON.stringify({ cnt: cnt+1, window: now + (hours||24)*3600000 }));
    return true;
  } catch(_){ return true; }
}

function getHeadIndex_(sh){
  const head = sh.getRange(1,1,1,Math.max(1,sh.getLastColumn())).getValues()[0].map(x=>String(x||''));
  const idx = Object.fromEntries(head.map((h,i)=>[h,i]));
  return { head, idx };
}
function mustIndex_(idx, cols){
  cols.forEach(c => { if (!(c in idx)) throw new Error('Falta columna "'+c+'" en la hoja'); });
}
function readSheetData_(tabName){
  const sh = tab(tabName);
  const values = sh.getDataRange().getValues();
  if (!values.length) return { sh, head:[], idx:{}, rows:[] };
  const head = values.shift().map(x=>String(x||''));
  if (!head.join('')) return { sh, head:[], idx:{}, rows: values };
  const idx = Object.fromEntries(head.map((h,i)=>[h,i]));
  return { sh, head, idx, rows: values };
}
function writeRow_(sh, idx, data){
  const head = sh.getRange(1,1,1,Math.max(1,sh.getLastColumn())).getValues()[0].map(x=>String(x||''));
  const row = head.map(h => data[h] !== undefined ? data[h] : '');
  sh.appendRow(row);
}
function updateRow_(sh, rowNum, idx, data){
  Object.entries(data).forEach(([k,v]) => {
    if (k in idx) sh.getRange(rowNum, idx[k]+1).setValue(v);
  });
}
function getConfig_(key, def){
  try {
    const { idx, rows } = readSheetData_(DB.TABS.CONFIG);
    if (!('clave' in idx && 'valor' in idx)) return def;
    const r = rows.find(x => normText_(x[idx.clave]) === normText_(key));
    if (r) return r[idx.valor];
  } catch(_){}
  return def;
}
function setConfig_(key, val){
  const sh = tab(DB.TABS.CONFIG);
  const { idx, rows } = readSheetData_(DB.TABS.CONFIG);
  if (!('clave' in idx && 'valor' in idx)) throw new Error('Hoja CONFIG mal formada');
  const pos = rows.findIndex(r => normText_(r[idx.clave]) === normText_(key));
  if (pos>=0){ sh.getRange(pos+2, idx.valor+1).setValue(String(val||'')); }
  else { writeRow_(sh, idx, { clave: key, valor: String(val||''), notas: '', actualizado_en: nowISO() }); }
}
function audit_(usuario, accion, detalle){
  try {
    const sh = tab(DB.TABS.AUDITORIA);
    const { idx } = getHeadIndex_(sh);
    writeRow_(sh, idx, { fecha: nowISO(), usuario: usuario||'public', accion: accion||'', detalle: detalle||'' });
  } catch(_){}
}
function notifyAdmin_(asunto, cuerpo){
  try {
    const email = getConfig_('notify_email','');
    if (email) GmailApp.sendEmail(email, asunto, cuerpo);
  } catch(_){}
}
function notifyEmail_(to, asunto, cuerpo){
  try { if (to) GmailApp.sendEmail(to, asunto, cuerpo); } catch(_){}
}
function notifyWa_(telefono, mensaje){
  try {
    const url = getConfig_('notify_wa_url','');
    const token = getConfig_('notify_wa_token','');
    if (!url) return;
    const num = String(telefono||'').replace(/\D/g,'');
    const to = num.length===9 ? '51'+num : num;
    const payload = { to: to, text: mensaje };
    if (token){ payload.token = token; }
    const opts = { method:'post', contentType:'application/json', muteHttpExceptions:true, payload: JSON.stringify(payload) };
    if (url.indexOf('{token}')>=0){ url = url.replace('{token}', encodeURIComponent(token)); }
    UrlFetchApp.fetch(url, opts);
  } catch(_){}
}
function notifyEstadoCliente_(tabName, rowNum, field, value){
  try {
    const { idx: fIdx, rows } = readSheetData_(tabName);
    const r = rows[Number(rowNum)-2];
    if (!r) return;
    const email = ('email' in fIdx) ? r[fIdx.email] : '';
    const tel = ('telefono' in fIdx) ? r[fIdx.telefono] : '';
    const nombre = ('nombres' in fIdx) ? r[fIdx.nombres] : '';
    const codigo = ('solicitud_id' in fIdx) ? r[fIdx.solicitud_id] : (('visita_id' in fIdx) ? r[fIdx.visita_id] : '');
    const asunto = 'Estado actualizado: '+value;
    const cuerpo = 'Hola '+nombre+',\nTu solicitud/visita cambió a: '+value+'\nCódigo: '+codigo;
    notifyEmail_(email, asunto, cuerpo);
    notifyWa_(tel, 'Hola '+nombre+'!\n'+(codigo? 'Tu código '+codigo+' ':'')+'cambió a: '+value+'. Respuesta de NetSatipo.');
  } catch(_){}
}

/***********************
 *  INIT DB
 ***********************/
function initDB(){
  const s = ss();
  const ensure = (name, headers) => {
    if (!s.getSheetByName(name)) s.insertSheet(name);
    const sh = s.getSheetByName(name);
    const cur = sh.getRange(1,1,1,sh.getLastColumn()||1).getValues()[0].map(x=>String(x||''));
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    if (cur.join('') !== headers.join('')) sh.getRange(1,1,1,headers.length).setValues([headers]);
    return sh;
  };
  ensure(DB.TABS.CONFIG, ['clave','valor','notas','actualizado_en']);
  ensure(DB.TABS.PLANES, ['plan_id','nombre','velocidad','precio','periodicidad','extras','recomendado','activo','orden','creado_en','actualizado_en']);
  ensure(DB.TABS.CLIENTES, ['cliente_id','dni','nombres','telefono','email','direccion','distrito','plan_id','estado','fecha_alta','notas','creado_en','actualizado_en','prioridad','condicion','cuota_especial','saldo_a_favor']);
  ensure(DB.TABS.SOLICITUDES, ['solicitud_id','tipo','plan_id','plan_nombre','nombres','dni','telefono','email','direccion','distrito','pago_metodo','pago_estado','estado','observaciones','creado_en','actualizado_en','firma','firmado_en','creado_por']);
  ensure(DB.TABS.VISITAS, ['visita_id','cliente_id','nombres','dni','telefono','tipo_visita','fecha_propuesta','hora_propuesta','direccion','distrito','notas','estado','tecnico','creado_en','actualizado_en','adjunto']);
  ensure(DB.TABS.PAGOS, ['pago_id','solicitud_id','cliente_id','cliente_nombre','monto','metodo','referencia','estado','registrado_por','creado_en','confirmado_en']);
  ensure(DB.TABS.FACTURAS, ['factura_id','cliente_id','cliente_nombre','plan_id','plan_nombre','periodo','monto','vencimiento','estado','metodo','referencia','pagado_en','creado_en','actualizado_en','enviado_email','enviado_wa']);
  ensure(DB.TABS.AUDITORIA, ['fecha','usuario','accion','detalle']);
  ensure(DB.TABS.FOTOS, ['foto_id','solicitud_id','cliente_id','url','nota','subido_por','creado_en']);
  const confDefault = {
    empresa_nombre: 'NetSatipo',
    lema: 'Internet de alta velocidad para Satipo',
    whatsapp: '+51 999 999 999',
    telefono: '(064) 000 000',
    correo_contacto: 'contacto@netsatipo.pe',
    direccion_oficina: 'Jr. Satipo 123, Satipo - Junín',
    horario: 'Lun a Vie 8:00a.m. - 6:00p.m. / Sáb 8:00a.m. - 12:00p.m.',
    distritos: '',
    admin_pass: 'admin123',
    tecnico_clave: 'tec2026',
    ventas_clave: 'ventas2026',
    notify_email: '',
    pasarela_on: 'no',
    pasarela_nombre: 'Izipay',
    yape_telefono: '',
    yape_nombre: '',
    plin_telefono: '',
    plin_nombre: '',
    banco_nombre: '',
    banco_cuenta: '',
    banco_titular: '',
    tema: 'confianza',
    razon_social: '',
    ruc: '',
    domicilio_fiscal: '',
    dpo_email: '',
    sitio_web: 'https://yepez8981.github.io/NetSatipo/',
    cuota_instalacion: '49',
    estado_red: 'Sin incidencias: red operativa de día y de noche.',
    licencias: 'Autorizado por el MTC · Supervisado por OSIPTEL',
    zona_wifi_text: 'Wi-Fi gratis en parques y zonas públicas de Satipo: escríbenos para conocer los puntos habilitados.',
    promo_titulo: '',
    promo_texto: '',
    promo_price: '',
    promo_fin: ''
  };
  const confSh = s.getSheetByName(DB.TABS.CONFIG);
  const { idx: cIdx, rows: cRows } = readSheetData_(DB.TABS.CONFIG);
  if (!('clave' in cIdx)) throw new Error('Hoja CONFIG mal formada');
  Object.entries(confDefault).forEach(([k,v]) => {
    const found = cRows.some(r => normText_(r[cIdx.clave]) === k);
    if (!found) writeRow_(confSh, cIdx, { clave: k, valor: v, notas: '', actualizado_en: nowISO() });
  });
  // Planes por defecto si la hoja esta vacia
  const plSh = s.getSheetByName(DB.TABS.PLANES);
  const { idx: pIdx, rows: pRows } = readSheetData_(DB.TABS.PLANES);
  if (!('plan_id' in pIdx)) throw new Error('Hoja PLANES mal formada');
  if (pRows.length === 0){
    const defPlanes = [
      ['PLN-000001','Básico','20 Mbps',59,'MENSUAL','WiFi incluido, 1 router, streaming 1 TV',false,true,1,nowISO(),nowISO()],
      ['PLN-000002','Hogar','50 Mbps',79,'MENSUAL','WiFi, router, 2 TVs en streaming, soporte 24/7',true,true,2,nowISO(),nowISO()],
      ['PLN-000003','Hogar Plus','100 Mbps',99,'MENSUAL','WiFi 5G, router, 4 TVs, prioridad en soporte',false,true,3,nowISO(),nowISO()],
      ['PLN-000004','Empresarial','200 Mbps',149,'MENSUAL','IP fija, soporte prioritario, SLA',false,true,4,nowISO(),nowISO()]
    ];
    defPlanes.forEach(r => plSh.appendRow(r));
  }
  audit_('sistema', 'initDB', 'Base de datos inicializada');
  return { ok:true, message:'Base de datos lista' };
}

/***********************
 *  FIX CONFIG (correcciones manuales a CONFIG)
 ***********************/
function fixConfig(){
  const fixes = [];
  const set = (k, v, motivo) => {
    const cur = String(getConfig_(k,'')||'').trim();
    if (cur !== v){
      setConfig_(k, v);
      fixes.push({ clave: k, antes: cur, despues: v, motivo: motivo });
    } else {
      fixes.push({ clave: k, estado: 'ok', motivo: motivo });
    }
  };
  // 1. WhatsApp: corregir celda con error de formula "#ERROR!" o numero con '+' (que Sheets
  //    interpreta como formula). Se guarda como texto simple sin el signo + al inicio.
  const wap = String(getConfig_('whatsapp','')||'');
  if (wap === '#ERROR!' || /^\+/.test(wap) || /^=/.test(wap)){
    const limpiado = wap.replace(/^[+=]/,'').replace(/[^\d\s+]/g,'').trim();
    set('whatsapp', limpiado || '+51 999 999 999', 'Celda con error de formula, se guardo el numero como texto');
  } else {
    fixes.push({ clave: 'whatsapp', estado: 'ok', motivo: 'Valor aparentemente valido' });
  }
  // 2. Distritos: si esta vacia, pone la lista por defecto (visible en "Agendar visita").
  set('distritos', 'Satipo, Mazamari, Coviriali, Río Negro', 'Lista de distritos vacia');
  // 3. Tema visual: si esta vacio, activa el tema de confianza.
  set('tema', 'confianza', 'Tema vacio, se aplico el por defecto');
  // 4. Contrasena admin: fijada a peticion del operador.
  {
    const actual = String(getConfig_('admin_pass','')||'');
    const nueva = 'Valen.220610@';
    if (actual === '' || actual === 'admin123' || actual !== nueva){
      setConfig_('admin_pass', nueva);
      fixes.push({ clave: 'admin_pass', antes: actual ? '***' : '(vacia)', despues: '***', motivo: 'Contrasena admin configurada' });
    } else {
      fixes.push({ clave: 'admin_pass', estado: 'ok', motivo: 'Ya configurada' });
    }
  }
  audit_('sistema', 'fixConfig', 'Reparacion de CONFIG ejecutada');
  return { ok:true, fixes: fixes };
}

/***********************
 *  HEALTH / ROUTER
 ***********************/
function doGet(e){
  // Backend puro: la web vive en GitHub Pages / Netlify.
  if (e && e.parameter && e.parameter.callback){
    const out = { ok:true, service:'netsatipo', now: nowISO() };
    return ContentService.createTextOutput(e.parameter.callback + '(' + JSON.stringify(out) + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  if (e && e.parameter && e.parameter.json){
    return ContentService.createTextOutput(JSON.stringify({ ok:true, service:'netsatipo', now: nowISO() })).setMimeType(ContentService.MimeType.JSON);
  }
  const sitio = getConfig_('sitio_web','');
  const nom = getConfig_('empresa_nombre','NetSatipo');
  return HtmlService.createHtmlOutput(
    '<html><body style="font-family:Arial,Helvetica,sans-serif;text-align:center;padding:40px;line-height:1.7">'
    +'<h2>'+nom+' — API activo</h2>'
    +'<p>Este endpoint es el backend (API) del sistema, no una página web pública.</p>'
    +(sitio ? '<p>Web oficial: <a href="'+sitio+'">'+sitio+'</a></p>' : '')
    +'<p>Para verificar el servicio usa: <code>'+'?'+'json=1</code></p>'
    +'</body></html>'
  ).setTitle(nom);
}

function doPost(e){
  try{
    const body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    const fn = body.fn;
    const args = body.args || [];
    if (!fn || typeof this[fn] !== 'function'){
      return ContentService.createTextOutput(JSON.stringify({ ok:false, error:'Función no encontrada: '+fn })).setMimeType(ContentService.MimeType.JSON);
    }
    const result = this[fn].apply(null, args);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  }catch(err){
    return ContentService.createTextOutput(JSON.stringify({ ok:false, error: String(err && err.message || err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function __rpc(fn, args, ctx){
  args = args || [];
  if (typeof this[fn] !== 'function'){
    return { ok:false, error:'Función no encontrada: '+fn, _rpc:true };
  }
  try {
    const result = this[fn].apply(null, args);
    return { ok:true, result: result };
  } catch(err){
    return { ok:false, error: String(err && err.message || err), _rpc:true };
  }
}
function ping(){ return { ok:true, pong:true, time: nowISO() }; }

/***********************
 *  SESIONES (persistentes: sobreviven a republicar el Web App)
 ***********************/
var SES_LAST_CLEAN = 0;
function sesPut_(prefix, token, value, ttlMs){
  if (!token) return;
  const p = PropertiesService.getScriptProperties();
  p.setProperty(prefix+token, JSON.stringify({ v: value, exp: Date.now()+ttlMs }));
  // Limpieza ocasional de sesiones vencidas
  if (Date.now() - SES_LAST_CLEAN > 30*60*1000){
    SES_LAST_CLEAN = Date.now();
    try {
      const props = p.getProperties();
      const now = Date.now();
      Object.keys(props).forEach(k => {
        if (['adm_','cli_','tec_','ven_'].some(x => k.indexOf(x)===0)){
          try { const j = JSON.parse(props[k]); if (!j || !j.exp || j.exp < now) p.deleteProperty(k); } catch(_){ p.deleteProperty(k); }
        }
      });
    } catch(_){}
  }
}
function sesGet_(prefix, token){
  if (!token) return null;
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(prefix+token);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (j && j.exp && j.exp >= Date.now()) return j.v;
    PropertiesService.getScriptProperties().deleteProperty(prefix+token);
  } catch(_){}
  return null;
}
function sesDel_(prefix, token){
  try { PropertiesService.getScriptProperties().deleteProperty(prefix+token); } catch(_){}
}

/***********************
 *  ADMIN SESSION
 ***********************/
function adminLogin(pass){
  const expected = getConfig_('admin_pass','');
  if (!expected) throw new Error('No hay contraseña admin configurada (Config -> admin_pass)');
  if (String(pass||'') !== String(expected)) throw new Error('Contraseña incorrecta');
  const token = Utilities.getUuid().replace(/-/g,'');
  sesPut_('adm_', token, nowISO(), 86400*1000);
  audit_('admin', 'login', 'Acceso al panel admin');
  return { ok:true, token: token, name: 'Admin' };
}
function adminLogout(token){
  sesDel_('adm_', token);
  return { ok:true };
}
function requireAdmin_(token){
  if (!token) throw new Error('No autorizado');
  const has = sesGet_('adm_', token);
  if (!has) throw new Error('Sesión expirada o inválida');
  return true;
}

/***********************
 *  PUBLICO: CONFIG Y PLANES
 ***********************/
function getPublicSettings(){
  const res = {};
  WEB_SETTING_KEYS.forEach(k => {
    if (WEB_PASSWORD_KEYS.indexOf(k)>=0) return;
    res[k] = getConfig_(k,'');
  });
  res.pasarela_on = getConfig_('pasarela_on','');
  res.pasarela_nombre = getConfig_('pasarela_nombre','');
  res.moneda = DB.MONEDA;
  res.ok = true;
  return res;
}

function getSiteData(){
  const cfg = getPublicSettings();
  let planes = [];
  try { planes = getPlans(); } catch(_){}
  return { ok:true, config: cfg, planes: planes };
}

/***********************
 *  ADMIN: AJUSTES DE LA WEB (editar CONFIG desde el panel)
 ***********************/
var WEB_SETTING_KEYS = ['empresa_nombre','lema','whatsapp','telefono','correo_contacto','direccion_oficina','horario','yape_telefono','yape_nombre','plin_telefono','plin_nombre','banco_nombre','banco_cuenta','banco_titular','tema','razon_social','ruc','domicilio_fiscal','dpo_email','sitio_web','cuota_instalacion','estado_red','licencias','zona_wifi_text','promo_titulo','promo_texto','promo_price','promo_fin','factura_auto','dias_gracia','aviso_activo','aviso_texto','admin_pass','tecnico_clave','ventas_clave','distritos'];
var WEB_PASSWORD_KEYS = ['admin_pass','tecnico_clave','ventas_clave'];
function adminGetSettings(token){
  requireAdmin_(token);
  const res = {};
  WEB_SETTING_KEYS.forEach(k => res[k] = getConfig_(k,''));
  return { ok:true, settings: res };
}
function adminSaveSettings(pairs, token){
  requireAdmin_(token);
  pairs = pairs || {};
  let n = 0;
  WEB_SETTING_KEYS.forEach(k => {
    if (!(k in pairs)) return;
    let v = String(pairs[k]==null?'':pairs[k]);
    if (WEB_PASSWORD_KEYS.indexOf(k)>=0 && v==='') return;
    setConfig_(k, v);
    n++;
  });
  audit_('admin', 'config', 'Actualizados '+n+' ajustes de la web');
  return { ok:true, message:'Ajustes guardados ('+n+' campos)' };
}

function getPlans(){
  const { idx, rows } = readSheetData_(DB.TABS.PLANES);
  if (!('plan_id' in idx)) return [];
  return rows
    .filter(r => String(r[idx.activo]).toUpperCase() !== 'FALSE')
    .sort((a,b) => Number(a[idx.orden]||0) - Number(b[idx.orden]||0))
    .map(r => ({
      plan_id: r[idx.plan_id]||''.toString(),
      nombre: String(r[idx.nombre]||''),
      velocidad: String(r[idx.velocidad]||''),
      precio: Number(r[idx.precio]||0),
      periodicidad: String(r[idx.periodicidad]||'MENSUAL').toLowerCase(),
      extras: String(r[idx.extras]||'').split('|').map(s=>s.trim()).filter(Boolean),
      recomendado: String(r[idx.recomendado]).toUpperCase()==='TRUE',
      activo: true
    }));
}

/***********************
 *  PUBLICO: CONTRATAR PLAN
 ***********************/
function submitContract(p){
  p = p || {};
  const requeridos = ['plan_id','nombres','telefono','direccion','distrito','pago_metodo'];
  requeridos.forEach(c => { if (!p[c]) throw new Error('Falta el campo: '+c); });
  if (!/^\d{8}$/.test(String(p.dni||''))) throw new Error('Ingresa un DNI válido de 8 dígitos');
  if (!/^\d{9}$/.test(String(p.telefono||''))) throw new Error('Ingresa un teléfono válido de 9 dígitos');
  const tipo = DB.SOLICITUD_TIPOS.includes(p.tipo) ? p.tipo : 'NUEVO_CONTRATO';
  if (tipo==='NUEVO_CONTRATO'){
    const dupe = verificarDuplicado({ dni:p.dni, telefono:p.telefono });
    if (dupe && dupe.ok){
      if (dupe.solicitud) throw new Error('Ya existe una solicitud en curso ('+dupe.solicitud.solicitud_id+', estado '+dupe.solicitud.estado+'). Te contactaremos pronto.');
      if (dupe.cliente && /ACTIVO|INSTALAD/i.test(String(dupe.cliente.estado).toUpperCase())) throw new Error('Este DNI o teléfono ya figura como cliente activo. Entra a Tu portal (Mi cuenta) o agenda una visita de soporte.');
    }
  }
  const { idx, rows } = readSheetData_(DB.TABS.PLANES);
  if (!('plan_id' in idx)) throw new Error('No hay planes registrados');
  const plan = rows.find(r => r[idx.plan_id]===p.plan_id && String(r[idx.activo]).toUpperCase()!=='FALSE');
  if (!plan) throw new Error('El plan seleccionado no existe');
  const pagoEstado = 'PENDIENTE';
  if (!publicLimit_('sol', p.telefono, 5, 24)) throw new Error('Has llegado al límite de solicitudes desde este número hoy. Escríbenos por WhatsApp.');
  const creado = withLock_(() => {
    const sh = tab(DB.TABS.SOLICITUDES);
    const { idx: sIdx } = getHeadIndex_(sh);
    const num = (sh.getLastRow()||0);
    const sid = 'SOL-'+Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd')+'-'+String(num+1).padStart(3,'0');
    const data = {
    solicitud_id: sid,
    tipo: tipo,
    plan_id: p.plan_id,
    plan_nombre: String(plan[idx.nombre]||''),
    nombres: String(p.nombres||'').toUpperCase().replace(/\s+/g,' ').trim(),
    dni: String(p.dni||''),
    telefono: String(p.telefono||''),
    email: String(p.email||'').toLowerCase(),
    direccion: String(p.direccion||''),
    distrito: String(p.distrito||''),
    pago_metodo: p.pago_metodo,
    pago_estado: pagoEstado,
    estado: 'PENDIENTE',
    observaciones: String(p.observaciones||''),
    creado_en: nowISO(),
    actualizado_en: nowISO()
  };
  writeRow_(sh, sIdx, data);
  // Guardar como cliente si aún no existe
  upsertClienteByPhone_(p.telefono, { dni:p.dni, nombres:data.nombres, telefono:p.telefono, email:data.email, direccion:data.direccion, distrito:data.distrito, plan_id:p.plan_id, estado:'PENDIENTE' });
    return { sid: sid, data: data };
  });
  audit_('public', 'solicitud', 'Nueva solicitud '+creado.sid+' plan '+creado.data.plan_nombre);
  notifyAdmin_('Nueva solicitud de contratación '+creado.sid,
    'Plan: '+creado.data.plan_nombre+'\nCliente: '+creado.data.nombres+'\nDNI: '+creado.data.dni+'\nTel: '+creado.data.telefono+'\nPago: '+p.pago_metodo+'\n'+creado.data.direccion+', '+creado.data.distrito);
  return { ok:true, solicitud_id: creado.sid, message: '¡Solicitud enviada! Guarda tu código: '+creado.sid+' para dar seguimiento.' };
}

function verificarDuplicado(dato){
  const dni = String(dato.dni||'').replace(/\D/g,'');
  const tel = String(dato.telefono||'').replace(/\D/g,'');
  const out = { ok:true, cliente:null, solicitud:null };
  if (!dni && !tel) return out;
  try {
    const { idx, rows } = readSheetData_(DB.TABS.CLIENTES);
    if ('cliente_id' in idx){
      const hit = rows.find(r =>
        (dni && String(r[idx.dni]||'').replace(/\D/g,'')===dni) ||
        (tel && String(r[idx.telefono]||'').replace(/\D/g,'')===tel));
      if (hit) out.cliente = { cliente_id: String(hit[idx.cliente_id]||''), nombres: String(hit[idx.nombres]||''), estado: String(hit[idx.estado]||'') };
    }
  } catch(_){}
  try {
    const { idx: sIdx, rows: sRows } = readSheetData_(DB.TABS.SOLICITUDES);
    if ('solicitud_id' in sIdx){
      const activas = ['PENDIENTE','EN_REVISION','APROBADO','APROBADA','INSTALADO','INSTALADA'];
      const hit = sRows.find(r =>
        String(r[sIdx.tipo]||'')==='NUEVO_CONTRATO' &&
        activas.indexOf(String(r[sIdx.estado]||'').toUpperCase())>=0 &&
        ((dni && String(r[sIdx.dni]||'').replace(/\D/g,'')===dni) || (tel && String(r[sIdx.telefono]||'').replace(/\D/g,'')===tel)));
      if (hit) out.solicitud = { solicitud_id: String(hit[sIdx.solicitud_id]||''), estado: String(hit[sIdx.estado]||'') };
    }
  } catch(_){}
  return out;
}

function getSolicitudStatus(p){
  p = p || {};
  const { idx, rows } = readSheetData_(DB.TABS.SOLICITUDES);
  if (!('solicitud_id' in idx)) throw new Error('Base mal formada');
  const r = rows.find(x => x[idx.solicitud_id]===p.solicitud_id);
  if (!r) return { ok:false, error:'No se encontró la solicitud' };
  const verifier = normText_(p.verifier);
  const okVerifier = verifier && (verifier === String(r[idx.telefono]||'').slice(-4) || verifier === normText_(r[idx.email]||'').toLowerCase() || verifier === normText_(r[idx.dni]||'').toLowerCase());
  if (!okVerifier) return { ok:false, error:'Verificación inválida' };
  return { ok:true, data:{ solicitud_id: r[idx.solicitud_id], estado: r[idx.estado]||'', plan_nombre: r[idx.plan_nombre]||'', pago_metodo: r[idx.pago_metodo]||'', pago_estado: r[idx.pago_estado]||'', actualizado_en: r[idx.actualizado_en]||'' } };
}

/***********************
 *  PUBLICO: CLIENTES (verificación + visitas)
 ***********************/
function upsertClienteByPhone_(telefono, c){
  if (!telefono) return null;
  const sh = tab(DB.TABS.CLIENTES);
  const { idx, rows } = readSheetData_(DB.TABS.CLIENTES);
  if (!('telefono' in idx)) throw new Error('Hoja CLIENTES mal formada');
  const pos = rows.findIndex(r => String(r[idx.telefono]||'')===String(telefono));
  const now = nowISO();
  if (pos>=0){
    const rowNum = pos+2;
    if (c.dni && 'dni' in idx && !rows[pos][idx.dni]) sh.getRange(rowNum, idx.dni+1).setValue(c.dni);
    if (c.nombres && 'nombres' in idx && !rows[pos][idx.nombres]) sh.getRange(rowNum, idx.nombres+1).setValue(c.nombres);
    if (c.email && 'email' in idx && !rows[pos][idx.email]) sh.getRange(rowNum, idx.email+1).setValue(c.email);
    if (c.direccion && 'direccion' in idx) sh.getRange(rowNum, idx.direccion+1).setValue(c.direccion);
    if (c.distrito && 'distrito' in idx && !rows[pos][idx.distrito]) sh.getRange(rowNum, idx.distrito+1).setValue(c.distrito);
    if ('actualizado_en' in idx) sh.getRange(rowNum, idx.actualizado_en+1).setValue(now);
    const cid = rows[pos][idx.cliente_id] || 'CLI-'+String(uid_());
    if (!rows[pos][idx.cliente_id] && 'cliente_id' in idx) sh.getRange(rowNum, idx.cliente_id+1).setValue(cid);
    return cid;
  }
  const cid = 'CLI-'+uid_();
  const data = {
    cliente_id: cid, dni: c.dni||'', nombres: c.nombres||'', telefono: telefono,
    email: c.email||'', direccion: c.direccion||'', distrito: c.distrito||'',
    plan_id: c.plan_id||'', estado: c.estado||'PENDIENTE', fecha_alta: todayISO(),
    notas: '', creado_en: now, actualizado_en: now
  };
  writeRow_(sh, idx, data);
  return cid;
}

function verifyClient(p){
  p = p || {};
  const q = String(p.query||'').trim().toLowerCase();
  if (!q) throw new Error('Ingresa DNI, teléfono o email');
  const { idx, rows } = readSheetData_(DB.TABS.CLIENTES);
  if (!('telefono' in idx)) throw new Error('Base mal formada');
  const match = rows.find(r =>
    normText_(r[idx.telefono]||'').replace(/\D/g,'').slice(-9) === q.replace(/\D/g,'').slice(-9) ||
    normText_(r[idx.dni]||'').replace(/\D/g,'') === q.replace(/\D/g,'') ||
    normText_(r[idx.email]||'') === q
  );
  if (!match){
    // Verificar si tiene una solicitud aprobada/instalada sin estar en CLIENTES
    return { ok:false, error:'No encontramos tu servicio. Solo clientes con servicio pueden agendar visitas.' };
  }
  return {
    ok:true,
    cliente: {
      cliente_id: match[idx.cliente_id]||'',
      dni: normText_(match[idx.dni]||'').replace(/\D/g,''),
      nombres: match[idx.nombres]||'',
      telefono: match[idx.telefono]||'',
      direccion: match[idx.direccion]||'',
      distrito: match[idx.distrito]||'',
      estado: match[idx.estado]||'',
      plan_id: match[idx.plan_id]||''
    }
  };
}

function scheduleVisit(p){
  p = p || {};
  ['nombres','telefono','tipo_visita','fecha_propuesta'].forEach(c => { if (!p[c]) throw new Error('Falta el campo: '+c); });
  if (!/^\d{9}$/.test(String(p.telefono||''))) throw new Error('Teléfono inválido');
  const dniDig = String(p.dni||'').replace(/\D/g,'');
  if (String(p.dni||'') && !/^\d{8}$/.test(dniDig)) throw new Error('DNI inválido');
  // Validación: sólo clientes con servicio (o solicitud instalada)
  const verif = verifyClient({ query: dniDig || String(p.telefono||'') || String(p.email||'') || '' });
  if (!verif.ok) throw new Error(verif.error);
  const tipo = DB.VISITA_TIPOS.includes(p.tipo_visita) ? p.tipo_visita : 'MANTENIMIENTO';
  if (!publicLimit_('vis', p.telefono, 5, 24)) throw new Error('Has llegado al límite de visitas desde este número hoy. Escríbenos por WhatsApp.');
  const vid = withLock_(() => {
    const sh = tab(DB.TABS.VISITAS);
    const { idx } = getHeadIndex_(sh);
    const num = (sh.getLastRow()||0);
    const vid = 'VIS-'+Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd')+'-'+String(num+1).padStart(3,'0');
  const data = {
    visita_id: vid,
    cliente_id: verif.cliente.cliente_id||'',
    nombres: String(p.nombres||'').toUpperCase().replace(/\s+/g,' ').trim(),
    dni: dniDig,
    telefono: String(p.telefono||''),
    tipo_visita: tipo,
    fecha_propuesta: String(p.fecha_propuesta||''),
    hora_propuesta: String(p.hora_propuesta||''),
    direccion: String(p.direccion||'') || (verif.cliente.direccion||''),
    distrito: String(p.distrito||'') || (verif.cliente.distrito||''),
    notas: String(p.notas||''),
    estado: 'PENDIENTE',
    tecnico: '',
    creado_en: nowISO(),
    actualizado_en: nowISO(),
    adjunto: String(p.adjunto||'')
  };
  writeRow_(sh, idx, data);
    return { vid: vid, data: data };
  });
  audit_('public', 'visita', 'Nueva visita '+vid.vid+' tipo '+vid.data.tipo+' cliente '+vid.data.nombres+((vid.data.adjunto)?' [con adjunto]':''));
  notifyAdmin_('Nueva visita agendada '+vid.vid,
    'Tipo: '+vid.data.tipo+'\nCliente: '+vid.data.nombres+'\nTel: '+vid.data.telefono+'\nFecha: '+p.fecha_propuesta+' '+(p.hora_propuesta||'')+'\n'+vid.data.direccion+', '+vid.data.distrito);
  notifyWa_(vid.data.telefono, 'Hola '+vid.data.nombres+'! Agendamos tu visita ('+vid.data.tipo+') para el '+p.fecha_propuesta+' '+(p.hora_propuesta||'')+'. Tu código: '+vid.vid+'. Te avisaremos cuando esté confirmado.');
  return { ok:true, visita_id: vid.vid, message: '¡Visita agendada! tu código: '+vid.vid };
}

function getVisitaStatus(p){
  p = p || {};
  const { idx, rows } = readSheetData_(DB.TABS.VISITAS);
  if (!('visita_id' in idx)) throw new Error('Base mal formada');
  const r = rows.find(x => x[idx.visita_id]===p.visita_id);
  if (!r) return { ok:false, error:'No se encontró la visita' };
  const verifier = normText_(p.verifier);
  const okVerifier = verifier && (verifier === String(r[idx.telefono]||'').slice(-4) || verifier === normText_(r[idx.dni]||'') || verifier === normText_(r[idx.email]||''));
  if (!okVerifier) return { ok:false, error:'Verificación inválida' };
  return { ok:true, data:{ visita_id: r[idx.visita_id], estado: r[idx.estado]||'', tipo_visita: r[idx.tipo_visita]||'', fecha_propuesta: r[idx.fecha_propuesta]||'', tecnico: r[idx.tecnico]||'', actualizado_en: r[idx.actualizado_en]||'' } };
}

/***********************
 *  PUBLICO: MI SERVICIO (seguimiento ampliado)
 ***********************/
function miServicio(p){
  p = p || {};
  const codigo = String(p.codigo||'').trim().toUpperCase();
  const verifier = normText_(p.verifier||'');
  if (!codigo || !verifier) throw new Error('Ingresa tu código y la verificación');
  const { idx: sIdx, rows: sRows } = readSheetData_(DB.TABS.SOLICITUDES);
  const { idx: vIdx, rows: vRows } = readSheetData_(DB.TABS.VISITAS);
  const sol = ('solicitud_id' in sIdx) ? sRows.find(x => x[sIdx.solicitud_id]===codigo) : null;
  const vis = !sol && ('visita_id' in vIdx) ? vRows.find(x => x[vIdx.visita_id]===codigo) : null;
  const reg = sol || vis;
  if (!reg) return { ok:false, error:'No encontramos ese código. Revisa que sea SOL-…, VIS-…, RCL-… o GES-…' };
  const idx = sol ? sIdx : vIdx;
  const tel = String(reg[idx.telefono]||'').replace(/\D/g,'');
  const okV = verifier && (verifier === String(reg[idx.telefono]||'').slice(-4) || verifier === normText_(reg[idx.dni]||'') || verifier === normText_(reg[idx.email]||'').toLowerCase());
  if (!okV) return { ok:false, error:'Verificación inválida' };
  const registro = {
    codigo: codigo,
    tipo: sol ? String(reg[idx.tipo]||'SOLICITUD') : 'VISITA',
    estado: reg[idx.estado]||'',
    plan_nombre: reg[idx.plan_nombre]||'',
    tipo_visita: reg[idx.tipo_visita]||'',
    fecha_propuesta: reg[idx.fecha_propuesta]||'',
    fecha_registro: reg[idx.creado_en]||'',
    actualizado_en: reg[idx.actualizado_en]||'',
    tecnico: reg[idx.tecnico]||''
  };
  const normTel = tel || 'x';
  const srcDni = normText_(reg[idx.dni]||'');
  const matchRow = (r, i2) => (!tel || String(r[i2.telefono]||'').replace(/\D/g,'') === tel) || (srcDni && normText_(r[i2.dni]||'') === srcDni);
  const solicitudes = sol ? [] : sRows.filter(r => matchRow(r, sIdx)).map(r => ({ codigo: r[sIdx.solicitud_id], tipo: r[sIdx.tipo], estado: r[sIdx.estado], plan_nombre: r[sIdx.plan_nombre], fecha: r[sIdx.creado_en] })).sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha))).slice(0,5);
  const visitas = vis ? [] : vRows.filter(r => matchRow(r, vIdx)).map(r => ({ codigo: r[vIdx.visita_id], tipo_visita: r[vIdx.tipo_visita], estado: r[vIdx.estado], fecha_propuesta: r[vIdx.fecha_propuesta], tecnico: r[vIdx.tecnico] })).sort((a,b)=>String(b.fecha_propuesta).localeCompare(String(a.fecha_propuesta))).slice(0,5);
  let pagos = [];
  try {
    const { idx: pIdx, rows: pRows } = readSheetData_(DB.TABS.PAGOS);
    if ('pago_id' in pIdx){
      const mtel = tel || 'x';
      pagos = pRows.filter(r => normText_(r[pIdx.cliente_nombre]||'') === normText_(reg[idx.nombres]||'')).map(r => ({ pago_id: r[pIdx.pago_id], monto: r[pIdx.monto], metodo: r[pIdx.metodo], estado: r[pIdx.estado], fecha: r[pIdx.creado_en], confirmado_en: r[pIdx.confirmado_en] })).sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha))).slice(0,5);
    }
  } catch(_){}
  const nombre = reg[idx.nombres]||'';
  return { ok:true, registro: registro, cliente: { nombres: nombre }, solicitudes: solicitudes, visitas: visitas, pagos: pagos };
}

/***********************
 *  PORTAL CLIENTE (Mi Cuenta)
 ***********************/
function clientLogin(p){
  p = p || {};
  const dni = String(p.dni||'').replace(/\D/g,'');
  const contacto = normText_(p.contacto||'');
  if (!/^\d{8}$/.test(dni)) throw new Error('Ingresa tu DNI (8 dígitos)');
  if (!contacto) throw new Error('Ingresa tu correo o tu WhatsApp (9 dígitos)');
  const { idx, rows } = readSheetData_(DB.TABS.CLIENTES);
  if (!('dni' in idx && 'telefono' in idx && 'email' in idx)) throw new Error('Base de clientes mal formada');
  const cDigits = contacto.replace(/\D/g,'').slice(-9);
  const match = rows.find(r => {
    if (normText_(r[idx.dni]||'').replace(/\D/g,'') !== dni) return false;
    return normText_(r[idx.email]||'') === contacto || (cDigits && normText_(r[idx.telefono]||'').replace(/\D/g,'').slice(-9) === cDigits);
  });
  if (!match) return { ok:false, error:'No encontramos coincidencias. Ingresas solo si ya contrataste y registraste tu DNI con tu correo o WhatsApp.' };
  const cliente_id = String(match[idx.cliente_id]||'CLI-'+uid_());
  const token = Utilities.getUuid().replace(/-/g,'');
  sesPut_('cli_', token, cliente_id, 43200*1000);
  audit_('cliente', 'login', 'Acceso al portal: '+String(match[idx.nombres]||''));
  return { ok:true, token: token, nombre: String(match[idx.nombres]||''), cliente_id: cliente_id };
}
function clientLogout(token){
  sesDel_('cli_', token);
  return { ok:true };
}
function requireClient_(token){
  if (!token) throw new Error('Sesión no iniciada');
  const cid = sesGet_('cli_', token);
  if (!cid) throw new Error('Tu sesión expiró. Vuelve a ingresar.');
  return cid;
}
function getClienteRow_(cid){
  const { idx, rows } = readSheetData_(DB.TABS.CLIENTES);
  if (!('cliente_id' in idx)) throw new Error('Hoja CLIENTES mal formada');
  const pos = rows.findIndex(x => String(x[idx.cliente_id]||'') === String(cid));
  if (pos<0) return null;
  return { idx, row: rows[pos], rowNum: pos+2 };
}
function esActivoFacturable_(estado){
  return ['ACTIVO','INSTALADO','INSTALADA','APROBADO','APROBADA'].indexOf(String(estado||'').toUpperCase()) >= 0;
}
function cuotaClienteRow_(row, idx){
  const cEsp = Number(row[idx.cuota_especial]||0);
  if (cEsp && cEsp > 0) return cEsp;
  let monto = Number(getConfig_('cuota_default','0')||0);
  try {
    const { idx: pIdx, rows: pRows } = readSheetData_(DB.TABS.PLANES);
    const pl = ('plan_id' in pIdx) ? pRows.find(x => x[pIdx.plan_id]===row[idx.plan_id]) : null;
    if (pl) monto = Number(pl[pIdx.precio]||0);
  } catch(_){}
  if (monto <= 0) monto = 59;
  return monto;
}
function diasGracia_(dias){ return Math.max(0, Number(getConfig_('dias_gracia', dias || '5')||0)); }
function vencDefault_(periodo, dias){
  const partes = String(periodo||'').split('-').map(Number);
  const ddg = diasGracia_(dias);
  let d;
  if (partes.length===2 && partes[0] && partes[1]){
    d = ddg ? new Date(partes[0], partes[1]+1, ddg) : new Date(partes[0], partes[1], 0);
  } else {
    d = ddg ? new Date(Date.now() + ddg*86400000) : new Date();
  }
  return Utilities.formatDate(d, tz(), 'yyyy-MM-dd');
}
function _crearFacturaMes_(cid, row, idx, periodo, opts){
  opts = opts || {};
  const cache = opts.cache || {};
  const d = new Date();
  periodo = periodo || Utilities.formatDate(d, tz(), 'yyyy-MM');
  const fSh = tab(DB.TABS.FACTURAS);
  const fData = cache.f || readSheetData_(DB.TABS.FACTURAS);
  const fIdx = fData.idx; const fRows = fData.rows;
  if (!('factura_id' in fIdx)) throw new Error('Hoja FACTURAS mal formada');
  let plan_nombre = '';
  const pData = cache.p || (function(){ try { return readSheetData_(DB.TABS.PLANES); } catch(_){ return null; } })();
  if (pData && 'plan_id' in pData.idx){
    try {
      const pl = pData.rows.find(x => x[pData.idx.plan_id]===row[idx.plan_id]);
      if (pl) plan_nombre = String(pl[pData.idx.nombre]||'');
    } catch(_){}
  }
  const monto = cuotaClienteRow_(row, idx);
  const fid = withLock_(() => {
    const yaExiste = fRows.some(r => String(r[fIdx.cliente_id]||'') === String(cid) && String(r[fIdx.periodo]||'') === periodo);
    if (yaExiste) return false;
    const num = (fSh.getLastRow()||0);
    const fid = 'FAC-'+String(periodo).replace(/-/g,'')+'-'+String(num+1).padStart(3,'0');
    writeRow_(fSh, fIdx, {
      factura_id: fid, cliente_id: String(cid), cliente_nombre: String(row[idx.nombres]||''),
      plan_id: String(row[idx.plan_id]||''), plan_nombre: plan_nombre, periodo: periodo,
      monto: monto, vencimiento: vencDefault_(periodo),
      estado: 'PENDIENTE', metodo: '', referencia: '', pagado_en: '',
      creado_en: nowISO(), actualizado_en: nowISO()
    });
    return fid;
  });
  if (fid === false) return { creada:false };
  if (!opts.skipAuto){ try { autoAplicarSaldo_(String(cid)); } catch(_){} }
  return { creada:true, factura_id: fid, monto: monto };
}
function ensureFacturaMes_(cid, row, idx){
  if (!esActivoFacturable_(row[idx.estado])) return null;
  const res = _crearFacturaMes_(cid, row, idx);
  return res.creada ? res.factura_id : null;
}
function clientProfile(token){
  const cid = requireClient_(token);
  const found = getClienteRow_(cid);
  if (!found) throw new Error('Cliente no encontrado');
  const { idx, row } = found;
  try { if (getConfig_('factura_auto','NO').toUpperCase()==='SI') ensureFacturaMes_(cid, row, idx); } catch(_){}
  const cliente = {
    cliente_id: cid,
    dni: normText_(row[idx.dni]||'').replace(/\D/g,''),
    nombres: String(row[idx.nombres]||''),
    telefono: String(row[idx.telefono]||''),
    email: String(row[idx.email]||''),
    direccion: String(row[idx.direccion]||''),
    distrito: String(row[idx.distrito]||''),
    estado: String(row[idx.estado]||'PENDIENTE').toUpperCase(),
    fecha_alta: String(row[idx.fecha_alta]||''),
    plan_id: String(row[idx.plan_id]||''),
    notas: String(row[idx.notas]||''),
    prioridad: ('prioridad' in idx) ? String(row[idx.prioridad]||'REGULAR') : 'REGULAR',
    condicion: ('condicion' in idx) ? String(row[idx.condicion]||'') : '',
    cuota_especial: ('cuota_especial' in idx) ? Number(row[idx.cuota_especial]||0) : 0
  };
  cliente.saldo_a_favor = ('saldo_a_favor' in idx) ? Number(row[idx.saldo_a_favor]||0) : 0;
  let plan = null;
  try {
    const { idx: pIdx, rows: pRows } = readSheetData_(DB.TABS.PLANES);
    if ('plan_id' in pIdx){
      const pl = pRows.find(x => x[pIdx.plan_id]===cliente.plan_id);
      if (pl) plan = { plan_id: cliente.plan_id, nombre:String(pl[pIdx.nombre]||''), velocidad:String(pl[pIdx.velocidad]||''), precio:Number(pl[pIdx.precio]||0), periodicidad:String(pl[pIdx.periodicidad]||'MENSUAL'), extras:String(pl[pIdx.extras]||'') };
    }
  } catch(_){}
  let contrato = null;
  try {
    const { idx: sIdx, rows: sRows } = readSheetData_(DB.TABS.SOLICITUDES);
    if ('solicitud_id' in sIdx && 'tipo' in sIdx && 'estado' in sIdx){
      const tel = String(cliente.telefono).replace(/\D/g,'');
      const dni = String(cliente.dni);
      const c = sRows.find(x => String(x[sIdx.tipo]||'')==='NUEVO_CONTRATO' && ['INSTALADA','APROBADA'].indexOf(String(x[sIdx.estado]||'').toUpperCase())>=0 && (normText_(x[sIdx.dni]||'').replace(/\D/g,'')===dni || (tel && normText_(x[sIdx.telefono]||'').replace(/\D/g,'')===tel)));
      if (c) contrato = { codigo:String(c[sIdx.solicitud_id]||''), fecha:String(c[sIdx.creado_en]||''), plan_nombre:String(c[sIdx.plan_nombre]||''), estado:String(c[sIdx.estado]||''), direccion:String(c[sIdx.direccion]||''), distrito:String(c[sIdx.distrito]||''), actualizado_en:String(c[sIdx.actualizado_en]||''), firmado: ('firmado_en' in sIdx) ? Boolean(String(c[sIdx.firmado_en]||'')) : false, firmado_en: ('firmado_en' in sIdx) ? String(c[sIdx.firmado_en]||'') : '' };
    }
  } catch(_){}
  const facturas = [];
  try {
    const { idx: fIdx, rows: fRows } = readSheetData_(DB.TABS.FACTURAS);
    if ('factura_id' in fIdx){
      fRows.filter(r => String(r[fIdx.cliente_id]||'')===String(cid))
        .sort((a,b)=>String(a[fIdx.periodo]||'').localeCompare(String(b[fIdx.periodo]||'')))
        .forEach(r => facturas.push({
          factura_id:String(r[fIdx.factura_id]||''), periodo:String(r[fIdx.periodo]||''),
          plan_nombre:String(r[fIdx.plan_nombre]||''), monto:Number(r[fIdx.monto]||0),
          vencimiento:String(r[fIdx.vencimiento]||''), estado:String(r[fIdx.estado]||'PENDIENTE').toUpperCase(),
          metodo:String(r[fIdx.metodo]||''), pagado_en:String(r[fIdx.pagado_en]||''), creado_en:String(r[fIdx.creado_en]||'')
        }));
    }
  } catch(_){}
  let pendiente = 0; let vencida = false;
  facturas.forEach(f => {
    if (f.estado!=='PAGADA'){
      pendiente += f.monto;
      if (f.vencimiento && String(f.vencimiento) < todayISO()) vencida = true;
    }
  });
  const estSrv = String(cliente.estado||'').toUpperCase();
  let corte = { estado:'ACTIVO', mensaje:'Tu servicio está activo y sin cortes.' };
  if (estSrv==='CORTADO'||estSrv==='SUSPENDIDO'||estSrv==='SUSPENDIDA') corte = { estado:'CORTADO', mensaje:'Tu servicio está suspendido. Escríbenos por WhatsApp para regularizar.' };
  else if (estSrv==='BAJA_SOLICITADA') corte = { estado:'EN_BAJA', mensaje:'Registramos tu solicitud de baja. Un asesor te contactará para confirmarla.' };
  else if (vencida) corte = { estado:'EN_RIESGO', mensaje:'Tienes facturas vencidas. Regulariza antes de la fecha límite para evitar cortes.' };
  return {
    ok:true, cliente: cliente, plan: plan, contrato: contrato,
    facturas: facturas, balance_pendiente: fmtNum_(pendiente), factura_vencida: vencida, corte: corte,
    config: {
      empresa_nombre: getConfig_('empresa_nombre','NetSatipo'), razon_social: getConfig_('razon_social',''),
      ruc: getConfig_('ruc',''), domicilio_fiscal: getConfig_('domicilio_fiscal',''),
      whatsapp: getConfig_('whatsapp',''), yape_telefono: getConfig_('yape_telefono',''), yape_nombre: getConfig_('yape_nombre',''),
      plin_telefono: getConfig_('plin_telefono',''), plin_nombre: getConfig_('plin_nombre','')
    }
  };
}
function clientUpdateProfile(token, p){
  const cid = requireClient_(token);
  const found = getClienteRow_(cid);
  if (!found) throw new Error('Cliente no encontrado');
  const { idx, row } = found;
  const updates = {};
  const email = normText_(p.email||'');
  const telefono = String(p.telefono||'').replace(/\D/g,'');
  if (email){ if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Correo inválido'); updates.email = email; }
  if (telefono){ if (!/^\d{9}$/.test(telefono)) throw new Error('Teléfono inválido'); updates.telefono = telefono; }
  if (p.direccion !== undefined && p.direccion !== null && String(p.direccion).trim()) updates.direccion = String(p.direccion).trim();
  if (p.distrito !== undefined && p.distrito !== null && String(p.distrito).trim()) updates.distrito = String(p.distrito).trim();
  if (!Object.keys(updates).length) return { ok:true, message:'No hubo cambios' };
  updates.actualizado_en = nowISO();
  updateRow_(tab(DB.TABS.CLIENTES), found.rowNum, idx, updates);
  audit_('cliente', 'update', 'Actualizó su perfil: '+Object.keys(updates).join(', '));
  return { ok:true, message:'Tus datos se actualizaron.' };
}
function clientCancelService(token, p){
  p = p || {};
  const cid = requireClient_(token);
  const found = getClienteRow_(cid);
  if (!found) throw new Error('Cliente no encontrado');
  const { idx, row } = found;
  const motivo = String(p.motivo||'OTRO').toUpperCase();
  const detalle = String(p.detalle||'').trim();
  if (['ECONOMICO','CAMBIO_PROVEEDOR','MAL_SERVICIO','MUDANZA','OTRO'].indexOf(motivo)<0) throw new Error('Elige un motivo válido');
  if (String(row[idx.estado]||'').toUpperCase()==='BAJA_SOLICITADA') return { ok:false, error:'Ya tienes una baja en proceso. Te contactaremos.' };
  const notas = (String(row[idx.notas]||'')+' ['+nowISO()+'] Baja solicitada: '+motivo+(detalle? ' — '+detalle:'')).trim();
  updateRow_(tab(DB.TABS.CLIENTES), found.rowNum, idx, { estado:'BAJA_SOLICITADA', notas: notas, actualizado_en: nowISO() });
  const sSh = tab(DB.TABS.SOLICITUDES);
  const { idx: sIdx } = getHeadIndex_(sSh);
  const num = (sSh.getLastRow()||0);
  const rid = 'BJS-'+Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd')+'-'+String(num+1).padStart(3,'0');
  writeRow_(sSh, sIdx, {
    solicitud_id: rid, tipo:'BAJA', plan_id:String(row[idx.plan_id]||''), plan_nombre:'',
    nombres:String(row[idx.nombres]||''), dni:String(row[idx.dni]||''), telefono:String(row[idx.telefono]||''),
    email:String(row[idx.email]||''), direccion:String(row[idx.direccion]||''), distrito:String(row[idx.distrito]||''),
    pago_metodo:'', pago_estado:'', estado:'PENDIENTE',
    observaciones:'BAJA DE SERVICIO\nMotivo: '+motivo+(detalle? '\nDetalle: '+detalle:'')+'\nSolicitado: '+nowISO(),
    creado_en: nowISO(), actualizado_en: nowISO()
  });
  audit_('cliente', 'baja', 'Solicitud de baja '+rid+' de '+String(row[idx.nombres]||''));
  notifyAdmin_('Solicitud de BAJA '+rid, 'Cliente: '+String(row[idx.nombres]||'')+'\nDNI: '+String(row[idx.dni]||'')+'\nTel: '+String(row[idx.telefono]||'')+'\nMotivo: '+motivo+(detalle? '\nDetalle: '+detalle:''));
  const telC = String(row[idx.telefono]||''); const nomC = String(row[idx.nombres]||'');
  notifyWa_(telC, 'Hola '+nomC+'! Registramos tu solicitud de baja ('+rid+'). Un asesor te contactará para confirmarla.');
  notifyEmail_(String(row[idx.email]||''), 'Solicitud de baja '+rid, 'Hola '+nomC+',\nRegistramos tu solicitud de baja de servicio. Te contactaremos para confirmarla.\nCódigo: '+rid);
  return { ok:true, baja_id: rid, message:'Solicitud de baja registrada. Te contactaremos para confirmarla.' };
}

/***********************
 *  ADMIN: FACTURAS
 ***********************/
function adminRegisterFactura(p, token){
  requireAdmin_(token);
  if (!p.cliente_nombre) throw new Error('Indica el cliente');
  const periodo = String(p.periodo||'').trim() || Utilities.formatDate(new Date(), tz(), 'yyyy-MM');
  let clienteRow = null; let cIdx = null;
  try {
    const r = readSheetData_(DB.TABS.CLIENTES);
    if ('cliente_id' in r.idx){
      const cid = String(p.cliente_id||'');
      clienteRow = cid
        ? r.rows.find(x => String(x[r.idx.cliente_id]||'')===cid)
        : r.rows.find(x => normText_(x[r.idx.nombres]||'')===normText_(p.cliente_nombre));
      cIdx = r.idx;
    }
  } catch(_){}
  const cid = (clienteRow && cIdx) ? String(clienteRow[cIdx.cliente_id]||'') : String(p.cliente_id||'');
  let monto = Number(p.monto);
  if (!monto && clienteRow && cIdx) monto = cuotaClienteRow_(clienteRow, cIdx);
  if (!monto) throw new Error('Monto requerido');
  let plan_id = String(p.plan_id||''); let plan_nombre = String(p.plan_nombre||'');
  if (clienteRow && cIdx){
    if (!plan_id) plan_id = String(clienteRow[cIdx.plan_id]||'');
    try {
      const pr = readSheetData_(DB.TABS.PLANES);
      if ('plan_id' in pr.idx){
        const pl = pr.rows.find(x => x[pr.idx.plan_id]===plan_id);
        if (pl) plan_nombre = String(pl[pr.idx.nombre]||'');
      }
    } catch(_){}
  }
  const sh = tab(DB.TABS.FACTURAS);
  const { idx } = getHeadIndex_(sh);
  if ('cliente_id' in idx && 'periodo' in idx){
    const dupe = sh.getDataRange().getValues().slice(1).some(r => String(r[idx.cliente_id]||'')===cid && String(r[idx.periodo]||'')===periodo && cid);
    if (dupe) throw new Error('Ya existe una factura de '+periodo+' para este cliente');
  }
  const num = (sh.getLastRow()||0);
  const fid = 'FAC-'+String(periodo).replace(/-/g,'')+'-'+String(num+1).padStart(3,'0');
  const estado = String(p.estado||'PENDIENTE').toUpperCase();
  writeRow_(sh, idx, {
    factura_id: fid, cliente_id: cid, cliente_nombre: p.cliente_nombre,
    plan_id: plan_id, plan_nombre: plan_nombre,
    periodo: periodo,
    monto: monto, vencimiento: String(p.vencimiento||vencDefault_(periodo)),
    estado: (estado==='PAGADA'||estado==='PENDIENTE'||estado==='VENCIDA') ? estado : 'PENDIENTE',
    metodo: String(p.metodo||''), referencia: String(p.referencia||''),
    pagado_en: (estado==='PAGADA') ? nowISO() : '',
    creado_en: nowISO(), actualizado_en: nowISO()
  });
  try { autoAplicarSaldo_(cid); } catch(_){}
  audit_('admin', 'factura', 'Registrada factura '+fid+' de '+p.cliente_nombre+' ('+periodo+')');
  return { ok:true, factura_id: fid };
}
function adminBulkFacturas(p, token){
  requireAdmin_(token);
  p = p || {};
  const periodo = String(p.periodo||'').trim() || Utilities.formatDate(new Date(), tz(), 'yyyy-MM');
  let filtro = null;
  if (Array.isArray(p.cliente_ids) && p.cliente_ids.length) filtro = p.cliente_ids.map(String);
  const r = readSheetData_(DB.TABS.CLIENTES);
  if (!('cliente_id' in r.idx)) throw new Error('Hoja CLIENTES mal formada');
  const cache = { f: readSheetData_(DB.TABS.FACTURAS), p: null };
  try { cache.p = readSheetData_(DB.TABS.PLANES); } catch(_){}
  const creadas = [];
  let duplicados = 0, ignorados = 0;
  r.rows.forEach(row => {
    const cid = String(row[r.idx.cliente_id]||'');
    if (filtro && filtro.indexOf(cid)<0) return;
    if (!esActivoFacturable_(row[r.idx.estado])){ ignorados++; return; }
    try {
      const res = _crearFacturaMes_(cid, row, r.idx, periodo, { cache: cache, skipAuto: true });
      if (res.creada){
        creadas.push({ factura_id: res.factura_id, cliente_nombre: String(row[r.idx.nombres]||''), monto: res.monto });
        if (Number(row[r.idx.saldo_a_favor]||0) > 0){ try { autoAplicarSaldo_(cid); } catch(_){} }
      }
      else duplicados++;
    } catch(_){ ignorados++; }
  });
  audit_('admin', 'facturacion', 'Cobro masivo '+periodo+' -> '+creadas.length+' creadas, '+duplicados+' ya existían');
  if (creadas.length) notifyAdmin_('Cobro masivo '+periodo, 'Facturas creadas: '+creadas.length+'\nYa existentes (duplicadas): '+duplicados+'\nClientes no aptos: '+ignorados);
  return { ok:true, periodo: periodo, creadas: creadas.length, duplicados: duplicados, ignorados: ignorados, detalle: creadas };
}
function adminMora(token){
  requireAdmin_(token);
  const hoy = todayISO();
  const porCliente = {};
  try {
    const { idx: fIdx, rows: fRows } = readSheetData_(DB.TABS.FACTURAS);
    if ('cliente_id' in fIdx && 'estado' in fIdx){
      fRows.forEach(r => {
        if (String(r[fIdx.estado]||'').toUpperCase()==='PAGADA') return;
        const cid = String(r[fIdx.cliente_id]||'');
        if (!cid) return;
        if (!porCliente[cid]) porCliente[cid] = { total:0, n:0, vencidas:0, dias:0 };
        const c = porCliente[cid];
        c.total += Number(r[fIdx.monto]||0);
        c.n++;
        const venc = String(r[fIdx.vencimiento]||'');
        if (venc && venc < hoy){
          c.vencidas++;
          try {
            const dd = Math.floor((Date.now() - new Date(venc+'T00:00:00').getTime())/86400000);
            if (dd > c.dias) c.dias = dd;
          } catch(_){}
        }
      });
    }
  } catch(_){}
  const lista = [];
  try {
    const r = readSheetData_(DB.TABS.CLIENTES);
    if ('cliente_id' in r.idx){
      Object.keys(porCliente).forEach(cid => {
        const row = r.rows.find(x => String(x[r.idx.cliente_id]||'')===cid);
        lista.push({
          cliente_id: cid,
          nombres: row ? String(row[r.idx.nombres]||'') : '—',
          dni: row ? String(row[r.idx.dni]||'') : '',
          telefono: row ? String(row[r.idx.telefono]||'') : '',
          email: row ? String(row[r.idx.email]||'') : '',
          distrito: row ? String(row[r.idx.distrito]||'') : '',
          estado: row ? String(row[r.idx.estado]||'') : '—',
          prioridad: (row && 'prioridad' in r.idx) ? String(row[r.idx.prioridad]||'') : '',
          condicion: (row && 'condicion' in r.idx) ? String(row[r.idx.condicion]||'') : '',
          facturas_pend: porCliente[cid].n,
          vencidas: porCliente[cid].vencidas,
          dias_mora: porCliente[cid].dias,
          total_deuda: fmtNum_(porCliente[cid].total),
          __row: row ? (r.rows.indexOf(row)+2) : 0
        });
      });
    }
  } catch(_){}
  lista.sort((a,b)=> (b.total_deuda - a.total_deuda) || (b.dias_mora - a.dias_mora));
  const deuda_total = fmtNum_(lista.reduce((a,b)=> a + Number(b.total_deuda||0), 0));
  return { ok:true, total: lista.length, deuda_total: deuda_total, lista: lista };
}
function adminConfirmFactura(factura_id, token){
  requireAdmin_(token);
  const { idx, rows } = readSheetData_(DB.TABS.FACTURAS);
  const sh = tab(DB.TABS.FACTURAS);
  const pos = rows.findIndex(r => r[idx.factura_id]===factura_id);
  if (pos<0) throw new Error('Factura no encontrada');
  sh.getRange(pos+2, idx.estado+1).setValue('PAGADA');
  if ('pagado_en' in idx) sh.getRange(pos+2, idx.pagado_en+1).setValue(nowISO());
  if ('actualizado_en' in idx) sh.getRange(pos+2, idx.actualizado_en+1).setValue(nowISO());
  audit_('admin', 'factura', 'Confirmada factura '+factura_id);
  return { ok:true };
}

function setFacturaCampo_(fIdx, pos, campo, valor){
  try {
    if (!(campo in fIdx)) return;
    const sh = tab(DB.TABS.FACTURAS);
    sh.getRange(pos+2, fIdx[campo]+1).setValue(valor);
    if ('actualizado_en' in fIdx) sh.getRange(pos+2, fIdx.actualizado_en+1).setValue(nowISO());
  } catch(_){}
}

function mailFacturaHtml_(f, cfg, metodosHtml){
  const portal = cfg.sitio ? (String(cfg.sitio).replace(/\/$/,'')+'/portal.html') : '';
  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#1a2333;max-width:600px;margin:0 auto">'
    + '<div style="background:#0e2a47;color:#fff;border-radius:12px 12px 0 0;padding:18px 22px">'
    + '<div style="font-size:18px;font-weight:bold">'+escH_(cfg.empresa)+'</div>'
    + (cfg.razon ? '<div style="font-size:12px;opacity:.85">'+escH_(cfg.razon)+(cfg.ruc? ' · RUC '+escH_(cfg.ruc):'')+'</div>' : '')
    + '</div>'
    + '<div style="border:1px solid #e3e8ef;border-top:0;border-radius:0 0 12px 12px;padding:22px 22px 26px">'
    + '<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Hola <b>'+escH_(f.cliente_nombre)+'</b>, te compartimos tu recibo del servicio. Puedes pagarlo por los medios indicados abajo o desde tu panel de cliente.</p>'
    + '<table style="width:100%;border-collapse:collapse;font-size:14px">'
    + '<tr><td style="padding:8px 10px;background:#f4f7fb;border:1px solid #e3e8ef">Factura</td><td style="padding:8px 10px;border:1px solid #e3e8ef;font-weight:bold">'+escH_(f.factura_id)+'</td></tr>'
    + '<tr><td style="padding:8px 10px;background:#f4f7fb;border:1px solid #e3e8ef">Período</td><td style="padding:8px 10px;border:1px solid #e3e8ef">'+escH_(f.periodo)+'</td></tr>'
    + '<tr><td style="padding:8px 10px;background:#f4f7fb;border:1px solid #e3e8ef">Plan</td><td style="padding:8px 10px;border:1px solid #e3e8ef">'+escH_(f.plan_nombre||'—')+'</td></tr>'
    + '<tr><td style="padding:8px 10px;background:#f4f7fb;border:1px solid #e3e8ef">Monto</td><td style="padding:8px 10px;border:1px solid #e3e8ef;font-size:18px;font-weight:bold;color:#0e7a3d">S/ '+fmtNum_(f.monto)+'</td></tr>'
    + '<tr><td style="padding:8px 10px;background:#f4f7fb;border:1px solid #e3e8ef">Vence el</td><td style="padding:8px 10px;border:1px solid #e3e8ef">'+escH_(f.vencimiento||'—')+'</td></tr>'
    + '</table>'
    + '<div style="margin-top:16px;padding:12px 14px;background:#f4f7fb;border-radius:10px;font-size:13px;line-height:1.6">'
    + '<b>Medios de pago:</b>'+metodosHtml+'</div>'
    + (portal ? '<p style="font-size:13px;color:#5a6b82;margin:14px 0 0">También la encuentras en tu panel: <a href="'+escH_(portal)+'">'+escH_(portal)+'</a></p>' : '')
    + '<p style="font-size:12px;color:#8a97aa;margin:18px 0 0">Este es un correo informativo. Si ya realizaste el pago, ignora este mensaje.</p>'
    + '</div></div>';
}

function adminEnviarFactura(p, token){
  requireAdmin_(token);
  p = p || {};
  const fid = String(p.factura_id||'');
  const modo = String(p.modo||'wa').toLowerCase();
  if (!fid) throw new Error('Indica la factura');
  if (['email','wa'].indexOf(modo)<0) throw new Error('Modo no válido');
  const { idx: fIdx, rows: fRows } = readSheetData_(DB.TABS.FACTURAS);
  if (!('factura_id' in fIdx)) throw new Error('Hoja FACTURAS mal formada');
  const pos = fRows.findIndex(r => String(r[fIdx.factura_id]||'')===fid);
  if (pos<0) throw new Error('Factura no encontrada');
  const f = fRows[pos];
  const fdata = { factura_id: String(f[fIdx.factura_id]||''), cliente_nombre: String(f[fIdx.cliente_nombre]||''), plan_nombre: String(f[fIdx.plan_nombre]||''), periodo: String(f[fIdx.periodo]||''), monto: Number(f[fIdx.monto]||0), vencimiento: String(f[fIdx.vencimiento]||'') };
  let cliente = null; let cIdx = null;
  try {
    const r = readSheetData_(DB.TABS.CLIENTES);
    if ('cliente_id' in r.idx){
      cIdx = r.idx;
      cliente = r.rows.find(x => String(x[r.idx.cliente_id]||'')===String(f[fIdx.cliente_id]||''));
    }
  } catch(_){}
  const cfg = {
    empresa: getConfig_('empresa_nombre','NetSatipo'), razon: getConfig_('razon_social',''), ruc: getConfig_('ruc',''),
    whatsapp: getConfig_('whatsapp',''), yape: getConfig_('yape_telefono',''), yape_n: getConfig_('yape_nombre',''),
    plin: getConfig_('plin_telefono',''), plin_n: getConfig_('plin_nombre',''), sitio: getConfig_('sitio_web','')
  };
  const metodosHtml = []
    + (cfg.yape ? '<p style="margin:6px 0 0"><b>Yape:</b> '+escH_(cfg.yape)+(cfg.yape_n? ' ('+escH_(cfg.yape_n)+')':'')+'</p>' : '')
    + (cfg.plin ? '<p style="margin:2px 0"><b>Plin:</b> '+escH_(cfg.plin)+(cfg.plin_n? ' ('+escH_(cfg.plin_n)+')':'')+'</p>' : '')
    + '<p style="margin:'+(cfg.yape||cfg.plin?'4px 0 0':'0')+'">o consulta por WhatsApp al '+escH_(cfg.whatsapp||'—')+'</p>';
  if (modo==='email'){
    const to = cliente ? normText_(String(cliente[cIdx.email]||'')).trim() : '';
    if (!to) throw new Error('El cliente no tiene correo registrado');
    const html = mailFacturaHtml_(fdata, cfg, metodosHtml);
    MailApp.sendEmail({ to: to, subject: 'Factura '+fdata.factura_id+' · '+cfg.empresa+' ('+fdata.periodo+')', htmlBody: html, name: cfg.empresa });
    setFacturaCampo_(fIdx, pos, 'enviado_email', nowISO());
    audit_('admin', 'factura', 'Enviada factura '+fdata.factura_id+' por correo a '+to);
    return { ok:true, modo:'email', email: to };
  }
  const tel = cliente ? String(cliente[cIdx.telefono]||'').replace(/\D/g,'') : '';
  if (!tel) throw new Error('El cliente no tiene teléfono registrado');
  const portal = cfg.sitio ? (String(cfg.sitio).replace(/\/$/,'')+'/portal.html') : '';
  const texto =
    '*'+fdata.cliente_nombre+', este es el recordatorio de tu factura '+cfg.empresa+'* 🔔\n\n'
    + '🧾 Factura: '+fdata.factura_id+'\n'
    + '📅 Período: '+fdata.periodo+'\n'
    + '💰 Total: *S/ '+fmtNum_(fdata.monto)+'*\n'
    + (fdata.vencimiento ? '⏰ Vence el: '+fdata.vencimiento+'\n' : '')
    + '\nPuedes pagar por:\n'
    + (cfg.yape ? '• Yape: '+cfg.yape+(cfg.yape_n? ' ('+cfg.yape_n+')':'')+'\n' : '')
    + (cfg.plin ? '• Plin: '+cfg.plin+(cfg.plin_n? ' ('+cfg.plin_n+')':'')+'\n' : '')
    + '• Efectivo/transferencia (consultar)\n'
    + (portal ? '\nO desde tu panel de cliente: '+portal+'\n' : '')
    + '\n¡Gracias por tu preferencia!';
  setFacturaCampo_(fIdx, pos, 'enviado_wa', nowISO());
  audit_('admin', 'factura', 'Generado recordatorio WhatsApp de '+fdata.factura_id);
  return { ok:true, modo:'wa', telefono: tel, url: 'https://wa.me/'+tel+'?text='+encodeURIComponent(texto), texto: texto };
}

function autoAplicarSaldo_(cid){
  const found = getClienteRow_(String(cid));
  if (!found) return 0;
  const { idx, row, rowNum } = found;
  if (!('saldo_a_favor' in idx)) return 0;
  let saldo = Number(row[idx.saldo_a_favor]||0);
  if (!(saldo > 0)) return saldo;
  let fIdx = {};
  let fRows = [];
  try {
    const d = readSheetData_(DB.TABS.FACTURAS);
    if ('cliente_id' in d.idx && 'estado' in d.idx && 'factura_id' in d.idx){
      fIdx = d.idx;
      fRows = d.rows.filter(r => String(r[d.idx.cliente_id]||'') === String(cid) && String(r[d.idx.estado]||'').toUpperCase() !== 'PAGADA')
        .sort((a,b) => String(a[d.idx.periodo]||'').localeCompare(String(b[d.idx.periodo]||'')) || String(a[d.idx.factura_id]||'').localeCompare(String(b[d.idx.factura_id]||'')));
    }
  } catch(_){ return saldo; }
  const sh = tab(DB.TABS.FACTURAS);
  const shRows = sh.getDataRange().getValues();
  const posMap = {};
  for (let i=1;i<shRows.length;i++){ posMap[String(shRows[i][fIdx.factura_id]||'')] = i+1; }
  for (const f of fRows){
    if (!(saldo > 0)) break;
    const monto = Number(f[fIdx.monto]||0);
    if (!(monto > 0)) continue;
    if (saldo < monto) break;
    const realPos = posMap[String(f[fIdx.factura_id]||'')];
    if (!realPos) continue;
    sh.getRange(realPos, fIdx.estado+1).setValue('PAGADA');
    if ('metodo' in fIdx) sh.getRange(realPos, fIdx.metodo+1).setValue('SALDO');
    if ('referencia' in fIdx) sh.getRange(realPos, fIdx.referencia+1).setValue('ADELANTO');
    if ('pagado_en' in fIdx) sh.getRange(realPos, fIdx.pagado_en+1).setValue(nowISO());
    if ('actualizado_en' in fIdx) sh.getRange(realPos, fIdx.actualizado_en+1).setValue(nowISO());
    saldo = fmtNum_(saldo - monto);
    audit_('sistema', 'pago', 'Saldo a favor aplicado a factura '+String(f[fIdx.factura_id]||'')+' (quedan S/ '+fmtNum_(saldo)+')');
  }
  if (Number(saldo) !== Number(row[idx.saldo_a_favor]||0)){
    if (saldo < 0) saldo = 0;
    tab(DB.TABS.CLIENTES).getRange(rowNum, idx.saldo_a_favor+1).setValue(saldo);
  }
  return saldo;
}

function marcarFacturaPagada_(cid, nombre, metodo, referencia){
  const cidS = String(cid||'');
  const nom = normText_(nombre||'');
  try {
    const { idx: fIdx, rows: fRows } = readSheetData_(DB.TABS.FACTURAS);
    if (!('cliente_id' in fIdx) || !('factura_id' in fIdx) || !('estado' in fIdx)) return null;
    const sh = tab(DB.TABS.FACTURAS);
    const shRows = sh.getDataRange().getValues();
    const posMap = {};
    for (let i=1;i<shRows.length;i++) posMap[String(shRows[i][fIdx.factura_id]||'')] = i+1;
    const cand = fRows
      .filter(r => {
        if (String(r[fIdx.estado]||'').toUpperCase()==='PAGADA') return false;
        if (cidS) return String(r[fIdx.cliente_id]||'')===cidS;
        return nom && normText_(String(r[fIdx.cliente_nombre]||''))===nom;
      })
      .sort((a,b)=> String(a[fIdx.periodo]||'').localeCompare(String(b[fIdx.periodo]||'')) || String(a[fIdx.factura_id]||'').localeCompare(String(b[fIdx.factura_id]||'')));
    for (const f of cand){
      const rp = posMap[String(f[fIdx.factura_id]||'')];
      if (!rp) continue;
      sh.getRange(rp, fIdx.estado+1).setValue('PAGADA');
      if ('metodo' in fIdx) sh.getRange(rp, fIdx.metodo+1).setValue(metodo||'EFECTIVO');
      if ('referencia' in fIdx) sh.getRange(rp, fIdx.referencia+1).setValue(referencia||'');
      if ('pagado_en' in fIdx) sh.getRange(rp, fIdx.pagado_en+1).setValue(nowISO());
      if ('actualizado_en' in fIdx) sh.getRange(rp, fIdx.actualizado_en+1).setValue(nowISO());
      audit_('admin', 'pago', 'Factura '+String(f[fIdx.factura_id]||'')+' marcada PAGADA por pago confirmado');
      return String(f[fIdx.factura_id]||'');
    }
  } catch(_){}
  return null;
}

function adminSaldo(p, token){
  requireAdmin_(token);
  p = p || {};
  const cid = String(p.cliente_id||'');
  if (!cid) throw new Error('Indica el cliente');
  const found = getClienteRow_(cid);
  if (!found) throw new Error('Cliente no encontrado');
  const { idx, row, rowNum } = found;
  if (!('saldo_a_favor' in idx)) throw new Error('Falta la columna saldo_a_favor; ejecuta initDB primero');
  const monto = Number(p.monto);
  if (!(monto >= 0) ) throw new Error('Monto inválido');
  let nuevo = monto;
  if (p.op !== 'ajustar'){
    nuevo = fmtNum_(Number(row[idx.saldo_a_favor]||0) + monto);
  }
  tab(DB.TABS.CLIENTES).getRange(rowNum, idx.saldo_a_favor+1).setValue(nuevo);
  audit_('admin', 'saldo', 'Saldo de '+cid+' = S/ '+nuevo+' ('+(p.op==='ajustar'?'ajuste':'abono de S/ '+monto)+')');
  const restante = autoAplicarSaldo_(cid);
  return { ok:true, saldo_a_favor: fmtNum_(restante), message: 'Saldo a favor: S/ '+fmtNum_(restante) };
}

function clientFirmaContrato(token, p){
  const cid = requireClient_(token);
  p = p || {};
  const firma = String(p.firma||'');
  if (!firma) throw new Error('La firma está vacía');
  if (firma.length > 45000) throw new Error('La firma es muy grande; intenta firmar de nuevo sobre el recuadro');
  const found = getClienteRow_(cid);
  if (!found) throw new Error('Cliente no encontrado');
  const { row, idx } = found;
  const tel = String(row[idx.telefono]||'').replace(/\D/g,'');
  const dni = normText_(row[idx.dni]||'').replace(/\D/g,'');
  try {
    const { idx: sIdx, rows: sRows } = readSheetData_(DB.TABS.SOLICITUDES);
    if ('solicitud_id' in sIdx && 'tipo' in sIdx && 'estado' in sIdx && 'firma' in sIdx && 'firmado_en' in sIdx){
      const sSh = tab(DB.TABS.SOLICITUDES);
      for (let i=0;i<sRows.length;i++){
        const c = sRows[i];
        if (String(c[sIdx.tipo]||'')!=='NUEVO_CONTRATO') continue;
        const okTipo = ['INSTALADA','APROBADA'].indexOf(String(c[sIdx.estado]||'').toUpperCase()) >= 0;
        const mDni = normText_(c[sIdx.dni]||'').replace(/\D/g,'') === dni;
        const mTel = tel && normText_(c[sIdx.telefono]||'').replace(/\D/g,'') === tel;
        if (okTipo && (mDni || mTel)){
          if (String(c[sIdx.firmado_en]||'')) throw new Error('Tu contrato ya está firmado');
          sSh.getRange(i+2, sIdx.firma+1).setValue(firma);
          sSh.getRange(i+2, sIdx.firmado_en+1).setValue(nowISO());
          if ('actualizado_en' in sIdx) sSh.getRange(i+2, sIdx.actualizado_en+1).setValue(nowISO());
          audit_('cliente', 'contrato', 'Firmado contrato de '+cid+' ('+String(c[sIdx.solicitud_id]||'')+')');
          return { ok:true, message:'Contrato firmado correctamente. Ya puedes descargar tu copia firmada.' };
        }
      }
    }
  } catch(e){ if (String(e&&e.message).indexOf('ya está firmado')>=0) throw e; }
  throw new Error('No se encontró un contrato activo para firmar (solicitud instalada/aprobada). Escríbenos si deberías tenerlo.');
}

/***********************
 *  ADMIN: ALTAS (NUEVO CONTRATO / NUEVO CLIENTE)
 ***********************/
function adminNuevoContrato(p, token){
  requireAdmin_(token);
  p = p || {};
  const tipo = String(p.tipo||'SOLICITUD').toUpperCase();
  const nombres = String(p.nombres||'').trim();
  const dni = normText_(p.dni||'').replace(/\D/g,'');
  const telefono = normText_(p.telefono||'').replace(/\D/g,'');
  if (!nombres) throw new Error('Indica los nombres');
  if (dni && !/^\d{8}$/.test(dni)) throw new Error('DNI inválido (debe tener 8 dígitos)');
  if (telefono && !/^\d{9}$/.test(telefono)) throw new Error('Teléfono inválido (9 dígitos)');
  let plan_id = String(p.plan_id||'');
  let plan_nombre = String(p.plan_nombre||'');
  if (plan_id){
    try {
      const pr = readSheetData_(DB.TABS.PLANES);
      const pl = ('plan_id' in pr.idx) ? pr.rows.find(x => x[pr.idx.plan_id]===plan_id) : null;
      if (pl) plan_nombre = String(pl[pr.idx.nombre]||'');
    } catch(_){}
  }
  try {
    const r = readSheetData_(DB.TABS.CLIENTES);
    if (dni && r.rows.some(x => normText_(x[r.idx.dni]||'').replace(/\D/g,'')===dni)) throw new Error('Ya existe un cliente con ese DNI ('+dni+')');
  } catch(e){ if (String(e&&e.message).indexOf('Ya existe')>=0) throw e; }
  const now = nowISO();
  if (tipo==='CLIENTE'){
    const csh = tab(DB.TABS.CLIENTES);
    const cidx = getHeadIndex_(csh).idx;
    const cid = 'CLI-'+uid_();
    writeRow_(csh, cidx, {
      cliente_id: cid, dni: dni, nombres: nombres, telefono: telefono, email: String(p.email||''),
      direccion: String(p.direccion||''), distrito: String(p.distrito||''), plan_id: plan_id,
      estado: String(p.estado||'INSTALADO').toUpperCase()==='ACTIVO' ? 'ACTIVO' : 'INSTALADO',
      fecha_alta: todayISO(), notas: String(p.notas||''), creado_en: now, actualizado_en: now
    });
    audit_('admin', 'cliente', 'Nuevo cliente '+cid+' ('+nombres+')');
    return { ok:true, tipo:'CLIENTE', cliente_id: cid, message:'Cliente creado: '+nombres };
  }
  const sid = withLock_(() => {
    const ssh = tab(DB.TABS.SOLICITUDES);
    const sidx = getHeadIndex_(ssh).idx;
    const num = (ssh.getLastRow()||0);
    const sid = 'SOL-'+Utilities.formatDate(new Date(), tz(), 'yyyyMM')+'-'+String(num+1).padStart(3,'0');
    const estIn = String(p.estado||'PENDIENTE').toUpperCase();
    writeRow_(ssh, sidx, {
      solicitud_id: sid, tipo: 'NUEVO_CONTRATO', plan_id: plan_id, plan_nombre: plan_nombre,
      nombres: nombres, dni: dni, telefono: telefono, email: String(p.email||''),
      direccion: String(p.direccion||''), distrito: String(p.distrito||''),
      pago_metodo: String(p.pago_metodo||'EFECTIVO'), pago_estado: 'NO_PAGADO',
      estado: ['INSTALADA','APROBADA'].indexOf(estIn)>=0 ? estIn : 'PENDIENTE',
      observaciones: String(p.notas||''), creado_en: now, actualizado_en: now, creado_por: 'admin'
    });
    return sid;
  });
  audit_('admin', 'solicitud', 'Nueva solicitud '+sid+' ('+nombres+')');
  return { ok:true, tipo:'SOLICITUD', solicitud_id: sid, message:'Contrato registrado: '+sid };
}

/***********************
 *  PANEL CARGAS: TECNICO
 ***********************/
function tecnicoLogin(clave){
  if (!clave) throw new Error('Ingresa la clave');
  const c = getConfig_('tecnico_clave','tec2026');
  const a = getConfig_('admin_pass','admin123');
  if (!(c && String(clave)===String(c)) && !(a && String(clave)===String(a))) throw new Error('Clave incorrecta');
  const token = Utilities.getUuid().replace(/-/g,'');
  sesPut_('tec_', token, nowISO(), 28800*1000);
  audit_('tecnico', 'login', 'Acceso al panel técnico');
  return { ok:true, token: token, name: 'Técnico' };
}
function requireTecnico_(token){
  if (!token) throw new Error('No autorizado');
  if (!sesGet_('tec_', token)) throw new Error('Sesión de técnico expirada');
  return true;
}
function tecnicoLogout(token){
  sesDel_('tec_', token);
  return { ok:true };
}
function tecnicoPlanes(token){
  requireTecnico_(token);
  return { ok:true, planes: getPlans() };
}
function tecnicoTareas(token){
  requireTecnico_(token);
  const pend = ['PENDIENTE','APROBADA'];
  const { idx, rows } = readSheetData_(DB.TABS.SOLICITUDES);
  if (!('solicitud_id' in idx)) throw new Error('Hoja SOLICITUDES mal formada');
  const lista = rows
    .filter(r => String(r[idx.tipo]||'')==='NUEVO_CONTRATO' && pend.indexOf(String(r[idx.estado]||'').toUpperCase())>=0)
    .map(r => ({
      solicitud_id: String(r[idx.solicitud_id]||''),
      nombres: String(r[idx.nombres]||''),
      dni: normText_(r[idx.dni]||'').replace(/\D/g,''),
      telefono: String(r[idx.telefono]||''),
      direccion: String(r[idx.direccion]||''),
      distrito: String(r[idx.distrito]||''),
      plan_id: String(r[idx.plan_id]||''),
      plan_nombre: String(r[idx.plan_nombre]||''),
      pago_metodo: String(r[idx.pago_metodo]||''),
      observaciones: String(r[idx.observaciones]||''),
      creado_en: String(r[idx.creado_en]||'').slice(0,10)
    }));
  lista.sort((a,b)=> String(a.creado_en).localeCompare(String(b.creado_en)));
  return { ok:true, tareas: lista };
}
function crearClienteDesdeSolicitud_(sid, idx, row, plan_id){
  const dni = normText_(row[idx.dni]||'').replace(/\D/g,'');
  const tel = String(row[idx.telefono]||'').replace(/\D/g,'');
  const now = nowISO();
  const { idx: cIdx, rows: cRows } = readSheetData_(DB.TABS.CLIENTES);
  if (!('telefono' in cIdx)) throw new Error('Hoja CLIENTES mal formada');
  const pos = cRows.findIndex(r =>
    (dni && normText_(r[cIdx.dni]||'').replace(/\D/g,'')===dni) ||
    (tel && normText_(r[cIdx.telefono]||'').replace(/\D/g,'')===String(tel))
  );
  const csh = tab(DB.TABS.CLIENTES);
  if (pos>=0){
    const rn = pos+2;
    if ('estado' in cIdx) csh.getRange(rn, cIdx.estado+1).setValue('INSTALADO');
    if (plan_id && 'plan_id' in cIdx) csh.getRange(rn, cIdx.plan_id+1).setValue(plan_id);
    if ('actualizado_en' in cIdx) csh.getRange(rn, cIdx.actualizado_en+1).setValue(now);
    return String(cRows[pos][cIdx.cliente_id]||'');
  }
  const cid = 'CLI-'+uid_();
  writeRow_(csh, cIdx, {
    cliente_id: cid, dni: dni||'', nombres: String(row[idx.nombres]||''), telefono: tel,
    email: String(row[idx.email]||''), direccion: String(row[idx.direccion]||''), distrito: String(row[idx.distrito]||''),
    plan_id: plan_id||'', estado: 'INSTALADO', fecha_alta: todayISO(), notas: 'Alta por instalación '+sid,
    creado_en: now, actualizado_en: now
  });
  return cid;
}
function tecnicoAccion(token, p){
  requireTecnico_(token);
  p = p || {};
  const sid = String(p.solicitud_id||'');
  const accion = String(p.accion||'').toUpperCase();
  if (!sid) throw new Error('Falta la solicitud');
  if (['INSTALADA','NO_ENCONTRADO','PLAN'].indexOf(accion)<0) throw new Error('Acción no válida');
  const { idx, rows } = readSheetData_(DB.TABS.SOLICITUDES);
  if (!('solicitud_id' in idx)) throw new Error('Hoja SOLICITUDES mal formada');
  const pos = rows.findIndex(r => String(r[idx.solicitud_id]||'')===sid);
  if (pos<0) throw new Error('Solicitud no encontrada');
  const row = rows[pos];
  const sh = tab(DB.TABS.SOLICITUDES);
  const rn = pos+2;
  const now = nowISO();
  const nota = String(p.nota||'');
  const obsSet = (txt) => { if ('observaciones' in idx) sh.getRange(rn, idx.observaciones+1).setValue(String(txt).slice(0,1999)); };
  if (accion==='PLAN'){
    const plan_id = String(p.plan_id||row[idx.plan_id]||'');
    if (!plan_id) throw new Error('Indica el plan instalado');
    sh.getRange(rn, idx.plan_id+1).setValue(plan_id);
    if ('plan_nombre' in idx){
      let pn = row[idx.plan_nombre];
      try { const pr = readSheetData_(DB.TABS.PLANES); const pl = ('plan_id' in pr.idx) ? pr.rows.find(x => x[pr.idx.plan_id]===plan_id) : null; if (pl) pn = String(pl[pr.idx.nombre]||''); } catch(_){}
      sh.getRange(rn, idx.plan_nombre+1).setValue(pn);
    }
    if ('actualizado_en' in idx) sh.getRange(rn, idx.actualizado_en+1).setValue(now);
    if (nota) obsSet((String(row[idx.observaciones]||'')+' | Plan instalado: '+nota));
    audit_('tecnico', 'instalacion', 'Plan actualizado a '+plan_id+' en '+sid);
    return { ok:true, message:'Plan instalado registrado' };
  }
  if (accion==='NO_ENCONTRADO'){
    sh.getRange(rn, idx.estado+1).setValue('PENDIENTE');
    if ('actualizado_en' in idx) sh.getRange(rn, idx.actualizado_en+1).setValue(now);
    obsSet((String(row[idx.observaciones]||'')+' | No estaba el cliente'+(nota? ' - '+nota : '')).slice(0,1999));
    audit_('tecnico', 'instalacion', 'Cliente no encontrado en '+sid);
    return { ok:true, message:'Queda pendiente: no estaba el cliente' };
  }
  const plan_id = String(p.plan_id||row[idx.plan_id]||'');
  let pn = String(p.plan_nombre||row[idx.plan_nombre]||'');
  if (plan_id && !pn){
    try { const pr = readSheetData_(DB.TABS.PLANES); const pl = ('plan_id' in pr.idx) ? pr.rows.find(x => x[pr.idx.plan_id]===plan_id) : null; if (pl) pn = String(pl[pr.idx.nombre]||''); } catch(_){}
  }
  sh.getRange(rn, idx.estado+1).setValue('INSTALADA');
  if (plan_id && 'plan_id' in idx) sh.getRange(rn, idx.plan_id+1).setValue(plan_id);
  if ('plan_nombre' in idx) sh.getRange(rn, idx.plan_nombre+1).setValue(pn);
  if ('actualizado_en' in idx) sh.getRange(rn, idx.actualizado_en+1).setValue(now);
  if (nota) obsSet((String(row[idx.observaciones]||'')+' | '+nota).slice(0,1999));
  const cliente_id = crearClienteDesdeSolicitud_(sid, idx, row, plan_id);
  audit_('tecnico', 'instalacion', 'Instalación completada '+sid+' -> cliente '+cliente_id);
  return { ok:true, message:'Instalación completada ✓', cliente_id: cliente_id };
}
function getDriveFolder_(){
  const folderName = 'InternetSatipo_FotosInstalaciones';
  const it = DriveApp.getFoldersByName(folderName);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(folderName);
}
function tecnicoFotos(token, p){
  requireTecnico_(token);
  p = p || {};
  const sid = String(p.solicitud_id||'');
  if (!sid) throw new Error('Falta la solicitud');
  const fotos = (Array.isArray(p.fotos) ? p.fotos : []).filter(f => f && f.data);
  if (!fotos.length) throw new Error('No hay fotos para subir');
  if (fotos.length > 5) throw new Error('Máximo 5 fotos por instalación');
  const folder = getDriveFolder_();
  const cid = String(p.cliente_id||'');
  const fsh = tab(DB.TABS.FOTOS);
  const fIdx = getHeadIndex_(fsh).idx;
  const now = nowISO();
  const urls = [];
  fotos.forEach(f => {
    let base = String(f.data||'');
    const i = base.indexOf(',');
    base = (i>=0 && base.indexOf('data:')===0) ? base.slice(i+1) : base;
    const ext = /^data:image\/(png|jpe?g|gif|webp)/.test(String(f.data||'')) ? String(f.data).match(/image\/(png|jpe?g|gif|webp)/)[1].replace('jpeg','jpg') : 'jpg';
    const name = 'inst-'+sid+'-'+Math.floor(Date.now()/1000)+'-'+Math.floor(Math.random()*900+100)+'.'+ext;
    const blob = Utilities.newBlob(Utilities.base64Decode(base), 'image/'+ext, name);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    urls.push({ name: name, url: file.getUrl() });
    writeRow_(fsh, fIdx, { foto_id: 'FOT-'+uid_(), solicitud_id: sid, cliente_id: cid, url: file.getUrl(), nota: String(f.nota||''), subido_por: 'tecnico', creado_en: now });
  });
  audit_('tecnico', 'instalacion', 'Subidas '+urls.length+' foto(s) de instalación para '+sid);
  return { ok:true, fotos: urls };
}

/***********************
 *  PANEL DE VENTAS
 ***********************/
function ventasLogin(clave){
  if (!clave) throw new Error('Ingresa la clave');
  const c = getConfig_('ventas_clave','ventas2026');
  const a = getConfig_('admin_pass','admin123');
  if (!(c && String(clave)===String(c)) && !(a && String(clave)===String(a))) throw new Error('Clave incorrecta');
  const token = Utilities.getUuid().replace(/-/g,'');
  sesPut_('ven_', token, nowISO(), 28800*1000);
  audit_('ventas', 'login', 'Acceso al panel de ventas');
  return { ok:true, token: token, name: 'Ventas' };
}
function requireVentas_(token){
  if (!token) throw new Error('No autorizado');
  if (!sesGet_('ven_', token)) throw new Error('Sesión expirada. Vuelve a ingresar.');
  return true;
}
function ventasLogout(token){
  sesDel_('ven_', token);
  return { ok:true };
}
function ventasPlanes(token){
  requireVentas_(token);
  return { ok:true, planes: getPlans() };
}
function ventasRegistrar(p, token){
  requireVentas_(token);
  p = p || {};
  const nombres = String(p.nombres||'').trim();
  const dni = normText_(p.dni||'').replace(/\D/g,'');
  const telefono = normText_(p.telefono||'').replace(/\D/g,'');
  if (!nombres) throw new Error('Indica los nombres');
  if (dni && !/^\d{8}$/.test(dni)) throw new Error('DNI inválido (8 dígitos)');
  if (telefono && !/^\d{9}$/.test(telefono)) throw new Error('Teléfono inválido (9 dígitos)');
  let plan_id = String(p.plan_id||'');
  let plan_nombre = String(p.plan_nombre||'');
  if (plan_id){
    try {
      const pr = readSheetData_(DB.TABS.PLANES);
      const pl = ('plan_id' in pr.idx) ? pr.rows.find(x => x[pr.idx.plan_id]===plan_id) : null;
      if (pl) plan_nombre = String(pl[pr.idx.nombre]||'');
    } catch(_){}
  }
  const sid = withLock_(() => {
    const ssh = tab(DB.TABS.SOLICITUDES);
    const sidx = getHeadIndex_(ssh).idx;
    const num = (ssh.getLastRow()||0);
    const sid = 'SOL-'+Utilities.formatDate(new Date(), tz(), 'yyyyMM')+'-'+String(num+1).padStart(3,'0');
    const now = nowISO();
    writeRow_(ssh, sidx, {
      solicitud_id: sid, tipo: 'NUEVO_CONTRATO', plan_id: plan_id, plan_nombre: plan_nombre,
      nombres: nombres, dni: dni, telefono: telefono, email: String(p.email||''),
      direccion: String(p.direccion||''), distrito: String(p.distrito||''),
      pago_metodo: String(p.pago_metodo||'EFECTIVO'), pago_estado: 'NO_PAGADO', estado: 'PENDIENTE',
      observaciones: String(p.notas||''), creado_en: now, actualizado_en: now, creado_por: 'ventas'
    });
    return sid;
  });
  audit_('ventas', 'solicitud', 'Nuevo contrato '+sid+' ('+nombres+')');
  return { ok:true, solicitud_id: sid, message: 'Contrato registrado: '+sid };
}
function ventasLista(token){
  requireVentas_(token);
  const { idx, rows } = readSheetData_(DB.TABS.SOLICITUDES);
  if (!('solicitud_id' in idx)) throw new Error('Hoja SOLICITUDES mal formada');
  const lista = rows
    .filter(r => String(r[idx.tipo]||'')==='NUEVO_CONTRATO' && String(r[idx.creado_por]||'')==='ventas')
    .map(r => ({
      solicitud_id: String(r[idx.solicitud_id]||''),
      nombres: String(r[idx.nombres]||''),
      dni: normText_(r[idx.dni]||'').replace(/\D/g,''),
      telefono: String(r[idx.telefono]||''),
      distrito: String(r[idx.distrito]||''),
      plan_nombre: String(r[idx.plan_nombre]||''),
      pago_metodo: String(r[idx.pago_metodo]||''),
      estado: String(r[idx.estado]||''),
      creado_en: String(r[idx.creado_en]||'').slice(0,10)
    }));
  lista.sort((a,b)=> String(b.creado_en).localeCompare(String(a.creado_en)));
  return { ok:true, registros: lista };
}

/***********************
 *  PUBLICO: LIBRO DE RECLAMACIONES (Ley 29571 / D.S. 011-2011-PCM)
 ***********************/
function saveReclamo(p){
  p = p || {};
  ['nombres','documento','telefono','tipo','descripcion','pedido'].forEach(c => { if (!p[c]) throw new Error('Falta el campo: '+c); });
  const tipo = ['QUEJA','RECLAMO','GESTION','SUGERENCIA'].includes(String(p.tipo).toUpperCase()) ? String(p.tipo).toUpperCase() : 'RECLAMO';
  const pref = tipo==='QUEJA' ? 'QUE' : tipo==='RECLAMO' ? 'RCL' : 'GES';
  if (!/^\d{9}$/.test(String(p.telefono||'').replace(/\D/g,''))) throw new Error('Teléfono inválido (9 dígitos)');
  if (!publicLimit_('rcl', p.telefono, 5, 24)) throw new Error('Has llegado al límite de registros desde este número hoy. Escríbenos directamente.');
  const rid = withLock_(() => {
    const sh = tab(DB.TABS.SOLICITUDES);
    const { idx } = getHeadIndex_(sh);
    const num = (sh.getLastRow()||0);
    const rid = pref+'-'+Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd')+'-'+String(num+1).padStart(3,'0');
    const obs = 'HECHO: '+String(p.descripcion||'')+'\nPEDIDO/SOLUCION: '+String(p.pedido||'')
      +'\nN° SERVICIO/CONTRATO: '+String(p.num_servicio||'—')+'\nTIPO DOC: '+String(p.tipo_doc||'DNI')
      +'\nREGISTRO: '+nowISO();
    const data = {
      solicitud_id: rid,
      tipo: tipo,
      plan_id: '', plan_nombre: '',
      nombres: String(p.nombres||'').toUpperCase().replace(/\s+/g,' ').trim(),
      dni: String(p.documento||'').replace(/[^0-9]/g,''),
      telefono: String(p.telefono||''),
      email: String(p.email||'').toLowerCase(),
      direccion: String(p.direccion||''),
      distrito: String(p.distrito||''),
      pago_metodo: '', pago_estado: '',
      estado: 'PENDIENTE',
      observaciones: obs,
      creado_en: nowISO(),
      actualizado_en: nowISO()
    };
    writeRow_(sh, idx, data);
    return { rid: rid, data: data };
  });
  audit_('public', 'reclamo', 'Nuevo '+tipo+' '+rid.rid+' de '+rid.data.nombres);
  notifyAdmin_('Nuevo '+tipo+' en Libro de Reclamaciones '+rid.rid,
    'Registro: '+rid.rid+'\nCliente: '+rid.data.nombres+'\nDoc: '+rid.data.dni+'\nTel: '+rid.data.telefono+'\nTipo: '+tipo+'\nHecho: '+p.descripcion+'\nPedido: '+p.pedido+'\n\nResponde en máximo 15 días hábiles (D.S. 011-2011-PCM).');
  return { ok:true, reclamo_id: rid.rid, message: 'Registro enviado. Resolveremos dentro del plazo legal (15 días hábiles).' };
}

/***********************
 *  PUBLICO: CONTACTO
 ***********************/
function sendContactMessage(p){
  p = p || {};
  if (!p.nombres || !p.telefono || !p.mensaje) throw new Error('Completa todos los campos');
  if (!/^\d{9}$/.test(String(p.telefono||'').replace(/\D/g,''))) throw new Error('Teléfono inválido (9 dígitos)');
  if (!publicLimit_('con', p.telefono, 5, 24)) throw new Error('Has llegado al límite de mensajes desde este número hoy. Llámanos directamente.');
  const sid = withLock_(() => {
    const sh = tab(DB.TABS.SOLICITUDES);
    const { idx } = getHeadIndex_(sh);
    const num = (sh.getLastRow()||0);
    const sid = 'CON-'+Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd')+'-'+String(num+1).padStart(3,'0');
    writeRow_(sh, idx, {
      solicitud_id: sid, tipo: 'CONTACTO', plan_id:'', plan_nombre:'',
      nombres: String(p.nombres||'').toUpperCase(), dni:'', telefono: String(p.telefono||''),
      email: String(p.email||'').toLowerCase(), direccion:'', distrito:'',
      pago_metodo:'', pago_estado:'', estado:'PENDIENTE',
      observaciones: String(p.mensaje||''), creado_en: nowISO(), actualizado_en: nowISO()
    });
    return sid;
  });
  audit_('public', 'contacto', 'Mensaje de contacto '+p.nombres);
  notifyAdmin_('Mensaje de contacto', p.nombres+'\nTel: '+p.telefono+'\nEmail: '+p.email+'\n\n'+p.mensaje);
  return { ok:true, message:'Mensaje enviado, te contactaremos pronto.' };
}

/***********************
 *  ADMIN: DASHBOARD
 ***********************/
function adminStats(token){
  requireAdmin_(token);
  const countRows = (t, extra) => {
    try {
      const { idx, rows } = readSheetData_(t);
      return extra ? rows.filter(extra).length : rows.length;
    } catch(_){ return 0; }
  };
  const solicitudes = countRows(DB.TABS.SOLICITUDES);
  const pendientes = (() => {
    try {
      const { idx, rows } = readSheetData_(DB.TABS.SOLICITUDES);
      return ('estado' in idx) ? rows.filter(r => r[idx.estado]==='PENDIENTE').length : 0;
    } catch(_){ return 0; }
  })();
  const visitas = countRows(DB.TABS.VISITAS);
  const visitasPend = (() => {
    try {
      const { idx, rows } = readSheetData_(DB.TABS.VISITAS);
      return ('estado' in idx) ? rows.filter(r => r[idx.estado]==='PENDIENTE').length : 0;
    } catch(_){ return 0; }
  })();
  const clientes = countRows(DB.TABS.CLIENTES);
  let ingresos = 0;
  try {
    const { idx, rows } = readSheetData_(DB.TABS.PAGOS);
    if ('monto' in idx) {
      rows.forEach(r => { if (String(r[idx.estado]||'').toUpperCase()==='CONFIRMADO') ingresos += Number(r[idx.monto]||0); });
    }
  } catch(_){}
  let facturasPend = 0, morosos = 0;
  try {
    const { idx, rows } = readSheetData_(DB.TABS.FACTURAS);
    if ('estado' in idx){
      const noPago = rows.filter(r => String(r[idx.estado]||'').toUpperCase()!=='PAGADA');
      facturasPend = noPago.length;
      morosos = new Set(noPago.map(r => String(r[idx.cliente_id]||'')).filter(Boolean)).size;
    }
  } catch(_){}
  return { ok:true, stats:{ solicitudes, pendientes, visitas, visitasPend, clientes, ingresos: fmtNum_(ingresos), facturasPend, morosos } };
}

function adminList(section, token){
  requireAdmin_(token);
  const map = (idx, r) => Object.fromEntries(Object.keys(idx).map(k => [k, r[idx[k]]!==undefined ? r[idx[k]] : '']));
  const getTab = (t) => {
    const { idx, rows } = readSheetData_(t);
    return rows.map((r,i) => ({ __row: i+2, data: map(idx, r) }));
  };
  if (section==='CLIENTES') return getTab(DB.TABS.CLIENTES);
  if (section==='SOLICITUDES') return getTab(DB.TABS.SOLICITUDES);
  if (section==='VISITAS') return getTab(DB.TABS.VISITAS);
  if (section==='PAGOS') return getTab(DB.TABS.PAGOS);
  if (section==='FACTURAS') return getTab(DB.TABS.FACTURAS);
  if (section==='PLANES') return getTab(DB.TABS.PLANES);
  throw new Error('Sección inválida');
}

function adminUpdateRow(section, rowNum, field, value, token){
  requireAdmin_(token);
  const tabName = { CLIENTES:DB.TABS.CLIENTES, SOLICITUDES:DB.TABS.SOLICITUDES, VISITAS:DB.TABS.VISITAS, PAGOS:DB.TABS.PAGOS, FACTURAS:DB.TABS.FACTURAS }[section];
  if (!tabName || !rowNum) throw new Error('Datos inválidos');
  const sh = tab(tabName);
  const { idx } = getHeadIndex_(sh);
  if (!(field in idx)) throw new Error('Campo no existe: '+field);
  const rn = Number(rowNum);
  sh.getRange(rn, idx[field]+1).setValue(value);
  if ('actualizado_en' in idx) sh.getRange(rn, idx.actualizado_en+1).setValue(nowISO());
  audit_('admin', 'update', section+' fila '+rowNum+' -> '+field+' = '+value);
  // Notificar estado al cliente (correo + WhatsApp) si corresponde
  if (field==='estado') notifyEstadoCliente_(tabName, rowNum, field, value);
  return { ok:true };
}

function adminSavePlan(plan, token){
  requireAdmin_(token);
  if (!plan || !plan.nombre) throw new Error('Nombre del plan requerido');
  const sh = tab(DB.TABS.PLANES);
  const { idx, rows } = readSheetData_(DB.TABS.PLANES);
  if (!('plan_id' in idx)) throw new Error('Hoja PLANES mal formada');
  const now = nowISO();
  const fields = {
    plan_id: String(plan.plan_id||''),
    nombre: String(plan.nombre||''),
    velocidad: String(plan.velocidad||''),
    precio: Number(plan.precio||0),
    periodicidad: String(plan.periodicidad||'MENSUAL').toUpperCase(),
    extras: Array.isArray(plan.extras) ? plan.extras.join('|') : String(plan.extras||''),
    recomendado: !!plan.recomendado,
    activo: plan.activo!==false,
    orden: Number(plan.orden||0),
    actualizado_en: now
  };
  const pos = plan.plan_id ? rows.findIndex(r => r[idx.plan_id]===plan.plan_id) : -1;
  if (pos>=0){
    updateRow_(sh, pos+2, idx, fields);
    return { ok:true, plan_id: plan.plan_id, created:false };
  }
  fields.plan_id = fields.plan_id || ('PLN-'+Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmmss'));
  fields.creado_en = now;
  writeRow_(sh, idx, fields);
  audit_('admin', 'plan', 'Guardado plan '+fields.nombre);
  return { ok:true, plan_id: fields.plan_id, created:true };
}

function adminDeletePlan(plan_id, token){
  requireAdmin_(token);
  const { idx, rows } = readSheetData_(DB.TABS.PLANES);
  const sh = tab(DB.TABS.PLANES);
  for (let i=rows.length-1;i>=0;i--){
    if (rows[i][idx.plan_id]===plan_id){ sh.deleteRow(i+2); audit_('admin','plan','Eliminado plan '+plan_id); return { ok:true }; }
  }
  throw new Error('Plan no encontrado');
}

function adminRegisterPago(p, token){
  requireAdmin_(token);
  if (!p.monto || !p.cliente_nombre) throw new Error('Monto y cliente requeridos');
  const sh = tab(DB.TABS.PAGOS);
  const { idx } = getHeadIndex_(sh);
  const pid = withLock_(() => {
    const num = (sh.getLastRow()||0);
    const pid = 'PAG-'+Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd')+'-'+String(num+1).padStart(3,'0');
    writeRow_(sh, idx, {
      pago_id: pid, solicitud_id: p.solicitud_id||'', cliente_id: p.cliente_id||'',
      cliente_nombre: p.cliente_nombre, monto: Number(p.monto||0),
      metodo: p.metodo||'EFECTIVO', referencia: p.referencia||'',
      estado: 'REGISTRADO', registrado_por: 'admin', creado_en: nowISO(), confirmado_en: ''
    });
    return pid;
  });
  audit_('admin', 'pago', 'Registrado pago '+pid+' de '+p.cliente_nombre);
  return { ok:true, pago_id: pid };
}

function adminConfirmPago(pago_id, token){
  requireAdmin_(token);
  const { idx, rows } = readSheetData_(DB.TABS.PAGOS);
  const sh = tab(DB.TABS.PAGOS);
  const pos = rows.findIndex(r => r[idx.pago_id]===pago_id);
  if (pos<0) throw new Error('Pago no encontrado');
  sh.getRange(pos+2, idx.estado+1).setValue('CONFIRMADO');
  if ('confirmado_en' in idx) sh.getRange(pos+2, idx.confirmado_en+1).setValue(nowISO());
  if ('solicitud_id' in idx && rows[pos][idx.solicitud_id]){
    try {
      const { idx: sIdx, rows: sRows } = readSheetData_(DB.TABS.SOLICITUDES);
      const sSh = tab(DB.TABS.SOLICITUDES);
      const sp = sRows.findIndex(r => r[sIdx.solicitud_id]===rows[pos][idx.solicitud_id]);
      if (sp>=0 && 'pago_estado' in sIdx){ sSh.getRange(sp+2, sIdx.pago_estado+1).setValue('PAGADO'); sSh.getRange(sp+2, sIdx.actualizado_en+1).setValue(nowISO()); }
    } catch(_){}
  }
  const fid = marcarFacturaPagada_(
    ('cliente_id' in idx) ? String(rows[pos][idx.cliente_id]||'') : '',
    ('cliente_nombre' in idx) ? String(rows[pos][idx.cliente_nombre]||'') : '',
    ('metodo' in idx) ? String(rows[pos][idx.metodo]||'') : '',
    ('referencia' in idx) ? String(rows[pos][idx.referencia]||'') : ''
  );
  if (fid && 'factura_id' in idx){ try { sh.getRange(pos+2, idx.factura_id+1).setValue(fid); } catch(_){} }
  audit_('admin', 'pago', 'Confirmado pago '+pago_id+(fid? ' -> factura '+fid : ''));
  return { ok:true };
}

/***********************
 *  ADMIN: SUMARY / CSV
 ***********************/
function adminExportCsv(section, token){
  requireAdmin_(token);
  const tabName = { CLIENTES:DB.TABS.CLIENTES, SOLICITUDES:DB.TABS.SOLICITUDES, VISITAS:DB.TABS.VISITAS, PAGOS:DB.TABS.PAGOS, FACTURAS:DB.TABS.FACTURAS }[section];
  if (!tabName) throw new Error('Sección inválida');
  const { head, rows } = readSheetData_(tabName);
  const csv = [head.join(',')];
  rows.forEach(r => {
    csv.push(head.map((h,i) => '"'+String(r[i]===undefined?'':r[i]).replace(/"/g,'""')+'"').join(','));
  });
  return { ok:true, csv: csv.join('\n') };
}
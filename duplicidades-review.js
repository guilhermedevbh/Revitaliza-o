(function(){
  let description='';
  let originSheet='Descricoes_Duplicadas';
  let productReviewMode=false;
  let editContext=null;
  let editOriginalRow=null;
  function readStoredArray(key){try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value:[]}catch(error){console.warn('Informação local inválida ignorada:',key,error);return[]}}
  function safeLocalSet(key,value){
    try{localStorage.setItem(key,value);return true}
    catch(error){
      try{
        localStorage.removeItem('emtel_imported');
        localStorage.removeItem('emtel_last_import_report');
        localStorage.setItem(key,value);
        return true;
      }catch(finalError){console.warn('A informação será preservada no armazenamento interno:',key,finalError);return false}
    }
  }
  window.safeEmtelStore=safeLocalSet;
  const editTracking=readStoredArray('emtel_edit_tracking');
  const selectedForDeletion=new Set();
  window.selectedForDeletion=selectedForDeletion; // usado pelo card "Separados p/ desativação" no Resumo (script principal)
  const history=readStoredArray('emtel_duplicate_history');
  const deactivationReport=readStoredArray('emtel_deactivation_report');
  const activeReport=readStoredArray('emtel_active_report');
  const validationHistory=readStoredArray('emtel_validation_history');
  deactivationReport.filter(x=>x.status==='Selecionado').forEach(x=>selectedForDeletion.add(Number(x.idx)));
  const originalRender=window.render;
  const originalSave=window.saveModal;
  const originalClose=window.closeModal;

  let movementSaveTimer=null;
  function openMovementDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('EmtelCadastroMovimentos',1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('state'))db.createObjectStore('state')};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
  function movementSnapshot(updatedAt){return{updatedAt,edits:{...edits},deletes:[...deletes],validated:[...validated],history:history.slice(0,5000),deactivationReport:deactivationReport.slice(0,5000),activeReport:activeReport.slice(0,5000),editTracking:editTracking.slice(0,5000)}}
  async function saveMovementSnapshotNow(updatedAt){const db=await openMovementDB(),tx=db.transaction('state','readwrite');tx.objectStore('state').put(movementSnapshot(updatedAt),'current');await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}
  function queueMovementSnapshot(){
    const updatedAt=Date.now();
    safeLocalSet('emtel_movements_updated_at',String(updatedAt));
    if(movementSaveTimer)clearTimeout(movementSaveTimer);
    movementSaveTimer=setTimeout(()=>{movementSaveTimer=null;saveMovementSnapshotNow(updatedAt).catch(error=>console.error('Falha ao salvar movimentações no armazenamento interno:',error))},0);
  }
  window.persistMovementSnapshot=queueMovementSnapshot;
  async function restoreMovementSnapshot(){
    try{
      const db=await openMovementDB(),tx=db.transaction('state','readonly'),req=tx.objectStore('state').get('current');
      const saved=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error)}),localUpdatedAt=Number(localStorage.getItem('emtel_movements_updated_at')||0);
      if(saved&&Number(saved.updatedAt||0)>=localUpdatedAt){
        Object.keys(edits).forEach(key=>delete edits[key]);Object.assign(edits,saved.edits||{});
        deletes.clear();(saved.deletes||[]).forEach(key=>deletes.add(key));
        validated.clear();(saved.validated||[]).forEach(key=>validated.add(key));
        history.splice(0,history.length,...(saved.history||[]));
        deactivationReport.splice(0,deactivationReport.length,...(saved.deactivationReport||[]));
        activeReport.splice(0,activeReport.length,...(saved.activeReport||[]));
        editTracking.splice(0,editTracking.length,...(saved.editTracking||[]));
        selectedForDeletion.clear();deactivationReport.filter(x=>x.status==='Selecionado').forEach(x=>selectedForDeletion.add(Number(x.idx)));
        safeLocalSet('emtel_movements_updated_at',String(saved.updatedAt));
        render();
      }else if(!saved){queueMovementSnapshot()}
    }catch(error){console.warn('Armazenamento interno de movimentações indisponível:',error)}
  }

  function user(){return (localStorage.getItem('emtel_review_user')||'').trim()}
  function setUser(v){safeLocalSet('emtel_review_user',(v||'').trim())}
  // nunca bloqueia com prompt() — usa o campo "Seu nome" do cabeçalho (ou "Anônimo"), igual ao resto do site
  function requireUser(){return typeof window.ensureReviewUserName==='function' ? window.ensureReviewUserName() : (user()||'Anônimo')}
  function requireUserAlways(){return requireUser()}
  function indices(){const d=DATA[MAIN_SHEET],di=d.headers.findIndex(h=>/descric|descr|produto|nome/i.test(h)),target=description.trim().toUpperCase(),out=[];for(let i=0;i<rowCount(MAIN_SHEET);i++){if(String(getRow(MAIN_SHEET,i)[di]||'').trim().toUpperCase()===target)out.push(i)}return out}
  function numberCode(v){const x=String(v??'').replace(/\D/g,'');return x?Number(x):Number.MAX_SAFE_INTEGER}
  function principalsByBranch(list){const d=DATA[MAIN_SHEET],ci=d.headers.findIndex(h=>/^codigo$|^código$/i.test(h)),fi=d.headers.findIndex(h=>/filial|loja|unidade/i.test(h)),groups=new Map();list.filter(i=>isActive(MAIN_SHEET,i)).forEach(i=>{const branch=String(getRow(MAIN_SHEET,i)[fi]??'—');if(!groups.has(branch))groups.set(branch,[]);groups.get(branch).push(i)});const result=new Set();groups.forEach(items=>{if(items.length>=2){items.sort((a,b)=>numberCode(getRow(MAIN_SHEET,a)[ci])-numberCode(getRow(MAIN_SHEET,b)[ci])||a-b);result.add(items[0])}});return result}
  function genId(){try{return crypto.randomUUID()}catch(e){return 'h-'+Date.now()+'-'+Math.random().toString(36).slice(2)}}
  function log(action,idx,detail){const u=requireUser();if(!u)return false;const d=DATA[MAIN_SHEET],r=getRow(MAIN_SHEET,idx),fi=d.headers.findIndex(h=>/filial|loja|unidade/i.test(h));const entry={id:genId(),user:u,ts:new Date().toISOString(),filial:String(r[fi]??'—'),action,description,detail};history.unshift(entry);safeLocalSet('emtel_duplicate_history',JSON.stringify(history.slice(0,1000)));queueMovementSnapshot();historicoInsert(entry);return true}
  // ===== Supabase: Histórico de ações compartilhado entre usuários =====
  function historicoInsert(entry){
    if(typeof supa==='undefined'||!supa) return;
    supa.from('historico_acoes').upsert({id:entry.id, usuario:entry.user, criado_em:entry.ts, filial:entry.filial, acao:entry.action, descricao:entry.description, detalhe:entry.detail||null}).then(({error})=>{ if(error) console.warn('Supabase upsert (historico_acoes) falhou:', error.message); });
  }
  function applyRemoteHistorico(row){
    if(history.some(x=>x.id===row.id)) return;
    history.push({id:row.id, user:row.usuario, ts:row.criado_em, filial:row.filial, action:row.acao, description:row.descricao, detail:row.detalhe});
  }
  function resortHistorico(){history.sort((a,b)=>new Date(b.ts)-new Date(a.ts));safeLocalSet('emtel_duplicate_history',JSON.stringify(history.slice(0,1000)))}
  async function loadHistoricoFromSupabase(){
    if(typeof supa==='undefined'||!supa) return;
    try{
      const { data, error } = await supa.from('historico_acoes').select('*').order('criado_em',{ascending:false}).limit(1000);
      if(error){ console.warn('Supabase load (historico_acoes) falhou:', error.message); return; }
      const remoteIds=new Set(data.map(r=>r.id));
      data.forEach(applyRemoteHistorico);
      // envia pro banco entradas locais (criadas antes da sincronização, sem id ou ainda não enviadas)
      history.forEach(entry=>{ if(!entry.id) entry.id=genId(); if(!remoteIds.has(entry.id)) historicoInsert(entry); });
      resortHistorico();
      softRender();
    }catch(e){ console.warn('Falha ao carregar histórico do Supabase:', e); }
  }
  function subscribeHistoricoRealtime(){
    if(typeof supa==='undefined'||!supa) return;
    supa.channel('historico-changes')
      .on('postgres_changes', {event:'INSERT', schema:'public', table:'historico_acoes'}, payload=>{
        applyRemoteHistorico(payload.new);
        resortHistorico();
        softRender();
      })
      .subscribe(status=>{ if(typeof reportRealtimeStatus==='function') reportRealtimeStatus('historico', status); });
  }
  // ===== Supabase: Rastreabilidade de edições (badges "Protheus pendente/atualizado" e
  // reforço do Relatório de Produtos Validados) compartilhada entre usuários =====
  function editTrackingInsert(entry){
    if(typeof supa==='undefined'||!supa) return;
    supa.from('edicoes_pendentes').upsert({id:entry.id, row_idx:entry.idx, produto_key:entry.key, campos:entry.fields||[], plataforma:!!entry.platform, protheus:!!entry.protheus, usuario:entry.user, descricao:entry.description, criado_em:entry.ts}).then(({error})=>{ if(error) console.warn('Supabase upsert (edicoes_pendentes) falhou:', error.message); });
  }
  function applyRemoteEditTracking(row){
    if(editTracking.some(x=>x.id===row.id)) return;
    editTracking.push({id:row.id, idx:row.row_idx, key:row.produto_key, fields:row.campos||[], platform:!!row.plataforma, protheus:!!row.protheus, user:row.usuario, description:row.descricao, ts:row.criado_em});
  }
  function resortEditTracking(){editTracking.sort((a,b)=>new Date(b.ts)-new Date(a.ts));safeLocalSet('emtel_edit_tracking',JSON.stringify(editTracking.slice(0,1000)))}
  async function loadEditTrackingFromSupabase(){
    if(typeof supa==='undefined'||!supa) return;
    try{
      const data = typeof fetchAllRows==='function' ? await fetchAllRows('edicoes_pendentes') : (await supa.from('edicoes_pendentes').select('*')).data||[];
      const remoteIds=new Set(data.map(r=>r.id));
      data.forEach(applyRemoteEditTracking);
      // registros de edição criados antes desta sincronização existir ficaram só neste navegador — sobe pro banco agora
      editTracking.forEach(entry=>{ if(!entry.id) entry.id=genId(); if(!remoteIds.has(entry.id)) editTrackingInsert(entry); });
      resortEditTracking();
      softRender();
    }catch(e){ console.warn('Falha ao carregar rastreabilidade de edições do Supabase:', e); }
  }
  function subscribeEditTrackingRealtime(){
    if(typeof supa==='undefined'||!supa) return;
    supa.channel('edicoes-pendentes-changes')
      .on('postgres_changes', {event:'INSERT', schema:'public', table:'edicoes_pendentes'}, payload=>{
        applyRemoteEditTracking(payload.new);
        resortEditTracking();
        softRender();
      })
      .subscribe(status=>{ if(typeof reportRealtimeStatus==='function') reportRealtimeStatus('edicoes_pendentes', status); });
  }
  // re-render em segundo plano (sincronização/Realtime) sem "pular" a página: usa
  // renderPreserveState() do script principal quando disponível (preserva rolagem/busca/foco).
  function softRender(){ if(typeof window.scheduleBackgroundRender==='function') window.scheduleBackgroundRender(); else if(typeof renderPreserveState==='function') renderPreserveState(); else render(); }
  function saveDeactivationReport(){safeLocalSet('emtel_deactivation_report',JSON.stringify(deactivationReport.slice(0,2000)));queueMovementSnapshot()}
  function saveActiveReport(){safeLocalSet('emtel_active_report',JSON.stringify(activeReport.slice(0,2000)));queueMovementSnapshot()}
  // ===== Supabase: Relatório de Desativação compartilhado entre usuários =====
  function desativacaoRowFromItem(item){
    return {
      key:item.key, idx:item.idx, codigo:item.code, codigo_item:item.itemCode,
      descricao:item.description, filial:item.branch, ncm:item.ncm, tipo:item.type,
      unidade:item.unit, grupo:item.group, criado_em_origem:item.createdAt,
      motivo:item.reason||null, selecionado_em:item.selectedAt||null,
      usuario:item.user||null, status:item.status, concluido_em:item.completedAt||null,
      atualizado_em:new Date().toISOString()
    };
  }
  function desativacaoUpsert(item){
    if(typeof supa==='undefined'||!supa) return;
    supa.from('desativacoes').upsert(desativacaoRowFromItem(item)).then(({error})=>{ if(error) console.warn('Supabase upsert (desativacoes) falhou:', error.message); });
  }
  function desativacaoDelete(key){
    if(typeof supa==='undefined'||!supa) return;
    supa.from('desativacoes').delete().eq('key', key).then(({error})=>{ if(error) console.warn('Supabase delete (desativacoes) falhou:', error.message); });
  }
  // upsert em lote (1 requisição por bloco de 300) — usado pela automação de
  // separação por filial, que pode mexer em milhares de registros de uma vez.
  function desativacaoUpsertBatch(items){
    if(typeof supa==='undefined'||!supa||!items.length) return;
    const rows=items.map(desativacaoRowFromItem),chunkSize=300;
    for(let i=0;i<rows.length;i+=chunkSize){
      supa.from('desativacoes').upsert(rows.slice(i,i+chunkSize)).then(({error})=>{ if(error) console.warn('Supabase upsert em lote (desativacoes) falhou:', error.message); });
    }
  }
  function applyRemoteDesativacao(row){
    const item={key:row.key, idx:row.idx, code:row.codigo, itemCode:row.codigo_item, description:row.descricao, branch:row.filial, ncm:row.ncm, type:row.tipo, unit:row.unidade, group:row.grupo, createdAt:row.criado_em_origem, reason:row.motivo, selectedAt:row.selecionado_em, user:row.usuario, status:row.status, completedAt:row.concluido_em};
    const pos=deactivationReport.findIndex(x=>x.key===row.key);
    if(pos>=0) deactivationReport[pos]=item; else deactivationReport.unshift(item);
    if(item.status==='Selecionado') selectedForDeletion.add(Number(item.idx)); else selectedForDeletion.delete(Number(item.idx));
  }
  function removeLocalDesativacao(key){
    for(let i=deactivationReport.length-1;i>=0;i--) if(deactivationReport[i].key===key){ selectedForDeletion.delete(Number(deactivationReport[i].idx)); deactivationReport.splice(i,1); }
  }
  async function loadDesativacaoFromSupabase(){
    if(typeof supa==='undefined'||!supa) return;
    try{
      const data = typeof fetchAllRows==='function' ? await fetchAllRows('desativacoes') : (await supa.from('desativacoes').select('*')).data||[];
      const remoteKeys=new Set(data.map(r=>r.key));
      data.forEach(applyRemoteDesativacao);
      // registros separados antes da sincronização com o Supabase existir (ou antes da
      // tabela ser criada) ficaram só neste navegador — sobe eles agora para o banco.
      deactivationReport.forEach(item=>{ if(!remoteKeys.has(item.key)) desativacaoUpsert(item); });
      saveDeactivationReport();
      softRender();
    }catch(e){ console.warn('Falha ao carregar desativações do Supabase:', e); }
  }
  function subscribeDesativacaoRealtime(){
    if(typeof supa==='undefined'||!supa) return;
    supa.channel('desativacoes-changes')
      .on('postgres_changes', {event:'*', schema:'public', table:'desativacoes'}, payload=>{
        if(payload.eventType==='DELETE'){
          const key = payload.old && payload.old.key; if(!key) return;
          removeLocalDesativacao(key);
        } else {
          applyRemoteDesativacao(payload.new);
        }
        saveDeactivationReport(); softRender();
      })
      .subscribe(status=>{ if(typeof reportRealtimeStatus==='function') reportRealtimeStatus('desativacoes', status); });
  }
  window.loadDesativacaoFromSupabase = loadDesativacaoFromSupabase;
  window.subscribeDesativacaoRealtime = subscribeDesativacaoRealtime;
  // ===== Supabase: Relatório Mantidos Ativos compartilhado entre usuários =====
  // Ficava só salvo no navegador de quem validou — por isso o nome de quem validou (e de
  // quem a tarefa estava atribuída) parecia "sumir": outros usuários/sessões nunca viam.
  function activeReportRowFromItem(item){
    return {
      key:item.key, idx:item.idx, codigo:item.code, codigo_item:item.itemCode,
      descricao:item.description, filial:item.branch, ncm:item.ncm, tipo:item.type,
      unidade:item.unit, grupo:item.group, criado_em_origem:item.createdAt,
      decisao:item.decision, validado_em:item.validatedAt||null, usuario:item.user||null,
      atribuido_para:item.atribuidoPara||null, atualizado_em:new Date().toISOString()
    };
  }
  function activeReportUpsert(item){
    if(typeof supa==='undefined'||!supa) return;
    supa.from('cadastros_mantidos_ativos').upsert(activeReportRowFromItem(item)).then(({error})=>{ if(error) console.warn('Supabase upsert (cadastros_mantidos_ativos) falhou:', error.message); });
  }
  function activeReportDelete(key){
    if(typeof supa==='undefined'||!supa) return;
    supa.from('cadastros_mantidos_ativos').delete().eq('key', key).then(({error})=>{ if(error) console.warn('Supabase delete (cadastros_mantidos_ativos) falhou:', error.message); });
  }
  function applyRemoteActiveReport(row){
    const item={key:row.key, idx:row.idx, code:row.codigo, itemCode:row.codigo_item, description:row.descricao, branch:row.filial, ncm:row.ncm, type:row.tipo, unit:row.unidade, group:row.grupo, createdAt:row.criado_em_origem, decision:row.decisao, validatedAt:row.validado_em, user:row.usuario, atribuidoPara:row.atribuido_para};
    const pos=activeReport.findIndex(x=>x.key===row.key);
    if(pos>=0) activeReport[pos]=item; else activeReport.unshift(item);
  }
  function removeLocalActiveReport(key){
    for(let i=activeReport.length-1;i>=0;i--) if(activeReport[i].key===key) activeReport.splice(i,1);
  }
  async function loadActiveReportFromSupabase(){
    if(typeof supa==='undefined'||!supa) return;
    try{
      const data = typeof fetchAllRows==='function' ? await fetchAllRows('cadastros_mantidos_ativos') : (await supa.from('cadastros_mantidos_ativos').select('*')).data||[];
      const remoteKeys=new Set(data.map(r=>r.key));
      data.forEach(applyRemoteActiveReport);
      // registros validados antes da sincronização com o Supabase existir ficaram só neste
      // navegador — sobe eles agora para o banco.
      activeReport.forEach(item=>{ if(!remoteKeys.has(item.key)) activeReportUpsert(item); });
      saveActiveReport();
      softRender();
    }catch(e){ console.warn('Falha ao carregar relatório de ativos do Supabase:', e); }
  }
  function subscribeActiveReportRealtime(){
    if(typeof supa==='undefined'||!supa) return;
    supa.channel('cadastros-mantidos-ativos-changes')
      .on('postgres_changes', {event:'*', schema:'public', table:'cadastros_mantidos_ativos'}, payload=>{
        if(payload.eventType==='DELETE'){
          const key = payload.old && payload.old.key; if(!key) return;
          removeLocalActiveReport(key);
        } else {
          applyRemoteActiveReport(payload.new);
        }
        saveActiveReport(); softRender();
      })
      .subscribe(status=>{ if(typeof reportRealtimeStatus==='function') reportRealtimeStatus('cadastros_mantidos_ativos', status); });
  }
  function reportKey(idx){return MAIN_SHEET+'|'+idx}
  function reportProductData(idx){
    const d=DATA[MAIN_SHEET],r=getRow(MAIN_SHEET,idx),find=re=>d.headers.findIndex(h=>re.test(String(h)));
    const ci=find(/^codigo$|^código$/i),ii=find(/cod\.?\s*item|código\s*do\s*item|codigo\s*do\s*item/i),di=find(/descric|descr|produto|nome/i),fi=find(/filial|loja|unidade/i),ni=find(/NCM|IPI/i),ti=find(/^tipo$/i),ui=find(/^unidade$|^um$|^un$/i),gi=find(/^grupo$/i),dti=find(/data.*cri|cria[çc][aã]o|inclus[aã]o/i);
    return {code:String(r[ci]??'—'),itemCode:String(r[ii]??'—'),description:String(r[di]??''),branch:String(r[fi]??'—'),ncm:String(r[ni]??'—'),type:String(r[ti]??'—'),unit:String(r[ui]??'—'),group:String(r[gi]??'—'),createdAt:String(r[dti]??'Não informado')};
  }
  function addToDeactivationReport(idx,reason){const key=reportKey(idx),data=reportProductData(idx),existing=deactivationReport.find(x=>x.key===key&&x.status==='Selecionado');let item;if(existing){Object.assign(existing,data,{reason,selectedAt:new Date().toISOString(),user:user()});item=existing}else{item=Object.assign({key,idx},data,{reason,selectedAt:new Date().toISOString(),user:user(),status:'Selecionado'});deactivationReport.unshift(item)}saveDeactivationReport();desativacaoUpsert(item)}
  function removeFromDeactivationReport(idx){const key=reportKey(idx);for(let i=deactivationReport.length-1;i>=0;i--)if(deactivationReport[i].key===key&&deactivationReport[i].status==='Selecionado')deactivationReport.splice(i,1);saveDeactivationReport();desativacaoDelete(key)}
  // ===== Automação: separar para desativação todos os produtos das filiais 02, 03 e 07 =====
  // Não exclui nada — só marca "Separar para Desativação" e manda pro Relatório de
  // Desativação, do mesmo jeito que o botão manual faz produto a produto. Roda em lote
  // (upserts em blocos) porque pode envolver milhares de registros de uma vez.
  const FILIAL_AUTOMATION_TARGETS=[{code:2,label:'02 – Full Log'},{code:3,label:'03 – Tardane Logística'},{code:7,label:'07 – Verde Azul'}];
  window.runFilialDeactivationAutomation=function(){
    const d=DATA[MAIN_SHEET];
    if(!d){alert('Base de produtos não carregada.');return}
    const h=d.headers,fi=h.findIndex(x=>/filial|loja|unidade/i.test(x));
    if(fi<0){alert('Coluna de filial não encontrada na base.');return}
    const targetCodes=new Set(FILIAL_AUTOMATION_TARGETS.map(b=>b.code));
    const existingKeys=new Set(deactivationReport.map(x=>x.key));
    const matches=[],countsByCode={};
    for(let i=0;i<rowCount(MAIN_SHEET);i++){
      if(!isActive(MAIN_SHEET,i))continue;
      const key=reportKey(i);
      if(existingKeys.has(key))continue; // já separado/desativado — evita duplicidade no relatório
      const branchRaw=String(getRow(MAIN_SHEET,i)[fi]||'').trim();
      const codeMatch=branchRaw.match(/^0*([0-9]+)/);
      const code=codeMatch?Number(codeMatch[1]):null;
      if(code===null||!targetCodes.has(code))continue;
      matches.push(i);
      countsByCode[code]=(countsByCode[code]||0)+1;
    }
    const resumo=FILIAL_AUTOMATION_TARGETS.map(b=>b.label+': '+(countsByCode[b.code]||0)).join('\n');
    if(!matches.length){ toast('Nenhum produto novo encontrado nas filiais 02, 03 e 07 (os já separados/desativados não contam de novo).'); return; }
    if(!confirm('Separar automaticamente '+matches.length.toLocaleString('pt-BR')+' produto(s) para o Relatório de Desativação?\n\n'+resumo+'\n\nOs produtos NÃO serão excluídos agora — ficam pendentes de análise e desativação manual.'))return;
    const quem=requireUserAlways();
    if(!quem)return;
    const motivo='Produto pertencente à filial selecionada para desativação';
    const now=new Date().toISOString();
    const newItems=[];
    matches.forEach(idx=>{
      const key=reportKey(idx),data=reportProductData(idx),mainKey=MAIN_SHEET+'|'+idx;
      validated.delete(mainKey);
      removeFromActiveReport(idx);
      selectedForDeletion.add(idx);
      timestamps[mainKey]=now;
      lastEditors[mainKey]=quem;
      const item=Object.assign({key,idx},data,{reason:motivo,selectedAt:now,user:quem,status:'Selecionado'});
      deactivationReport.unshift(item);
      newItems.push(item);
    });
    saveDeactivationReport();
    desativacaoUpsertBatch(newItems);
    if(typeof window.supabaseUpsertBatch==='function') window.supabaseUpsertBatch(matches.map(i=>MAIN_SHEET+'|'+i));
    if(typeof persist==='function') persist();
    log('Separação automática por filial',matches[0],newItems.length+' produto(s) separados para desativação — '+resumo.replace(/\n/g,' · '));
    toast(newItems.length.toLocaleString('pt-BR')+' produto(s) separado(s) para o Relatório de Desativação.');
    if(typeof renderPreserveState==='function') renderPreserveState(); else render();
  };
  // ===== Relatório de Produtos Validados: histórico de validações/alterações por produto =====
  // Cada evento é 1 linha: uma validação sem alteração (campoAlterado=null) ou 1 campo alterado
  // (campoAlterado/valorAnterior/valorNovo preenchidos). Vários campos alterados na mesma ação
  // de salvar compartilham o mesmo validacaoId, pra contar "produtos alterados" x "total de alterações".
  function saveValidationHistory(){safeLocalSet('emtel_validation_history',JSON.stringify(validationHistory.slice(0,10000)))}
  function logValidationEvent(idx,opts){
    const key=reportKey(idx),data=reportProductData(idx);
    const entry={
      id:genId(), validacaoId:(opts&&opts.validacaoId)||genId(), produtoKey:key,
      codigo:data.code, descricao:data.description, filial:data.branch, ncm:data.ncm,
      usuario:user(), sofreuAlteracao:!!(opts&&opts.sofreuAlteracao),
      campoAlterado:(opts&&opts.campoAlterado)||null,
      valorAnterior:(opts&&opts.valorAnterior!=null)?String(opts.valorAnterior):null,
      valorNovo:(opts&&opts.valorNovo!=null)?String(opts.valorNovo):null,
      ts:new Date().toISOString()
    };
    validationHistory.unshift(entry);
    saveValidationHistory();
    validationHistoryInsert(entry);
    return entry;
  }
  function validationHistoryInsert(entry){
    if(typeof supa==='undefined'||!supa) return;
    supa.from('historico_validacao_produtos').upsert({
      id:entry.id, validacao_id:entry.validacaoId, produto_key:entry.produtoKey,
      codigo:entry.codigo, descricao:entry.descricao, filial:entry.filial, ncm:entry.ncm,
      usuario:entry.usuario, sofreu_alteracao:entry.sofreuAlteracao,
      campo_alterado:entry.campoAlterado, valor_anterior:entry.valorAnterior, valor_novo:entry.valorNovo,
      criado_em:entry.ts
    }).then(({error})=>{ if(error) console.warn('Supabase upsert (historico_validacao_produtos) falhou:', error.message); });
  }
  function applyRemoteValidationHistory(row){
    if(validationHistory.some(x=>x.id===row.id)) return;
    validationHistory.push({id:row.id, validacaoId:row.validacao_id, produtoKey:row.produto_key, codigo:row.codigo, descricao:row.descricao, filial:row.filial, ncm:row.ncm, usuario:row.usuario, sofreuAlteracao:!!row.sofreu_alteracao, campoAlterado:row.campo_alterado, valorAnterior:row.valor_anterior, valorNovo:row.valor_novo, ts:row.criado_em});
  }
  function resortValidationHistory(){validationHistory.sort((a,b)=>new Date(b.ts)-new Date(a.ts));saveValidationHistory()}
  async function loadValidationHistoryFromSupabase(){
    if(typeof supa==='undefined'||!supa) return;
    try{
      const data = typeof fetchAllRows==='function' ? await fetchAllRows('historico_validacao_produtos') : (await supa.from('historico_validacao_produtos').select('*')).data||[];
      const remoteIds=new Set(data.map(r=>r.id));
      data.forEach(applyRemoteValidationHistory);
      validationHistory.forEach(entry=>{ if(!entry.id) entry.id=genId(); if(!remoteIds.has(entry.id)) validationHistoryInsert(entry); });
      resortValidationHistory();
      softRender();
    }catch(e){ console.warn('Falha ao carregar histórico de validação do Supabase:', e); }
  }
  function subscribeValidationHistoryRealtime(){
    if(typeof supa==='undefined'||!supa) return;
    supa.channel('historico-validacao-changes')
      .on('postgres_changes', {event:'INSERT', schema:'public', table:'historico_validacao_produtos'}, payload=>{
        applyRemoteValidationHistory(payload.new);
        resortValidationHistory();
        softRender();
      })
      .subscribe(status=>{ if(typeof reportRealtimeStatus==='function') reportRealtimeStatus('historico_validacao', status); });
  }
  // nome de quem a tarefa estava atribuída no momento da validação — gravado no próprio
  // registro do relatório pra nunca se perder, mesmo que a atribuição mude/seja desfeita depois.
  function originAssignmentName(){
    if(typeof assignments==='undefined'||typeof taskUserById!=='function')return null;
    const sheet=originSheet,d=DATA[sheet];if(!d)return null;
    const di=d.headers.findIndex(h=>/descric|descr|produto|nome/i.test(h));if(di<0)return null;
    const target=String(description||'').trim().toUpperCase();if(!target)return null;
    for(let i=0;i<rowCount(sheet);i++){
      if(String(getRow(sheet,i)[di]||'').trim().toUpperCase()!==target)continue;
      const info=assignments[sheet+'|'+i];
      if(info){const u=taskUserById(info.responsavel);if(u)return u.nome}
    }
    return null;
  }
  function addToActiveReport(idx,decision,atribuidoPara){const key=reportKey(idx),existing=activeReport.find(x=>x.key===key),item=Object.assign({key,idx},reportProductData(idx),{decision:decision||'Validado – Manter Ativo',validatedAt:new Date().toISOString(),user:user(),atribuidoPara:atribuidoPara||(existing?existing.atribuidoPara:null)||null});const pos=activeReport.findIndex(x=>x.key===key);if(pos>=0)activeReport[pos]=item;else activeReport.unshift(item);saveActiveReport();activeReportUpsert(item)}
  function removeFromActiveReport(idx){const key=reportKey(idx);for(let i=activeReport.length-1;i>=0;i--)if(activeReport[i].key===key)activeReport.splice(i,1);saveActiveReport();activeReportDelete(key)}
  window.syncAnalyticalValidation=function(sheet,idx,shouldValidate){
    const source=DATA[sheet],main=DATA[MAIN_SHEET];
    if(!source||!main)return 0;
    const sourceRow=getRow(sheet,idx),sourceDescIdx=source.headers.findIndex(h=>/descric|descr|produto|nome/i.test(h)),sourceNcmIdx=source.headers.findIndex(h=>/NCM|IPI/i.test(h));
    const mainDescIdx=main.headers.findIndex(h=>/descric|descr|produto|nome/i.test(h)),mainNcmIdx=main.headers.findIndex(h=>/NCM|IPI/i.test(h));
    if(sourceDescIdx<0||mainDescIdx<0)return 0;
    const normalize=value=>String(value??'').trim().replace(/\s+/g,' ').toUpperCase(),targetDescription=normalize(sourceRow[sourceDescIdx]),targetNcm=sourceNcmIdx>=0?normalize(sourceRow[sourceNcmIdx]):'';
    if(!targetDescription)return 0;
    const matches=[];
    for(let i=0;i<rowCount(MAIN_SHEET);i++){
      if(!isActive(MAIN_SHEET,i))continue;
      const row=getRow(MAIN_SHEET,i);
      if(normalize(row[mainDescIdx])!==targetDescription)continue;
      if(sheet==='NCM_Mesma_Descricao'&&targetNcm&&mainNcmIdx>=0&&normalize(row[mainNcmIdx])!==targetNcm)continue;
      matches.push(i);
    }
    if(!matches.length)return 0;
    description=String(sourceRow[sourceDescIdx]??'');
    if(shouldValidate){
      if(!requireUserAlways()){ validated.delete(sheet+'|'+idx); return 0; }
    } else if(!requireUser()){
      validated.add(sheet+'|'+idx);
      return 0;
    }
    if(shouldValidate){
      const assignInfo=(typeof assignments!=='undefined')?assignments[sheet+'|'+idx]:null;
      const atribuidoPara=assignInfo&&typeof taskUserById==='function'?(taskUserById(assignInfo.responsavel)||{}).nome||null:null;
      matches.forEach(i=>{
        validated.add(MAIN_SHEET+'|'+i);
        selectedForDeletion.delete(i);
        removeFromDeactivationReport(i);
        addToActiveReport(i,'Validado – Manter Ativo pela aba '+(sheet==='NCM_Mesma_Descricao'?'NCM Mesma Descrição':'Descrições Duplicadas'),atribuidoPara);
        touchTimestamp(MAIN_SHEET+'|'+i);
        logValidationEvent(i,{sofreuAlteracao:false});
      });
      log('Validação de grupo pela aba analítica',matches[0],matches.length+' cadastro(s) correspondente(s) enviados ao Relatório Mantidos Ativos');
      toast(matches.length+' cadastro(s) validado(s). O item foi movido para o final da lista.');
    }else{
      matches.forEach(i=>{validated.delete(MAIN_SHEET+'|'+i);removeFromActiveReport(i);touchTimestamp(MAIN_SHEET+'|'+i)});
      log('Validação de grupo desfeita pela aba analítica',matches[0],matches.length+' cadastro(s) retornaram para análise');
      toast('Validação desfeita. O item voltou para a lista de pendentes.');
    }
    persist();
    queueMovementSnapshot();
    return matches.length;
  };
  function toast(msg){const t=document.createElement('div');t.textContent=msg;t.style.cssText='position:fixed;right:22px;bottom:22px;z-index:999;background:#087b59;color:#fff;padding:13px 17px;border-radius:10px;box-shadow:0 12px 30px #0004;font-size:12px;font-weight:700';document.body.appendChild(t);setTimeout(()=>t.remove(),3200)}

  window.openDuplicateReview=function(desc){if(current==='Descricoes_Duplicadas'||current==='NCM_Mesma_Descricao')originSheet=current;description=desc;productReviewMode=true;current=MAIN_SHEET;render();window.scrollTo({top:0,behavior:'smooth'})};
  window.closeDuplicateReview=function(){description='';productReviewMode=false;goTo(originSheet)};
  window.setReviewUser=setUser;
  window.validateReviewPrincipal=function(idx){
    if(!requireUserAlways()||!confirm('Confirma que este é o cadastro principal e deve permanecer ativo?'))return;
    validated.add(MAIN_SHEET+'|'+idx);
    selectedForDeletion.delete(idx);
    removeFromDeactivationReport(idx);
    addToActiveReport(idx,'Validado – Manter Ativo (principal)',originAssignmentName());
    touchTimestamp(MAIN_SHEET+'|'+idx);
    logValidationEvent(idx,{sofreuAlteracao:false});
    persist();
    log('Validação do cadastro principal',idx,'Confirmado para permanecer ativo');
    render();
    toast('Cadastro principal validado e enviado ao Relatório Mantidos Ativos.');
  };
  window.validateReviewRecord=function(idx){
    if(!requireUserAlways()||!confirm('Confirma que este cadastro deve permanecer ativo?'))return;
    validated.add(MAIN_SHEET+'|'+idx);
    selectedForDeletion.delete(idx);
    removeFromDeactivationReport(idx);
    addToActiveReport(idx,'Validado – Manter Ativo',originAssignmentName());
    touchTimestamp(MAIN_SHEET+'|'+idx);
    logValidationEvent(idx,{sofreuAlteracao:false});
    persist();
    log('Validação – Manter Ativo',idx,'Registro confirmado para permanecer ativo');
    render();
    toast('Produto validado e enviado ao Relatório Mantidos Ativos.');
  };
  window.undoReviewValidation=function(idx){if(!requireUser()||!confirm('Deseja desfazer a decisão de manter este cadastro ativo?'))return;validated.delete(MAIN_SHEET+'|'+idx);removeFromActiveReport(idx);touchTimestamp(MAIN_SHEET+'|'+idx);log('Validação desfeita',idx,'Decisão de manter ativo removida');persist();render();toast('Validação e registro no relatório foram desfeitos.')};
  window.toggleReviewDeletion=function(idx,checked,checkbox){
    if(checked){
      const sugestao=requireUser();
      const nome=(prompt('Informe seu nome para registrar esta desativação:', sugestao==='Anônimo'?'':sugestao)||'').trim();
      if(!nome){if(checkbox)checkbox.checked=false;return}
      setUser(nome);
      if(typeof window.setReviewUserName==='function') window.setReviewUserName(nome);
      const nameInput=document.getElementById('userNameInput'); if(nameInput) nameInput.value=nome;
      const reason=(prompt('Informe o motivo da desativação deste cadastro:')||'').trim();
      if(!reason){if(checkbox)checkbox.checked=false;return}
      validated.delete(MAIN_SHEET+'|'+idx);
      removeFromActiveReport(idx);
      selectedForDeletion.add(idx);
      addToDeactivationReport(idx,reason);
      touchTimestamp(MAIN_SHEET+'|'+idx);
      persist();
      log('Separar para Desativação',idx,'Motivo: '+reason);
      toast('Cadastro separado e incluído no Relatório de Desativação.');
      productReviewMode=false;
      goTo('deactivationReport');
      return;
    }
    if(!requireUser()){if(checkbox)checkbox.checked=true;return}
    if(!confirm('Deseja desfazer a separação deste cadastro para desativação?')){if(checkbox)checkbox.checked=true;return}
    selectedForDeletion.delete(idx);
    removeFromDeactivationReport(idx);
    persist();
    log('Separação para desativação desfeita',idx,'Registro removido do Relatório de Desativação');
    render();
    toast('Separação desfeita e cadastro removido do relatório.');
  };
  window.deleteSelectedReview=function(){const chosen=[...selectedForDeletion].filter(i=>isActive(MAIN_SHEET,i));if(!chosen.length)return;if(!requireUser())return;const principals=principalsByBranch(indices()),blocked=chosen.filter(i=>principals.has(i)&&!validated.has(MAIN_SHEET+'|'+i));if(blocked.length){alert('Existem cadastros principais selecionados que ainda não foram validados. Valide-os antes da exclusão.');return}if(!confirm('Confirma a exclusão de '+chosen.length+' registro(s) separado(s)? A ação será registrada no histórico.'))return;const touched=[];chosen.forEach(idx=>{const d=DATA[MAIN_SHEET],r=getRow(MAIN_SHEET,idx),ci=d.headers.findIndex(h=>/^codigo$|^código$/i.test(h));log('Exclusão de registro separado',idx,'Código '+r[ci]+' excluído após triagem');deletes.add(MAIN_SHEET+'|'+idx);touchTimestamp(MAIN_SHEET+'|'+idx);const item=deactivationReport.find(x=>x.key===reportKey(idx)&&x.status==='Selecionado');if(item){item.status='Desativado';item.completedAt=new Date().toISOString();touched.push(item)}});saveDeactivationReport();touched.forEach(desativacaoUpsert);selectedForDeletion.clear();persist();render();toast('Registros selecionados excluídos e registrados no relatório.')};
  function installEditTracking(){const body=document.getElementById('mBody');if(!body||editContext===null)return;body.querySelectorAll('[data-i]').forEach(input=>{input.addEventListener('input',()=>{const changed=String(input.value)!==String(editOriginalRow[+input.dataset.i]??'');input.closest('.fld').classList.toggle('field-changed',changed)})});const box=document.createElement('section');box.className='edit-tracking';box.innerHTML='<h4>Rastreabilidade da alteração</h4><p>Os campos modificados serão identificados automaticamente. Marque o Protheus somente depois de confirmar que a atualização também foi realizada no ERP.</p><div class="edit-tracking-options"><label class="edit-status-option"><input type="checkbox" id="editPlatformStatus" checked disabled> Alterado na plataforma</label><label class="edit-status-option"><input type="checkbox" id="editProtheusStatus"> Atualizado no Protheus</label></div><button type="button" class="btn gray" style="margin-top:12px;width:100%" onclick="openValidationHistoryModal(\''+reportKey(editContext)+'\')">🕑 Ver histórico completo deste produto</button>';body.appendChild(box)}
  window.editReviewRecord=function(idx){if(!requireUser())return;const d=DATA[MAIN_SHEET],r=getRow(MAIN_SHEET,idx),ci=d.headers.findIndex(h=>/^codigo$|^código$/i.test(h)),fi=d.headers.findIndex(h=>/filial/i.test(h));if(!confirm('Deseja alterar o cadastro '+r[ci]+' da Filial '+r[fi]+'?'))return;editContext=idx;editOriginalRow=[...r];openModal(MAIN_SHEET,idx);installEditTracking()};
  window.deleteReviewRecord=function(idx){if(!requireUser())return;const list=indices(),principals=principalsByBranch(list),d=DATA[MAIN_SHEET],r=getRow(MAIN_SHEET,idx),ci=d.headers.findIndex(h=>/^codigo$|^código$/i.test(h)),fi=d.headers.findIndex(h=>/filial/i.test(h));if(principals.has(idx)&&!validated.has(MAIN_SHEET+'|'+idx)){alert('Valide o cadastro principal desta filial antes de excluí-lo.');return}if(!confirm('Confirma a exclusão do cadastro '+r[ci]+' da Filial '+r[fi]+'?'))return;log('Exclusão de registro',idx,'Código '+r[ci]+' excluído');deletes.add(MAIN_SHEET+'|'+idx);touchTimestamp(MAIN_SHEET+'|'+idx);persist();render();toast('Registro excluído e histórico atualizado.')};

  window.saveModal=function(){
    const idx=editContext;if(idx===null){originalSave();return}
    const d=DATA[MAIN_SHEET],inputs=[...document.querySelectorAll('#mBody [data-i]')];
    const changes=inputs.filter(el=>String(el.value)!==String(editOriginalRow[+el.dataset.i]??'')).map(el=>({header:d.headers[+el.dataset.i],oldVal:editOriginalRow[+el.dataset.i],newVal:el.value}));
    const changedFields=changes.map(c=>c.header),protheus=!!document.getElementById('editProtheusStatus')?.checked;
    if(!changedFields.length){alert('Nenhum campo foi alterado.');return}
    if(!confirm('Salvar alterações nos campos: '+changedFields.join(', ')+'?'))return;
    originalSave();
    const trackingEntry={id:genId(),idx,key:reportKey(idx),fields:changedFields,platform:true,protheus,user:user(),ts:new Date().toISOString(),description};
    editTracking.unshift(trackingEntry);
    safeLocalSet('emtel_edit_tracking',JSON.stringify(editTracking.slice(0,1000)));
    editTrackingInsert(trackingEntry);
    queueMovementSnapshot();
    const validacaoId=genId();
    changes.forEach(c=>logValidationEvent(idx,{sofreuAlteracao:true,campoAlterado:c.header,valorAnterior:c.oldVal,valorNovo:c.newVal,validacaoId}));
    log('Alteração de cadastro',idx,'Campos: '+changedFields.join(', ')+' • Plataforma: atualizado • Protheus: '+(protheus?'atualizado':'pendente'));
    editContext=null;editOriginalRow=null;render();
    toast(protheus?'Alteração registrada na plataforma e no Protheus.':'Alteração salva; atualização no Protheus ficou pendente.');
  };
  window.closeModal=function(){editContext=null;editOriginalRow=null;return originalClose()};

  function historyHtml(){const target=String(description||'').trim();const logs=history.filter(x=>String(x.description||'').trim()===target).slice(0,20);return '<section class="panel"><h2>Histórico desta análise</h2>'+(logs.length?logs.map(x=>'<div class="history-row"><b>'+escapeHtml(x.user)+'</b><span>'+escapeHtml(x.action)+'<br>'+escapeHtml(x.detail||'')+'</span><span>Filial '+escapeHtml(x.filial)+'</span><span>'+new Date(x.ts).toLocaleString('pt-BR')+'</span></div>').join(''):'<div class="empty">Nenhuma ação registrada.</div>')+'</section>'}
  window.renderDuplicateReview=function(m){
    const d=DATA[MAIN_SHEET],h=d.headers,list=indices(),active=list.filter(i=>isActive(MAIN_SHEET,i));
    const fi=h.findIndex(x=>/filial|loja|unidade/i.test(x)),ci=h.findIndex(x=>/^codigo$|^código$/i.test(x)),itemIdx=h.findIndex(x=>/cod\.?\s*item|código\s*do\s*item/i.test(x)),ni=h.findIndex(x=>/NCM|IPI/i.test(x)),dateIdx=h.findIndex(x=>/data.*cri|cria[cç][aã]o|inclus[aã]o/i.test(x));
    const principals=principalsByBranch(list),branches=[...new Set(active.map(i=>String(getRow(MAIN_SHEET,i)[fi]??'—')))],colors=new Map(branches.map((b,i)=>[b,i%6])),ncm={};active.forEach(i=>{const n=String(getRow(MAIN_SHEET,i)[ni]||'Não informado');ncm[n]=(ncm[n]||0)+1});
    const rows=list.map(idx=>{const r=getRow(MAIN_SHEET,idx),branch=String(r[fi]??'—'),n=String(r[ni]||'Não informado'),created=dateIdx>=0?String(r[dateIdx]||'Não informado'):'Não informado',isMain=principals.has(idx),isDeleted=!isActive(MAIN_SHEET,idx),isVal=validated.has(MAIN_SHEET+'|'+idx),isSelected=selectedForDeletion.has(idx);return '<tr id="reviewRow'+idx+'" class="branch-c'+(colors.get(branch)||0)+' '+(isMain?'primary-record ':'')+(isDeleted?'deleted-record ':'')+(isSelected?'marked-delete':'')+'"><td>'+(isDeleted?'<span class="pill">Desativado</span>':isVal?'<span class="pill" style="background:#d1fae5;color:#047857">Validado – Manter Ativo</span>':isSelected?'<span class="pill" style="background:#fff0f3;color:var(--vermelho)">Separar para Desativação</span>':'<span class="pill" style="background:#fff0f3;color:var(--vermelho)">Aguardando análise</span>')+(isMain?'<br><span class="primary-badge">★ Principal desta filial</span>':'')+'</td><td><b>'+escapeHtml(branch)+'</b></td><td><b>'+escapeHtml(r[ci]||'—')+'</b></td><td>'+escapeHtml(description)+'</td><td>'+escapeHtml(n)+'</td><td>'+escapeHtml(r[3]||'—')+'</td><td>'+escapeHtml(r[5]||'—')+'</td><td>'+escapeHtml(r[7]||'—')+'</td><td>'+escapeHtml(created)+'</td><td>'+(ncm[n]>1?'<span class="ncm-match">Mesmo NCM · '+ncm[n]+' registros</span>':'<span class="ncm-single">NCM diferente</span>')+'</td><td><div class="review-actions">'+(isDeleted?'—':(isMain&&!isVal?'<button class="validate" onclick="validateReviewPrincipal('+idx+')">Validar principal</button>':'')+(isVal?'<button class="undo" onclick="undoReviewValidation('+idx+')">↺ Desfazer validação</button>':'<button class="correct" onclick="validateReviewRecord('+idx+')">Validado – Manter Ativo</button>')+'<button class="edit" onclick="editReviewRecord('+idx+')">Alterar</button><label class="select-delete '+(isSelected?'selected':'')+'"><input type="checkbox" '+(isSelected?'checked':'')+' onchange="toggleReviewDeletion('+idx+',this.checked,this)"> '+(isSelected?'Desfazer separação':'Separar para Desativação')+'</label>')+'</div></td></tr>'}).join('');
    const principalStatus=principals.size===0?'Não se aplica':([...principals].every(i=>validated.has(MAIN_SHEET+'|'+i))?'Validado':'Pendente');
    m.innerHTML='<div class="review-header"><div><button class="review-back" onclick="closeDuplicateReview()">← Voltar</button><div class="page-kicker" style="margin-top:14px">Produtos Cadastrados no Protheus · Análise comparativa</div><h1>'+escapeHtml(description)+'</h1><p>Classifique cada cadastro como “Validado – Manter Ativo” ou “Separar para Desativação”.</p></div><div class="review-user"><label>Usuário</label><input value="'+escapeHtml(user())+'" placeholder="Informe seu nome" oninput="setReviewUser(this.value)"></div></div><div class="review-stats"><div class="review-stat"><b>'+active.length+'</b><span>Cadastros relacionados</span></div><div class="review-stat"><b>'+branches.length+'</b><span>Filiais</span></div><div class="review-stat"><b>'+Object.values(ncm).filter(v=>v>1).length+'</b><span>NCMs coincidentes</span></div><div class="review-stat"><b>'+principalStatus+'</b><span>Principais por filial</span></div></div><section class="panel"><h2>Cadastros relacionados ao produto</h2><div class="branch-legend">'+branches.map((b,i)=>'<span class="branch-key c'+i%6+'">Filial '+escapeHtml(b)+'</span>').join('')+'</div><div class="review-batch"><span><b id="selectedDeleteCount">'+selectedForDeletion.size+'</b> registro(s) separado(s) para desativação</span><button id="deleteSelectedButton" onclick="deleteSelectedReview()" '+(selectedForDeletion.size?'':'disabled')+'>Confirmar desativação</button></div><div class="review-wrap"><table class="review-table"><thead><tr><th>Situação</th><th>Filial</th><th>Código</th><th>Descrição</th><th>NCM</th><th>Tipo</th><th>Unidade</th><th>Grupo</th><th>Data de criação</th><th>Comparação NCM</th><th>Ações</th></tr></thead><tbody>'+rows+'</tbody></table></div></section>'+historyHtml();
    const reviewTable=m.querySelector('.review-table');
    if(reviewTable){
      const headerRow=reviewTable.querySelector('thead tr'),itemHeader=document.createElement('th');
      itemHeader.textContent='Código do item';
      headerRow.insertBefore(itemHeader,headerRow.children[3]);
      [...reviewTable.querySelectorAll('tbody tr')].forEach((tr,pos)=>{
        const itemCell=document.createElement('td'),rowIndex=list[pos],rowData=getRow(MAIN_SHEET,rowIndex),itemValue=itemIdx>=0?String(rowData[itemIdx]||'Não informado'):'Não informado';
        itemCell.innerHTML='<b>'+escapeHtml(itemValue)+'</b>';
        tr.insertBefore(itemCell,tr.children[3]);
        const tracking=editTracking.find(x=>x.idx===rowIndex);
        if(tracking){const status=document.createElement('div');status.className='sync-badges';status.innerHTML='<span class="sync-badge sync-platform">Plataforma atualizada</span><span class="sync-badge '+(tracking.protheus?'sync-protheus':'sync-pending')+'">Protheus '+(tracking.protheus?'atualizado':'pendente')+'</span>';tr.children[0].appendChild(status)}
      });
    }
  };

  let catalogFilters={q:'',filial:'',ncm:'',desc:'',status:'all'};
  window.catalogValidate=function(idx,desc){description=String(desc||'').trim();validateReviewRecord(idx)};
  window.catalogUndo=function(idx,desc){description=String(desc||'').trim();undoReviewValidation(idx)};
  window.catalogEdit=function(idx,desc){description=String(desc||'').trim();editReviewRecord(idx)};
  window.catalogSeparate=function(idx,desc,checked,checkbox){description=String(desc||'').trim();toggleReviewDeletion(idx,checked,checkbox)};
  window.catalogFilter=function(){catalogFilters.q=(document.getElementById('catalogSearch')?.value||'').toLowerCase();catalogFilters.filial=(document.getElementById('catalogBranch')?.value||'').toLowerCase();catalogFilters.ncm=(document.getElementById('catalogNcm')?.value||'').toLowerCase();catalogFilters.desc=(document.getElementById('catalogDesc')?.value||'').toLowerCase();drawModernProducts()};
  window.catalogSetStatus=function(status){catalogFilters.status=status;document.querySelectorAll('[data-catalog-status]').forEach(b=>b.classList.toggle('active',b.dataset.catalogStatus===status));drawModernProducts()};
  window.catalogClear=function(){catalogFilters={q:'',filial:'',ncm:'',desc:'',status:'all'};['catalogSearch','catalogBranch','catalogNcm','catalogDesc'].forEach(id=>{const e=document.getElementById(id);if(e)e.value=''});document.querySelectorAll('[data-catalog-status]').forEach(b=>b.classList.toggle('active',b.dataset.catalogStatus==='all'));drawModernProducts()};
  window.drawModernProducts=function(){
    const tb=document.getElementById('catalogBody');if(!tb)return;const d=DATA[MAIN_SHEET],h=d.headers,fi=h.findIndex(x=>/filial|loja|unidade/i.test(x)),ci=h.findIndex(x=>/^codigo$|^código$/i.test(x)),itemIdx=h.findIndex(x=>/cod\.?\s*item|código\s*do\s*item/i.test(x)),di=h.findIndex(x=>/descric|descr|produto|nome/i.test(x)),ni=h.findIndex(x=>/NCM|IPI/i.test(x)),typeIdx=h.findIndex(x=>/^tipo$/i.test(x)),unitIdx=h.findIndex(x=>/unidade/i.test(x)),groupIdx=h.findIndex(x=>/^grupo$/i.test(x)),dateIdx=h.findIndex(x=>/data.*cri|cria[cç][aã]o|inclus[aã]o/i.test(x)),dupSet=buildDupSet(MAIN_SHEET),branchNames=[...new Set(Array.from({length:rowCount(MAIN_SHEET)},(_,i)=>isActive(MAIN_SHEET,i)?String(getRow(MAIN_SHEET,i)[fi]??'—'):null).filter(Boolean))],branchColors=new Map(branchNames.map((b,i)=>[b,i%6])),pairCounts=new Map();
    for(let i=0;i<rowCount(MAIN_SHEET);i++){if(!isActive(MAIN_SHEET,i))continue;const r=getRow(MAIN_SHEET,i),key=String(r[di]??'').trim().toUpperCase()+'||'+String(r[ni]??'').trim().toUpperCase();pairCounts.set(key,(pairCounts.get(key)||0)+1)}
    let html='',shown=0,totalFound=0;
    for(let i=0;i<rowCount(MAIN_SHEET);i++){if(!isActive(MAIN_SHEET,i))continue;const r=getRow(MAIN_SHEET,i),branch=String(r[fi]??'—'),code=String(r[ci]??'—'),item=itemIdx>=0?String(r[itemIdx]||'Não informado'):'Não informado',desc=String(r[di]??''),ncm=String(r[ni]||'Não informado'),isVal=validated.has(MAIN_SHEET+'|'+i),isSelected=selectedForDeletion.has(i),isDup=dupSet.has(i),hay=r.join(' ').toLowerCase();if(catalogFilters.q&&!hay.includes(catalogFilters.q))continue;if(catalogFilters.filial&&!branch.toLowerCase().includes(catalogFilters.filial))continue;if(catalogFilters.ncm&&!ncm.toLowerCase().includes(catalogFilters.ncm))continue;if(catalogFilters.desc&&!desc.toLowerCase().includes(catalogFilters.desc))continue;if(catalogFilters.status==='dup'&&!isDup)continue;if(catalogFilters.status==='val'&&!isVal)continue;if(catalogFilters.status==='pend'&&(isVal||isSelected))continue;if(catalogFilters.status==='separated'&&!isSelected)continue;totalFound++;if(shown++>=600)continue;const pairKey=desc.trim().toUpperCase()+'||'+ncm.trim().toUpperCase(),sameNcm=pairCounts.get(pairKey)||1,created=dateIdx>=0?String(r[dateIdx]||'Não informado'):'Não informado';const rowEditCall="catalogEdit("+i+",decodeURIComponent('"+encodeURIComponent(desc)+"'))";html+='<tr class="branch-c'+(branchColors.get(branch)||0)+' '+(isSelected?'marked-delete':'')+' clk" onclick="'+rowEditCall+'"><td>'+(isVal?'<span class="pill" style="background:#d1fae5;color:#047857">Validado – Manter Ativo</span>':isSelected?'<span class="pill" style="background:#fff0f3;color:var(--vermelho)">Separar para Desativação</span>':isDup?'<span class="pill" style="background:#fff0f3;color:var(--vermelho)">Duplicado</span>':'<span class="pill">Aguardando análise</span>')+'</td><td><b>'+escapeHtml(branch)+'</b></td><td><b>'+escapeHtml(code)+'</b></td><td><b>'+escapeHtml(item)+'</b></td><td>'+escapeHtml(desc)+'</td><td>'+escapeHtml(ncm)+'</td><td>'+escapeHtml(typeIdx>=0?r[typeIdx]:'—')+'</td><td>'+escapeHtml(unitIdx>=0?r[unitIdx]:'—')+'</td><td>'+escapeHtml(groupIdx>=0?r[groupIdx]:'—')+'</td><td>'+escapeHtml(created)+'</td><td>'+(sameNcm>1?'<span class="ncm-match">Mesmo NCM · '+sameNcm+' registros</span>':'<span class="ncm-single">NCM único</span>')+'</td><td onclick="event.stopPropagation()"><div class="review-actions">'+(isVal?'<button class="undo" onclick="catalogUndo('+i+',decodeURIComponent(\''+encodeURIComponent(desc)+'\'))">↺ Desfazer</button>':'<button class="correct" onclick="catalogValidate('+i+',decodeURIComponent(\''+encodeURIComponent(desc)+'\'))">Validado – Manter Ativo</button>')+'<button class="edit" onclick="catalogEdit('+i+',decodeURIComponent(\''+encodeURIComponent(desc)+'\'))">Alterar</button><label class="select-delete '+(isSelected?'selected':'')+'"><input type="checkbox" '+(isSelected?'checked':'')+' onchange="catalogSeparate('+i+',decodeURIComponent(\''+encodeURIComponent(desc)+'\'),this.checked,this)"> '+(isSelected?'Desfazer separação':'Separar para Desativação')+'</label></div></td></tr>'}
    if(!html)html='<tr><td colspan="12" class="empty">Nenhum produto encontrado.</td></tr>';else if(totalFound>600)html+='<tr><td colspan="12" class="empty">Mostrando os primeiros 600 de '+totalFound.toLocaleString('pt-BR')+' resultados. Use os filtros para refinar.</td></tr>';tb.innerHTML=html;const count=document.getElementById('catalogResultCount');if(count)count.textContent=totalFound.toLocaleString('pt-BR')+' produto(s)';
  };
  window.renderModernProducts=function(m){
    const st=computeStats(MAIN_SHEET),init=pendingFilter||{};pendingFilter=null;const pendAjustado=Math.max(0,st.pend-selectedForDeletion.size);catalogFilters={q:'',filial:String(init.filial||'').toLowerCase(),ncm:String(init.ncm||'').toLowerCase(),desc:String(init.desc||'').toLowerCase(),status:init.onlyDup?'dup':init.onlyValidated?'val':init.onlyPending?'pend':'all'};
    m.innerHTML='<div class="page-title"><div><div class="page-kicker">Base cadastral Protheus</div><h2>Produtos Cadastrados Protheus</h2><p>Analise, valide, altere e separe produtos para desativação.</p></div><div class="date-badge" id="catalogResultCount">'+st.total.toLocaleString('pt-BR')+' produto(s)</div></div><div class="cards"><div class="card clk" onclick="catalogSetStatus(\'all\')"><h3>Total</h3><div class="v">'+st.total.toLocaleString('pt-BR')+'</div><div class="d">Produtos ativos</div></div><div class="card clk" onclick="catalogSetStatus(\'val\')"><h3>Validados</h3><div class="v">'+st.val.toLocaleString('pt-BR')+'</div><div class="d">Mantidos ativos</div></div><div class="card clk" onclick="catalogSetStatus(\'pend\')"><h3>Pendentes</h3><div class="v">'+pendAjustado.toLocaleString('pt-BR')+'</div><div class="d">Aguardando análise</div></div><div class="card clk" onclick="catalogSetStatus(\'separated\')"><h3>Separados</h3><div class="v">'+selectedForDeletion.size.toLocaleString('pt-BR')+'</div><div class="d">Para desativação</div></div></div><section class="panel"><div class="toolbar"><input id="catalogSearch" type="text" placeholder="🔍 Busca geral..." oninput="catalogFilter()"><input id="catalogBranch" type="text" placeholder="🏢 Filial" value="'+escapeHtml(init.filial||'')+'" oninput="catalogFilter()"><input id="catalogNcm" type="text" placeholder="🏷️ NCM" value="'+escapeHtml(init.ncm||'')+'" oninput="catalogFilter()"><input id="catalogDesc" type="text" placeholder="📝 Descrição" value="'+escapeHtml(init.desc||'')+'" oninput="catalogFilter()"><button class="btn gray" onclick="catalogClear()">Limpar</button><button class="btn" onclick="triggerImport(MAIN_SHEET)">⬆ Importar Produtos</button><input type="file" id="importFile" accept=".xlsx,.xls" style="display:none" onchange="handleImportFile(event,MAIN_SHEET)"><button class="btn" onclick="exportAll()">⬇ Exportar Excel</button></div><div class="catalog-status-filters"><button data-catalog-status="all" class="'+(catalogFilters.status==='all'?'active':'')+'" onclick="catalogSetStatus(\'all\')">Todos</button><button data-catalog-status="dup" class="'+(catalogFilters.status==='dup'?'active':'')+'" onclick="catalogSetStatus(\'dup\')">Duplicados</button><button data-catalog-status="val" class="'+(catalogFilters.status==='val'?'active':'')+'" onclick="catalogSetStatus(\'val\')">Validados</button><button data-catalog-status="pend" class="'+(catalogFilters.status==='pend'?'active':'')+'" onclick="catalogSetStatus(\'pend\')">Pendentes</button><button data-catalog-status="separated" class="'+(catalogFilters.status==='separated'?'active':'')+'" onclick="catalogSetStatus(\'separated\')">Separados</button></div><div class="review-wrap"><table class="review-table"><thead><tr><th>Situação</th><th>Filial</th><th>Código</th><th>Código do item</th><th>Descrição</th><th>NCM</th><th>Tipo</th><th>Unidade</th><th>Grupo</th><th>Data de criação</th><th>Comparação NCM</th><th>Ações</th></tr></thead><tbody id="catalogBody"></tbody></table></div></section>';drawModernProducts();
  };

  // os botões de relatório entram na área que rola (#navScroll); "Configurações" fica fixo
  // fora dela (direto em #nav), sempre visível na última posição sem precisar rolar a barra.
  function ensureReportNav(){const n=document.getElementById('navScroll');if(!n)return;if(!n.querySelector('[data-id="activeReport"]')){const a=document.createElement('button');a.dataset.id='activeReport';a.innerHTML='✅ Relatório Mantidos Ativos';a.onclick=function(){productReviewMode=false;goTo('activeReport')};n.appendChild(a)}if(!n.querySelector('[data-id="deactivationReport"]')){const b=document.createElement('button');b.dataset.id='deactivationReport';b.innerHTML='📋 Relatório de Desativação';b.onclick=function(){productReviewMode=false;goTo('deactivationReport')};n.appendChild(b)}if(!n.querySelector('[data-id="validatedReport"]')){const c=document.createElement('button');c.dataset.id='validatedReport';c.innerHTML='🧾 Produtos Validados';c.onclick=function(){productReviewMode=false;goTo('validatedReport')};n.appendChild(c)}const nav=document.getElementById('nav'),config=document.querySelector('[data-id="config"]');if(nav&&config)nav.appendChild(config)}
  window.undoActiveReportTask=function(idx){
    const item=activeReport.find(x=>x.key===reportKey(idx));
    if(!item||!requireUser())return;
    if(!confirm('Desfazer a validação do produto '+item.code+' da Filial '+item.branch+'?'))return;
    description=item.description;
    validated.delete(MAIN_SHEET+'|'+idx);
    removeFromActiveReport(idx);
    touchTimestamp(MAIN_SHEET+'|'+idx);
    persist();
    log('Validação desfeita pelo relatório',idx,'Produto removido do Relatório Mantidos Ativos');
    render();
    toast('Validação desfeita. O produto voltou para Aguardando análise.');
  };
  window.undoDeactivationReportTask=function(idx){
    const key=reportKey(idx),pos=deactivationReport.findIndex(x=>x.key===key);
    if(pos<0||!requireUser())return;
    const item=deactivationReport[pos],wasCompleted=item.status==='Desativado';
    const question=wasCompleted?'Restaurar o cadastro '+item.code+' da Filial '+item.branch+'?':'Desfazer a separação do produto '+item.code+' da Filial '+item.branch+'?';
    if(!confirm(question))return;
    description=item.description;
    selectedForDeletion.delete(idx);
    if(wasCompleted)deletes.delete(key);
    deactivationReport.splice(pos,1);
    saveDeactivationReport();
    desativacaoDelete(key);
    touchTimestamp(key);
    persist();
    log(wasCompleted?'Cadastro restaurado pelo relatório':'Separação desfeita pelo relatório',idx,wasCompleted?'Cadastro restaurado e removido do Relatório de Desativação':'Produto removido do Relatório de Desativação');
    render();
    toast(wasCompleted?'Cadastro restaurado com sucesso.':'Separação desfeita. O produto voltou para Aguardando análise.');
  };
  function undoReportButton(item,type){const idx=Number(item.idx);if(!Number.isInteger(idx)||idx<0)return '—';const label=type==='active'?'↺ Desfazer validação':item.status==='Desativado'?'↺ Restaurar cadastro':'↺ Desfazer separação';const action=type==='active'?'undoActiveReportTask':'undoDeactivationReportTask';return '<button class="undo" onclick="'+action+'('+idx+')">'+label+'</button>'}
  window.exportDeactivationReport=function(){const columns=['Status','Código','Código do item','Descrição','Filial','NCM','Tipo','Unidade','Grupo','Data de criação','Motivo','Data da seleção','Usuário','Data da desativação'],quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"',lines=[columns.map(quote).join(';')];deactivationReport.forEach(x=>lines.push([x.status,x.code,x.itemCode,x.description,x.branch,x.ncm,x.type,x.unit,x.group,x.createdAt,x.reason,new Date(x.selectedAt).toLocaleString('pt-BR'),x.user,x.completedAt?new Date(x.completedAt).toLocaleString('pt-BR'):''].map(quote).join(';')));const blob=new Blob(['\ufeff'+lines.join('\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='relatorio_desativacao_produtos.csv';a.click();URL.revokeObjectURL(url)};
  window.renderDeactivationReport=function(m){
    const selected=deactivationReport.filter(x=>x.status==='Selecionado').length,done=deactivationReport.filter(x=>x.status==='Desativado').length;
    const rows=deactivationReport.map(x=>'<tr><td><span class="report-status '+(x.status==='Desativado'?'done':'selected')+'">'+escapeHtml(x.status)+'</span></td><td><b>'+escapeHtml(x.code)+'</b></td><td><b>'+escapeHtml(x.itemCode||'—')+'</b></td><td>'+escapeHtml(x.description)+'</td><td>'+escapeHtml(x.branch)+'</td><td>'+escapeHtml(x.ncm)+'</td><td>'+escapeHtml(x.type||'—')+'</td><td>'+escapeHtml(x.unit||'—')+'</td><td>'+escapeHtml(x.group||'—')+'</td><td>'+escapeHtml(x.createdAt||'Não informado')+'</td><td class="report-reason">'+escapeHtml(x.reason)+'</td><td>'+new Date(x.selectedAt).toLocaleString('pt-BR')+'</td><td>'+escapeHtml(x.user)+'</td><td>'+(x.completedAt?new Date(x.completedAt).toLocaleString('pt-BR'):'—')+'</td><td>'+undoReportButton(x,'deactivation')+'</td></tr>').join('');
    m.innerHTML='<div class="page-title"><div><div class="page-kicker">Governança cadastral</div><h2>Relatório de Desativação</h2><p>Cadastros separados durante a análise de duplicidades.</p></div></div><div class="review-stats"><div class="review-stat"><b>'+deactivationReport.length+'</b><span>Total no relatório</span></div><div class="review-stat"><b>'+selected+'</b><span>Aguardando desativação</span></div><div class="review-stat"><b>'+done+'</b><span>Desativados</span></div><div class="review-stat"><b>'+new Set(deactivationReport.map(x=>x.branch)).size+'</b><span>Filiais envolvidas</span></div></div><section class="panel"><div class="report-toolbar"><div><h2 style="margin-bottom:4px">Cadastros selecionados</h2><p>As informações ficam salvas no banco compartilhado e visíveis para todos os usuários.</p></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn gray" onclick="runFilialDeactivationAutomation()" title="Separa (sem excluir) todos os produtos ativos das filiais 02 – Full Log, 03 – Tardane Logística e 07 – Verde Azul">⚙️ Separar filiais 02, 03 e 07</button><button class="btn" onclick="exportDeactivationReport()" '+(deactivationReport.length?'':'disabled')+'>⬇ Exportar CSV</button></div></div><div class="review-wrap"><table class="review-table"><thead><tr><th>Status</th><th>Código</th><th>Código do item</th><th>Descrição</th><th>Filial</th><th>NCM</th><th>Tipo</th><th>Unidade</th><th>Grupo</th><th>Data de criação</th><th>Motivo</th><th>Data da seleção</th><th>Usuário</th><th>Data da desativação</th><th>Ações</th></tr></thead><tbody>'+(rows||'<tr><td colspan="15" class="empty">Nenhum cadastro foi separado para desativação.</td></tr>')+'</tbody></table></div></section>';
  };
  window.exportActiveReport=function(){const columns=['Código','Código do item','Descrição','Filial','NCM','Tipo','Unidade','Grupo','Data de criação','Decisão','Data da validação','Usuário','Atribuído a'],quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"',lines=[columns.map(quote).join(';')];activeReport.forEach(x=>lines.push([x.code,x.itemCode,x.description,x.branch,x.ncm,x.type,x.unit,x.group,x.createdAt,x.decision,new Date(x.validatedAt).toLocaleString('pt-BR'),x.user,x.atribuidoPara||'—'].map(quote).join(';')));const blob=new Blob(['\ufeff'+lines.join('\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='relatorio_cadastros_mantidos_ativos.csv';a.click();URL.revokeObjectURL(url)};
  window.renderActiveReport=function(m){
    const rows=activeReport.map(x=>'<tr><td><span class="report-status done">Validado – Manter Ativo</span></td><td><b>'+escapeHtml(x.code)+'</b></td><td><b>'+escapeHtml(x.itemCode||'—')+'</b></td><td>'+escapeHtml(x.description)+'</td><td>'+escapeHtml(x.branch)+'</td><td>'+escapeHtml(x.ncm)+'</td><td>'+escapeHtml(x.type||'—')+'</td><td>'+escapeHtml(x.unit||'—')+'</td><td>'+escapeHtml(x.group||'—')+'</td><td>'+escapeHtml(x.createdAt||'Não informado')+'</td><td>'+escapeHtml(x.decision)+'</td><td>'+new Date(x.validatedAt).toLocaleString('pt-BR')+'</td><td>'+escapeHtml(x.user)+'</td><td>'+escapeHtml(x.atribuidoPara||'—')+'</td><td>'+undoReportButton(x,'active')+'</td></tr>').join('');
    m.innerHTML='<div class="page-title"><div><div class="page-kicker">Governança cadastral</div><h2>Relatório de Cadastros Mantidos Ativos</h2><p>Produtos analisados e validados para permanecerem ativos.</p></div></div><div class="review-stats"><div class="review-stat"><b>'+activeReport.length+'</b><span>Cadastros validados</span></div><div class="review-stat"><b>'+new Set(activeReport.map(x=>x.description)).size+'</b><span>Produtos</span></div><div class="review-stat"><b>'+new Set(activeReport.map(x=>x.branch)).size+'</b><span>Filiais</span></div><div class="review-stat"><b>'+new Set(activeReport.map(x=>x.user)).size+'</b><span>Responsáveis</span></div></div><section class="panel"><div class="report-toolbar"><div><h2 style="margin-bottom:4px">Cadastros mantidos ativos</h2><p>As informações ficam salvas no banco compartilhado e visíveis para todos os usuários.</p></div><button class="btn" onclick="exportActiveReport()" '+(activeReport.length?'':'disabled')+'>⬇ Exportar CSV</button></div><div class="review-wrap"><table class="review-table"><thead><tr><th>Situação</th><th>Código</th><th>Código do item</th><th>Descrição</th><th>Filial</th><th>NCM</th><th>Tipo</th><th>Unidade</th><th>Grupo</th><th>Data de criação</th><th>Decisão</th><th>Data da validação</th><th>Usuário</th><th>Atribuído a</th><th>Ações</th></tr></thead><tbody>'+(rows||'<tr><td colspan="15" class="empty">Nenhum cadastro foi validado para permanecer ativo.</td></tr>')+'</tbody></table></div></section>';
  };

  // ===== Relatório de Produtos Validados =====
  let validatedReportFilter={status:'all',q:''};
  function computeValidatedReportRows(){
    const byProduct=new Map();
    validationHistory.forEach(e=>{
      if(!byProduct.has(e.produtoKey)) byProduct.set(e.produtoKey,{produtoKey:e.produtoKey,codigo:e.codigo,descricao:e.descricao,filial:e.filial,ncm:e.ncm,eventos:[]});
      byProduct.get(e.produtoKey).eventos.push(e);
    });
    // produtos alterados antes deste relatório existir só tinham o registro no
    // "Histórico desta análise" (editTracking, usado no card de Alterações Pendentes e
    // na Configuração) — sem isso o relatório mostrava "Com alteração: 0" mesmo com
    // edições reais já feitas. Só usa editTracking como reforço quando o produto AINDA
    // não tem nenhum evento em validationHistory (evita contar a mesma edição 2x, já
    // que toda edição nova grava nos dois ao mesmo tempo).
    editTracking.forEach(t=>{
      if(!t.key || byProduct.has(t.key)) return;
      const data=reportProductData(t.idx);
      byProduct.set(t.key,{produtoKey:t.key,codigo:data.code,descricao:data.description,filial:data.branch,ncm:data.ncm,eventos:[{
        id:'legacy-edit-'+t.idx+'-'+t.ts, produtoKey:t.key, usuario:t.user,
        sofreuAlteracao:true, campoAlterado:(t.fields||[]).join(', ')||null,
        valorAnterior:null, valorNovo:null, ts:t.ts
      }]});
    });
    // garante uma linha para todo produto validado hoje, mesmo sem histórico registrado (validado antes deste recurso existir)
    for(let i=0;i<rowCount(MAIN_SHEET);i++){
      const key=reportKey(i);
      if(validated.has(key) && !byProduct.has(key)){
        const data=reportProductData(i);
        byProduct.set(key,{produtoKey:key,codigo:data.code,descricao:data.description,filial:data.branch,ncm:data.ncm,eventos:[]});
      }
    }
    return [...byProduct.values()].map(p=>{
      const eventosOrdenados=[...p.eventos].sort((a,b)=>new Date(a.ts)-new Date(b.ts));
      const alteracoes=eventosOrdenados.filter(e=>e.sofreuAlteracao);
      const idx=Number(p.produtoKey.split('|')[1]);
      const ativoHoje=isActive(MAIN_SHEET,idx)&&validated.has(p.produtoKey);
      const usuarios=[...new Set(eventosOrdenados.map(e=>e.usuario).filter(Boolean))];
      const ultimo=eventosOrdenados[eventosOrdenados.length-1];
      return {
        ...p, idx, eventosOrdenados,
        qtdAlteracoes:alteracoes.length,
        sofreuAlteracao:alteracoes.length>0,
        status: !ativoHoje?'Pendente':(alteracoes.length>0?'Validado — Com alteração':'Validado — Sem alteração'),
        usuarios,
        primeiraValidacao: eventosOrdenados[0]?eventosOrdenados[0].ts:null,
        ultimaAtividade: ultimo?ultimo.ts:null
      };
    });
  }
  function validatedReportStats(rows){
    const total=rows.filter(r=>r.status!=='Pendente').length;
    const alterados=rows.filter(r=>r.status==='Validado — Com alteração').length;
    const semAlteracao=rows.filter(r=>r.status==='Validado — Sem alteração').length;
    const totalAlteracoes=rows.reduce((sum,r)=>sum+r.qtdAlteracoes,0);
    const pendentes=rows.filter(r=>r.status==='Pendente').length;
    return {total,alterados,semAlteracao,totalAlteracoes,pendentes,pctAlterado:total?Math.round(alterados*100/total):0,pctSemAlteracao:total?Math.round(semAlteracao*100/total):0};
  }
  window.setValidatedReportStatus=function(status){validatedReportFilter.status=status;renderValidatedReport(document.getElementById('main'))};
  window.filterValidatedReport=function(){validatedReportFilter.q=(document.getElementById('validatedReportSearch')?.value||'').toLowerCase();renderValidatedReport(document.getElementById('main'))};
  window.exportValidatedReport=function(){
    const rows=applyValidatedReportFilter(computeValidatedReportRows());
    const columns=['Código','Descrição','Filial','NCM','Status','Sofreu alteração','Qtd. alterações','Usuário(s)','Primeira validação','Última atividade'];
    const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
    const lines=[columns.map(quote).join(';')];
    rows.forEach(r=>lines.push([r.codigo,r.descricao,r.filial,r.ncm,r.status,r.sofreuAlteracao?'SIM':'NÃO',r.qtdAlteracoes,r.usuarios.join(', '),r.primeiraValidacao?new Date(r.primeiraValidacao).toLocaleString('pt-BR'):'—',r.ultimaAtividade?new Date(r.ultimaAtividade).toLocaleString('pt-BR'):'—'].map(quote).join(';')));
    const blob=new Blob(['\ufeff'+lines.join('\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='relatorio_produtos_validados.csv';a.click();URL.revokeObjectURL(url);
  };
  function applyValidatedReportFilter(rows){
    const f=validatedReportFilter;
    return rows.filter(r=>{
      if(f.status==='alterados'&&r.status!=='Validado — Com alteração')return false;
      if(f.status==='sem-alteracao'&&r.status!=='Validado — Sem alteração')return false;
      if(f.status==='pendentes'&&r.status!=='Pendente')return false;
      if(f.status==='validados'&&r.status==='Pendente')return false;
      if(f.q&&!(r.codigo+' '+r.descricao).toLowerCase().includes(f.q))return false;
      return true;
    });
  }
  window.renderValidatedReport=function(m){
    const allRows=computeValidatedReportRows(),stats=validatedReportStats(allRows),rows=applyValidatedReportFilter(allRows).sort((a,b)=>new Date(b.ultimaAtividade||0)-new Date(a.ultimaAtividade||0));
    const statusPill=s=>{
      const map={'Validado — Sem alteração':['🟢','#047857','#d1fae5'],'Validado — Com alteração':['🟠','#92610a','#fff3d6'],'Pendente':['🔴','#b91c1c','#fee']};
      const [icon,color,bg]=map[s]||map['Pendente'];
      return '<span class="pill" style="color:'+color+';background:'+bg+'">'+icon+' '+escapeHtml(s)+'</span>';
    };
    const rowsHtml=rows.map(r=>'<tr class="clk-row" onclick="openValidationHistoryModal(\''+r.produtoKey.replace(/'/g,"\\'")+'\')"><td><b>'+escapeHtml(r.codigo)+'</b></td><td>'+escapeHtml(r.descricao)+'</td><td>'+escapeHtml(r.filial)+'</td><td>'+escapeHtml(r.ncm)+'</td><td>'+statusPill(r.status)+'</td><td>'+r.qtdAlteracoes+'</td><td>'+escapeHtml(r.usuarios.join(', ')||'—')+'</td><td>'+(r.primeiraValidacao?new Date(r.primeiraValidacao).toLocaleString('pt-BR'):'—')+'</td><td>'+(r.ultimaAtividade?new Date(r.ultimaAtividade).toLocaleString('pt-BR'):'—')+'</td><td><button class="btn small" onclick="event.stopPropagation();openValidationHistoryModal(\''+r.produtoKey.replace(/'/g,"\\'")+'\')">Ver histórico</button></td></tr>').join('');
    m.innerHTML='<div class="page-title"><div><div class="page-kicker">Governança cadastral</div><h2>Relatório de Produtos Validados</h2><p>Histórico completo de validações e alterações realizadas durante a análise.</p></div></div>'
      +'<div class="cards">'
      +'<div class="card clk" onclick="setValidatedReportStatus(\'validados\')"><h3>Total validados</h3><div class="v">'+stats.total.toLocaleString('pt-BR')+'</div></div>'
      +'<div class="card clk" onclick="setValidatedReportStatus(\'sem-alteracao\')"><h3>Sem alteração</h3><div class="v">'+stats.semAlteracao.toLocaleString('pt-BR')+'</div><div class="d">'+stats.pctSemAlteracao+'% dos validados</div></div>'
      +'<div class="card clk" onclick="setValidatedReportStatus(\'alterados\')"><h3>Com alteração</h3><div class="v">'+stats.alterados.toLocaleString('pt-BR')+'</div><div class="d">'+stats.pctAlterado+'% dos validados</div></div>'
      +'<div class="card"><h3>Total de alterações</h3><div class="v">'+stats.totalAlteracoes.toLocaleString('pt-BR')+'</div><div class="d">campos alterados (pode ser &gt; nº de produtos)</div></div>'
      +'<div class="card clk" onclick="setValidatedReportStatus(\'pendentes\')"><h3>Pendentes</h3><div class="v">'+stats.pendentes.toLocaleString('pt-BR')+'</div></div>'
      +'</div>'
      +'<section class="panel">'
      +'<div class="report-toolbar"><div><h2 style="margin-bottom:4px">Produtos</h2><p>Clique em um produto para ver o histórico completo.</p></div><button class="btn" onclick="exportValidatedReport()">⬇ Exportar CSV</button></div>'
      +'<div class="toolbar"><input id="validatedReportSearch" type="text" placeholder="🔍 Buscar por código ou descrição..." value="'+escapeHtml(validatedReportFilter.q)+'" oninput="filterValidatedReport()"></div>'
      +'<div class="catalog-status-filters">'
      +'<button class="'+(validatedReportFilter.status==='all'?'active':'')+'" onclick="setValidatedReportStatus(\'all\')">Todos</button>'
      +'<button class="'+(validatedReportFilter.status==='validados'?'active':'')+'" onclick="setValidatedReportStatus(\'validados\')">Validados</button>'
      +'<button class="'+(validatedReportFilter.status==='alterados'?'active':'')+'" onclick="setValidatedReportStatus(\'alterados\')">Alterados</button>'
      +'<button class="'+(validatedReportFilter.status==='sem-alteracao'?'active':'')+'" onclick="setValidatedReportStatus(\'sem-alteracao\')">Sem alteração</button>'
      +'<button class="'+(validatedReportFilter.status==='pendentes'?'active':'')+'" onclick="setValidatedReportStatus(\'pendentes\')">Pendentes</button>'
      +'</div>'
      +'<div class="review-wrap"><table class="review-table"><thead><tr><th>Código</th><th>Descrição</th><th>Filial</th><th>NCM</th><th>Status</th><th>Alterações</th><th>Usuário(s)</th><th>1ª validação</th><th>Última atividade</th><th>Ações</th></tr></thead><tbody>'+(rowsHtml||'<tr><td colspan="10" class="empty">Nenhum produto encontrado.</td></tr>')+'</tbody></table></div>'
      +'</section>';
  };
  window.openValidationHistoryModal=function(produtoKey){
    const rows=computeValidatedReportRows();
    let p=rows.find(r=>r.produtoKey===produtoKey);
    if(!p){
      // produto sem evento em validationHistory/editTracking ainda (nunca editado nem
      // validado) — mostra o modal vazio em vez de simplesmente não abrir nada.
      const idx=Number(String(produtoKey).split('|')[1]),data=Number.isInteger(idx)?reportProductData(idx):null;
      p=data?{produtoKey,codigo:data.code,descricao:data.description,filial:data.branch,ncm:data.ncm,status:'Pendente',eventosOrdenados:[]}:{produtoKey,codigo:'—',descricao:'—',filial:'—',ncm:'—',status:'—',eventosOrdenados:[]};
    }
    let overlay=document.getElementById('validationHistoryOverlay');
    if(!overlay){
      overlay=document.createElement('div');
      overlay.id='validationHistoryOverlay';
      overlay.style.cssText='position:fixed;inset:0;z-index:9998;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px';
      overlay.onclick=function(e){if(e.target===overlay)closeValidationHistoryModal()};
      document.body.appendChild(overlay);
    }
    const eventos=[...p.eventosOrdenados].reverse();
    const eventoHtml=e=>'<div class="history-row"><b>'+escapeHtml(e.usuario||'Anônimo')+'</b><span>'
      +(e.sofreuAlteracao?('Alteração de campo: <b>'+escapeHtml(e.campoAlterado||'—')+'</b><br>'+escapeHtml(e.valorAnterior||'—')+' → '+escapeHtml(e.valorNovo||'—')):'Validado sem alteração')
      +'</span><span>'+new Date(e.ts).toLocaleString('pt-BR')+'</span></div>';
    overlay.style.display='flex';
    overlay.innerHTML='<div class="box" style="max-width:640px;max-height:80vh;overflow:auto;background:#fff;border-radius:14px;padding:20px" onclick="event.stopPropagation()">'
      +'<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px"><div><h3 style="margin:0">Histórico de Validação do Produto</h3><p style="color:var(--muted);font-size:13px;margin:4px 0 0">'+escapeHtml(p.codigo)+' — '+escapeHtml(p.descricao)+'</p></div><button class="ia-close" onclick="closeValidationHistoryModal()">✕</button></div>'
      +'<p style="font-size:12px;color:var(--muted);margin-bottom:14px">Filial: '+escapeHtml(p.filial)+' · NCM: '+escapeHtml(p.ncm)+' · Status atual: '+escapeHtml(p.status)+'</p>'
      +(eventos.length?eventos.map(eventoHtml).join(''):'<div class="empty">Nenhum evento registrado para este produto.</div>')
      +'</div>';
  };
  window.closeValidationHistoryModal=function(){const overlay=document.getElementById('validationHistoryOverlay');if(overlay){overlay.style.display='none';overlay.innerHTML=''}};

  window.dashboardGo=function(target,filter){productReviewMode=false;goTo(target,filter||null)};
  window.renderExecutiveDashboard=function(m){
    const st=computeStats(MAIN_SHEET),total=st.total||1,valPct=Math.round(st.val*100/total),dupPct=Math.round(st.dup*100/total),d=DATA[MAIN_SHEET],fi=d.headers.findIndex(h=>/filial|loja|unidade/i.test(h)),dupSet=buildDupSet(MAIN_SHEET),branchCounts=new Map();
    const totalBase=rowCount(MAIN_SHEET),desativados=Math.max(0,totalBase-st.total);
    const separados=deactivationReport.filter(x=>x.status==='Selecionado').length;
    const pendAjustado=Math.max(0,st.pend-separados),pendPct=Math.round(pendAjustado*100/total);
    dupSet.forEach(i=>{if(!isActive(MAIN_SHEET,i))return;const branch=fi>=0?String(getRow(MAIN_SHEET,i)[fi]??'—'):'—';branchCounts.set(branch,(branchCounts.get(branch)||0)+1)});
    const topBranches=[...branchCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6),maxBranch=topBranches.length?topBranches[0][1]:1;
    const kpi=(label,value,detail,color,icon,action)=>'<article class="exec-kpi" style="--kpi-color:'+color+'" onclick="'+action+'"><div class="exec-kpi-top"><span class="exec-kpi-label">'+label+'</span><span class="exec-kpi-icon">'+icon+'</span></div><strong>'+Number(value).toLocaleString('pt-BR')+'</strong><small>'+detail+'</small><div class="exec-kpi-link">Abrir detalhes →</div></article>';
    m.innerHTML='<div class="exec-dashboard-head"><div><div class="page-kicker">Visão executiva</div><h1>Dashboard de qualidade cadastral</h1><p>Acompanhe a evolução, identifique riscos e acesse diretamente os registros.</p></div><div class="exec-updated">Atualizado em '+new Date().toLocaleString('pt-BR')+'</div></div><div class="exec-kpis">'+kpi('Total na base',totalBase,desativados.toLocaleString('pt-BR')+' desativado(s)','#5b3dd6','🗂️',"dashboardGo(MAIN_SHEET)")+kpi('Produtos ativos',st.total,'Base consolidada','#174ea6','▦',"dashboardGo(MAIN_SHEET)")+kpi('Validados',st.val,valPct+'% concluído','#0f9f72','✓',"dashboardGo(MAIN_SHEET,{onlyValidated:true})")+kpi('Pendentes',pendAjustado,pendPct+'% aguardando análise','#e99912','◷',"dashboardGo(MAIN_SHEET,{onlyPending:true})")+kpi('Separados p/ desativação',separados,'No Relatório de Desativação','#8a5a00','🗃️',"dashboardGo('deactivationReport')")+'</div><div class="exec-layout"><section class="exec-panel"><div class="exec-panel-title"><h2>Distribuição da situação cadastral</h2><button onclick="dashboardGo(MAIN_SHEET)">Ver produtos →</button></div><div class="exec-donut-wrap"><div class="exec-donut" style="--validated:'+valPct+'%;--duplicate:'+dupPct+'%"><div class="exec-donut-center"><b>'+st.total.toLocaleString('pt-BR')+'</b><span>produtos</span></div></div><div class="exec-legend"><div class="exec-legend-item" onclick="dashboardGo(MAIN_SHEET,{onlyValidated:true})"><i style="background:#0f9f72"></i>Validados<b>'+st.val.toLocaleString('pt-BR')+'</b></div><div class="exec-legend-item" onclick="dashboardGo(MAIN_SHEET,{onlyDup:true})"><i style="background:#e3122b"></i>Repetidos<b>'+st.dup.toLocaleString('pt-BR')+'</b></div><div class="exec-legend-item" onclick="dashboardGo(MAIN_SHEET,{onlyPending:true})"><i style="background:#e99912"></i>Pendentes<b>'+pendAjustado.toLocaleString('pt-BR')+'</b></div></div></div></section><section class="exec-panel"><div class="exec-panel-title"><h2>Filiais com mais duplicidades</h2><button onclick="dashboardGo(\'Descricoes_Duplicadas\')">Analisar →</button></div><div class="branch-bars">'+(topBranches.length?topBranches.map(([branch,count])=>'<div class="branch-bar" onclick="dashboardGo(MAIN_SHEET,{filial:\''+escapeHtml(branch)+'\',onlyDup:true})"><div class="branch-bar-head"><b>Filial '+escapeHtml(branch)+'</b><span>'+count.toLocaleString('pt-BR')+' registros</span></div><div class="branch-track"><div class="branch-fill" style="width:'+Math.round(count*100/maxBranch)+'%"></div></div></div>').join(''):'<div class="empty">Nenhuma duplicidade encontrada.</div>')+'</div></section></div><section class="exec-panel"><div class="exec-panel-title"><h2>Acessos rápidos</h2></div><div class="exec-shortcuts"><button class="exec-shortcut" onclick="dashboardGo(\'NCM_Mesma_Descricao\')"><b>NCM Mesma Descrição</b><span>Analise coincidências de classificação fiscal.</span><em>Abrir análise →</em></button><button class="exec-shortcut" onclick="dashboardGo(\'Descricoes_Duplicadas\')"><b>Descrições Duplicadas</b><span>Compare produtos com descrições repetidas.</span><em>Abrir análise →</em></button><button class="exec-shortcut" onclick="dashboardGo(\'activeReport\')"><b>Mantidos Ativos</b><span>'+activeReport.length+' decisões registradas.</span><em>Abrir relatório →</em></button><button class="exec-shortcut" onclick="dashboardGo(\'deactivationReport\')"><b>Para Desativação</b><span>'+deactivationReport.length+' registros no relatório.</span><em>Abrir relatório →</em></button></div></section>';
  };

  window.render=function(){ensureReportNav();if(productReviewMode&&current!==MAIN_SHEET)productReviewMode=false;if(productReviewMode&&current===MAIN_SHEET){activeBtn();return renderDuplicateReview(document.getElementById('main'))}if(current===MAIN_SHEET){activeBtn();return renderModernProducts(document.getElementById('main'))}if(current==='dashboard'){activeBtn();return renderExecutiveDashboard(document.getElementById('main'))}if(current==='activeReport'){activeBtn();return renderActiveReport(document.getElementById('main'))}if(current==='deactivationReport'){activeBtn();return renderDeactivationReport(document.getElementById('main'))}if(current==='validatedReport'){activeBtn();return renderValidatedReport(document.getElementById('main'))}originalRender();ensureReportNav();if(current==='Descricoes_Duplicadas'||current==='NCM_Mesma_Descricao'){const sourceSheet=current,tb=document.getElementById('tbody'),source=DATA[sourceSheet],descriptionIndex=source?source.headers.findIndex(h=>/descric|descr|produto|nome/i.test(h)):-1;if(tb&&descriptionIndex>=0&&!tb.dataset.reviewBound){tb.dataset.reviewBound='1';tb.addEventListener('click',function(e){if(e.target.closest('button,input,label,a,select,option'))return;const tr=e.target.closest('tr');if(!tr||!tb.contains(tr))return;const descCell=tr.children[descriptionIndex+1];if(!descCell)return;e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();openDuplicateReview(descCell.textContent.trim())},true)}}};
  render();
  restoreMovementSnapshot();
  loadDesativacaoFromSupabase();
  subscribeDesativacaoRealtime();
  setInterval(loadDesativacaoFromSupabase, 8000);
  loadHistoricoFromSupabase();
  subscribeHistoricoRealtime();
  setInterval(loadHistoricoFromSupabase, 8000);
  loadValidationHistoryFromSupabase();
  subscribeValidationHistoryRealtime();
  setInterval(loadValidationHistoryFromSupabase, 8000);
  loadEditTrackingFromSupabase();
  subscribeEditTrackingRealtime();
  setInterval(loadEditTrackingFromSupabase, 8000);
  loadActiveReportFromSupabase();
  subscribeActiveReportRealtime();
  setInterval(loadActiveReportFromSupabase, 8000);
})();

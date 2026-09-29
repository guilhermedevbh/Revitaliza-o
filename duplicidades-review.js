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
  const history=readStoredArray('emtel_duplicate_history');
  const deactivationReport=readStoredArray('emtel_deactivation_report');
  const activeReport=readStoredArray('emtel_active_report');
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
  // re-render em segundo plano (sincronização/Realtime) sem "pular" a página: usa
  // renderPreserveState() do script principal quando disponível (preserva rolagem/busca/foco).
  function softRender(){ if(typeof renderPreserveState==='function') renderPreserveState(); else render(); }
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
  function reportKey(idx){return MAIN_SHEET+'|'+idx}
  function reportProductData(idx){
    const d=DATA[MAIN_SHEET],r=getRow(MAIN_SHEET,idx),find=re=>d.headers.findIndex(h=>re.test(String(h)));
    const ci=find(/^codigo$|^código$/i),ii=find(/cod\.?\s*item|código\s*do\s*item|codigo\s*do\s*item/i),di=find(/descric|descr|produto|nome/i),fi=find(/filial|loja|unidade/i),ni=find(/NCM|IPI/i),ti=find(/^tipo$/i),ui=find(/^unidade$|^um$|^un$/i),gi=find(/^grupo$/i),dti=find(/data.*cri|cria[çc][aã]o|inclus[aã]o/i);
    return {code:String(r[ci]??'—'),itemCode:String(r[ii]??'—'),description:String(r[di]??''),branch:String(r[fi]??'—'),ncm:String(r[ni]??'—'),type:String(r[ti]??'—'),unit:String(r[ui]??'—'),group:String(r[gi]??'—'),createdAt:String(r[dti]??'Não informado')};
  }
  function addToDeactivationReport(idx,reason){const key=reportKey(idx),data=reportProductData(idx),existing=deactivationReport.find(x=>x.key===key&&x.status==='Selecionado');let item;if(existing){Object.assign(existing,data,{reason,selectedAt:new Date().toISOString(),user:user()});item=existing}else{item=Object.assign({key,idx},data,{reason,selectedAt:new Date().toISOString(),user:user(),status:'Selecionado'});deactivationReport.unshift(item)}saveDeactivationReport();desativacaoUpsert(item)}
  function removeFromDeactivationReport(idx){const key=reportKey(idx);for(let i=deactivationReport.length-1;i>=0;i--)if(deactivationReport[i].key===key&&deactivationReport[i].status==='Selecionado')deactivationReport.splice(i,1);saveDeactivationReport();desativacaoDelete(key)}
  function addToActiveReport(idx,decision){const key=reportKey(idx),item=Object.assign({key,idx},reportProductData(idx),{decision:decision||'Validado – Manter Ativo',validatedAt:new Date().toISOString(),user:user()});const pos=activeReport.findIndex(x=>x.key===key);if(pos>=0)activeReport[pos]=item;else activeReport.unshift(item);saveActiveReport()}
  function removeFromActiveReport(idx){for(let i=activeReport.length-1;i>=0;i--)if(activeReport[i].key===reportKey(idx))activeReport.splice(i,1);saveActiveReport()}
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
      matches.forEach(i=>{
        validated.add(MAIN_SHEET+'|'+i);
        selectedForDeletion.delete(i);
        removeFromDeactivationReport(i);
        addToActiveReport(i,'Validado – Manter Ativo pela aba '+(sheet==='NCM_Mesma_Descricao'?'NCM Mesma Descrição':'Descrições Duplicadas'));
        touchTimestamp(MAIN_SHEET+'|'+i);
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
    addToActiveReport(idx,'Validado – Manter Ativo (principal)');
    touchTimestamp(MAIN_SHEET+'|'+idx);
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
    addToActiveReport(idx,'Validado – Manter Ativo');
    touchTimestamp(MAIN_SHEET+'|'+idx);
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
  function installEditTracking(){const body=document.getElementById('mBody');if(!body||editContext===null)return;body.querySelectorAll('[data-i]').forEach(input=>{input.addEventListener('input',()=>{const changed=String(input.value)!==String(editOriginalRow[+input.dataset.i]??'');input.closest('.fld').classList.toggle('field-changed',changed)})});const box=document.createElement('section');box.className='edit-tracking';box.innerHTML='<h4>Rastreabilidade da alteração</h4><p>Os campos modificados serão identificados automaticamente. Marque o Protheus somente depois de confirmar que a atualização também foi realizada no ERP.</p><div class="edit-tracking-options"><label class="edit-status-option"><input type="checkbox" id="editPlatformStatus" checked disabled> Alterado na plataforma</label><label class="edit-status-option"><input type="checkbox" id="editProtheusStatus"> Atualizado no Protheus</label></div>';body.appendChild(box)}
  window.editReviewRecord=function(idx){if(!requireUser())return;const d=DATA[MAIN_SHEET],r=getRow(MAIN_SHEET,idx),ci=d.headers.findIndex(h=>/^codigo$|^código$/i.test(h)),fi=d.headers.findIndex(h=>/filial/i.test(h));if(!confirm('Deseja alterar o cadastro '+r[ci]+' da Filial '+r[fi]+'?'))return;editContext=idx;editOriginalRow=[...r];openModal(MAIN_SHEET,idx);installEditTracking()};
  window.deleteReviewRecord=function(idx){if(!requireUser())return;const list=indices(),principals=principalsByBranch(list),d=DATA[MAIN_SHEET],r=getRow(MAIN_SHEET,idx),ci=d.headers.findIndex(h=>/^codigo$|^código$/i.test(h)),fi=d.headers.findIndex(h=>/filial/i.test(h));if(principals.has(idx)&&!validated.has(MAIN_SHEET+'|'+idx)){alert('Valide o cadastro principal desta filial antes de excluí-lo.');return}if(!confirm('Confirma a exclusão do cadastro '+r[ci]+' da Filial '+r[fi]+'?'))return;log('Exclusão de registro',idx,'Código '+r[ci]+' excluído');deletes.add(MAIN_SHEET+'|'+idx);touchTimestamp(MAIN_SHEET+'|'+idx);persist();render();toast('Registro excluído e histórico atualizado.')};

  window.saveModal=function(){const idx=editContext;if(idx===null){originalSave();return}const d=DATA[MAIN_SHEET],inputs=[...document.querySelectorAll('#mBody [data-i]')],changedFields=inputs.filter(el=>String(el.value)!==String(editOriginalRow[+el.dataset.i]??'')).map(el=>d.headers[+el.dataset.i]),protheus=!!document.getElementById('editProtheusStatus')?.checked;if(!changedFields.length){alert('Nenhum campo foi alterado.');return}if(!confirm('Salvar alterações nos campos: '+changedFields.join(', ')+'?'))return;originalSave();editTracking.unshift({idx,key:reportKey(idx),fields:changedFields,platform:true,protheus,user:user(),ts:new Date().toISOString(),description});safeLocalSet('emtel_edit_tracking',JSON.stringify(editTracking.slice(0,1000)));queueMovementSnapshot();log('Alteração de cadastro',idx,'Campos: '+changedFields.join(', ')+' • Plataforma: atualizado • Protheus: '+(protheus?'atualizado':'pendente'));editContext=null;editOriginalRow=null;render();toast(protheus?'Alteração registrada na plataforma e no Protheus.':'Alteração salva; atualização no Protheus ficou pendente.')};
  window.closeModal=function(){editContext=null;editOriginalRow=null;return originalClose()};

  function historyHtml(){const logs=history.filter(x=>x.description===description).slice(0,20);return '<section class="panel"><h2>Histórico desta análise</h2>'+(logs.length?logs.map(x=>'<div class="history-row"><b>'+escapeHtml(x.user)+'</b><span>'+escapeHtml(x.action)+'<br>'+escapeHtml(x.detail||'')+'</span><span>Filial '+escapeHtml(x.filial)+'</span><span>'+new Date(x.ts).toLocaleString('pt-BR')+'</span></div>').join(''):'<div class="empty">Nenhuma ação registrada.</div>')+'</section>'}
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
  window.catalogValidate=function(idx,desc){description=desc;validateReviewRecord(idx)};
  window.catalogUndo=function(idx,desc){description=desc;undoReviewValidation(idx)};
  window.catalogEdit=function(idx,desc){description=desc;editReviewRecord(idx)};
  window.catalogSeparate=function(idx,desc,checked,checkbox){description=desc;toggleReviewDeletion(idx,checked,checkbox)};
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
    const st=computeStats(MAIN_SHEET),init=pendingFilter||{};pendingFilter=null;catalogFilters={q:'',filial:String(init.filial||'').toLowerCase(),ncm:String(init.ncm||'').toLowerCase(),desc:String(init.desc||'').toLowerCase(),status:init.onlyDup?'dup':init.onlyValidated?'val':init.onlyPending?'pend':'all'};
    m.innerHTML='<div class="page-title"><div><div class="page-kicker">Base cadastral Protheus</div><h2>Produtos Cadastrados Protheus</h2><p>Analise, valide, altere e separe produtos para desativação.</p></div><div class="date-badge" id="catalogResultCount">'+st.total.toLocaleString('pt-BR')+' produto(s)</div></div><div class="cards"><div class="card clk" onclick="catalogSetStatus(\'all\')"><h3>Total</h3><div class="v">'+st.total.toLocaleString('pt-BR')+'</div><div class="d">Produtos ativos</div></div><div class="card clk" onclick="catalogSetStatus(\'dup\')"><h3>Duplicados</h3><div class="v">'+st.dup.toLocaleString('pt-BR')+'</div></div><div class="card clk" onclick="catalogSetStatus(\'val\')"><h3>Validados</h3><div class="v">'+st.val.toLocaleString('pt-BR')+'</div><div class="d">Mantidos ativos</div></div><div class="card clk" onclick="catalogSetStatus(\'pend\')"><h3>Pendentes</h3><div class="v">'+st.pend.toLocaleString('pt-BR')+'</div><div class="d">Aguardando análise</div></div></div><section class="panel"><div class="toolbar"><input id="catalogSearch" type="text" placeholder="🔍 Busca geral..." oninput="catalogFilter()"><input id="catalogBranch" type="text" placeholder="🏢 Filial" value="'+escapeHtml(init.filial||'')+'" oninput="catalogFilter()"><input id="catalogNcm" type="text" placeholder="🏷️ NCM" value="'+escapeHtml(init.ncm||'')+'" oninput="catalogFilter()"><input id="catalogDesc" type="text" placeholder="📝 Descrição" value="'+escapeHtml(init.desc||'')+'" oninput="catalogFilter()"><button class="btn gray" onclick="catalogClear()">Limpar</button><button class="btn" onclick="triggerImport(MAIN_SHEET)">⬆ Importar Produtos</button><input type="file" id="importFile" accept=".xlsx,.xls" style="display:none" onchange="handleImportFile(event,MAIN_SHEET)"><button class="btn" onclick="exportAll()">⬇ Exportar Excel</button></div><div class="catalog-status-filters"><button data-catalog-status="all" class="'+(catalogFilters.status==='all'?'active':'')+'" onclick="catalogSetStatus(\'all\')">Todos</button><button data-catalog-status="dup" class="'+(catalogFilters.status==='dup'?'active':'')+'" onclick="catalogSetStatus(\'dup\')">Duplicados</button><button data-catalog-status="val" class="'+(catalogFilters.status==='val'?'active':'')+'" onclick="catalogSetStatus(\'val\')">Validados</button><button data-catalog-status="pend" class="'+(catalogFilters.status==='pend'?'active':'')+'" onclick="catalogSetStatus(\'pend\')">Pendentes</button><button data-catalog-status="separated" class="'+(catalogFilters.status==='separated'?'active':'')+'" onclick="catalogSetStatus(\'separated\')">Separados</button></div><div class="review-wrap"><table class="review-table"><thead><tr><th>Situação</th><th>Filial</th><th>Código</th><th>Código do item</th><th>Descrição</th><th>NCM</th><th>Tipo</th><th>Unidade</th><th>Grupo</th><th>Data de criação</th><th>Comparação NCM</th><th>Ações</th></tr></thead><tbody id="catalogBody"></tbody></table></div></section>';drawModernProducts();
  };

  function ensureReportNav(){const n=document.getElementById('nav');if(!n)return;if(!n.querySelector('[data-id="activeReport"]')){const a=document.createElement('button');a.dataset.id='activeReport';a.innerHTML='✅ Relatório Mantidos Ativos';a.onclick=function(){productReviewMode=false;goTo('activeReport')};n.appendChild(a)}if(!n.querySelector('[data-id="deactivationReport"]')){const b=document.createElement('button');b.dataset.id='deactivationReport';b.innerHTML='📋 Relatório de Desativação';b.onclick=function(){productReviewMode=false;goTo('deactivationReport')};n.appendChild(b)}const config=n.querySelector('[data-id="config"]');if(config)n.appendChild(config)}
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
    m.innerHTML='<div class="page-title"><div><div class="page-kicker">Governança cadastral</div><h2>Relatório de Desativação</h2><p>Cadastros separados durante a análise de duplicidades.</p></div></div><div class="review-stats"><div class="review-stat"><b>'+deactivationReport.length+'</b><span>Total no relatório</span></div><div class="review-stat"><b>'+selected+'</b><span>Aguardando desativação</span></div><div class="review-stat"><b>'+done+'</b><span>Desativados</span></div><div class="review-stat"><b>'+new Set(deactivationReport.map(x=>x.branch)).size+'</b><span>Filiais envolvidas</span></div></div><section class="panel"><div class="report-toolbar"><div><h2 style="margin-bottom:4px">Cadastros selecionados</h2><p>As informações ficam salvas no banco compartilhado e visíveis para todos os usuários.</p></div><button class="btn" onclick="exportDeactivationReport()" '+(deactivationReport.length?'':'disabled')+'>⬇ Exportar CSV</button></div><div class="review-wrap"><table class="review-table"><thead><tr><th>Status</th><th>Código</th><th>Código do item</th><th>Descrição</th><th>Filial</th><th>NCM</th><th>Tipo</th><th>Unidade</th><th>Grupo</th><th>Data de criação</th><th>Motivo</th><th>Data da seleção</th><th>Usuário</th><th>Data da desativação</th><th>Ações</th></tr></thead><tbody>'+(rows||'<tr><td colspan="15" class="empty">Nenhum cadastro foi separado para desativação.</td></tr>')+'</tbody></table></div></section>';
  };
  window.exportActiveReport=function(){const columns=['Código','Código do item','Descrição','Filial','NCM','Tipo','Unidade','Grupo','Data de criação','Decisão','Data da validação','Usuário'],quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"',lines=[columns.map(quote).join(';')];activeReport.forEach(x=>lines.push([x.code,x.itemCode,x.description,x.branch,x.ncm,x.type,x.unit,x.group,x.createdAt,x.decision,new Date(x.validatedAt).toLocaleString('pt-BR'),x.user].map(quote).join(';')));const blob=new Blob(['\ufeff'+lines.join('\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='relatorio_cadastros_mantidos_ativos.csv';a.click();URL.revokeObjectURL(url)};
  window.renderActiveReport=function(m){
    const rows=activeReport.map(x=>'<tr><td><span class="report-status done">Validado – Manter Ativo</span></td><td><b>'+escapeHtml(x.code)+'</b></td><td><b>'+escapeHtml(x.itemCode||'—')+'</b></td><td>'+escapeHtml(x.description)+'</td><td>'+escapeHtml(x.branch)+'</td><td>'+escapeHtml(x.ncm)+'</td><td>'+escapeHtml(x.type||'—')+'</td><td>'+escapeHtml(x.unit||'—')+'</td><td>'+escapeHtml(x.group||'—')+'</td><td>'+escapeHtml(x.createdAt||'Não informado')+'</td><td>'+escapeHtml(x.decision)+'</td><td>'+new Date(x.validatedAt).toLocaleString('pt-BR')+'</td><td>'+escapeHtml(x.user)+'</td><td>'+undoReportButton(x,'active')+'</td></tr>').join('');
    m.innerHTML='<div class="page-title"><div><div class="page-kicker">Governança cadastral</div><h2>Relatório de Cadastros Mantidos Ativos</h2><p>Produtos analisados e validados para permanecerem ativos.</p></div></div><div class="review-stats"><div class="review-stat"><b>'+activeReport.length+'</b><span>Cadastros validados</span></div><div class="review-stat"><b>'+new Set(activeReport.map(x=>x.description)).size+'</b><span>Produtos</span></div><div class="review-stat"><b>'+new Set(activeReport.map(x=>x.branch)).size+'</b><span>Filiais</span></div><div class="review-stat"><b>'+new Set(activeReport.map(x=>x.user)).size+'</b><span>Responsáveis</span></div></div><section class="panel"><div class="report-toolbar"><div><h2 style="margin-bottom:4px">Cadastros mantidos ativos</h2><p>As decisões permanecem armazenadas neste navegador.</p></div><button class="btn" onclick="exportActiveReport()" '+(activeReport.length?'':'disabled')+'>⬇ Exportar CSV</button></div><div class="review-wrap"><table class="review-table"><thead><tr><th>Situação</th><th>Código</th><th>Código do item</th><th>Descrição</th><th>Filial</th><th>NCM</th><th>Tipo</th><th>Unidade</th><th>Grupo</th><th>Data de criação</th><th>Decisão</th><th>Data da validação</th><th>Usuário</th><th>Ações</th></tr></thead><tbody>'+(rows||'<tr><td colspan="14" class="empty">Nenhum cadastro foi validado para permanecer ativo.</td></tr>')+'</tbody></table></div></section>';
  };

  window.dashboardGo=function(target,filter){productReviewMode=false;goTo(target,filter||null)};
  window.renderExecutiveDashboard=function(m){
    const st=computeStats(MAIN_SHEET),total=st.total||1,valPct=Math.round(st.val*100/total),dupPct=Math.round(st.dup*100/total),pendPct=Math.max(0,100-valPct),d=DATA[MAIN_SHEET],fi=d.headers.findIndex(h=>/filial|loja|unidade/i.test(h)),dupSet=buildDupSet(MAIN_SHEET),branchCounts=new Map();
    dupSet.forEach(i=>{if(!isActive(MAIN_SHEET,i))return;const branch=fi>=0?String(getRow(MAIN_SHEET,i)[fi]??'—'):'—';branchCounts.set(branch,(branchCounts.get(branch)||0)+1)});
    const topBranches=[...branchCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6),maxBranch=topBranches.length?topBranches[0][1]:1;
    const kpi=(label,value,detail,color,icon,action)=>'<article class="exec-kpi" style="--kpi-color:'+color+'" onclick="'+action+'"><div class="exec-kpi-top"><span class="exec-kpi-label">'+label+'</span><span class="exec-kpi-icon">'+icon+'</span></div><strong>'+Number(value).toLocaleString('pt-BR')+'</strong><small>'+detail+'</small><div class="exec-kpi-link">Abrir detalhes →</div></article>';
    m.innerHTML='<div class="exec-dashboard-head"><div><div class="page-kicker">Visão executiva</div><h1>Dashboard de qualidade cadastral</h1><p>Acompanhe a evolução, identifique riscos e acesse diretamente os registros.</p></div><div class="exec-updated">Atualizado em '+new Date().toLocaleString('pt-BR')+'</div></div><div class="exec-kpis">'+kpi('Produtos ativos',st.total,'Base consolidada','#174ea6','▦',"dashboardGo(MAIN_SHEET)")+kpi('Cadastros repetidos',st.dup,dupPct+'% da base','#e3122b','⧉',"dashboardGo(MAIN_SHEET,{onlyDup:true})")+kpi('Validados',st.val,valPct+'% concluído','#0f9f72','✓',"dashboardGo(MAIN_SHEET,{onlyValidated:true})")+kpi('Pendentes',st.pend,pendPct+'% aguardando análise','#e99912','◷',"dashboardGo(MAIN_SHEET,{onlyPending:true})")+'</div><div class="exec-layout"><section class="exec-panel"><div class="exec-panel-title"><h2>Distribuição da situação cadastral</h2><button onclick="dashboardGo(MAIN_SHEET)">Ver produtos →</button></div><div class="exec-donut-wrap"><div class="exec-donut" style="--validated:'+valPct+'%;--duplicate:'+dupPct+'%"><div class="exec-donut-center"><b>'+st.total.toLocaleString('pt-BR')+'</b><span>produtos</span></div></div><div class="exec-legend"><div class="exec-legend-item" onclick="dashboardGo(MAIN_SHEET,{onlyValidated:true})"><i style="background:#0f9f72"></i>Validados<b>'+st.val.toLocaleString('pt-BR')+'</b></div><div class="exec-legend-item" onclick="dashboardGo(MAIN_SHEET,{onlyDup:true})"><i style="background:#e3122b"></i>Repetidos<b>'+st.dup.toLocaleString('pt-BR')+'</b></div><div class="exec-legend-item" onclick="dashboardGo(MAIN_SHEET,{onlyPending:true})"><i style="background:#e99912"></i>Pendentes<b>'+st.pend.toLocaleString('pt-BR')+'</b></div></div></div></section><section class="exec-panel"><div class="exec-panel-title"><h2>Filiais com mais duplicidades</h2><button onclick="dashboardGo(\'Descricoes_Duplicadas\')">Analisar →</button></div><div class="branch-bars">'+(topBranches.length?topBranches.map(([branch,count])=>'<div class="branch-bar" onclick="dashboardGo(MAIN_SHEET,{filial:\''+escapeHtml(branch)+'\',onlyDup:true})"><div class="branch-bar-head"><b>Filial '+escapeHtml(branch)+'</b><span>'+count.toLocaleString('pt-BR')+' registros</span></div><div class="branch-track"><div class="branch-fill" style="width:'+Math.round(count*100/maxBranch)+'%"></div></div></div>').join(''):'<div class="empty">Nenhuma duplicidade encontrada.</div>')+'</div></section></div><section class="exec-panel"><div class="exec-panel-title"><h2>Acessos rápidos</h2></div><div class="exec-shortcuts"><button class="exec-shortcut" onclick="dashboardGo(\'NCM_Mesma_Descricao\')"><b>NCM Mesma Descrição</b><span>Analise coincidências de classificação fiscal.</span><em>Abrir análise →</em></button><button class="exec-shortcut" onclick="dashboardGo(\'Descricoes_Duplicadas\')"><b>Descrições Duplicadas</b><span>Compare produtos com descrições repetidas.</span><em>Abrir análise →</em></button><button class="exec-shortcut" onclick="dashboardGo(\'activeReport\')"><b>Mantidos Ativos</b><span>'+activeReport.length+' decisões registradas.</span><em>Abrir relatório →</em></button><button class="exec-shortcut" onclick="dashboardGo(\'deactivationReport\')"><b>Para Desativação</b><span>'+deactivationReport.length+' registros no relatório.</span><em>Abrir relatório →</em></button></div></section>';
  };

  window.render=function(){ensureReportNav();if(productReviewMode&&current!==MAIN_SHEET)productReviewMode=false;if(productReviewMode&&current===MAIN_SHEET){activeBtn();return renderDuplicateReview(document.getElementById('main'))}if(current===MAIN_SHEET){activeBtn();return renderModernProducts(document.getElementById('main'))}if(current==='dashboard'){activeBtn();return renderExecutiveDashboard(document.getElementById('main'))}if(current==='activeReport'){activeBtn();return renderActiveReport(document.getElementById('main'))}if(current==='deactivationReport'){activeBtn();return renderDeactivationReport(document.getElementById('main'))}originalRender();ensureReportNav();if(current==='Descricoes_Duplicadas'||current==='NCM_Mesma_Descricao'){const sourceSheet=current,tb=document.getElementById('tbody'),source=DATA[sourceSheet],descriptionIndex=source?source.headers.findIndex(h=>/descric|descr|produto|nome/i.test(h)):-1;if(tb&&descriptionIndex>=0&&!tb.dataset.reviewBound){tb.dataset.reviewBound='1';tb.addEventListener('click',function(e){if(e.target.closest('button,input,label,a,select,option'))return;const tr=e.target.closest('tr');if(!tr||!tb.contains(tr))return;const descCell=tr.children[descriptionIndex+1];if(!descCell)return;e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();openDuplicateReview(descCell.textContent.trim())},true)}}};
  render();
  restoreMovementSnapshot();
  loadDesativacaoFromSupabase();
  subscribeDesativacaoRealtime();
  setInterval(loadDesativacaoFromSupabase, 8000);
  loadHistoricoFromSupabase();
  subscribeHistoricoRealtime();
  setInterval(loadHistoricoFromSupabase, 8000);
})();

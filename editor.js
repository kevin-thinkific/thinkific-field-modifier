// ── State ──
let count = 2, dark = true;
const MAX = 20;
const DEFAULT_ERROR_TEXT = 'This field cannot be blank';
const DEFAULT_SELECT_ERROR = 'Selection required';
const DEFAULT_INVALID_SEARCH_TEXT = 'Please choose a valid option from the list.';
const DEFAULT_CHECKBOX_ERROR = 'This must be checked to continue.';
const DEFAULT_CHECKED_VALUE = 'Yes';
const DEFAULT_UNCHECKED_VALUE = 'No';

// Each behaviour is now an object: { signup, checkout, account }
// false = off, true = on for that page
function defaultBehaviour(){ return {signup:false, checkout:false, account:false}; }
function behaviourActive(b){ return b && (b.signup||b.checkout||b.account); }
function behaviourLabel(b){
  if(!behaviourActive(b)) return null;
  if(b.signup&&b.checkout&&b.account) return 'Always';
  const parts=[];
  if(b.signup)   parts.push('Sign up');
  if(b.checkout) parts.push('After checkout');
  if(b.account)  parts.push('Account');
  return parts.join(', ');
}
// Generate a JS boolean expression for the behaviour
function behaviourExpr(b){
  if(!behaviourActive(b)) return 'false';
  if(b.signup&&b.checkout&&b.account) return 'true';
  const parts=[];
  if(b.signup)   parts.push(`(window.location.pathname.indexOf('sign_up')!==-1)`);
  if(b.checkout) parts.push(`(window.location.pathname.indexOf('complete_signup')!==-1)`);
  if(b.account)  parts.push(`(window.location.pathname.indexOf('/account')!==-1&&window.location.pathname.indexOf('complete_signup')===-1)`);
  return parts.join('||');
}
// Is the behaviour "always on" (all three pages)?
function behaviourAlways(b){ return b&&b.signup&&b.checkout&&b.account; }

const fields = Array.from({length: MAX}, (_, i) => ({
  idx: i, label: '', inputType: 'text', dropdownOpts: '',
  hidden: defaultBehaviour(),
  readonly: defaultBehaviour(),
  required: defaultBehaviour(),
  errorMsg: '', placeholder: '', dropdownSearchErrorMsg: '',
  checkboxCheckedValue: '', checkboxUncheckedValue: '',
  urlParam: '',
  textCond: { alphanumOnly:false, onlyNumbers:false, onlyLetters:false, excludeChars:'', includeChars:'', maxLength:'', forceUppercase:false },
  // which panel is open: null | 'hidden' | 'readonly' | 'required'
  openPanel: null,
  step: 0 // which multi-step "page" (steps[].id) this custom field belongs to
}));
let rules = [], ruleId = 0, pendingConfig = null;

// ── Multi-step pages (optional wizard for custom fields only) ──
// Never available on the account page — only sign_up and complete_signup (after checkout).
let multiStep = { enabled: false, signup: false, checkout: false };
let steps = [{ id: 0, title: 'Step 1' }];
let stepIdCounter = 1;
let activeCondSubTab = 'visibility';
let activeCodeSubTab = 'codeeditor';
let dragSrcIdx = null;

// Style editor state — empty string means "don't emit this property"
const styleState = {
  inputBg:'', inputColor:'', inputBorder:'', inputRadius:'', inputFontSize:'', inputPadding:'',
  labelColor:'', labelFontSize:'', labelWeight:'',
  btnBg:'', btnColor:'', btnRadius:'', btnFontSize:'',
  roBg:'', roColor:'', roBorder:'', roCursor:''
};

// ── Helpers ──
function fname(i){ return `user[profile_attributes][custom_profile_fields_attributes][${i}][value]`; }
function q(s){ return (s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function checkboxValues(f){
  return [f.checkboxCheckedValue&&f.checkboxCheckedValue.trim()||DEFAULT_CHECKED_VALUE, f.checkboxUncheckedValue&&f.checkboxUncheckedValue.trim()||DEFAULT_UNCHECKED_VALUE];
}
function getMasterOptions(fi){
  if(fi===''||fi===null)return[];
  const f=fields[parseInt(fi)];
  if(!f)return[];
  if(f.inputType==='checkbox')return checkboxValues(f);
  if((f.inputType!=='dropdown'&&f.inputType!=='dropdownsearch')||!f.dropdownOpts.trim())return[];
  return f.dropdownOpts.trim().split('\n').filter(Boolean);
}
function isConditionallyHidden(i){
  return rules.some(r=>r.type==='visibility'&&r.entries.some(e=>String(e.targetField)===String(i)));
}

// Migrate old string-based behaviour values from v2 configs
function migrateBehaviour(val){
  if(!val||val===false) return defaultBehaviour();
  if(typeof val==='object') return {signup:!!val.signup,checkout:!!val.checkout,account:!!val.account};
  // old string format
  if(val==='signup')   return {signup:true,  checkout:false, account:false};
  if(val==='checkout') return {signup:false, checkout:true,  account:false};
  if(val==='account')  return {signup:false, checkout:false, account:true};
  if(val==='both')     return {signup:true,  checkout:true,  account:true};
  return defaultBehaviour();
}

// ── Load scan results ──
function loadScanResults(){
  if(typeof chrome==='undefined'||!chrome.storage){return;}
  chrome.storage.session.get('scanResult', function(data){
    if(chrome.runtime.lastError||!data||!data.scanResult||!data.scanResult.length)return;
    const found=data.scanResult;
    chrome.storage.session.remove('scanResult');
    const maxIdx=Math.max(...found.map(f=>f.idx));
    count=Math.min(MAX,maxIdx+1);
    document.getElementById('countDisplay').textContent=count;
    document.getElementById('idxRange').textContent=`(indices 0–${count-1})`;
    found.forEach(function(f){ if(f.idx<MAX&&f.label&&!fields[f.idx].label) fields[f.idx].label=f.label; });
    render();renderRules();
    const notice=document.getElementById('scanNotice');
    notice.className='notice scan';
    notice.textContent=`✓ Scanned ${found.length} custom field${found.length===1?'':'s'} from the sign-up page. Labels pre-filled where available.`;
    notice.style.display='block';
    setTimeout(()=>{notice.style.display='none';},8000);
  });
}

// ── Theme ──
function applyTheme(){
  document.body.className=dark?'':'light';
  document.getElementById('btn-toggleTheme').textContent=dark?'☀ Light mode':'☾ Dark mode';
}
function toggleTheme(){dark=!dark;applyTheme();}

// ── Tabs ──
function switchTab(name){
  ['fields','conditionals','pages','code'].forEach(t=>{
    document.getElementById('tab-'+t).style.display=t===name?'':'none';
  });
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  if(name==='code'){ gen(); renderCodeEditor(); }
}
function switchCondSubTab(name){
  activeCondSubTab=name;
  ['visibility','dependent','groupvisibility'].forEach(t=>{
    const el=document.getElementById('subtab-'+t);
    if(el)el.style.display=t===name?'':'none';
  });
  document.querySelectorAll('.sub-tab[data-subtab]').forEach(b=>{
    if(['visibility','dependent','groupvisibility'].includes(b.dataset.subtab))
      b.classList.toggle('active',b.dataset.subtab===name);
  });
}
function switchCodeSubTab(name){
  activeCodeSubTab=name;
  ['codeeditor','styleeditor'].forEach(t=>{
    const el=document.getElementById('subtab-'+t);
    if(el)el.style.display=t===name?'':'none';
  });
  document.querySelectorAll('.sub-tab[data-subtab]').forEach(b=>{
    if(['codeeditor','styleeditor'].includes(b.dataset.subtab))
      b.classList.toggle('active',b.dataset.subtab===name);
  });
  if(name==='codeeditor'){ gen(); renderCodeEditor(); }
}

// ── Field count ──
function changeCount(d){
  count=Math.max(1,Math.min(MAX,count+d));
  document.getElementById('countDisplay').textContent=count;
  document.getElementById('idxRange').textContent=`(indices 0–${count-1})`;
  render();renderRules();renderSteps();
}

// ── Behaviour panel toggle ──
function togglePanel(i, panel){
  fields[i].openPanel = fields[i].openPanel===panel ? null : panel;
  render();
}
function toggleBehaviourPage(i, behaviour, page){
  fields[i][behaviour][page] = !fields[i][behaviour][page];
  // If hidden=all pages and not a conditional field, can't be required
  if(behaviour==='hidden' && behaviourAlways(fields[i].hidden) && !isConditionallyHidden(i)){
    fields[i].required = defaultBehaviour();
  }
  render();
}

// ── Reorder fields (drag & drop) ──
// A field's index IS its identity (it maps 1:1 to the real custom-profile-field
// position on the Thinkific page — see fname()). So "reordering" means relocating
// each field's full config to a new index slot, then rewriting every rule reference
// (masterField/targetField/showFields) so conditionals keep pointing at the field
// that moved, not the index number.
function moveField(fromIdx, toIdx){
  if(fromIdx===toIdx||isNaN(fromIdx)||isNaN(toIdx)||fromIdx<0||toIdx<0||fromIdx>=count||toIdx>=count)return;
  const order=Array.from({length:count},(_,i)=>i); // order[newPos] = oldIdx
  const [moved]=order.splice(fromIdx,1);
  order.splice(toIdx,0,moved);
  const oldToNew={};
  order.forEach((oldI,newI)=>{ oldToNew[oldI]=newI; });
  const reordered=order.map(oldI=>fields[oldI]);
  reordered.forEach((f,newI)=>{ f.idx=newI; fields[newI]=f; });

  function remap(v){
    if(v===''||v===null||v===undefined)return v;
    const n=parseInt(v,10);
    if(isNaN(n))return v;
    return String(oldToNew.hasOwnProperty(n)?oldToNew[n]:n);
  }
  rules.forEach(r=>{
    if(r.masterField!=='') r.masterField=remap(r.masterField);
    r.entries.forEach(e=>{
      if(e.targetField!==undefined&&e.targetField!=='') e.targetField=remap(e.targetField);
      if(Array.isArray(e.showFields)) e.showFields=e.showFields.map(fi=>parseInt(remap(fi),10));
    });
  });

  render();renderRules();renderSteps();
}

function setInputType(i,type){ fields[i].inputType=type; render(); renderRules(); }
function updLabel(i,val){ fields[i].label=val; renderRules(); renderSteps(); }
function updOpts(i,val){ fields[i].dropdownOpts=val; }
function updErrMsg(i,val){ fields[i].errorMsg=val; }
function updPlaceholder(i,val){ fields[i].placeholder=val; }
function updDropdownSearchErrMsg(i,val){ fields[i].dropdownSearchErrorMsg=val; }
function updCheckedVal(i,val){ fields[i].checkboxCheckedValue=val; renderRules(); }
function updUncheckedVal(i,val){ fields[i].checkboxUncheckedValue=val; renderRules(); }
function updUrlParam(i,val){ fields[i].urlParam=val; }
function updTextCond(i,key,val){
  if(!fields[i].textCond)fields[i].textCond={};
  fields[i].textCond[key]=val;
  // Preset checkboxes auto-fill includeChars and clear sibling presets
  const presets=['alphanumOnly','onlyNumbers','onlyLetters'];
  const presetValues={
    alphanumOnly:'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
    onlyNumbers:'0123456789',
    onlyLetters:'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ '
  };
  if(presets.includes(key)){
    if(val){
      presets.forEach(p=>{ if(p!==key) fields[i].textCond[p]=false; });
      fields[i].textCond.includeChars=presetValues[key];
    } else {
      if(fields[i].textCond.includeChars===presetValues[key]){
        fields[i].textCond.includeChars='';
      }
    }
    render(); // preset toggle — re-render to update checkboxes and fill include field
  } else if(!['excludeChars','includeChars','maxLength'].includes(key)){
    render(); // other bool toggles (forceUppercase)
  }
  // excludeChars/includeChars/maxLength: no render here — change handler does it on blur
}

// ── Render fields ──
function render(){
  const list=document.getElementById('fieldsList');
  let html='';
  for(let i=0;i<count;i++){
    const f=fields[i];
    const condHidden=isConditionallyHidden(i);

    const typeChips=[
      {type:'text',      label:'Text'},
      {type:'date',      label:'Date (standard)', cls:'a'},
      {type:'monthyear', label:'Date (MM/YYYY)',  cls:'a'},
      {type:'dropdown',  label:'Dropdown',        cls:'p'},
      {type:'dropdownsearch', label:'Dropdown (search)', cls:'p'},
      {type:'checkbox', label:'Checkbox', cls:'p'},
    ].map(t=>{
      const on=f.inputType===t.type;
      return`<span class="chip ${on?(t.cls||'a'):''}" data-action="setInputType" data-idx="${i}" data-type="${t.type}">${t.label}</span>`;
    }).join('');

    // ── Behaviour chips with inline checkbox panels ──
    function behaviourChipHtml(key, label, chipCls, condOverride){
      const b=f[key];
      const active=behaviourActive(b);
      const always=behaviourAlways(b);
      const lbl=behaviourLabel(b);
      const isOpen=f.openPanel===key;
      const condNote=condOverride&&active?` <span style="font-size:10px;opacity:.7">(conditional overrides)</span>`:'';
      const chip=`<span class="chip ${active?chipCls:''} ${always?'locked':''}" data-action="togglePanel" data-idx="${i}" data-panel="${key}" style="cursor:pointer">${label}${lbl?' ('+lbl+')':''}${condNote}</span>`;
      if(!isOpen) return chip;
      // inline checkbox panel
      const pages=[
        {page:'signup',   label:'Sign up'},
        {page:'checkout', label:'After checkout'},
        {page:'account',  label:'Account'},
      ];
      const checks=pages.map(p=>{
        const checked=b[p.page]?'checked':'';
        const disabled=(key==='required'&&behaviourAlways(f.hidden)&&!condHidden)?'disabled title="Always hidden — cannot be required"':'';
        return`<label class="page-check ${b[p.page]?'on':''}"><input type="checkbox" data-action="toggleBehaviourPage" data-idx="${i}" data-behaviour="${key}" data-page="${p.page}" ${checked} ${disabled}> ${p.label}</label>`;
      }).join('');
      return`${chip}<div class="page-panel">${checks}</div>`;
    }

    const hidChip   = behaviourChipHtml('hidden',   'Hide',      'o', condHidden);
    const roChip    = behaviourChipHtml('readonly',  'Read only', 'r', false);
    const reqPermBlocked = behaviourAlways(f.hidden)&&!condHidden;
    const reqChip = reqPermBlocked
      ? `<span class="chip disabled" title="Cannot be required when always hidden">Required</span>`
      : behaviourChipHtml('required', 'Required', 'm', false);

    const phRow = (f.inputType==='text'||f.inputType==='dropdownsearch')
      ?`<div class="sub" style="margin-top:8px"><span class="sub-label-light">Placeholder text <span style="color:var(--text3)">(optional)</span></span><input type="text" data-action="updPlaceholder" data-idx="${i}" placeholder="${f.inputType==='dropdownsearch'?'e.g. Start typing a country…':'e.g. Enter your city'}" value="${esc(f.placeholder||'')}"/></div>`
      :'';

    const urlHint = (f.inputType==='dropdown'||f.inputType==='dropdownsearch')
      ? 'must exactly match one of the options below (case-insensitive), otherwise it\'s ignored'
      : f.inputType==='checkbox'
        ? 'must match the checked/unchecked value below (case-insensitive), otherwise it\'s ignored'
        : 'only fills the field if it\'s currently empty — never overwrites an existing saved value';
    const urlRow = `<div class="sub" style="margin-top:8px"><span class="sub-label-light">Prefill from URL parameter <span style="color:var(--text3)">(optional — e.g. <code>ref</code> reads <code>?ref=value</code>; ${urlHint})</span></span><input type="text" data-action="updUrlParam" data-idx="${i}" placeholder="e.g. ref" value="${esc(f.urlParam||'')}"/></div>`;

    let subs=phRow+urlRow;
    // Text conditions — shown for all text fields
    if(f.inputType==='text'){
      const tc=f.textCond||{};
      // Conflict: alphanumOnly + onlyNumbers/onlyLetters, or onlyNumbers + onlyLetters
      const conflict=(tc.alphanumOnly&&(tc.onlyNumbers||tc.onlyLetters))||(tc.onlyNumbers&&tc.onlyLetters);
      subs+=`<div class="sub" style="margin-top:8px">
        <span class="sub-label" style="display:block;margin-bottom:6px">Text conditions <span style="color:var(--text3);font-weight:400">(optional)</span></span>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <span style="font-size:11px;color:var(--text3);white-space:nowrap">Allow:</span>
            <label class="page-check ${tc.alphanumOnly?'on':''}"><input type="checkbox" data-action="updTextCondBool" data-idx="${i}" data-key="alphanumOnly" ${tc.alphanumOnly?'checked':''}> Alphanumeric only</label>
            <label class="page-check ${tc.onlyNumbers?'on':''}"><input type="checkbox" data-action="updTextCondBool" data-idx="${i}" data-key="onlyNumbers" ${tc.onlyNumbers?'checked':''}> Only numbers</label>
            <label class="page-check ${tc.onlyLetters?'on':''}"><input type="checkbox" data-action="updTextCondBool" data-idx="${i}" data-key="onlyLetters" ${tc.onlyLetters?'checked':''}> Only letters</label>
            <label class="page-check ${tc.forceUppercase?'on':''}" style="margin-left:6px"><input type="checkbox" data-action="updTextCondBool" data-idx="${i}" data-key="forceUppercase" ${tc.forceUppercase?'checked':''}> Force uppercase</label>
          </div>
          ${conflict?'<div style="font-size:11px;color:var(--r-tx)">⚠ Only one "allow" filter can be active at a time</div>':''
          }<div style="display:grid;grid-template-columns:auto 1fr;gap:5px 8px;align-items:center;margin-top:2px">
            <span style="font-size:11px;color:var(--text3);white-space:nowrap">Excluded chars:</span>
            <div style="display:flex;align-items:center;gap:6px">
              <input type="text" data-action="updTextCondStr" data-idx="${i}" data-key="excludeChars" placeholder="e.g. @#$%" value="${esc(tc.excludeChars||'')||''}" style="flex:1;max-width:180px"/>
              <span style="font-size:10px;color:var(--text3)">each character individually, no separator</span>
            </div>
            <span style="font-size:11px;color:var(--text3);white-space:nowrap">Include only chars:</span>
            <div style="display:flex;align-items:center;gap:6px">
              <input type="text" data-action="updTextCondStr" data-idx="${i}" data-key="includeChars" placeholder="e.g. 0123456789-" value="${esc(tc.includeChars||'')||''}" style="flex:1;max-width:180px;${tc.alphanumOnly||tc.onlyNumbers||tc.onlyLetters?'color:var(--a-tx);font-size:10px':''}" title="${tc.alphanumOnly?'Auto-filled by Alphanumeric only':tc.onlyNumbers?'Auto-filled by Only numbers':tc.onlyLetters?'Auto-filled by Only letters':''}"/>
              <span style="font-size:10px;color:var(--text3)">each char, no separator${tc.alphanumOnly||tc.onlyNumbers||tc.onlyLetters?' · <em>auto-filled by preset</em>':'' }</span>
            </div>
            <span style="font-size:11px;color:var(--text3);white-space:nowrap">Max length:</span>
            <input type="number" data-action="updTextCondStr" data-idx="${i}" data-key="maxLength" placeholder="∞" min="1" max="9999" value="${tc.maxLength||''}" style="width:64px"/>
          </div>
        </div>
      </div>`;
    }
    if(f.inputType==='dropdown'||f.inputType==='dropdownsearch') subs+=`<div class="sub" style="margin-top:8px"><span class="sub-label">Dropdown options (one per line)</span><textarea rows="4" data-action="updOpts" data-idx="${i}" placeholder="Option A&#10;Option B&#10;Option C">${esc(f.dropdownOpts)}</textarea></div>`;
    if(f.inputType==='dropdownsearch'){
      subs+=`<div class="sub" style="margin-top:8px"><span class="sub-label-light">Invalid entry message <span style="color:var(--text3)">(shown when typed text doesn't match an option; default: "${DEFAULT_INVALID_SEARCH_TEXT}")</span></span><input type="text" data-action="updDropdownSearchErrMsg" data-idx="${i}" placeholder="${esc(DEFAULT_INVALID_SEARCH_TEXT)}" value="${esc(f.dropdownSearchErrorMsg||'')}"/></div>`;
    }
    if(f.inputType==='checkbox'){
      subs+=`<div class="sub" style="margin-top:8px">
        <span class="sub-label" style="display:block;margin-bottom:6px">Checkbox values <span style="color:var(--text3);font-weight:400">(text saved to the field)</span></span>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 8px;align-items:center">
          <span style="font-size:11px;color:var(--text3);white-space:nowrap">Value when checked:</span>
          <input type="text" data-action="updCheckedVal" data-idx="${i}" placeholder="${DEFAULT_CHECKED_VALUE}" value="${esc(f.checkboxCheckedValue||'')}" style="max-width:180px"/>
          <span style="font-size:11px;color:var(--text3);white-space:nowrap">Value when unchecked:</span>
          <input type="text" data-action="updUncheckedVal" data-idx="${i}" placeholder="${DEFAULT_UNCHECKED_VALUE}" value="${esc(f.checkboxUncheckedValue||'')}" style="max-width:180px"/>
        </div>
      </div>`;
    }
    const reqActive=behaviourActive(f.required);
    if(reqActive&&!(behaviourAlways(f.hidden)&&!condHidden)){
      const ph=f.inputType==='checkbox'?DEFAULT_CHECKBOX_ERROR:(f.inputType==='dropdown'||f.inputType==='dropdownsearch')?DEFAULT_SELECT_ERROR:DEFAULT_ERROR_TEXT;
      const reqLabel=f.inputType==='checkbox'?'Error message when left unchecked':'Error message when left empty';
      subs+=`<div class="sub" style="margin-top:8px"><span class="sub-label-light">${reqLabel} <span style="color:var(--text3)">(default: "${ph}")</span></span><input type="text" data-action="updErrMsg" data-idx="${i}" placeholder="${esc(ph)}" value="${esc(f.errorMsg)}"/>${condHidden?`<div class="info-pill">Required when shown, lifted when hidden</div>`:''}</div>`;
    }
    html+=`<div class="field-row" data-field-idx="${i}"><div class="field-header"><span class="drag-handle" draggable="true" data-action="dragHandle" data-idx="${i}" title="Drag to reorder">⠿</span><span class="field-idx">Field ${i}</span><input type="text" data-action="updLabel" data-idx="${i}" placeholder="Label (optional)" value="${esc(f.label)}" style="flex:1"/></div><div class="mods-group"><div class="mods-row"><span class="mods-label">Input type</span>${typeChips}</div><div class="divider-line"></div><div class="mods-row"><span class="mods-label">Behaviour</span>${hidChip} ${roChip} ${reqChip}</div></div>${subs}</div>`;
  }
  list.innerHTML=html||'<div style="color:var(--text3);font-size:13px;padding:6px 0">Add fields using the stepper above.</div>';
}

// ── Conditionals ──
// excludeSearch=true restricts eligibility to plain 'dropdown' fields only (used for dependent-options
// targets, whose generated code rebuilds a <select> — a search-dropdown's datalist and a checkbox aren't rebuildable that way).
function fieldOptions(excludeIdx,requireDropdown,excludeSearch){
  return Array.from({length:count},(_,j)=>{
    if(j===excludeIdx)return'';
    if(requireDropdown){
      const isDropdown=fields[j].inputType==='dropdown';
      const isEnumerable=fields[j].inputType==='dropdownsearch'||fields[j].inputType==='checkbox';
      if(excludeSearch?!isDropdown:!(isDropdown||isEnumerable))return'';
    }
    const lbl=fields[j].label||`Field ${j}`;
    return`<option value="${j}">Field ${j}: ${lbl}</option>`;
  }).join('');
}
function addRule(type){rules.push({id:ruleId++,type,masterField:'',entries:[],collapsed:false,pages:{signup:true,checkout:true,account:true}});renderRules();switchCondSubTab(type);}

function toggleRulePage(id,page){
  const r=rules.find(r=>r.id===id);
  if(!r)return;
  if(!r.pages)r.pages={signup:true,checkout:true,account:true};
  r.pages[page]=!r.pages[page];
  renderRules();
}
function toggleCollapse(id){
  const r=rules.find(r=>r.id===id);
  if(r){r.collapsed=!r.collapsed;renderRules();}
}
function removeRule(id){rules=rules.filter(r=>r.id!==id);renderRules();render();}
function addEntry(rId){const r=rules.find(r=>r.id===rId);if(!r)return;if(r.type==='groupvisibility'){r.entries.push({targetField:'',groups:'',mode:'hide',override:false});}else if(r.type==='visibility'){r.entries.push({targetField:'',triggerValues:[]});}else{r.entries.push({value:'',targetField:'',options:''});}renderRules();}
function removeEntry(rId,eIdx){const r=rules.find(r=>r.id===rId);if(r){r.entries.splice(eIdx,1);renderRules();render();}}
function setMasterField(rId,val){const r=rules.find(r=>r.id===rId);if(r){r.masterField=val;r.entries=[];renderRules();render();}}
function setEntryProp(rId,eIdx,key,val){const r=rules.find(r=>r.id===rId);if(r)r.entries[eIdx][key]=val;}
function updEntryOptions(rId,eIdx,val){const r=rules.find(r=>r.id===rId);if(r)r.entries[eIdx].options=val;}
function toggleShowField(rId,eIdx,fi){const r=rules.find(r=>r.id===rId);if(!r)return;const sf=r.entries[eIdx].showFields,pos=sf.indexOf(fi);if(pos===-1)sf.push(fi);else sf.splice(pos,1);renderRules();render();}
function toggleTriggerValue(rId,eIdx,val){const r=rules.find(r=>r.id===rId);if(!r)return;const tv=r.entries[eIdx].triggerValues||(r.entries[eIdx].triggerValues=[]);const pos=tv.indexOf(val);if(pos===-1)tv.push(val);else tv.splice(pos,1);renderRules();render();}
function selectAllFields(rId,eIdx){
  const r=rules.find(r=>r.id===rId);if(!r)return;
  const e=r.entries[eIdx];
  const masterOpts=getMasterOptions(r.masterField);
  const allOn=masterOpts.length>0&&masterOpts.every(v=>(e.triggerValues||[]).includes(v));
  e.triggerValues=allOn?[]:masterOpts.slice();
  renderRules();render();
}
function valueSelector(rId,eIdx,currentVal,masterIdx){
  const opts=getMasterOptions(masterIdx);
  if(!opts.length)return`<input type="text" placeholder="e.g. Canada" value="${esc(currentVal)}" data-action="entryVal" data-rid="${rId}" data-eidx="${eIdx}" style="flex:1"/>`;
  const optHtml=opts.map(o=>`<option value="${esc(o)}" ${o===currentVal?'selected':''}>${esc(o)}</option>`).join('');
  return`<select style="flex:1" data-action="entryVal" data-rid="${rId}" data-eidx="${eIdx}"><option value="">— pick a value —</option>${optHtml}</select>`;
}
function renderRules(){
  // Render each sub-list separately
  ['visibility','dependent','groupvisibility'].forEach(type=>{
    const container=document.getElementById('rulesList-'+type);
    if(!container)return;
    const typed=rules.filter(r=>r.type===type);
    if(!typed.length){
      const labels={'visibility':'field visibility','dependent':'dependent options','groupvisibility':'group show/hide'};
      container.innerHTML=`<div style="color:var(--text3);font-size:13px;padding:8px 0">No ${labels[type]} rules yet.</div>`;
      return;
    }
    container.innerHTML=typed.map(r=>{
    const masterOpts=`<option value="">— pick master field —</option>`+fieldOptions(-1,true);
    const typeLabel=r.type==='visibility'?'Field visibility':r.type==='groupvisibility'?'Group show/hide':'Dependent options';
    const typeCls=r.type==='visibility'?'o':r.type==='groupvisibility'?'r':'p';
    const masterIdx=r.masterField!==''?parseInt(r.masterField):null;
    const masterHasOpts=masterIdx!==null&&getMasterOptions(masterIdx).length>0;
    let entriesHtml=r.entries.map((e,eIdx)=>{
      const valInput=r.masterField!==''?valueSelector(r.id,eIdx,e.value,r.masterField):`<input type="text" placeholder="Pick a master field first" disabled style="flex:1;opacity:.5"/>`;
      if(r.type==='groupvisibility'){
        const allFieldOpts=Array.from({length:count},(_,j)=>{const lbl=fields[j].label||`Field ${j}`;return`<option value="${j}" ${String(e.targetField)===String(j)?'selected':''}>Field ${j}: ${lbl}</option>`;}).join('');
        const modeHide=!e.mode||e.mode==='hide';
        const overrideChecked=e.override?'checked':'';
        return`<div class="entry-inner">
          <div class="rule-row">
            <select data-action="groupvisTarget" data-rid="${r.id}" data-eidx="${eIdx}" style="flex:1"><option value="">— pick field —</option>${allFieldOpts}</select>
            <select data-action="groupvisMode" data-rid="${r.id}" data-eidx="${eIdx}" style="flex:0 0 auto;width:90px">
              <option value="hide" ${modeHide?'selected':''}>Hide</option>
              <option value="show" ${!modeHide?'selected':''}>Show</option>
            </select>
            <button class="btn xs danger" data-action="removeEntry" data-rid="${r.id}" data-eidx="${eIdx}">✕</button>
          </div>
          <div style="margin-top:6px"><span style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">When user is in these groups (one per line):</span><textarea rows="3" data-action="groupvisGroups" data-rid="${r.id}" data-eidx="${eIdx}" placeholder="Admins&#10;Premium Members&#10;Staff">${esc(e.groups||'')}</textarea></div>
          <label class="page-check" style="margin-top:6px;gap:6px"><input type="checkbox" data-action="groupvisOverride" data-rid="${r.id}" data-eidx="${eIdx}" ${overrideChecked}> <span>Override other hide rules (including field visibility conditionals)</span></label>
        </div>`;
      } else if(r.type==='visibility'){
        // New model: each entry = one target field + N trigger values from the master
        const masterOpts=getMasterOptions(r.masterField);
        const tv=e.triggerValues||[];
        const allSelected=masterOpts.length>0&&masterOpts.every(v=>tv.includes(v));
        const selectAllBtn=masterOpts.length>0
          ?`<button class="btn xs ${allSelected?'danger':'add'}" data-action="selectAllFields" data-rid="${r.id}" data-eidx="${eIdx}">${allSelected?'✕ Deselect all':'✓ Select all'}</button>`
          :'';
        // Target field picker — all fields except master
        const targetFieldOpts=Array.from({length:count},(_,j)=>{
          if(String(j)===r.masterField)return'';
          const lbl=fields[j].label||`Field ${j}`;
          return`<option value="${j}" ${String(e.targetField)===String(j)?'selected':''}>Field ${j}: ${lbl}</option>`;
        }).filter(Boolean).join('');
        // Trigger value chips — one per master option
        const valChips=masterOpts.length
          ?masterOpts.map(v=>{const on=tv.includes(v);return`<button class="btn xs ${on?'add':''}" style="opacity:${on?1:.5}" data-action="toggleTriggerValue" data-rid="${r.id}" data-eidx="${eIdx}" data-val="${esc(v)}">${esc(v)}</button>`;}).join('')
          :`<span style="font-size:12px;color:var(--text3)">Add dropdown options to the master field first</span>`;
        return`<div class="entry-inner">
          <div class="rule-row" style="margin-bottom:6px">
            <span style="font-size:12px;color:var(--text2);white-space:nowrap">Show field</span>
            <select data-action="visTargetField" data-rid="${r.id}" data-eidx="${eIdx}" style="flex:1"><option value="">— pick field to show —</option>${targetFieldOpts}</select>
            <button class="btn xs danger" data-action="removeEntry" data-rid="${r.id}" data-eidx="${eIdx}">✕</button>
          </div>
          <div style="font-size:12px;color:var(--text2);margin-bottom:5px;display:flex;align-items:center;gap:6px">When master = any of:${selectAllBtn}</div>
          <div style="display:flex;gap:4px;flex-wrap:wrap">${valChips}</div>
        </div>`;
      } else {
        const targetOpts=`<option value="">— pick target dropdown —</option>`+fieldOptions(parseInt(r.masterField)||0,true,true);
        const selTarget=e.targetField?targetOpts.replace(`value="${e.targetField}"`,`value="${e.targetField}" selected`):targetOpts;
        return`<div class="entry-inner"><div class="rule-row"><span style="font-size:12px;color:var(--text2);white-space:nowrap">When value =</span>${valInput}<button class="btn xs danger" data-action="removeEntry" data-rid="${r.id}" data-eidx="${eIdx}">✕</button></div><div class="rule-row"><span style="font-size:12px;color:var(--text2);white-space:nowrap">Filter options in</span><select data-action="entryTarget" data-rid="${r.id}" data-eidx="${eIdx}">${selTarget}</select></div><div style="margin-top:6px"><span style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px">Show only these options (one per line):</span><textarea rows="3" data-action="entryOpts" data-rid="${r.id}" data-eidx="${eIdx}" placeholder="Toronto&#10;Ottawa&#10;Hamilton">${esc(e.options||'')}</textarea></div></div>`;
      }
    }).join('');
    const selMaster=masterOpts.replace(`value="${r.masterField}"`,`value="${r.masterField}" selected`);
    const addDisabled=r.masterField==='';
    const masterRow=r.type==='groupvisibility'
      ?`<div class="notice" style="font-size:11px;margin-bottom:6px;padding:5px 8px">⚠ Only applies on the <strong>Account</strong> page — reads <code>Thinkific.current_user.groups</code></div>`
      :`<div class="rule-row" style="margin-bottom:5px"><span style="font-size:12px;color:var(--text2);white-space:nowrap">Master field</span><select data-action="masterField" data-rid="${r.id}">${selMaster}</select></div>${!masterHasOpts&&r.masterField!==''?`<div class="hint" style="margin-bottom:6px">⚠ This field has no dropdown options — go to the Fields tab and add them.</div>`:'<div style="height:6px"></div>'}`;
    const addEntryLabel=r.type==='groupvisibility'?'+ Add field / group rule':'+ Add value rule';
    const addEntryDisabled=r.type!=='groupvisibility'&&r.masterField==='';
    // Collapsed summary — show master field name and entry count
    const masterName=r.masterField!==''?(fields[parseInt(r.masterField)].label||`Field ${r.masterField}`):'(no master)';
    const summaryText=r.type==='groupvisibility'
      ?`${r.entries.length} rule${r.entries.length===1?'':'s'}`
      :`master: ${masterName} · ${r.entries.length} rule${r.entries.length===1?'':'s'}`;
    const isCollapsed=!!r.collapsed;
    return`<div class="cond-block ${isCollapsed?'collapsed':''}">
      <div class="cond-block-header" data-action="toggleCollapse" data-rid="${r.id}">
        <span class="chip ${typeCls}" style="cursor:default;pointer-events:none">${typeLabel}</span>
        ${isCollapsed?`<span class="cond-summary">${summaryText}</span>`:''}
        <span style="flex:1"></span>
        <button class="btn xs danger" data-action="removeRule" data-rid="${r.id}">✕</button>
        <span class="collapse-icon">▾</span>
      </div>
      <div class="cond-block-body">${masterRow}${
        r.type!=='groupvisibility' ? (()=>{
          const pages=r.pages||{signup:true,checkout:true,account:true};
          const pageList=[{k:'signup',l:'Sign up'},{k:'checkout',l:'After checkout'},{k:'account',l:'Account'}];
          const checks=pageList.map(p=>`<label class="page-check ${pages[p.k]?'on':''}"><input type="checkbox" data-action="toggleRulePage" data-rid="${r.id}" data-page="${p.k}" ${pages[p.k]?'checked':''}> ${p.l}</label>`).join('');
          const noneActive=!pages.signup&&!pages.checkout&&!pages.account;
          return`<div style="margin-bottom:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-size:11px;color:var(--text3);flex-shrink:0">Active on:</span>${checks}${noneActive?'<span style="font-size:11px;color:var(--r-tx)">⚠ No pages selected — rule inactive</span>':''}</div>`;
        })()
        : ''
      }<div class="entry-box">${entriesHtml||'<div style="color:var(--text3);font-size:12px">Add a rule below.</div>'}</div><button class="btn xs add" data-action="addEntry" data-rid="${r.id}" ${addEntryDisabled?'disabled style="opacity:.4;cursor:not-allowed"':''}>${addEntryLabel}</button></div>
    </div>`;
    }).join('');
  });
}

// ── Multi-step pages (custom fields wizard) ──
function toggleMultiStepEnabled(){ multiStep.enabled=!multiStep.enabled; renderSteps(); }
function toggleMultiStepContext(ctx){ multiStep[ctx]=!multiStep[ctx]; renderSteps(); }
function addStep(){ steps.push({id:stepIdCounter++, title:'Step '+(steps.length+1)}); renderSteps(); }
function removeStep(id){
  if(steps.length<=1)return;
  const pos=steps.findIndex(s=>s.id===id);
  if(pos===-1)return;
  steps.splice(pos,1);
  const fallback=steps[0].id;
  fields.forEach(f=>{ if(f.step===id) f.step=fallback; });
  renderSteps();
}
function renameStep(id,val){ const s=steps.find(s=>s.id===id); if(s) s.title=val; renderSteps(); }
function moveStep(id,dir){
  const pos=steps.findIndex(s=>s.id===id);
  if(pos===-1)return;
  const newPos=pos+dir;
  if(newPos<0||newPos>=steps.length)return;
  const [s]=steps.splice(pos,1);
  steps.splice(newPos,0,s);
  renderSteps();
}
function setFieldStep(i,stepId){ fields[i].step=parseInt(stepId,10); renderSteps(); }

function renderSteps(){
  const el=document.getElementById('pagesContent');
  if(!el)return;
  const enabled=multiStep.enabled;
  const ctxChecks=[
    {key:'signup',   label:'Sign up'},
    {key:'checkout', label:'After checkout'},
  ].map(c=>`<label class="page-check ${multiStep[c.key]?'on':''}"><input type="checkbox" data-action="toggleMultiStepContext" data-ctx="${c.key}" ${multiStep[c.key]?'checked':''} ${enabled?'':'disabled'}> ${c.label}</label>`).join('');
  const noneActive=enabled&&!multiStep.signup&&!multiStep.checkout;
  const pageOffset=(multiStep.signup||multiStep.checkout)?1:0; // page 1 is reserved for built-in fields

  const stepsHtml=steps.map((s,pos)=>`
    <div class="entry-inner" style="display:flex;align-items:center;gap:8px">
      <span style="font-size:11px;color:var(--text3);min-width:56px;flex-shrink:0">Page ${pos+1+pageOffset}</span>
      <input type="text" style="flex:1" data-action="renameStep" data-stepid="${s.id}" value="${esc(s.title)}" placeholder="Step title"/>
      <button class="btn xs" data-action="moveStepUp" data-stepid="${s.id}" ${pos===0?'disabled style="opacity:.3;cursor:not-allowed"':''}>↑</button>
      <button class="btn xs" data-action="moveStepDown" data-stepid="${s.id}" ${pos===steps.length-1?'disabled style="opacity:.3;cursor:not-allowed"':''}>↓</button>
      <button class="btn xs danger" data-action="removeStep" data-stepid="${s.id}" ${steps.length<=1?'disabled style="opacity:.3;cursor:not-allowed"':''}>✕</button>
    </div>`).join('');

  const fieldRows=Array.from({length:count},(_,i)=>{
    const f=fields[i];
    const lbl=f.label||`Field ${i}`;
    const opts=steps.map((s,pos)=>`<option value="${s.id}" ${f.step===s.id?'selected':''}>Page ${pos+1+pageOffset}: ${esc(s.title||'Step')}</option>`).join('');
    return `<div class="rule-row"><span class="field-idx" style="flex-shrink:0">Field ${i}</span><span style="flex:1;font-size:12px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(lbl)}</span><select style="flex:0 0 170px" data-action="setFieldStep" data-idx="${i}">${opts}</select></div>`;
  }).join('');

  el.innerHTML=`
    <div class="notice">Break the <strong>custom fields</strong> into a multi-step wizard with a progress bar and Back / Continue buttons. This is never available on the Account page. Optional — off by default.<br><br>Page 1 is always reserved for the built-in fields: on <strong>Sign up</strong> that's Name / Email / Password (plus "I agree to the Terms of Use" pinned to the last page), and on <strong>After checkout</strong> that's Password. The steps you build below start at Page 2.</div>
    <label class="page-check ${enabled?'on':''}" style="margin-bottom:12px;display:inline-flex"><input type="checkbox" data-action="toggleMultiStepEnabled" ${enabled?'checked':''}> Enable multi-step layout for custom fields</label>
    <div class="sub" style="margin-bottom:14px;${enabled?'':'opacity:.5'}">
      <span class="sub-label">Active on</span>
      <div style="display:flex;gap:10px;margin-top:4px">${ctxChecks}</div>
      ${noneActive?'<div style="font-size:11px;color:var(--r-tx);margin-top:6px">⚠ No pages selected — multi-step is enabled but inactive everywhere</div>':''}
      <div class="hint" style="margin-top:6px">Not available on the Account page.</div>
    </div>
    <div class="cond-block" style="${enabled?'':'opacity:.5;pointer-events:none'}">
      <div class="cond-block-header" style="cursor:default"><span class="chip a" style="cursor:default;pointer-events:none">Steps</span><span style="flex:1"></span><button class="btn xs add" data-action="addStep">+ Add step</button></div>
      <div class="cond-block-body" style="border-top:none;padding-top:10px">
        <div class="entry-box">${stepsHtml}</div>
      </div>
    </div>
    <div class="cond-block" style="margin-top:12px;${enabled?'':'opacity:.5;pointer-events:none'}">
      <div class="cond-block-header" style="cursor:default"><span class="chip a" style="cursor:default;pointer-events:none">Assign fields to steps</span></div>
      <div class="cond-block-body" style="border-top:none;padding-top:10px">
        <div class="entry-box">${fieldRows||'<div style="color:var(--text3);font-size:12px">Add fields in the Fields tab first.</div>'}</div>
      </div>
    </div>
  `;
}

// ── Event delegation ──
document.addEventListener('click', function(e){
  const el=e.target.closest('[data-action]');
  if(!el)return;
  const action=el.dataset.action;
  const idx=el.dataset.idx!==undefined?parseInt(el.dataset.idx):null;
  const rid=el.dataset.rid!==undefined?parseInt(el.dataset.rid):null;
  const eidx=el.dataset.eidx!==undefined?parseInt(el.dataset.eidx):null;
  const fi=el.dataset.fi!==undefined?parseInt(el.dataset.fi):null;
  const stepid=el.dataset.stepid!==undefined?parseInt(el.dataset.stepid):null;
  switch(action){
    case 'setInputType':    setInputType(idx, el.dataset.type); break;
    case 'togglePanel':     togglePanel(idx, el.dataset.panel); break;
    case 'removeRule':      removeRule(rid); break;
    case 'addEntry':        addEntry(rid); break;
    case 'removeEntry':     removeEntry(rid, eidx); break;
    case 'toggleShowField':   toggleShowField(rid, eidx, fi); break;
    case 'toggleCollapse':    if(!e.target.closest('[data-action="removeRule"]')) toggleCollapse(rid); break;
    case 'toggleTriggerValue':  { const r=rules.find(r=>r.id===rid); if(r&&r.entries[eidx]){ toggleTriggerValue(rid,eidx,el.dataset.val); } } break;
    case 'selectAllFields':   selectAllFields(rid, eidx); break;
    case 'addStep':          addStep(); break;
    case 'removeStep':       removeStep(stepid); break;
    case 'moveStepUp':       moveStep(stepid, -1); break;
    case 'moveStepDown':     moveStep(stepid, 1); break;
  }
});
document.addEventListener('change', function(e){
  const el=e.target.closest('[data-action]')||e.target;
  const action=el.dataset.action; if(!action)return;
  const idx=el.dataset.idx!==undefined?parseInt(el.dataset.idx):null;
  const rid=el.dataset.rid!==undefined?parseInt(el.dataset.rid):null;
  const eidx=el.dataset.eidx!==undefined?parseInt(el.dataset.eidx):null;
  switch(action){
    case 'toggleBehaviourPage': toggleBehaviourPage(idx, el.dataset.behaviour, el.dataset.page); break;
    case 'masterField':         setMasterField(rid, el.value); break;
    case 'visTargetField':      setEntryProp(rid, eidx, 'targetField', el.value); break;
    case 'updTextCondStr':      { const i=parseInt(el.dataset.idx); if(fields[i]){if(!fields[i].textCond)fields[i].textCond={};fields[i].textCond[el.dataset.key]=el.value;} render(); } break;
    case 'updTextCondStr':      updTextCond(parseInt(el.dataset.idx), el.dataset.key, el.value); break;
    case 'entryVal':            setEntryProp(rid, eidx, 'value', el.value); break;
    case 'entryTarget':         setEntryProp(rid, eidx, 'targetField', el.value); break;
    case 'groupvisTarget':      setEntryProp(rid, eidx, 'targetField', el.value); break;
    case 'groupvisMode':        setEntryProp(rid, eidx, 'mode', el.value); break;
    case 'groupvisOverride':    { const r=rules.find(r=>r.id===rid); if(r&&r.entries[eidx]) r.entries[eidx].override=el.checked; renderRules(); } break;
    case 'toggleRulePage':      toggleRulePage(rid, el.dataset.page); break;
    case 'updTextCondBool':     updTextCond(parseInt(el.dataset.idx), el.dataset.key, el.checked); break;
    case 'toggleMultiStepEnabled': toggleMultiStepEnabled(); break;
    case 'toggleMultiStepContext': toggleMultiStepContext(el.dataset.ctx); break;
    case 'setFieldStep':        setFieldStep(idx, el.value); break;
    case 'renameStep':          renameStep(el.dataset.stepid!==undefined?parseInt(el.dataset.stepid):null, el.value); break;
  }
});
document.addEventListener('input', function(e){
  const el=e.target; const action=el.dataset.action; if(!action)return;
  const idx=el.dataset.idx!==undefined?parseInt(el.dataset.idx):null;
  const rid=el.dataset.rid!==undefined?parseInt(el.dataset.rid):null;
  const eidx=el.dataset.eidx!==undefined?parseInt(el.dataset.eidx):null;
  const stepid=el.dataset.stepid!==undefined?parseInt(el.dataset.stepid):null;
  switch(action){
    case 'renameStep':     { const s=steps.find(s=>s.id===stepid); if(s) s.title=el.value; } break; // update state only, no re-render (keeps focus while typing)
    case 'updLabel':       updLabel(idx, el.value); break;
    case 'updOpts':        updOpts(idx, el.value); break;
    case 'updErrMsg':      updErrMsg(idx, el.value); break;
    case 'updPlaceholder': updPlaceholder(idx, el.value); break;
    case 'updDropdownSearchErrMsg': updDropdownSearchErrMsg(idx, el.value); break;
    case 'updCheckedVal':   updCheckedVal(idx, el.value); break;
    case 'updUncheckedVal': updUncheckedVal(idx, el.value); break;
    case 'updUrlParam':     updUrlParam(idx, el.value); break;
    case 'updTextCondStr':   fields[idx] && fields[idx].textCond && (fields[idx].textCond[el.dataset.key]=el.value); break; // update state only, no re-render
    case 'entryOpts':        updEntryOptions(rid, eidx, el.value); break;
    case 'groupvisGroups':   { const r=rules.find(r=>r.id===rid); if(r&&r.entries[eidx]) r.entries[eidx].groups=el.value; } break;
  }
});

// ── Field drag-and-drop reordering ──
document.addEventListener('dragstart', function(e){
  const handle=e.target.closest('[data-action="dragHandle"]');
  if(!handle){return;}
  dragSrcIdx=parseInt(handle.dataset.idx,10);
  const row=handle.closest('.field-row');
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain', String(dragSrcIdx));
  if(row){
    row.classList.add('dragging');
    if(e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(row, 20, 20);
  }
});
document.addEventListener('dragover', function(e){
  if(dragSrcIdx===null)return;
  const row=e.target.closest('.field-row');
  if(!row)return;
  e.preventDefault();
  e.dataTransfer.dropEffect='move';
  if(!row.classList.contains('drag-over')){
    document.querySelectorAll('.field-row.drag-over').forEach(r=>{ if(r!==row) r.classList.remove('drag-over'); });
    row.classList.add('drag-over');
  }
});
document.addEventListener('dragleave', function(e){
  const row=e.target.closest('.field-row');
  if(row&&(!e.relatedTarget||!row.contains(e.relatedTarget))) row.classList.remove('drag-over');
});
document.addEventListener('drop', function(e){
  if(dragSrcIdx===null)return;
  const row=e.target.closest('.field-row');
  if(row){
    e.preventDefault();
    moveField(dragSrcIdx, parseInt(row.dataset.fieldIdx,10));
  }
  dragSrcIdx=null;
});
document.addEventListener('dragend', function(){
  document.querySelectorAll('.field-row.dragging,.field-row.drag-over').forEach(r=>r.classList.remove('dragging','drag-over'));
  dragSrcIdx=null;
});

// ── Limitations ──
const LIMITATIONS_DISMISS_KEY='tfm_hideLimitations';
function openLimitations(){
  document.getElementById('limitationsModal').style.display='block';
}
function closeLimitations(){
  const dontShow=document.getElementById('limitationsDontShow');
  try{
    if(dontShow&&dontShow.checked) localStorage.setItem(LIMITATIONS_DISMISS_KEY,'1');
  }catch(e){/* localStorage unavailable — just close without persisting */}
  document.getElementById('limitationsModal').style.display='none';
}
function copyLimitationsCss(){
  const text=document.getElementById('limitationsCssBlock').textContent;
  navigator.clipboard.writeText(text).then(()=>{
    const btn=document.getElementById('btn-copyLimitationsCss');
    btn.textContent='✓ Copied';
    setTimeout(()=>{btn.textContent='⎘ Copy';},2000);
  });
}

// ── Export ──
function openExport(){
  document.getElementById('exportModal').style.display='block';
  setTimeout(()=>{const inp=document.getElementById('exportFilename');inp.focus();inp.select();},50);
}
function closeExport(){document.getElementById('exportModal').style.display='none';}
function doExport(){
  let name=(document.getElementById('exportFilename').value||'thinkific-field-config').trim();
  name=name.replace(/\.json$/i,'').replace(/[/\\:*?"<>|]/g,'-')||'thinkific-field-config';
  const config={version:5,count,
    fields:Array.from({length:count},(_,i)=>({
      label:fields[i].label, inputType:fields[i].inputType, dropdownOpts:fields[i].dropdownOpts,
      hidden:{...fields[i].hidden}, readonly:{...fields[i].readonly}, required:{...fields[i].required},
      errorMsg:fields[i].errorMsg, placeholder:fields[i].placeholder, dropdownSearchErrorMsg:fields[i].dropdownSearchErrorMsg||'',
      checkboxCheckedValue:fields[i].checkboxCheckedValue||'', checkboxUncheckedValue:fields[i].checkboxUncheckedValue||'',
      textCond:{...(fields[i].textCond||{})}, step:fields[i].step||0
    })),
    rules:rules.map(r=>({type:r.type,masterField:r.masterField,pages:{...(r.pages||{signup:true,checkout:true,account:true})},entries:r.entries.map(e=>r.type==='groupvisibility'?{targetField:e.targetField,groups:e.groups||'',mode:e.mode||'hide',override:!!e.override}:r.type==='visibility'?{targetField:e.targetField||'',triggerValues:[...(e.triggerValues||[])]}:{...e,showFields:[...(e.showFields||[])]})})),
    multiStep:{...multiStep},
    steps:steps.map(s=>({id:s.id,title:s.title}))
  };
  const blob=new Blob([JSON.stringify(config,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name+'.json';a.click();URL.revokeObjectURL(url);
  closeExport();
}

// ── Import ──
function openImport(){
  pendingConfig=null;
  ['fileName','importError'].forEach(id=>{const el=document.getElementById(id);el.style.display='none';el.textContent='';});
  document.getElementById('fileInput').value='';
  const btn=document.getElementById('btn-doImport');btn.disabled=true;btn.style.opacity='.4';btn.style.cursor='not-allowed';
  document.getElementById('dropZone').classList.remove('over');
  document.getElementById('importSuccess').style.display='none';
  document.getElementById('importModal').style.display='block';
}
function closeImport(){document.getElementById('importModal').style.display='none';}
function onDragOver(e){e.preventDefault();document.getElementById('dropZone').classList.add('over');}
function onDragLeave(){document.getElementById('dropZone').classList.remove('over');}
function onDrop(e){e.preventDefault();document.getElementById('dropZone').classList.remove('over');const file=e.dataTransfer.files[0];if(file)readFile(file);}
function onFileChosen(input){const file=input.files[0];if(file)readFile(file);}
function readFile(file){
  const errEl=document.getElementById('importError');errEl.style.display='none';
  const reader=new FileReader();
  reader.onload=function(e){
    try{
      const config=JSON.parse(e.target.result);
      if(!config.version||!Array.isArray(config.fields)||!Array.isArray(config.rules)){errEl.textContent='Unrecognised format.';errEl.style.display='block';return;}
      pendingConfig=config;
      document.getElementById('fileName').textContent=file.name;document.getElementById('fileName').style.display='block';
      const btn=document.getElementById('btn-doImport');btn.disabled=false;btn.style.opacity='1';btn.style.cursor='pointer';
    }catch(err){errEl.textContent='Invalid JSON file.';errEl.style.display='block';}
  };
  reader.readAsText(file);
}
function doImport(){
  if(!pendingConfig)return;
  const config=pendingConfig;
  count=Math.min(MAX,config.count||config.fields.length);
  steps=(Array.isArray(config.steps)&&config.steps.length)
    ?config.steps.map(s=>({id:s.id, title:s.title||'Step'}))
    :[{id:0,title:'Step 1'}];
  stepIdCounter=Math.max(...steps.map(s=>s.id))+1;
  multiStep=config.multiStep
    ?{enabled:!!config.multiStep.enabled, signup:!!config.multiStep.signup, checkout:!!config.multiStep.checkout}
    :{enabled:false, signup:false, checkout:false};
  config.fields.forEach((f,i)=>{
    if(i>=MAX)return;
    fields[i].label=f.label||''; fields[i].dropdownOpts=f.dropdownOpts||'';
    fields[i].errorMsg=f.errorMsg||''; fields[i].placeholder=f.placeholder||'';
    fields[i].dropdownSearchErrorMsg=f.dropdownSearchErrorMsg||'';
    fields[i].checkboxCheckedValue=f.checkboxCheckedValue||''; fields[i].checkboxUncheckedValue=f.checkboxUncheckedValue||'';
    fields[i].textCond=f.textCond?{alphanumOnly:!!f.textCond.alphanumOnly,onlyNumbers:!!(f.textCond.onlyNumbers||f.textCond.noNumbers),onlyLetters:!!(f.textCond.onlyLetters||f.textCond.noLetters),excludeChars:f.textCond.excludeChars||'',includeChars:f.textCond.includeChars||'',maxLength:f.textCond.maxLength||'',forceUppercase:!!f.textCond.forceUppercase}:{alphanumOnly:false,onlyNumbers:false,onlyLetters:false,excludeChars:'',includeChars:'',maxLength:'',forceUppercase:false};
    fields[i].inputType=f.inputType||'text';
    // migrateBehaviour handles both old string format and new object format
    fields[i].hidden=migrateBehaviour(f.hidden);
    fields[i].readonly=migrateBehaviour(f.readonly);
    fields[i].required=migrateBehaviour(f.required);
    fields[i].openPanel=null;
    fields[i].step=steps.some(s=>s.id===f.step)?f.step:steps[0].id;
  });
  for(let i=config.fields.length;i<MAX;i++){
    fields[i].label='';fields[i].inputType='text';fields[i].dropdownOpts='';
    fields[i].hidden=defaultBehaviour();fields[i].readonly=defaultBehaviour();fields[i].required=defaultBehaviour();
    fields[i].errorMsg='';fields[i].placeholder='';fields[i].dropdownSearchErrorMsg='';fields[i].checkboxCheckedValue='';fields[i].checkboxUncheckedValue='';fields[i].openPanel=null;
    fields[i].textCond={alphanumOnly:false,onlyNumbers:false,onlyLetters:false,excludeChars:'',includeChars:'',maxLength:'',forceUppercase:false};
    fields[i].step=steps[0].id;
  }
  rules=[];ruleId=0;
  (config.rules||[]).forEach(r=>{rules.push({id:ruleId++,type:r.type,masterField:r.masterField||'',collapsed:false,pages:r.pages||{signup:true,checkout:true,account:true},entries:(r.entries||[]).map(e=>r.type==='groupvisibility'?{targetField:e.targetField||'',groups:e.groups||'',mode:e.mode||'hide',override:!!e.override}:r.type==='visibility'?{targetField:e.targetField||'',triggerValues:[...(e.triggerValues||[])]}:{...e,showFields:[...(e.showFields||[])]})});});
  document.getElementById('countDisplay').textContent=count;
  document.getElementById('idxRange').textContent=`(indices 0–${count-1})`;
  closeImport();
  document.getElementById('importSuccess').style.display='block';
  setTimeout(()=>{document.getElementById('importSuccess').style.display='none';},3000);
  render();renderRules();renderSteps();
}

// ── Code generation ──
function topoSortTargets(targetMap){
  const allTargets=Object.keys(targetMap).map(Number);
  const mastersOf={};
  allTargets.forEach(ti=>{mastersOf[ti]=targetMap[ti].map(e=>e.mi);});
  const sorted=[],visited=new Set();
  function visit(ti){if(visited.has(ti))return;visited.add(ti);(mastersOf[ti]||[]).forEach(mi=>{if(targetMap[mi]!==undefined)visit(mi);});sorted.push(ti);}
  allTargets.forEach(ti=>visit(ti));
  return sorted;
}

function gen(){
  const active=Array.from({length:count},(_,i)=>fields[i]);
  const msActive=multiStep.enabled&&(multiStep.signup||multiStep.checkout)&&steps.length>0;
  const conditionalFields=new Set();
  rules.filter(r=>r.type==='visibility').forEach(r=>{r.entries.forEach(e=>{ if(e.targetField!==undefined&&e.targetField!=='') conditionalFields.add(parseInt(e.targetField,10)); });});
  const reqFields=active.filter(f=>behaviourActive(f.required)&&!(behaviourAlways(f.hidden)&&!conditionalFields.has(f.idx))).map(f=>f.idx);
  const hasRequired=reqFields.length>0;
  const depTargetIndices=new Set();
  rules.filter(r=>r.type==='dependent'&&r.masterField!=='').forEach(r=>{r.entries.forEach(e=>{if(e.targetField!==undefined&&e.targetField!=='')depTargetIndices.add(parseInt(e.targetField));});});
  const targetMap={};
  // Also track pages per dependent rule's target for page guard
  const depTargetPages={}; // ti -> {signup,checkout,account} (union of all rules targeting ti)
  rules.filter(r=>r.type==='dependent'&&r.masterField!=='').forEach(r=>{
    const mi=parseInt(r.masterField);
    const rp=r.pages||{signup:true,checkout:true,account:true};
    r.entries.forEach(e=>{
      if(!e.targetField)return;
      const ti=parseInt(e.targetField);
      if(!targetMap[ti])targetMap[ti]=[];
      let entry=targetMap[ti].find(x=>x.mi===mi);
      if(!entry){entry={mi,pairs:[]};targetMap[ti].push(entry);}
      const opts=(e.options||'').trim().split('\n').filter(Boolean);
      entry.pairs.push({val:e.value,opts});
      // Union pages: if any rule targets this field on a page, include that page
      if(!depTargetPages[ti])depTargetPages[ti]={signup:false,checkout:false,account:false};
      if(rp.signup)   depTargetPages[ti].signup=true;
      if(rp.checkout) depTargetPages[ti].checkout=true;
      if(rp.account)  depTargetPages[ti].account=true;
    });
  });
  const sortedTargets=Object.keys(targetMap).length?topoSortTargets(targetMap):[];
  const downstreamOf={};
  sortedTargets.forEach(ti=>{targetMap[ti].forEach(({mi})=>{if(targetMap[mi]!==undefined){if(!downstreamOf[mi])downstreamOf[mi]=[];if(!downstreamOf[mi].includes(ti))downstreamOf[mi].push(ti);}});});
  const rootTargets=sortedTargets.filter(ti=>!targetMap[ti].some(({mi})=>targetMap[mi]!==undefined));
  const needsVisDeferral=new Set();
  sortedTargets.forEach(ti=>{targetMap[ti].forEach(({mi})=>{if(conditionalFields.has(mi))needsVisDeferral.add(ti);});});

  const inner=[];
  inner.push(`  function _byName(name) { return document.querySelector('[name="' + name + '"]'); }`);
  inner.push(`  function _elVisible(el) { var w=el&&(el.closest('.form__group')||el.parentElement); return w?w.style.display!=='none':true; }`);
  inner.push(`  // Wait for all expected custom fields to appear in the DOM before running.`);
  inner.push(`  // Thinkific sometimes renders fields after DOMContentLoaded, so we poll.`);
  inner.push(`  function ready(fn) {`);
  inner.push(`    var _maxWait = 5000, _interval = 50, _elapsed = 0;`);
  inner.push(`    function _check() {`);
  inner.push(`      if (_byName('${fname(0)}')) { fn(); return; }`);
  inner.push(`      _elapsed += _interval;`);
  inner.push(`      if (_elapsed < _maxWait) setTimeout(_check, _interval);`);
  inner.push(`    }`);
  inner.push(`    if (document.readyState === 'loading') {`);
  inner.push(`      document.addEventListener('DOMContentLoaded', _check);`);
  inner.push(`    } else {`);
  inner.push(`      _check();`);
  inner.push(`    }`);
  inner.push(`  }`);
  inner.push(``);
  inner.push(`  var _savedVals = {};`);
  depTargetIndices.forEach(ti=>{inner.push(`  (function(){ var el=_byName('${fname(ti)}'); if(el) _savedVals['${ti}']=el.value; })();`);});
  inner.push(``);
  inner.push(``);
  inner.push(`  var _isAccount = (window.location.pathname.indexOf('/account')!==-1&&window.location.pathname.indexOf('complete_signup')===-1);`);
  inner.push(``);
  const urlActiveFields=active.filter(f=>(f.urlParam||'').trim());
  if(urlActiveFields.length){
    inner.push(`  // Prefill fields from URL query-string parameters (e.g. ?ref=partner123).`);
    inner.push(`  // Only fills empty fields — never overwrites an existing saved value on the Account page.`);
    inner.push(`  var _urlParams = new URLSearchParams(window.location.search);`);
    inner.push(``);
  }
  inner.push(`  ready(function () {`);
  inner.push(`    var el, wrap;`);

  active.forEach((f,i)=>{
    const condHidden=conditionalFields.has(i);
    const hidActive=behaviourActive(f.hidden);
    const roActive=behaviourActive(f.readonly);
    const reqActive=behaviourActive(f.required);
    const phActive=f.placeholder&&f.placeholder.trim();
    const tc=f.textCond||{};
    const tcActive=f.inputType==='text'&&(tc.alphanumOnly||tc.onlyNumbers||tc.onlyLetters||(tc.excludeChars&&tc.excludeChars.trim())||(tc.includeChars&&tc.includeChars.trim())||(tc.maxLength&&String(tc.maxLength).trim())||tc.forceUppercase);
    const urlKey=(f.urlParam||'').trim();
    const urlActive=!!urlKey;
    const hasAny=f.inputType!=='text'||hidActive||roActive||reqActive||phActive||tcActive||urlActive;
    if(!hasAny)return;
    const lbl=f.label||`Field ${i}`;
    inner.push(``);inner.push(`    // ── ${lbl} (index ${i}) ──`);
    inner.push(`    el = _byName('${fname(i)}');`);
    inner.push(`    if (el) {`);
    inner.push(`      wrap = el.closest('.form__group') || el.parentElement;`);
    if(phActive) inner.push(`      el.setAttribute('placeholder', '${q(f.placeholder.trim())}');`);
    // Label text — update the <label> element inside the form group
    if(f.label&&f.label.trim()){
      inner.push(`      (function(){ var lbl=wrap&&wrap.querySelector('label'); if(lbl) lbl.textContent='${q(f.label.trim())}'; })();`);
    }
    // Text conditions
    if(f.inputType==='text'&&tcActive){
      const tc=f.textCond||{};
      // maxlength attribute
      if(tc.maxLength&&parseInt(tc.maxLength)>0){
        inner.push(`      el.setAttribute('maxlength', '${parseInt(tc.maxLength)}');`);
      }
      // Force uppercase via CSS
      if(tc.forceUppercase){
        inner.push(`      el.style.textTransform = 'uppercase';`);
      }
      // Build exclusion regex from selected options
      // We'll use an input event listener to strip disallowed characters live
      // Build regex pattern — priority: includeChars > alphanumOnly > onlyNumbers > onlyLetters > excludeChars
      // Build regex body — emit as a regex LITERAL to avoid double-escaping
      function escLit(str){
        return str.split('').map(c=>{
          if(c==='\\'||c==='/') return '\\'+c;
          if(c==='-') return '\\-';
          if(c===']') return '\\]';
          if(c==='^') return '\\^';
          return c;
        }).join('');
      }

      // Presets (alphanumOnly, onlyNumbers, onlyLetters) auto-populate includeChars in the editor,
      // so we only need to handle includeChars and excludeChars here.
      let regexBody=null;
      if(tc.includeChars&&tc.includeChars.trim()){
        regexBody=`[^${escLit(tc.includeChars.trim())}]`;
      }
      let excludeBody=null;
      if(tc.excludeChars&&tc.excludeChars.trim()){
        excludeBody=`[${escLit(tc.excludeChars.trim())}]`;
      }

      const hasFilter=regexBody||excludeBody;
      if(hasFilter||tc.forceUppercase){
        inner.push(`      (function () {`);
        if(hasFilter){
          if(regexBody&&excludeBody){
            inner.push(`        var _exclAllow = /${regexBody}/g;`);
            inner.push(`        var _exclChars = /${excludeBody}/g;`);
            inner.push(`        el.addEventListener('keydown', function (e) {`);
            inner.push(`          if (e.ctrlKey||e.metaKey||e.altKey) return;`);
            inner.push(`          if (['Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Tab','Enter','Home','End'].indexOf(e.key)!==-1) return;`);
            inner.push(`          if (e.key.length===1) {`);
            inner.push(`            _exclAllow.lastIndex=0; _exclChars.lastIndex=0;`);
            inner.push(`            if (_exclAllow.test(e.key)||_exclChars.test(e.key)) { e.preventDefault(); }`);
            inner.push(`          }`);
            inner.push(`        });`);
          } else {
            const lit=regexBody||excludeBody;
            inner.push(`        var _excl = /${lit}/g;`);
            // keydown blocks invalid chars before React sees them — more reliable than input event
            inner.push(`        var _allowedRe = new RegExp(_excl.source.replace(/^\\[\\^/, '[').replace(/\\]g$/, ']'));`);
            inner.push(`        el.addEventListener('keydown', function (e) {`);
            inner.push(`          if (e.ctrlKey||e.metaKey||e.altKey) return;`);
            inner.push(`          if (['Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Tab','Enter','Home','End'].indexOf(e.key)!==-1) return;`);
            inner.push(`          if (e.key.length===1 && _excl.test(e.key)) { e.preventDefault(); }`);
            inner.push(`          _excl.lastIndex=0; // reset stateful regex after test()`);
            inner.push(`        });`);
          }
        } else if(tc.forceUppercase){
          inner.push(`        el.addEventListener('input', function () { el.value = el.value.toUpperCase(); });`);
        }
        if(tc.forceUppercase){
          // Also uppercase on blur to catch paste without triggering input
          inner.push(`        el.addEventListener('blur', function () { el.value = el.value.toUpperCase(); });`);
        }
        inner.push(`      })();`);
      }
    }
    if(hidActive){
      if(condHidden){ inner.push(`      if (wrap) wrap.style.display = 'none'; // conditional will override`); }
      else { inner.push(`      if (${behaviourExpr(f.hidden)}) { if (wrap) wrap.style.display = 'none'; }`); }
    }
    if(roActive&&f.inputType!=='dropdown'&&f.inputType!=='monthyear'&&f.inputType!=='dropdownsearch'&&f.inputType!=='checkbox'){
      inner.push(`      if (${behaviourExpr(f.readonly)}) { el.setAttribute('readonly', true); el.style.background = '#f5f5f4'; el.style.cursor = 'not-allowed'; }`);
    }
    if(f.inputType==='date')      inner.push(`      el.setAttribute('type', 'date');`);
    if(urlActive&&(f.inputType==='text'||f.inputType==='date')){
      inner.push(`      if (!el.value) { var _uv${i} = _urlParams.get('${q(urlKey)}'); if (_uv${i}!==null) { el.value = _uv${i}; el.dispatchEvent(new Event('change')); } }`);
    }
    if(f.inputType==='monthyear'){
      inner.push(`      // MM/YYYY month picker`);
      inner.push(`      // Strategy: replace the input with a type="month" picker for UI,`);
      inner.push(`      // and keep a hidden input with the original name that holds MM/YYYY.`);
      inner.push(`      // The hidden input is what actually gets submitted to Thinkific.`);
      inner.push(`      (function () {`);
      inner.push(`        var storedVal = el.value; // e.g. 'MM/YYYY' or '' or 'YYYY-MM' (legacy)`);
      if(urlActive){
        inner.push(`        if (!storedVal) { var _uv = _urlParams.get('${q(urlKey)}'); if (_uv) storedVal = _uv; }`);
      }
      inner.push(``);
      inner.push(`        // Build the hidden input that will actually submit MM/YYYY`);
      inner.push(`        var hidden = document.createElement('input');`);
      inner.push(`        hidden.type = 'hidden';`);
      inner.push(`        hidden.name = el.name; // keeps the original field name`);
      inner.push(`        hidden.value = storedVal;`);
      inner.push(`        el.parentNode.insertBefore(hidden, el);`);
      inner.push(``);
      inner.push(`        // Build the visible month picker (no name — won't submit)`);
      inner.push(`        var picker = document.createElement('input');`);
      inner.push(`        picker.type = 'month';`);
      inner.push(`        picker.className = el.className;`);
      inner.push(`        // No name on picker — only hidden submits`);
      inner.push(``);
      inner.push(`        // Convert stored MM/YYYY → YYYY-MM for the picker display`);
      inner.push(`        var displayVal = storedVal;`);
      inner.push(`        var mmyyyy = storedVal.match(/^(\\d{2})\\/(\\d{4})$/);`);
      inner.push(`        if (mmyyyy) displayVal = mmyyyy[2] + '-' + mmyyyy[1];`);
      inner.push(`        // Also handle legacy YYYY-MM stored directly`);
      inner.push(`        var yyyymm = storedVal.match(/^(\\d{4})-(\\d{2})$/);`);
      inner.push(`        if (yyyymm) { displayVal = storedVal; hidden.value = yyyymm[2] + '/' + yyyymm[1]; }`);
      inner.push(`        picker.value = displayVal;`);
      inner.push(``);
      inner.push(`        // When picker changes, update hidden in MM/YYYY format`);
      inner.push(`        picker.addEventListener('change', function () {`);
      inner.push(`          var v = picker.value; // YYYY-MM from browser`);
      inner.push(`          if (v && v.match(/^\\d{4}-\\d{2}$/)) {`);
      inner.push(`            var parts = v.split('-');`);
      inner.push(`            hidden.value = parts[1] + '/' + parts[0]; // MM/YYYY`);
      inner.push(`          } else {`);
      inner.push(`            hidden.value = '';`);
      inner.push(`          }`);
      inner.push(`        });`);
      inner.push(``);
      inner.push(`        // Replace the original input with the picker in the DOM`);
      inner.push(`        el.parentNode.replaceChild(picker, el);`);
      inner.push(`        window['_tf${i}'] = hidden; // validation references the hidden input`);
      inner.push(`      })();`);
    }
    if(f.inputType==='dropdown'){
      const opts=(f.dropdownOpts||'').trim().split('\n').filter(Boolean);
      if(opts.length){
        inner.push(`      (function () {`);
        inner.push(`        var existingValue = el.value;`);
        inner.push(`        var sel = document.createElement('select');`);
        inner.push(`        sel.name = el.name; sel.className = el.className;`);
        inner.push(`        var placeholder = new Option('— select —', '');`);
        inner.push(`        placeholder.disabled = true;`);
        inner.push(`        sel.appendChild(placeholder);`);
        opts.forEach(o=>inner.push(`        sel.appendChild(new Option('${q(o)}', '${q(o)}'));`));
        if(urlActive){
          inner.push(`        if (!existingValue) { var _uv = _urlParams.get('${q(urlKey)}'); if (_uv !== null) { var _uvLower = _uv.trim().toLowerCase(); var _match = [${opts.map(o=>`'${q(o)}'`).join(', ')}].filter(function(o){ return o.toLowerCase()===_uvLower; })[0]; if (_match) existingValue = _match; } }`);
        }
        inner.push(`        sel.value = existingValue;`);
        inner.push(`        if (sel.value !== existingValue || existingValue === '') { placeholder.selected = true; }`);
        if(roActive) inner.push(`        if (${behaviourExpr(f.readonly)}) { sel.setAttribute('disabled', true); sel.style.background = '#f5f5f4'; sel.style.cursor = 'not-allowed'; }`);
        inner.push(`        el.parentNode.replaceChild(sel, el);`);
        inner.push(`        window['_tf${i}'] = sel;`);
        inner.push(`      })();`);
      }
    }
    if(f.inputType==='dropdownsearch'){
      const opts=(f.dropdownOpts||'').trim().split('\n').filter(Boolean);
      if(opts.length){
        const ph=q((f.placeholder&&f.placeholder.trim())||'Start typing…');
        const invalidMsg=q((f.dropdownSearchErrorMsg&&f.dropdownSearchErrorMsg.trim())||DEFAULT_INVALID_SEARCH_TEXT);
        inner.push(`      (function () {`);
        inner.push(`        var originalInput = el;`);
        inner.push(`        originalInput.type = 'hidden';`);
        inner.push(`        var OPTIONS = [${opts.map(o=>`'${q(o)}'`).join(', ')}];`);
        inner.push(`        var textbox = document.createElement('input');`);
        inner.push(`        textbox.type = 'text';`);
        inner.push(`        textbox.className = originalInput.className;`);
        inner.push(`        textbox.setAttribute('placeholder', '${ph}');`);
        inner.push(`        textbox.setAttribute('list', 'tfm-datalist-${i}');`);
        inner.push(`        originalInput.parentNode.appendChild(textbox);`);
        inner.push(`        var datalist = document.createElement('datalist');`);
        inner.push(`        datalist.id = 'tfm-datalist-${i}';`);
        inner.push(`        OPTIONS.forEach(function (o) { var opt = document.createElement('option'); opt.value = o; datalist.appendChild(opt); });`);
        inner.push(`        originalInput.parentNode.appendChild(datalist);`);
        inner.push(`        var errorEl = document.createElement('div');`);
        inner.push(`        errorEl.textContent = '${invalidMsg}';`);
        inner.push(`        errorEl.style.cssText = 'display:none;margin-top:6px;font-size:12px;line-height:1.2;color:#c0392b';`);
        inner.push(`        textbox.insertAdjacentElement('afterend', errorEl);`);
        inner.push(`        function setInvalidState(isInvalid) {`);
        inner.push(`          if (isInvalid) { textbox.style.outline = '2px solid rgba(192,57,43,.35)'; textbox.style.borderColor = 'rgba(192,57,43,.7)'; errorEl.style.display = 'block'; textbox.setAttribute('aria-invalid', 'true'); }`);
        inner.push(`          else { textbox.style.outline = ''; textbox.style.borderColor = ''; errorEl.style.display = 'none'; textbox.removeAttribute('aria-invalid'); }`);
        inner.push(`        }`);
        inner.push(`        function findMatchingOption(rawValue) {`);
        inner.push(`          var value = (rawValue || '').trim().toLowerCase();`);
        inner.push(`          if (!value) return null;`);
        inner.push(`          var exact = OPTIONS.filter(function (o) { return o.toLowerCase() === value; })[0];`);
        inner.push(`          if (exact) return exact;`);
        inner.push(`          return OPTIONS.filter(function (o) { return o.toLowerCase().indexOf(value) === 0; })[0] || null;`);
        inner.push(`        }`);
        inner.push(`        var _internalChange = false;`);
        inner.push(`        function applyValue(rawValue) {`);
        inner.push(`          var trimmed = (rawValue || '').trim();`);
        inner.push(`          _internalChange = true;`);
        inner.push(`          if (!trimmed) { setInvalidState(false); originalInput.value = ''; originalInput.dispatchEvent(new Event('change')); _internalChange = false; return; }`);
        inner.push(`          var match = findMatchingOption(trimmed);`);
        inner.push(`          if (!match) { setInvalidState(true); originalInput.value = ''; originalInput.dispatchEvent(new Event('change')); _internalChange = false; return; }`);
        inner.push(`          setInvalidState(false); textbox.value = match; originalInput.value = match; originalInput.dispatchEvent(new Event('change')); _internalChange = false;`);
        inner.push(`        }`);
        inner.push(`        var _awaitingChoice = false, _preFocusValue = '';`);
        inner.push(`        textbox.addEventListener('focus', function () {`);
        inner.push(`          // Native datalist popups only suggest options matching the current text, so a`);
        inner.push(`          // filled-in field looks "empty" of suggestions. Clear it to show the full list again;`);
        inner.push(`          // restored on blur if nothing new was chosen.`);
        inner.push(`          _preFocusValue = textbox.value;`);
        inner.push(`          _awaitingChoice = true;`);
        inner.push(`          textbox.value = '';`);
        inner.push(`        });`);
        inner.push(`        textbox.addEventListener('input', function () {`);
        inner.push(`          _awaitingChoice = false;`);
        inner.push(`          var value = this.value.trim();`);
        inner.push(`          if (!value) { setInvalidState(false); return; }`);
        inner.push(`          if (findMatchingOption(value)) setInvalidState(false);`);
        inner.push(`        });`);
        inner.push(`        textbox.addEventListener('change', function () {`);
        inner.push(`          if (_awaitingChoice && !this.value.trim()) { textbox.value = _preFocusValue; _awaitingChoice = false; return; }`);
        inner.push(`          _awaitingChoice = false;`);
        inner.push(`          applyValue(this.value);`);
        inner.push(`        });`);
        inner.push(`        textbox.addEventListener('blur', function () {`);
        inner.push(`          if (_awaitingChoice && !textbox.value.trim()) textbox.value = _preFocusValue;`);
        inner.push(`          _awaitingChoice = false;`);
        inner.push(`        });`);
        inner.push(`        textbox.addEventListener('keydown', function (e) {`);
        inner.push(`          if (e.key !== 'Tab') return;`);
        inner.push(`          var value = this.value.trim();`);
        inner.push(`          if (!value) return;`);
        inner.push(`          _awaitingChoice = false;`);
        inner.push(`          var match = findMatchingOption(value);`);
        inner.push(`          if (match) { this.value = match; applyValue(match); return; }`);
        inner.push(`          setInvalidState(true); originalInput.value = ''; originalInput.dispatchEvent(new Event('change'));`);
        inner.push(`        });`);
        inner.push(`        // Resyncs the visible textbox when something external (a visibility/dependent rule) changes the hidden value`);
        inner.push(`        originalInput.addEventListener('change', function () {`);
        inner.push(`          if (_internalChange) return;`);
        inner.push(`          textbox.value = originalInput.value;`);
        inner.push(`          setInvalidState(false);`);
        inner.push(`        });`);
        if(roActive) inner.push(`        if (${behaviourExpr(f.readonly)}) { textbox.setAttribute('readonly', true); textbox.style.background = '#f5f5f4'; textbox.style.cursor = 'not-allowed'; }`);
        if(urlActive){
          inner.push(`        if (!originalInput.value) { var _uv = _urlParams.get('${q(urlKey)}'); if (_uv !== null) { var _uvLower = _uv.trim().toLowerCase(); var _match = OPTIONS.filter(function(o){ return o.toLowerCase()===_uvLower; })[0]; if (_match) originalInput.value = _match; } }`);
        }
        inner.push(`        if (originalInput.value) applyValue(originalInput.value);`);
        inner.push(`        window['_tf${i}'] = originalInput;`);
        inner.push(`      })();`);
      }
    }
    if(f.inputType==='checkbox'){
      const [checkedVal,uncheckedVal]=checkboxValues(f);
      inner.push(`      (function () {`);
      inner.push(`        var existingValue = el.value;`);
      inner.push(`        var checkedVal = '${q(checkedVal)}';`);
      inner.push(`        var uncheckedVal = '${q(uncheckedVal)}';`);
      if(urlActive){
        inner.push(`        var _uv = existingValue ? null : _urlParams.get('${q(urlKey)}');`);
        inner.push(`        if (_uv !== null) { var _uvLower = _uv.trim().toLowerCase(); if (_uvLower === checkedVal.toLowerCase()) existingValue = checkedVal; else if (_uvLower === uncheckedVal.toLowerCase()) existingValue = uncheckedVal; }`);
      }
      inner.push(`        var cb = document.createElement('input');`);
      inner.push(`        cb.type = 'checkbox';`);
      inner.push(`        cb.style.marginRight = '8px';`);
      inner.push(`        cb.style.verticalAlign = 'middle';`);
      inner.push(`        cb.checked = (existingValue === checkedVal);`);
      if(roActive) inner.push(`        if (${behaviourExpr(f.readonly)}) { cb.disabled = true; cb.style.cursor = 'not-allowed'; }`);
      inner.push(`        el.type = 'hidden';`);
      inner.push(`        el.value = cb.checked ? checkedVal : uncheckedVal;`);
      inner.push(`        el._isValidValue = function () { return cb.checked; }; // required means "must be checked"`);
      inner.push(`        cb.addEventListener('change', function () { el.value = cb.checked ? checkedVal : uncheckedVal; el.dispatchEvent(new Event('change')); });`);
      inner.push(`        // Nest the checkbox inside the field's own <label> so it renders to the left of the label`);
      inner.push(`        // text (native checkbox+label pattern) and clicking the text toggles it too.`);
      inner.push(`        var lbl = wrap && wrap.querySelector('label');`);
      inner.push(`        if (lbl) { lbl.insertBefore(cb, lbl.firstChild); lbl.style.cursor = cb.disabled ? 'not-allowed' : 'pointer'; }`);
      inner.push(`        else { el.parentNode.insertBefore(cb, el); }`);
      inner.push(`        window['_tf${i}'] = el;`);
      inner.push(`      })();`);
    }
    inner.push(`    }`);
  });

  if(hasRequired){
    inner.push(``);inner.push(`    // ── Validation & button gating ──`);
    inner.push(`    var submitBtn = document.querySelector('button.button-primary[type="submit"], input.button-primary[type="submit"]');`);
    inner.push(`    if (submitBtn) { submitBtn.style.opacity = '0.4'; submitBtn.style.pointerEvents = 'none'; submitBtn.style.cursor = 'not-allowed'; }`);
    inner.push(`    var _reqFields = [`);
    reqFields.forEach(i=>{const f=fields[i];const errMsg=f.errorMsg.trim()||(f.inputType==='checkbox'?DEFAULT_CHECKBOX_ERROR:(f.inputType==='dropdown'||f.inputType==='dropdownsearch')?DEFAULT_SELECT_ERROR:DEFAULT_ERROR_TEXT);inner.push(`      { name: '${fname(i)}', msg: '${q(errMsg)}', condHidden: ${conditionalFields.has(i)}, activeOn: function(){ return ${behaviourExpr(f.required)}; } },`);});
    inner.push(`    ];`);
    inner.push(`    function _getEl(name) { var idx=name.match(/\\[(\\d+)\\]\\[value\\]$/); if(idx&&window['_tf'+idx[1]])return window['_tf'+idx[1]]; return _byName(name); }`);
    inner.push(`    function _isEmpty(el) { if (el && typeof el._isValidValue === 'function') return !el._isValidValue(); return !el || el.value === ''; }`);
    inner.push(`    function _isVisible(el) { var w=el.closest('.form__group')||el.parentElement; return w?w.style.display!=='none':true; }`);
    inner.push(`    function _showError(el,msg) { var w=el.closest('.form__group')||el.parentElement; if(!w)return; var e=w.querySelector('.form__error-msg'); if(e){e.textContent=msg;e.classList.remove('hidden');} }`);
    inner.push(`    function _clearError(el) { var w=el.closest('.form__group')||el.parentElement; if(!w)return; var e=w.querySelector('.form__error-msg'); if(e)e.classList.add('hidden'); }`);
    inner.push(`    function _checkAll() { var allValid=true; _reqFields.forEach(function(f){ if(!f.activeOn())return; var el=_getEl(f.name); if(!el)return; if(f.condHidden&&!_isVisible(el))return; if(_isEmpty(el))allValid=false; }); if(submitBtn){ submitBtn.style.opacity=allValid?'':'0.4'; submitBtn.style.pointerEvents=allValid?'':'none'; submitBtn.style.cursor=allValid?'':'not-allowed'; } return allValid; }`);
    inner.push(`    _reqFields.forEach(function(f) { if(!f.activeOn())return; var el=_getEl(f.name); if(!el)return; el.addEventListener('change',function(){ if(!_isEmpty(el))_clearError(el); else _showError(el,f.msg); _checkAll(); }); el.addEventListener('blur',function(){ if(f.condHidden&&!_isVisible(el))return; if(_isEmpty(el))_showError(el,f.msg); else _clearError(el); }); });`);
    inner.push(`    _checkAll();`);
  }

  const visRules=rules.filter(r=>r.type==='visibility'&&r.masterField!==''&&r.entries.length);
  if(visRules.length){
    inner.push(``);inner.push(`    // ── Field visibility conditionals ──`);
    visRules.forEach((r,ri)=>{
      const mi=parseInt(r.masterField);
      // Collect all unique target field indices across entries (skip blanks)
      const allTargets=[...new Set(r.entries.map(e=>e.targetField).filter(t=>t!==''&&t!==undefined).map(t=>parseInt(t)))];
      if(!allTargets.length)return;
      inner.push(`    (function () { var master=window['_tf${mi}']||_byName('${fname(mi)}'); if(!master)return;`);
      allTargets.forEach(ti=>{
        inner.push(`      var el${ti}=window['_tf${ti}']||_byName('${fname(ti)}');`);
        inner.push(`      var w${ti}=el${ti}?(el${ti}.closest('.form__group')||el${ti}.parentElement):null;`);
        inner.push(`      if(w${ti})w${ti}.style.display='none';`);
      });
      // Page guard — build expression first, emit at TOP of applyVis function
      const vp=r.pages||{signup:true,checkout:true,account:true};
      const vpParts=[];
      if(vp.signup)   vpParts.push(`(window.location.pathname.indexOf('sign_up')!==-1)`);
      if(vp.checkout) vpParts.push(`(window.location.pathname.indexOf('complete_signup')!==-1)`);
      if(vp.account)  vpParts.push(`(window.location.pathname.indexOf('/account')!==-1&&window.location.pathname.indexOf('complete_signup')===-1)`);
      const vpExpr=vpParts.length?vpParts.join('||'):'false';

      inner.push(`      function applyVis${ri}() {`);
      // Guard is the FIRST thing in the function — before any showing logic
      if(vpParts.length<3){
        inner.push(`        if (!(${vpExpr})) return; // inactive on this page — fields follow Fields-tab rules`);
      }
      inner.push(`        var v=master.value,showing;`);
      allTargets.forEach(ti=>{
        const triggerVals=[...new Set(
          r.entries
            .filter(e=>String(e.targetField)===String(ti))
            .flatMap(e=>e.triggerValues||[])
        )].map(v=>`'${q(v)}'`);
        const expr=triggerVals.length?`[${triggerVals.join(',')}].indexOf(v)!==-1`:`false`;
        inner.push(`        showing=${expr};`);
        inner.push(`        if(w${ti})w${ti}.style.display=showing?'':'none';`);
        inner.push(`        if(!showing&&el${ti}){el${ti}.value='';if(el${ti}.dispatchEvent)el${ti}.dispatchEvent(new Event('change'));}`);
      });
      if(hasRequired)inner.push(`        if(typeof _checkAll==='function')_checkAll();`);
      inner.push(`      }`);
      inner.push(`      master.addEventListener('change',applyVis${ri}); applyVis${ri}();`);
      if(msActive) inner.push(`      window['_tfmApplyVis${ri}']=applyVis${ri};`);
      inner.push(`      })();`);
    });
  }

  // ── Group show/hide rules (account page only) ──
  const groupVisRules=rules.filter(r=>r.type==='groupvisibility'&&r.entries.length);
  if(groupVisRules.length){
    inner.push(``);inner.push(`    // ── Group show/hide (account page only) ──`);
    inner.push(`    (function () {`);
    inner.push(`      if (!_isAccount) return;`);
    inner.push(`      var _userGroups = (typeof Thinkific !== 'undefined' && Thinkific.current_user && Thinkific.current_user.groups || []).map(function(g){ return g.name; });`);

    // Build per-field instruction list: [{ti, groups, mode, override}]
    // Multiple entries can target the same field — keep them separate so each
    // mode/override combination is applied independently
    const ghEntries=[];
    groupVisRules.forEach(r=>{
      r.entries.forEach(e=>{
        if(e.targetField===''||e.targetField===undefined)return;
        const ti=parseInt(e.targetField);
        const groups=(e.groups||'').trim().split('\n').filter(Boolean);
        if(!groups.length)return;
        ghEntries.push({ti,groups,mode:e.mode||'hide',override:!!e.override});
      });
    });

    // Group by targetField
    const byTarget={};
    ghEntries.forEach(entry=>{
      if(!byTarget[entry.ti])byTarget[entry.ti]=[];
      byTarget[entry.ti].push(entry);
    });

    Object.entries(byTarget).forEach(([ti,entries])=>{
      ti=parseInt(ti);
      const lbl=fields[ti].label||`Field ${ti}`;
      inner.push(`      // ${lbl} (index ${ti})`);
      inner.push(`      (function () {`);
      inner.push(`        var el=window['_tf${ti}']||_byName('${fname(ti)}');`);
      inner.push(`        if (!el) return;`);
      inner.push(`        var wrap=el.closest('.form__group')||el.parentElement;`);
      inner.push(`        if (!wrap) return;`);

      entries.forEach((entry,ei)=>{
        const grpArr=entry.groups.map(g=>`'${q(g)}'`).join(',');
        inner.push(`        var _grp${ei}=[${grpArr}];`);
        inner.push(`        var _match${ei}=_userGroups.some(function(g){return _grp${ei}.indexOf(g)!==-1;});`);
      });

      // Override entries force display regardless of other hide rules
      // Non-override entries only apply if wrap isn't already forcibly shown by an override
      const overrideEntries=entries.filter(e=>e.override);
      const normalEntries=entries.filter(e=>!e.override);

      // Apply normal (non-override) entries first
      normalEntries.forEach((entry,ei)=>{
        const idx=entries.indexOf(entry);
        if(entry.mode==='hide'){
          inner.push(`        if (_match${idx}) { wrap.style.display='none'; }`);
        } else {
          inner.push(`        if (_match${idx}) { wrap.style.display=''; }`);
        }
      });

      // Apply override entries last — they win over everything including field visibility conditionals
      if(overrideEntries.length){
        inner.push(`        // Override rules — take priority over all other hide/show logic`);
        overrideEntries.forEach((entry,ei)=>{
          const idx=entries.indexOf(entry);
          if(entry.mode==='hide'){
            inner.push(`        if (_match${idx}) { wrap.style.display='none'; }`);
            inner.push(`        else { wrap.style.display=''; } // override: force show if not in group`);
          } else {
            inner.push(`        if (_match${idx}) { wrap.style.display=''; }`);
            inner.push(`        else { wrap.style.display='none'; } // override: force hide if not in group`);
          }
        });
      }

      inner.push(`      })();`);
    });

    inner.push(`    })();`);
  }

    if(sortedTargets.length){
    inner.push(``);inner.push(`    // ── Dependent dropdown options ──`);
    sortedTargets.forEach(ti=>{
      const masters=targetMap[ti];const downstream=downstreamOf[ti]||[];
      inner.push(`    (function () {`);
      masters.forEach(({mi})=>inner.push(`      var master${mi}=window['_tf${mi}']||_byName('${fname(mi)}');`));
      inner.push(`      var target=window['_tf${ti}']||_byName('${fname(ti)}'); if(!target)return;`);
      masters.forEach(({mi,pairs})=>{inner.push(`      var optMap${mi}={`);pairs.forEach(({val,opts})=>inner.push(`        '${q(val)}':[${opts.map(o=>`'${q(o)}'`).join(',')}],`));inner.push(`      };`);});
      inner.push(`      var existingTarget=_savedVals['${ti}']||'';`);
      // Page guard for this dependent target — build first, emit at TOP of applyOpts
      const dp=depTargetPages[ti]||{signup:true,checkout:true,account:true};
      const dpParts=[];
      if(dp.signup)   dpParts.push(`(window.location.pathname.indexOf('sign_up')!==-1)`);
      if(dp.checkout) dpParts.push(`(window.location.pathname.indexOf('complete_signup')!==-1)`);
      if(dp.account)  dpParts.push(`(window.location.pathname.indexOf('/account')!==-1&&window.location.pathname.indexOf('complete_signup')===-1)`);

      inner.push(`      window['_applyOpts_${ti}']=function(clearExisting) {`);
      // Guard is the FIRST thing inside the function
      if(dpParts.length<3){
        inner.push(`        if (!(${dpParts.length?dpParts.join('||'):'false'})) return; // inactive on this page`);
      }
      inner.push(`        var opts=[],v;`);
      masters.forEach(({mi})=>inner.push(`        if(!opts.length&&master${mi}&&_elVisible(master${mi})){v=master${mi}.value;opts=optMap${mi}[v]||[];}`));
      inner.push(`        var ph=new Option('— select —',''); ph.disabled=true; target.innerHTML=''; target.appendChild(ph); opts.forEach(function(o){target.appendChild(new Option(o,o));}); if(!clearExisting&&existingTarget&&opts.indexOf(existingTarget)!==-1){ target.value=existingTarget; } else { ph.selected=true; }`);
      if(hasRequired)inner.push(`        if(typeof _checkAll==='function')_checkAll();`);
      if(downstream.length){downstream.forEach(dti=>inner.push(`        if(typeof window['_applyOpts_${dti}']==='function') window['_applyOpts_${dti}'](clearExisting);`));}
      inner.push(`      };`);
      masters.forEach(({mi})=>inner.push(`      if(master${mi})master${mi}.addEventListener('change',function(){existingTarget='';window['_applyOpts_${ti}'](true);});`));
      inner.push(`    })();`);
    });
    inner.push(``);
    const immediateRoots=rootTargets.filter(ti=>!needsVisDeferral.has(ti));
    const deferredRoots=rootTargets.filter(ti=>needsVisDeferral.has(ti));
    immediateRoots.forEach(ti=>inner.push(`    if(typeof window['_applyOpts_${ti}']==='function') window['_applyOpts_${ti}'](false);`));
    if(deferredRoots.length){inner.push(`    setTimeout(function(){`);deferredRoots.forEach(ti=>inner.push(`      if(typeof window['_applyOpts_${ti}']==='function') window['_applyOpts_${ti}'](false);`));inner.push(`    }, 0);`);}
  }

  // ── Multi-step pages (custom fields wizard) ──
  if(msActive){
    const stepIndexById={};
    steps.forEach((s,pos)=>{stepIndexById[s.id]=pos;});
    const stepOfArr=Array.from({length:count},(_,i)=>{
      const sp=stepIndexById[fields[i].step];
      return sp!==undefined?sp:0;
    });
    // Fields that are already managed by another mechanism (conditional visibility, or a
    // permanent Hide rule) must never be force-shown just because their step became active —
    // only force-hidden when their step is inactive. Everything else toggles freely.
    const managedSet=new Set(conditionalFields);
    active.forEach(f=>{ if(behaviourActive(f.hidden)) managedSet.add(f.idx); });
    const msCtxExpr=[];
    if(multiStep.signup)   msCtxExpr.push(`(window.location.pathname.indexOf('sign_up')!==-1)`);
    if(multiStep.checkout) msCtxExpr.push(`(window.location.pathname.indexOf('complete_signup')!==-1)`);

    inner.push(``);inner.push(`    // ── Multi-step pages (custom fields) ──`);
    inner.push(`    (function () {`);
    inner.push(`      if (!(${msCtxExpr.join('||')})) return;`);
    inner.push(`      var _stepOfBase=[${stepOfArr.join(',')}];`);
    inner.push(`      var _managed=[${[...managedSet].join(',')}];`);
    inner.push(`      function _isManaged(i){ return _managed.indexOf(i)!==-1; }`);
    inner.push(`      function _cfName(i){ return 'user[profile_attributes][custom_profile_fields_attributes][' + i + '][value]'; }`);
    inner.push(`      var _wraps={}, _order=[];`);
    inner.push(`      for (var _i=0;_i<${count};_i++){`);
    inner.push(`        var _el=window['_tf'+_i]||_byName(_cfName(_i));`);
    inner.push(`        if(!_el) continue;`);
    inner.push(`        var _w=_el.closest('.form__group')||_el.parentElement;`);
    inner.push(`        if(!_w) continue;`);
    inner.push(`        _wraps[_i]=_w; _order.push(_i);`);
    inner.push(`      }`);
    inner.push(`      if(!_order.length) return;`);
    inner.push(`      var _isSignupCtx=(window.location.pathname.indexOf('sign_up')!==-1);`);
    inner.push(`      var _isCheckoutCtx=(window.location.pathname.indexOf('complete_signup')!==-1);`);
    inner.push(`      function _findCoreField(key){`);
    inner.push(`        var _all=document.querySelectorAll('[name="user['+key+']"]');`);
    inner.push(`        for (var _n=0;_n<_all.length;_n++){ if(_all[_n].type!=='hidden') return _all[_n]; }`);
    inner.push(`        if(_all.length) return _all[0];`);
    inner.push(`        var _alt=document.querySelectorAll('input[name*="'+key+'"],select[name*="'+key+'"]');`);
    inner.push(`        for (var _m=0;_m<_alt.length;_m++){ if(_alt[_m].type!=='hidden') return _alt[_m]; }`);
    inner.push(`        return _alt.length?_alt[0]:null;`);
    inner.push(`      }`);
    inner.push(`      function _flagCoreField(_c){ var _w=_c.closest('.form__group')||_c.parentElement; var _e=_w&&_w.querySelector('.form__error-msg'); if(_e){ if(!_e.textContent||!_e.textContent.trim())_e.textContent='This field is required'; _e.classList.remove('hidden'); } else { _c.style.outline='2px solid #ef4444'; } }`);
    inner.push(`      function _clearCoreFlag(_c){ _c.style.outline=''; var _w=_c.closest('.form__group')||_c.parentElement; var _e=_w&&_w.querySelector('.form__error-msg'); if(_e)_e.classList.add('hidden'); }`);
    inner.push(`      var _pinnedFirst=[];`);
    inner.push(`      if(_isSignupCtx){ ['first_name','last_name','email','password'].forEach(function(k){ var _c=_findCoreField(k); if(_c) _pinnedFirst.push(_c); }); }`);
    inner.push(`      else if(_isCheckoutCtx){ var _cp=_findCoreField('password'); if(_cp) _pinnedFirst.push(_cp); }`);
    inner.push(`      var _pinnedFirstWraps=_pinnedFirst.map(function(_c){ return _c.closest('.form__group')||_c.parentElement; }).filter(Boolean);`);
    inner.push(`      _pinnedFirst.forEach(function(_c){ _c.addEventListener('input',function(){ _clearCoreFlag(_c); }); });`);
    inner.push(`      var _pinnedLast=[];`);
    inner.push(`      if(_isSignupCtx){ var _terms=_findCoreField('terms'); if(_terms) _pinnedLast.push(_terms); }`);
    inner.push(`      var _pinnedLastWraps=_pinnedLast.map(function(_c){ return _c.closest('.form__group')||_c.parentElement; }).filter(Boolean);`);
    inner.push(`      _pinnedLast.forEach(function(_c){ _c.addEventListener('change',function(){ _clearCoreFlag(_c); }); });`);
    inner.push(`      // Page 1 is reserved for the pinned built-in fields (when any were found); every`);
    inner.push(`      // step created in the tool is shifted down to start at Page 2.`);
    inner.push(`      var _offset=_pinnedFirst.length?1:0;`);
    inner.push(`      var TOTAL=${steps.length}+_offset;`);
    inner.push(`      var STEP_TITLES=[${steps.map(s=>`'${q(s.title||'')}'`).join(',')}];`);
    inner.push(`      var _stepOf=_stepOfBase.map(function(p){ return p+_offset; });`);
    inner.push(`      var firstWrap=_pinnedFirstWraps.length?_pinnedFirstWraps[0]:_wraps[_order[0]];`);
    inner.push(`      var lastWrap=_pinnedLastWraps.length?_pinnedLastWraps[_pinnedLastWraps.length-1]:_wraps[_order[_order.length-1]];`);
    inner.push(`      var formEl=firstWrap.closest('form');`);
    inner.push(`      var header=document.createElement('div'); header.className='tfm-ms-header';`);
    inner.push(`      var track=document.createElement('div'); track.className='tfm-ms-track';`);
    inner.push(`      var fill=document.createElement('div'); fill.className='tfm-ms-fill'; track.appendChild(fill);`);
    inner.push(`      var dotsWrap=document.createElement('div'); dotsWrap.className='tfm-ms-dots';`);
    inner.push(`      var dots=[], lines=[];`);
    inner.push(`      for (var _s=0;_s<TOTAL;_s++){`);
    inner.push(`        var dot=document.createElement('div'); dot.className='tfm-ms-dot';`);
    inner.push(`        var num=document.createElement('span'); num.textContent=String(_s+1); dot.appendChild(num);`);
    inner.push(`        dotsWrap.appendChild(dot); dots.push(dot);`);
    inner.push(`        if(_s<TOTAL-1){ var line=document.createElement('div'); line.className='tfm-ms-line'; dotsWrap.appendChild(line); lines.push(line); }`);
    inner.push(`      }`);
    inner.push(`      var metaEl=document.createElement('div'); metaEl.className='tfm-ms-meta';`);
    inner.push(`      var titleEl=document.createElement('div'); titleEl.className='tfm-ms-title';`);
    inner.push(`      header.appendChild(track); header.appendChild(dotsWrap); header.appendChild(metaEl); header.appendChild(titleEl);`);
    inner.push(`      firstWrap.parentNode.insertBefore(header, firstWrap);`);
    inner.push(`      var nav=document.createElement('div'); nav.className='tfm-ms-nav';`);
    inner.push(`      var backBtn=document.createElement('button'); backBtn.type='button'; backBtn.className='tfm-ms-back'; backBtn.textContent='\\u2190 Back';`);
    inner.push(`      var nextBtn=document.createElement('button'); nextBtn.type='button'; nextBtn.className='tfm-ms-next'; nextBtn.textContent='Continue \\u2192';`);
    inner.push(`      nav.appendChild(backBtn); nav.appendChild(nextBtn);`);
    inner.push(`      lastWrap.parentNode.insertBefore(nav, lastWrap.nextSibling);`);
    inner.push(`      var submitGroup=formEl?formEl.querySelector('.form__button-group'):null;`);
    if(visRules.length) inner.push(`      var _visFns=[${visRules.map((_,ri)=>ri).join(',')}];`);
    if(sortedTargets.length) inner.push(`      var _optTargets=[${sortedTargets.join(',')}];`);
    inner.push(`      function _reassert(){`);
    if(visRules.length) inner.push(`        _visFns.forEach(function(vi){ if(typeof window['_tfmApplyVis'+vi]==='function') window['_tfmApplyVis'+vi](); });`);
    if(sortedTargets.length) inner.push(`        _optTargets.forEach(function(ti){ if(typeof window['_applyOpts_'+ti]==='function') window['_applyOpts_'+ti](false); });`);
    inner.push(`      }`);
    inner.push(`      function validateStep(n){`);
    inner.push(`        var ok=true;`);
    inner.push(`        if (typeof _reqFields!=='undefined') { _reqFields.forEach(function(rf){`);
    inner.push(`          if(!rf.activeOn()) return;`);
    inner.push(`          var _m=rf.name.match(/\\[(\\d+)\\]\\[value\\]$/); var _fi=_m?parseInt(_m[1]):-1;`);
    inner.push(`          if(_stepOf[_fi]===undefined||_stepOf[_fi]!==n) return;`);
    inner.push(`          var _el2=_getEl(rf.name); if(!_el2) return;`);
    inner.push(`          if(!_isVisible(_el2)) return;`);
    inner.push(`          if(_isEmpty(_el2)){ _showError(_el2,rf.msg); ok=false; }`);
    inner.push(`        }); }`);
    inner.push(`        if(n===0){ _pinnedFirst.forEach(function(_c){ var _empty=_c.type==='checkbox'?!_c.checked:((_c.value||'').trim()===''); if(_empty){ _flagCoreField(_c); ok=false; } }); }`);
    inner.push(`        if(n===TOTAL-1){ _pinnedLast.forEach(function(_c){ var _empty=_c.type==='checkbox'?!_c.checked:((_c.value||'').trim()===''); if(_empty){ _flagCoreField(_c); ok=false; } }); }`);
    inner.push(`        return ok;`);
    inner.push(`      }`);
    inner.push(`      var currentStep=0;`);
    inner.push(`      function goToStep(n){`);
    inner.push(`        if(n<0||n>=TOTAL) return;`);
    inner.push(`        currentStep=n;`);
    inner.push(`        var isLast=(n===TOTAL-1);`);
    inner.push(`        _order.forEach(function(i){`);
    inner.push(`          var w=_wraps[i];`);
    inner.push(`          if(_stepOf[i]!==n){ w.style.display='none'; }`);
    inner.push(`          else if(!_isManaged(i)){ w.style.display=''; }`);
    inner.push(`        });`);
    inner.push(`        _pinnedFirstWraps.forEach(function(w){ w.style.display = (n===0) ? '' : 'none'; });`);
    inner.push(`        _pinnedLastWraps.forEach(function(w){ w.style.display = (n===TOTAL-1) ? '' : 'none'; });`);
    inner.push(`        _reassert();`);
    inner.push(`        _order.forEach(function(i){ if(_isManaged(i) && _stepOf[i]!==n){ _wraps[i].style.display='none'; } });`);
    inner.push(`        fill.style.width=((n+1)/TOTAL*100)+'%';`);
    inner.push(`        metaEl.textContent='Step '+(n+1)+' of '+TOTAL;`);
    inner.push(`        titleEl.textContent = (_offset&&n===0) ? (_isSignupCtx?'Create your account':'Set your password') : (STEP_TITLES[n-_offset]||'');`);
    inner.push(`        for (var _d=0;_d<TOTAL;_d++){`);
    inner.push(`          dots[_d].classList.remove('active','done');`);
    inner.push(`          if(_d===n) dots[_d].classList.add('active'); else if(_d<n) dots[_d].classList.add('done');`);
    inner.push(`          if(_d<lines.length) lines[_d].classList.toggle('done', _d<n);`);
    inner.push(`        }`);
    inner.push(`        backBtn.style.display = n===0 ? 'none' : '';`);
    inner.push(`        nextBtn.style.display = isLast ? 'none' : '';`);
    inner.push(`        if(submitGroup) submitGroup.style.display = isLast ? '' : 'none';`);
    inner.push(`        if(typeof _checkAll==='function') _checkAll();`);
    inner.push(`      }`);
    inner.push(`      backBtn.addEventListener('click', function(){ goToStep(currentStep-1); });`);
    inner.push(`      nextBtn.addEventListener('click', function(){ if(!validateStep(currentStep)) return; goToStep(currentStep+1); });`);
    inner.push(`      function _stepHasError(n){`);
    inner.push(`        for (var _k=0;_k<_order.length;_k++){`);
    inner.push(`          var _fi2=_order[_k]; if(_stepOf[_fi2]!==n) continue;`);
    inner.push(`          var _em=_wraps[_fi2].querySelector('.form__error-msg');`);
    inner.push(`          if(_em && !_em.classList.contains('hidden') && _em.textContent && _em.textContent.trim()) return true;`);
    inner.push(`        }`);
    inner.push(`        if(n===0){ for(var _p=0;_p<_pinnedFirstWraps.length;_p++){ var _pe=_pinnedFirstWraps[_p].querySelector('.form__error-msg'); if(_pe && !_pe.classList.contains('hidden') && _pe.textContent && _pe.textContent.trim()) return true; } }`);
    inner.push(`        if(n===TOTAL-1){ for(var _q=0;_q<_pinnedLastWraps.length;_q++){ var _qe=_pinnedLastWraps[_q].querySelector('.form__error-msg'); if(_qe && !_qe.classList.contains('hidden') && _qe.textContent && _qe.textContent.trim()) return true; } }`);
    inner.push(`        return false;`);
    inner.push(`      }`);
    inner.push(`      var _initStep=0;`);
    inner.push(`      for (var _s2=0;_s2<TOTAL;_s2++){ if(_stepHasError(_s2)){ _initStep=_s2; break; } }`);
    inner.push(`      goToStep(_initStep);`);
    inner.push(`    })();`);
  }

  inner.push(`  });`);
  const lines=[`<script>`,
    `/* ===== Thinkific Field Modifier — generated script (BEGIN) =====`,
    `   Applies custom profile field behavior (required / hidden / read-only`,
    `   rules, field visibility & dependent-options conditionals, dropdown`,
    `   search and checkbox handling, and the optional multi-step wizard)`,
    `   across the Thinkific sign-up, checkout, and account pages. */`,
    `(function () {`];
  inner.forEach(l=>lines.push(l));
  lines.push(`})();`);
  lines.push(`/* ===== Thinkific Field Modifier — generated script (END) ===== */`);
  lines.push(`<\/script>`);
  const codeOutEl=document.getElementById('codeOut');
  codeOutEl.textContent=lines.join('\n');
  // Append style block if any styles are set
  const styleBlock=buildStyleBlock();
  if(styleBlock){
    codeOutEl.textContent+=styleBlock;
  }
  const msCssBlock=buildMultiStepCss();
  if(msCssBlock){
    codeOutEl.textContent+=msCssBlock;
  }
}

function buildMultiStepCss(){
  if(!(multiStep.enabled&&(multiStep.signup||multiStep.checkout)&&steps.length))return'';
  return `

<style>
/* Multi-step custom fields (Pages) */
.tfm-ms-header{margin:20px 0 18px}
.tfm-ms-track{height:4px;background:#e8eaf0;border-radius:2px;overflow:hidden}
.tfm-ms-fill{height:100%;background:#6366f1;transition:width .35s ease}
.tfm-ms-dots{display:flex;align-items:center;padding:14px 0 0}
.tfm-ms-dot{width:26px;height:26px;border-radius:50%;border:2px solid #d1d5db;background:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#9ca3af;flex-shrink:0;transition:all .2s ease}
.tfm-ms-dot.active,.tfm-ms-dot.done{border-color:#6366f1;background:#6366f1;color:#fff}
.tfm-ms-line{flex:1;height:2px;background:#d1d5db;transition:background .2s}
.tfm-ms-line.done{background:#6366f1}
.tfm-ms-meta{font-size:11px;font-weight:600;color:#6b7280;letter-spacing:.04em;text-transform:uppercase;margin:14px 0 4px}
.tfm-ms-title{font-size:18px;font-weight:600;margin-bottom:6px}
.tfm-ms-nav{display:flex;align-items:center;justify-content:space-between;margin:16px 0 20px;padding-top:16px;border-top:1px solid #e5e7eb}
.tfm-ms-back{background:transparent;border:none;color:#6b7280;font-size:14px;font-weight:600;cursor:pointer;padding:0;font-family:inherit}
.tfm-ms-back:hover{color:#111827}
.tfm-ms-next{background:#6366f1;color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}
.tfm-ms-next:hover{background:#5558e8}
</style>`;
}

function renderCodeEditor(){
  const el=document.getElementById('codeOut');
  const lineNums=document.getElementById('lineNums');
  if(!el)return;
  const code=(el.textContent||'').replace(/\n$/, ''); // strip trailing newline
  if(!code.trim())return;
  // Syntax highlight
  if(window.hljs){
    el.innerHTML=window.hljs.highlight(code,{language:'javascript'}).value;
  }
  // Count lines from highlighted HTML — each \n in the highlighted output = one line
  if(lineNums){
    // Count newlines in highlighted content to stay in sync
    const highlighted=el.innerHTML;
    const lineCount=(highlighted.match(/\n/g)||[]).length+1;
    lineNums.innerHTML=Array.from({length:lineCount},(_,i)=>`<span>${i+1}</span>`).join('');
  }
}

function buildStyleBlock(){
  const s=styleState;
  const rules=[];
  const inputProps=[];
  if(s.inputBg) inputProps.push(`background:${s.inputBg}`);
  if(s.inputColor) inputProps.push(`color:${s.inputColor}`);
  if(s.inputBorder) inputProps.push(`border-color:${s.inputBorder}`);
  if(s.inputRadius) inputProps.push(`border-radius:${s.inputRadius}`);
  if(s.inputFontSize) inputProps.push(`font-size:${s.inputFontSize}`);
  if(s.inputPadding) inputProps.push(`padding:${s.inputPadding}`);
  if(inputProps.length) rules.push(`.form__group input[type=text],.form__group input[type=date],.form__group input[type=month],.form__group select{${inputProps.join(';')}}`);
  const labelProps=[];
  if(s.labelColor) labelProps.push(`color:${s.labelColor}`);
  if(s.labelFontSize) labelProps.push(`font-size:${s.labelFontSize}`);
  if(s.labelWeight) labelProps.push(`font-weight:${s.labelWeight}`);
  if(labelProps.length) rules.push(`.form__group label{${labelProps.join(';')}}`);
  const btnProps=[];
  if(s.btnBg) btnProps.push(`background:${s.btnBg}!important`);
  if(s.btnColor) btnProps.push(`color:${s.btnColor}!important`);
  if(s.btnRadius) btnProps.push(`border-radius:${s.btnRadius}`);
  if(s.btnFontSize) btnProps.push(`font-size:${s.btnFontSize}`);
  if(btnProps.length) rules.push(`.button-primary{${btnProps.join(';')}}`);
  const roProps=[];
  if(s.roBg) roProps.push(`background:${s.roBg}`);
  if(s.roColor) roProps.push(`color:${s.roColor}`);
  if(s.roBorder) roProps.push(`border-color:${s.roBorder}`);
  if(s.roCursor) roProps.push(`cursor:${s.roCursor}`);
  if(roProps.length) rules.push(`.form__group input[readonly],.form__group input[disabled],.form__group select[disabled]{${roProps.join(';')}}`);
  if(!rules.length) return '';
  return '\n\n<style>\n/* Custom field styles */\n'+rules.join('\n')+'\n</style>';
}

function copyCode(){
  gen();
  navigator.clipboard.writeText(document.getElementById('codeOut').textContent).then(()=>{
    const btn=document.getElementById('btn-copyCode');
    btn.textContent='✓ Copied';
    setTimeout(()=>{btn.textContent='⎘ Copy';},2000);
  });
}

// ── Static button wiring ──
document.getElementById('btn-closeLimitations').addEventListener('click', closeLimitations);
document.getElementById('btn-copyLimitationsCss').addEventListener('click', copyLimitationsCss);
document.getElementById('btn-openExport').addEventListener('click', openExport);
document.getElementById('btn-openImport').addEventListener('click', openImport);
document.getElementById('btn-toggleTheme').addEventListener('click', toggleTheme);
document.getElementById('btn-closeExport').addEventListener('click', closeExport);
document.getElementById('btn-doExport').addEventListener('click', doExport);
document.getElementById('btn-closeImport').addEventListener('click', closeImport);
document.getElementById('btn-doImport').addEventListener('click', doImport);
document.getElementById('btn-copyCode').addEventListener('click', copyCode);
document.getElementById('btn-countDown').addEventListener('click', ()=>changeCount(-1));
document.getElementById('btn-countUp').addEventListener('click', ()=>changeCount(1));
document.getElementById('dropZone').addEventListener('click', ()=>document.getElementById('fileInput').click());
document.getElementById('fileInput').addEventListener('change', function(){ onFileChosen(this); });
document.querySelectorAll('.tab[data-tab]').forEach(btn=>{ btn.addEventListener('click', ()=>switchTab(btn.dataset.tab)); });
document.querySelectorAll('.sub-tab[data-subtab]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const t=btn.dataset.subtab;
    if(['visibility','dependent','groupvisibility'].includes(t)) switchCondSubTab(t);
    else if(['codeeditor','styleeditor'].includes(t)) switchCodeSubTab(t);
  });
});

// Style editor — sync color picker ↔ text input and update styleState
function wireStyleInput(colorId, textId, stateKey){
  const colorEl=document.getElementById(colorId);
  const textEl=document.getElementById(textId);
  if(!colorEl||!textEl)return;
  colorEl.addEventListener('input',()=>{ textEl.value=colorEl.value; styleState[stateKey]=colorEl.value; gen(); });
  textEl.addEventListener('change',()=>{ styleState[stateKey]=textEl.value; if(/^#[0-9a-f]{6}$/i.test(textEl.value)) colorEl.value=textEl.value; gen(); });
}
function wireStyleText(textId, stateKey){
  const el=document.getElementById(textId);
  if(!el)return;
  el.addEventListener('change',()=>{ styleState[stateKey]=el.value; gen(); });
}
wireStyleInput('style-input-bg','style-input-bg-text','inputBg');
wireStyleInput('style-input-color','style-input-color-text','inputColor');
wireStyleInput('style-input-border','style-input-border-text','inputBorder');
wireStyleText('style-input-radius','inputRadius');
wireStyleText('style-input-fontsize','inputFontSize');
wireStyleText('style-input-padding','inputPadding');
wireStyleInput('style-label-color','style-label-color-text','labelColor');
wireStyleText('style-label-fontsize','labelFontSize');
wireStyleText('style-label-weight','labelWeight');
wireStyleInput('style-btn-bg','style-btn-bg-text','btnBg');
wireStyleInput('style-btn-color','style-btn-color-text','btnColor');
wireStyleText('style-btn-radius','btnRadius');
wireStyleText('style-btn-fontsize','btnFontSize');

wireStyleInput('style-ro-bg','style-ro-bg-text','roBg');
wireStyleInput('style-ro-color','style-ro-color-text','roColor');
wireStyleInput('style-ro-border','style-ro-border-text','roBorder');
wireStyleText('style-ro-cursor','roCursor');

const clearStylesBtn=document.getElementById('btn-clearStyles');
if(clearStylesBtn) clearStylesBtn.addEventListener('click',()=>{
  Object.keys(styleState).forEach(k=>styleState[k]='');
  // Clear all inputs
  document.querySelectorAll('[id^="style-"]').forEach(el=>{ if(el.tagName==='INPUT') el.value=''; });
  gen();
});
const copyCode2Btn=document.getElementById('btn-copyCode2');
if(copyCode2Btn) copyCode2Btn.addEventListener('click',()=>copyCode());
document.querySelectorAll('[data-addrule]').forEach(btn=>{ btn.addEventListener('click', ()=>addRule(btn.dataset.addrule)); });
const dz=document.getElementById('dropZone');
dz.addEventListener('dragover', onDragOver);
dz.addEventListener('dragleave', onDragLeave);
dz.addEventListener('drop', onDrop);
document.addEventListener('keydown', function(e){
  if(e.key==='Enter'&&document.getElementById('exportModal').style.display!=='none'){doExport();}
  if(e.key==='Escape'){closeExport();closeImport();closeLimitations();}
});

// ── Init ──
applyTheme();
render();
renderRules();
renderSteps();
switchCondSubTab('visibility'); // set initial sub-tab
loadScanResults();
(function(){
  let dismissed=false;
  try{ dismissed=localStorage.getItem(LIMITATIONS_DISMISS_KEY)==='1'; }catch(e){/* localStorage unavailable — default to showing */}
  if(!dismissed) openLimitations();
})();

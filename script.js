(function(){
  // local testing uses your own computer; the deployed site uses your hosted backend
  var LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  var BASE = LOCAL ? 'http://localhost:8000' : '';  // on Vercel the API lives on the same site
  var API = BASE + '/api/analyze', CHAT = BASE + '/api/chat', IMG_API = BASE + '/api/analyze-image';
  var $ = function(i){return document.getElementById(i)};
  var d=$('desc'), res=$('result'), wel=$('welcome'), go=$('go');
  var imageInput=$('imageInput'), imageName=$('imageName');
  var S = null;        // state of the current check + conversation
  var timers = [];
  var mainEl = document.querySelector('main');   // the results area scrolls, not the page

  document.querySelectorAll('.ex').forEach(function(e){e.addEventListener('click',function(){d.value=e.dataset.t;d.focus()})});
  $('reset').addEventListener('click',function(){S=null;clearTimers();clearImage();res.hidden=true;res.innerHTML='';wel.hidden=false;d.value='';go.disabled=false;mainEl.scrollTop=0});
  d.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();run()}});
  go.addEventListener('click',run);

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  var COLOR={trustworthy:'var(--low)',verify:'var(--mid)',scam:'var(--high)',strong:'var(--low)',moderate:'var(--mid)',weak:'var(--high)',apply:'var(--low)',verify_then_apply:'var(--mid)',skip:'var(--high)'};
  var LABEL={trustworthy:'Looks trustworthy',verify:'Verify first',scam:'Likely scam',strong:'Strong',moderate:'Moderate',weak:'Weak',apply:'Apply',verify_then_apply:'Apply after verifying',skip:'Skip'};

  // ---------- image attachment ----------
  function clearImage(){
    imageInput.value='';
    imageName.hidden=true;
    imageName.textContent='';
  }

  imageInput.addEventListener('change',function(){
    var f=imageInput.files[0];
    if(!f){clearImage();return}
    if(f.size>8*1024*1024){
      clearImage();
      alert('Image must be smaller than 8 MB.');
      return;
    }
    imageName.textContent='Attached: '+f.name;
    imageName.hidden=false;
  });

  // ---------- small render helpers (all take RAW text; escaping happens inside) ----------
  // an item is {t: text, k: 'bad' | 'good' | 'note' | ''}
  function it(t,k){return {t:t,k:k||''}}
  function L(a,prefix,k){return (a||[]).map(function(x){return it((prefix||'')+x,k)})}
  function lis(items){
    return items.filter(function(x){return x&&x.t}).map(function(x){
      return '<li class="'+esc(x.k)+'">'+esc(x.t)+'</li>';
    }).join('');
  }

  // score card for the main view: shows only the first `max` items
  function card(title,score,level,items,max){
    var c=COLOR[level]||'var(--mid)';
    var shown=max?items.slice(0,max):items, extra=items.length-shown.length;
    return '<div class="card" style="--c:'+c+'"><header><b>'+esc(title)+'</b><span class="tag">'+esc(LABEL[level]||level)+'</span></header>'+
      '<div class="bar"><i style="width:'+Math.max(0,Math.min(100,score|0))+'%"></i></div><ul>'+lis(shown)+
      (extra>0?'<li class="note"><button type="button" class="expand">+'+extra+' more in the full analysis →</button></li>':'')+'</ul></div>';
  }

  // section for the "See more analysis" panel; groups = [{h: heading, items: [...]}]
  function sec(title,groups){
    var inner=groups.filter(function(g){return g.items&&g.items.length}).map(function(g){
      return (g.h?'<p class="sub">'+esc(g.h)+'</p>':'')+'<ul>'+lis(g.items)+'</ul>';
    }).join('');
    return inner?'<div class="card" style="--c:var(--accent)"><header><b>'+esc(title)+'</b></header>'+inner+'</div>':'';
  }

  function meta(k,v){return v&&v!=='Not stated'?'<span class="m"><small>'+k+'</small>'+esc(v)+'</span>':''}
  function safeUrl(u){return /^https?:\/\//i.test(u)?u:'#'}

  // ---------- network helpers ----------
  function errText(status,j){
    if(status===429) return 'Too many requests in a short time. Please wait a minute and try again.';
    var m=j&&(j.detail||j.error);
    return typeof m==='string'&&m?m:'Request failed';
  }
  function handle(r){
    return r.json().catch(function(){return {}}).then(function(j){
      if(!r.ok) throw new Error(errText(r.status,j));
      return j;
    });
  }
  function post(url,body){
    return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(handle);
  }
  // multipart upload (the browser sets the Content-Type boundary itself)
  function postForm(url,form){
    return fetch(url,{method:'POST',body:form}).then(handle);
  }

  // ---------- result rendering ----------
  function deepHtml(r){
    var rule=r.rule_flags||[];
    var ai=r.ai_red_flags||(r.red_flags||[]).filter(function(f){return rule.indexOf(f)<0});
    var n=r.source_count!=null?r.source_count:(r.sources||[]).length;

    var flags=sec('Warning signs and good signs',[
      {h:'Found by automated checks',items:L(rule,'⚠ ','bad')},
      {h:'Noted by AI',items:L(ai,'⚠ ','bad')},
      {h:'Good signs',items:L(r.green_flags,'✓ ','good')}
    ]);
    var verify=sec('Verify before you apply',[{items:L(r.verify_steps,'☐ ')}]);
    var fit=sec('Your fit',[
      {h:'You meet',items:L(r.requirements_met,'✓ ','good')},
      {h:'You may be missing',items:L(r.requirements_missing,'✗ ','bad')},
      {h:'Documents to prepare',items:L(r.documents_needed)}
    ]);
    var worth=sec('Worth pursuing',[
      {h:'Benefits',items:L(r.benefits)},
      {h:'Details',items:[it('Effort: '+r.effort),it('Cost to you: '+r.cost_to_student),it('Career value: '+r.career_value)]}
    ]);
    var srcList=(r.sources||[]).map(function(s){
      return '<li><a href="'+esc(safeUrl(s.url))+'" target="_blank" rel="noopener noreferrer">'+esc(s.title||s.url)+'</a></li>';
    }).join('');
    var sources='<div class="card src" style="--c:var(--accent)"><header><b>Web sources checked ('+n+')</b></header>'+
      (srcList?'<ul>'+srcList+'</ul>':'<ul><li class="note">No web sources were found for this post.</li></ul>')+'</div>';
    var fine='<p class="fine">AI checks can be wrong. Web results may be about a different organisation, so confirm on the official website.'+(r.cached?' (Saved result)':'')+'</p>';
    return flags+verify+fit+worth+sources+fine;
  }

  function render(text,r){
    var vc=COLOR[r.verdict]||'var(--mid)';
    var basics='<div class="meta">'+meta('Type',r.type)+meta('Organisation',r.organization)+meta('Deadline',r.deadline)+meta('Where',r.location_mode)+meta('Apply via',r.apply_link)+'</div>';

    // main view: short previews only
    var trust=L(r.red_flags,'⚠ ','bad').concat(L(r.green_flags,'✓ ','good')).concat(L(r.verify_steps,'Verify: '));
    if(!r.searched) trust.unshift(it('No web evidence was found, so this is based on the post only.','note'));
    var rel=L(r.requirements_met,'✓ ','good').concat(L(r.requirements_missing,'✗ ','bad'));
    if(!rel.length) rel=[it('No eligibility details found in the post.','note')];
    var worth=[it('Cost to you: '+r.cost_to_student),it('Effort: '+r.effort)].concat(L(r.benefits));
    var steps=(r.next_steps||[]).map(function(x){return '<li>'+esc(x)+'</li>'}).join('');

    var more='<button type="button" class="more" id="more" aria-expanded="false" aria-controls="deep"><span id="mlabel">See more analysis</span><span class="chev" aria-hidden="true">▾</span></button>'+
      '<div class="deep" id="deep" hidden>'+deepHtml(r)+'</div>';

    var follow=
      '<div class="card follow" style="--c:var(--accent)"><header><b>Ask me more</b></header>'+
      '<p class="sub">Answer these so I can tailor my advice</p><div class="qs" id="qs"></div>'+
      '<p class="sub" id="tpsub">Or get help with</p><div class="qs" id="tps"></div>'+
      '<div id="thread" aria-live="polite"></div>'+
      '<div class="fbox"><input type="text" id="fin" maxlength="1000" placeholder="Type your answer or a question…" aria-label="Your message" />'+
      '<button type="button" id="fsend" aria-label="Send">↑</button></div></div>';

    res.innerHTML='<div class="msg">'+esc(text)+'</div>'+
      '<div class="verdict" style="--vc:'+vc+'"><small>Overall</small><h2>'+esc(LABEL[r.verdict]||r.verdict)+'</h2><p>'+esc(r.verdict_reason)+'</p></div>'+
      basics+
      '<div class="cards">'+card('1 · Trust',r.trust_score,r.trust_level,trust,3)+card('2 · Relevance to you',r.match_score,r.match_level,rel,3)+card('3 · Worth pursuing',r.worth_score,r.worth_level,worth,3)+
      (steps?'<div class="card" style="--c:var(--accent)"><header><b>Next steps</b></header><ul>'+steps+'</ul></div>':'')+
      '</div>'+
      more+
      follow;
    initMore();
    initFollow(r);
  }

  function initMore(){
    var b=$('more'), panel=$('deep'), label=$('mlabel');
    function toggle(open){
      b.setAttribute('aria-expanded',String(open));
      panel.hidden=!open;
      label.textContent=open?'Hide analysis':'See more analysis';
    }
    b.addEventListener('click',function(){toggle(b.getAttribute('aria-expanded')!=='true')});
    document.querySelectorAll('.expand').forEach(function(x){
      x.addEventListener('click',function(){
        toggle(true);
        panel.scrollIntoView({behavior:'smooth',block:'start'});
      });
    });
  }

  // ---------- "ask me more" + follow-up chat ----------
  function summaryOf(r){
    return [
      'Verdict: '+(LABEL[r.verdict]||r.verdict)+'. '+(r.verdict_reason||''),
      'Trust: '+r.trust_score+'/100 ('+r.trust_level+'). Match: '+r.match_score+'/100. Worth: '+r.worth_score+'/100.',
      'Organisation: '+r.organization+'. Deadline: '+r.deadline+'. Cost to student: '+r.cost_to_student+'.',
      'Missing requirements: '+((r.requirements_missing||[]).join('; ')||'none')
    ].join('\n').slice(0,1400);
  }

  function bubble(cls,text){
    var t=$('thread'), b=document.createElement('div');
    b.className='bub '+cls; b.textContent=text; t.appendChild(b);
    b.scrollIntoView({block:'nearest',behavior:'smooth'});
    return b;
  }

  function addQuestions(list){
    var box=$('qs'); if(!box) return;
    list.forEach(function(q){
      var key=q.toLowerCase();
      if(S.shown.indexOf(key)>=0 || S.answered.indexOf(key)>=0) return;
      S.shown.push(key);
      var b=document.createElement('button');
      b.type='button'; b.className='qb'; b.textContent=q;
      b.addEventListener('click',function(){askQuestion(q,b)});
      box.appendChild(b);
    });
    var sub=box.previousElementSibling;
    if(sub) sub.hidden=!box.children.length;
  }

  function askQuestion(q,btn){
    if(S.busy) return;
    S.asked=q;
    var qb=bubble('bot ask','❓ '+q+'\nType your answer below ↓');
    qb.addEventListener('click',function(){var f=$('fin'); if(f){f.focus();f.scrollIntoView({block:'nearest',behavior:'smooth'})}});
    S.history.push({role:'assistant',content:q});
    if(btn&&btn.parentNode){var p=btn.parentNode;p.removeChild(btn);var sub=p.previousElementSibling;if(sub&&!p.children.length)sub.hidden=true}
    var fin=$('fin'); fin.placeholder='Type your answer…'; fin.focus();
  }

  function initFollow(r){
    addQuestions(r.missing_info||[]);
    var tps=$('tps');
    (r.topics||[]).forEach(function(t){
      var b=document.createElement('button');
      b.type='button'; b.className='tp'; b.textContent=t;
      b.addEventListener('click',function(){sendChat('Help me with: '+t)});
      tps.appendChild(b);
    });
    if(!(r.topics||[]).length) $('tpsub').hidden=true;
    $('fsend').addEventListener('click',function(){sendChat($('fin').value)});
    $('fin').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();sendChat($('fin').value)}});
  }

  function sendChat(text){
    text=(text||'').trim();
    if(!text||!S||S.busy) return;
    var current=S;                       // guard against "New check" during a request
    S.busy=true; $('fsend').disabled=true; $('fin').value='';
    bubble('me',text);
    var wait=bubble('bot wait','Thinking…');
    var r=S.result;
    post(CHAT,{
      message:text,
      post:S.text.slice(0,6000),
      summary:S.summary,
      field:$('field').value,
      level:$('level').value,
      asked:S.asked||'',
      trust_level:r.trust_level,
      verdict:r.verdict,
      red_flags:(r.red_flags||[]).slice(0,8),
      answered:S.answered.slice(-20),
      conversation_history:S.history.slice(-12)
    }).then(function(j){
      if(S!==current) return;
      wait.className='bub bot'; wait.textContent=j.reply;
      S.history.push({role:'user',content:text},{role:'assistant',content:j.reply});
      if(S.asked){S.answered.push(S.asked.toLowerCase());S.asked=''}
      addQuestions(j.questions||[]);
      $('fin').placeholder='Ask another question…';
    }).catch(function(e){
      if(S!==current) return;
      wait.className='bub bot err'; wait.textContent=e.message;
    }).finally(function(){
      if(S!==current) return;
      S.busy=false; var b=$('fsend'); if(b) b.disabled=false;
    });
  }

  // ---------- main check (text or image) ----------
  function clearTimers(){timers.forEach(clearTimeout);timers=[]}
  function stage(t){var el=$('ldt'); if(el) el.textContent=t}

  function run(){
    var t=d.value.trim();
    var file=imageInput.files[0];
    if(!file && t.length<20){d.focus();return}
    if(go.disabled) return;

    var shown=t||('📎 '+file.name);
    wel.hidden=true; res.hidden=false; go.disabled=true; S=null; clearTimers();
    res.innerHTML='<div class="msg">'+esc(shown)+'</div><div class="loading" role="status"><span class="spin"></span><span id="ldt">'+(file?'Reading the image…':'Searching the web…')+'</span></div>';
    timers.push(setTimeout(function(){stage('Reading the results and judging trust…')},6000));
    timers.push(setTimeout(function(){stage('Almost done…')},14000));
    mainEl.scrollTop=0;

    var req;
    if(file){
      var fd=new FormData();
      fd.append('image',file);
      fd.append('text',t);
      fd.append('field',$('field').value);
      fd.append('level',$('level').value);
      fd.append('kind',$('kind').value);
      req=postForm(IMG_API,fd);
    }else{
      req=post(API,{text:t,field:$('field').value,level:$('level').value,kind:$('kind').value});
    }

    req.then(function(j){
      // for image checks the backend returns the text it read from the image
      var postText=j.extracted_text||t;
      S={text:postText,result:j,summary:summaryOf(j),history:[],answered:[],shown:[],asked:'',busy:false};
      render(shown,j);
      d.value=''; clearImage();
    })
    .catch(function(e){
      var msg=e instanceof TypeError?'Cannot reach the backend at '+BASE+'. '+(LOCAL?'Start it with: python -m uvicorn main:app --reload':'It may be waking up or offline. Please try again in a minute.'):e.message;
      res.innerHTML='<div class="msg">'+esc(shown)+'</div><div class="verdict" style="--vc:var(--high)"><small>Error</small><h2>Could not check</h2><p>'+esc(msg)+'</p></div>';
    }).finally(function(){clearTimers();go.disabled=false});
  }
})();
/**
 * 手机伴侣页刻意做成单文件：它由 Electron 的局域网服务直接返回，
 * 不依赖开发服务器，也不会把桌面端 preload 或业务 bundle 暴露给手机。
 */
export const companionPageHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#0b0d10">
  <title>Vocue 手机伴侣</title>
  <style>
    :root { color-scheme: light dark; --bg:#f3f4f1; --surface:#fff; --subtle:#f7f8f5; --line:#dfe2dc; --fg:#171a18; --muted:#626a64; --faint:#8a928c; --accent:#246b4b; --accent-soft:#e7f3ec; --warn:#98620d; --danger:#b43a3a; --shadow:0 20px 50px rgba(20,28,23,.08); }
    @media (prefers-color-scheme: dark) { :root { --bg:#0b0d10; --surface:#14181b; --subtle:#101417; --line:#2b3135; --fg:#eef2ef; --muted:#aab3ad; --faint:#7f8982; --accent:#65c996; --accent-soft:#163326; --warn:#e2ad52; --danger:#ef7777; --shadow:0 22px 60px rgba(0,0,0,.3); } }
    * { box-sizing:border-box; }
    html { min-height:100%; background:var(--bg); }
    body { min-height:100%; margin:0; padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom); color:var(--fg); background:var(--bg); font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif; }
    button { font:inherit; }
    .shell { width:min(100%,720px); min-height:100vh; margin:0 auto; padding:24px 18px 36px; }
    header { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; margin-bottom:22px; }
    .brand { display:grid; gap:5px; }
    .eyebrow { color:var(--faint); font-size:11px; font-weight:700; letter-spacing:.14em; }
    h1 { margin:0; font-size:23px; letter-spacing:-.025em; }
    #preparation { color:var(--muted); font-size:13px; overflow-wrap:anywhere; }
    .status { flex:0 0 auto; display:flex; align-items:center; gap:7px; min-height:30px; padding:0 11px; border:1px solid var(--line); border-radius:999px; color:var(--muted); background:var(--surface); font-size:12px; }
    .dot { width:7px; height:7px; border-radius:50%; background:var(--faint); }
    .status.live .dot { background:var(--accent); box-shadow:0 0 0 4px var(--accent-soft); }
    .status.warn .dot { background:var(--warn); }
    .status.error .dot { background:var(--danger); }
    .welcome { min-height:58vh; display:grid; place-content:center; justify-items:center; gap:12px; color:var(--muted); text-align:center; }
    .welcome-mark { width:54px; height:54px; display:grid; place-items:center; border:1px solid var(--line); border-radius:18px; color:var(--accent); background:var(--surface); box-shadow:var(--shadow); font-size:23px; font-weight:700; }
    .welcome strong { color:var(--fg); font-size:17px; }
    .welcome p { max-width:320px; margin:0; font-size:13px; line-height:1.6; }
    .content { display:grid; gap:14px; }
    .card { overflow:hidden; border:1px solid var(--line); border-radius:18px; background:var(--surface); box-shadow:var(--shadow); }
    .card-head { min-height:48px; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 16px; border-bottom:1px solid var(--line); }
    .card-head strong { font-size:13px; }
    .card-head span { color:var(--faint); font-size:11px; }
    .card-body { padding:17px 16px 19px; }
    .question { min-height:68px; margin:0; color:var(--fg); font-size:16px; line-height:1.65; white-space:pre-wrap; overflow-wrap:anywhere; }
    .answer-summary { margin:0; color:var(--fg); font-size:15px; line-height:1.65; white-space:pre-wrap; overflow-wrap:anywhere; }
    details { margin-top:16px; padding-top:14px; border-top:1px solid var(--line); }
    summary { color:var(--accent); font-size:13px; font-weight:600; cursor:pointer; }
    .answer-detail { margin:13px 0 0; color:var(--muted); font-size:14px; line-height:1.72; white-space:pre-wrap; overflow-wrap:anywhere; }
    .placeholder { color:var(--faint); }
    .nav { display:flex; align-items:center; gap:7px; }
    .nav button { width:30px; height:30px; display:grid; place-items:center; padding:0; border:1px solid var(--line); border-radius:9px; color:var(--muted); background:var(--subtle); }
    .nav button:disabled { opacity:.35; }
    .nav-position { min-width:42px; color:var(--faint); font-size:11px; text-align:center; }
    .error-banner { padding:12px 14px; border:1px solid color-mix(in srgb,var(--danger) 35%,var(--line)); border-radius:13px; color:var(--danger); background:color-mix(in srgb,var(--danger) 9%,var(--surface)); font-size:12px; line-height:1.5; }
    [hidden] { display:none !important; }
    @media (min-width:600px) { .shell { padding:36px 24px 52px; } .content { gap:18px; } }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div class="brand"><span class="eyebrow">VOCUE COMPANION</span><h1>面试伴侣</h1><span id="preparation">等待连接</span></div>
      <div class="status" id="status"><span class="dot"></span><span id="statusText">正在连接</span></div>
    </header>
    <section class="welcome" id="welcome"><div class="welcome-mark">V</div><strong id="welcomeTitle">正在连接电脑</strong><p id="welcomeText">请确保手机与电脑处于同一个局域网。</p></section>
    <section class="content" id="content" hidden>
      <div class="error-banner" id="error" hidden></div>
      <article class="card">
        <div class="card-head"><strong>面试官</strong><span id="questionState">等待问题</span></div>
        <div class="card-body"><p class="question placeholder" id="question">等待问题…</p></div>
      </article>
      <article class="card">
        <div class="card-head"><strong>建议回答</strong><div class="nav" id="nav" hidden><button id="previous" aria-label="上一条">↑</button><span class="nav-position" id="position">最新</span><button id="next" aria-label="下一条">↓</button></div></div>
        <div class="card-body">
          <p class="answer-summary placeholder" id="summary">识别到问题后，建议回答会显示在这里。</p>
          <details id="detailWrap" hidden><summary>展开详细回答</summary><p class="answer-detail" id="detail"></p></details>
        </div>
      </article>
    </section>
  </main>
  <script>
    (() => {
      const elements = Object.fromEntries(['preparation','status','statusText','welcome','welcomeTitle','welcomeText','content','error','questionState','question','nav','previous','position','next','summary','detailWrap','detail'].map((id) => [id, document.getElementById(id)]));
      const labels = { idle:'等待开始', connecting:'正在连接', verifying:'正在检测', ready:'服务正常', listening:'正在聆听', recording:'录音中', finalizing:'正在识别', reconnecting:'正在重连', error:'出现问题' };
      let state = null;
      let answers = [];
      let viewIndex = null;
      let sessionStarted = false;
      let terminalMessage = '';
      let reconnectTimer = 0;

      function setConnection(label, tone) {
        elements.statusText.textContent = label;
        elements.status.className = 'status' + (tone ? ' ' + tone : '');
      }

      function render() {
        if (!state || state.status === 'idle') {
          elements.content.hidden = true;
          elements.welcome.hidden = false;
          elements.preparation.textContent = '手机只读显示';
          elements.welcomeTitle.textContent = terminalMessage || (sessionStarted ? '正在同步会话' : '已连接，等待电脑开始');
          elements.welcomeText.textContent = terminalMessage ? '可以关闭这个页面，新的面试需要重新扫码连接。' : sessionStarted ? '电脑正在重新准备当前会话。' : '请回到电脑完成档案与录音模式选择。';
          setConnection(terminalMessage ? '已关闭' : sessionStarted ? '同步中' : '等待开始', terminalMessage ? '' : 'live');
          return;
        }
        sessionStarted = true;
        elements.welcome.hidden = true;
        elements.content.hidden = false;
        elements.preparation.textContent = state.preparationName || '通用面试';
        setConnection(labels[state.status] || state.status, state.status === 'error' ? 'error' : state.status === 'reconnecting' ? 'warn' : 'live');
        elements.error.hidden = !state.error;
        elements.error.textContent = state.error || '';

        const live = viewIndex === null;
        const shown = live ? null : answers[Math.min(viewIndex, Math.max(answers.length - 1, 0))];
        const question = shown ? shown.question : state.partialTranscript || state.finalTranscript;
        const summary = shown ? shown.summary : state.answerSummary;
        const detail = shown ? shown.detail : state.answerDetail;
        elements.question.textContent = question || '等待问题…';
        elements.question.classList.toggle('placeholder', !question);
        elements.questionState.textContent = shown ? '历史问题' : state.partialTranscript ? '实时转写' : '当前问题';
        elements.summary.textContent = summary || (state.generating ? '正在组织回答…' : '识别到问题后，建议回答会显示在这里。');
        elements.summary.classList.toggle('placeholder', !summary);
        elements.detailWrap.hidden = !detail;
        elements.detail.textContent = detail || '';

        elements.nav.hidden = answers.length === 0;
        const effective = live ? answers.length : Math.min(viewIndex, answers.length - 1);
        elements.position.textContent = live ? '最新' : (effective + 1) + ' / ' + answers.length;
        elements.previous.disabled = answers.length === 0 || effective <= 0;
        elements.next.disabled = live;
      }

      elements.previous.addEventListener('click', () => {
        const at = viewIndex === null ? answers.length : viewIndex;
        viewIndex = Math.max(0, at - 1);
        render();
      });
      elements.next.addEventListener('click', () => {
        if (viewIndex === null) return;
        viewIndex = viewIndex + 1 >= answers.length ? null : viewIndex + 1;
        render();
      });

      function connect() {
        const token = location.hash.slice(1);
        if (!token) {
          elements.welcomeTitle.textContent = '连接地址无效';
          elements.welcomeText.textContent = '请回到电脑重新扫描二维码。';
          setConnection('无法连接', 'error');
          return;
        }
        const socket = new WebSocket('ws://' + location.host + '/ws?token=' + encodeURIComponent(token));
        socket.addEventListener('open', () => setConnection('已连接', 'live'));
        socket.addEventListener('message', (event) => {
          const message = JSON.parse(event.data);
          if (message.type === 'snapshot') { state = message.state; answers = message.answers; }
          if (message.type === 'state') state = message.state;
          if (message.type === 'answers') answers = message.answers;
          if (message.type === 'ended') { terminalMessage = '本场面试已结束'; state = { status:'idle' }; }
          if (message.type === 'closed') { terminalMessage = '手机伴侣已关闭'; state = { status:'idle' }; }
          render();
        });
        socket.addEventListener('close', () => {
          if (terminalMessage) return;
          setConnection('连接中断', 'warn');
          clearTimeout(reconnectTimer);
          reconnectTimer = window.setTimeout(connect, 1800);
        });
        socket.addEventListener('error', () => socket.close());
      }
      connect();
    })();
  </script>
</body>
</html>`

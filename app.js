/* =======================================================================
   20周年記念クイズ大会 — アプリ本体
   ※ 通常このファイルを編集する必要はありません。
     内容の変更は config.js で行えます。
   ======================================================================= */
(function () {
  "use strict";

  var TEAM_KEYS = Object.keys(CONFIG.teams);   // ["A","B",...,"J"]
  var QUESTIONS = CONFIG.questions;
  var N_Q = QUESTIONS.length;

  /* ---------------------------------------------------------------------
     データ保存層（store）
       ・Firebase設定があれば「オンライン集計モード」
       ・なければ「1台モード」（この端末の中だけで保存）
     どちらの場合も同じ関数で読み書きできるようにしてあります。
     --------------------------------------------------------------------- */
  var store = (function () {
    var mode = "local";
    var db = null;
    var listeners = [];       // 集計変更を受け取るコールバック
    var cache = { answers: {}, members: {} };  // { answers:{A:{0:2,1:0..}}, members:{A:{...}} }

    // --- ローカル保存の読み書き ---
    var LS_KEY = "quiz20_event";
    function loadLocal() {
      try {
        var raw = localStorage.getItem(LS_KEY);
        if (raw) cache = JSON.parse(raw);
      } catch (e) {}
      if (!cache.answers) cache.answers = {};
      if (!cache.members) cache.members = {};
    }
    function saveLocal() {
      try { localStorage.setItem(LS_KEY, JSON.stringify(cache)); } catch (e) {}
    }

    function hasFirebaseConfig() {
      var c = CONFIG.firebaseConfig || {};
      return !!(c.apiKey && c.databaseURL);
    }

    function init() {
      loadLocal();
      if (hasFirebaseConfig() && typeof firebase !== "undefined") {
        try {
          firebase.initializeApp(CONFIG.firebaseConfig);
          db = firebase.database();
          mode = "online";
          // 会場のWiFiが切れても回答を保持し、再接続時に自動送信する設定
          try { firebase.database().goOnline(); } catch (e) {}
          // /event を丸ごと監視して、変化があれば画面へ通知
          db.ref("event").on("value", function (snap) {
            var v = snap.val() || {};
            cache.answers = v.answers || {};
            cache.members = v.members || {};
            emit();
          });
          // 接続状態バッジ
          db.ref(".info/connected").on("value", function (s) {
            setConnBadge(s.val() ? "online" : "reconnect");
          });
        } catch (e) {
          console.warn("Firebase初期化に失敗したため、1台モードで動作します。", e);
          mode = "local";
        }
      }
      setConnBadge(mode === "online" ? "online" : "local");
    }

    function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

    return {
      init: init,
      get mode() { return mode; },
      onChange: function (fn) { listeners.push(fn); },

      // 回答を保存（team=チーム, qi=問題番号0〜, choice=選んだ番号0〜3）
      setAnswer: function (team, qi, choice) {
        if (!cache.answers[team]) cache.answers[team] = {};
        cache.answers[team][qi] = choice;
        saveLocal();                       // 常にこの端末にもバックアップ保存
        if (mode === "online" && db) {
          db.ref("event/answers/" + team + "/" + qi).set(choice);
        } else {
          emit();
        }
      },

      // メンバー出席情報を保存
      setMembers: function (team, data) {
        cache.members[team] = data;
        saveLocal();                       // 常にこの端末にもバックアップ保存
        if (mode === "online" && db) {
          db.ref("event/members/" + team).set(data);
        } else {
          emit();
        }
      },

      getAnswers: function () { return cache.answers || {}; },
      getMembers: function () { return cache.members || {}; },
      getTeamAnswers: function (team) { return (cache.answers && cache.answers[team]) || {}; },

      // 全データ消去（MCのリセット用）
      reset: function () {
        cache = { answers: {}, members: {} };
        saveLocal();
        if (mode === "online" && db) {
          db.ref("event").remove();
        } else {
          emit();
        }
      }
    };
  })();

  function setConnBadge(kind) {
    var el = document.getElementById("conn");
    if (!el) return;
    el.className = "conn";
    if (kind === "online") { el.classList.add("online"); el.textContent = "● オンライン集計中"; }
    else if (kind === "reconnect") { el.classList.add("local"); el.textContent = "● 再接続中…（回答は保持されます）"; }
    else { el.classList.add("local"); el.textContent = "● 1台モード（この端末のみ）"; }
  }

  /* ---------------------------------------------------------------------
     画面の状態（どの画面を表示しているか）
     --------------------------------------------------------------------- */
  var screen = "home";     // home / teamSelect / members / quiz / done / mc / result
  var current = {
    team: null,            // 担当チーム
    qi: 0,                 // いま回答中の問題番号
    selected: null,        // いま選択中の選択肢
    present: {},           // メンバー出席チェック { 名前: true }
    extras: []             // 自由記述で追加した人
  };

  var app = document.getElementById("app");

  // 画面下部の変化に応じてMC画面を自動更新
  store.onChange(function () {
    if (screen === "mc") renderMC();
    if (screen === "result") renderResult();
    if (screen === "teamSelect") renderTeamSelect();
  });

  /* ---------------------------------------------------------------------
     便利関数
     --------------------------------------------------------------------- */
  function el(html) {
    var d = document.createElement("div");
    d.innerHTML = html.trim();
    return d.firstChild;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function header() {
    return '<div class="header">' +
      '<div class="badge">' + esc(CONFIG.companyName) + ' 20th Anniversary</div>' +
      '<h1>' + esc(CONFIG.eventTitle) + '</h1>' +
      '<p>全' + N_Q + '問クイズ</p>' +
      '</div>';
  }
  // 1問分の回答が正解かどうか
  //   4択    … 番号が一致
  //   並び替え… 配列が順番どおり完全一致
  //   複数選択… 選んだ番号の集合が正解の集合と完全一致（順不同）
  function isCorrect(qi, ans) {
    var Q = QUESTIONS[qi];
    if (Q.type === "order") {
      if (!Array.isArray(ans) || ans.length !== Q.answer.length) return false;
      for (var i = 0; i < ans.length; i++) { if (ans[i] !== Q.answer[i]) return false; }
      return true;
    }
    if (Q.type === "multi") {
      if (!Array.isArray(ans) || ans.length !== Q.answer.length) return false;
      var a = ans.slice().sort();
      var b = Q.answer.slice().sort();
      for (var j = 0; j < a.length; j++) { if (a[j] !== b[j]) return false; }
      return true;
    }
    return ans === Q.answer;
  }
  function teamScore(team) {
    var ans = store.getTeamAnswers(team);
    var correct = 0, answered = 0;
    for (var i = 0; i < N_Q; i++) {
      if (ans[i] !== undefined && ans[i] !== null) {
        answered++;
        if (isCorrect(i, ans[i])) correct++;
      }
    }
    return { correct: correct, answered: answered };
  }

  /* =====================================================================
     画面①：ホーム（役割選択）
     ===================================================================== */
  function renderHome() {
    screen = "home";
    app.innerHTML = "";
    app.appendChild(el(header()));
    var c = el(
      '<div class="card">' +
        '<h2>役割を選んでください</h2>' +
        '<p class="sub">テーブル担当スタッフか、司会（結果画面）かを選びます。</p>' +
        '<button class="btn btn-primary role-btn" id="go-staff">👥 テーブル担当（スタッフ）<small>チームを選んで回答を送信します</small></button>' +
        '<button class="btn btn-secondary role-btn" id="go-mc">🎤 司会・結果画面（MC）<small>集計状況の確認・結果発表を行います</small></button>' +
        '<button class="btn btn-danger role-btn" id="go-sd">🔥 サドンデス<small>同率順位のタイブレークに使います</small></button>' +
      '</div>'
    );
    app.appendChild(c);
    if (store.mode === "local") {
      app.appendChild(el('<div class="note">現在は<b>1台モード</b>です（この端末の中だけで集計）。複数のスマホをまたいで自動集計するには config.js に Firebase 設定を入れてください。動作確認はこのままできます。</div>'));
    }
    document.getElementById("go-staff").onclick = renderTeamSelect;
    document.getElementById("go-mc").onclick = openMC;
    document.getElementById("go-sd").onclick = openSuddenDeath;
  }

  /* MC画面を開く（ロックがONなら合言葉画面へ） */
  function openMC() {
    var g = CONFIG.mcGate;
    if (g && g.enabled && g.buttons && g.buttons.length && g.answer) {
      renderMCGate();
    } else {
      renderMC();
    }
  }

  /* =====================================================================
     画面：司会用ロック（正解の動物ボタンを押すと入れる）
     ===================================================================== */
  function renderMCGate() {
    screen = "mcgate";
    var g = CONFIG.mcGate;
    app.innerHTML = "";
    app.appendChild(el(header()));

    var card = el(
      '<div class="card">' +
        '<h2>🔒 司会用ロック</h2>' +
        '<p class="sub">合言葉の動物ボタンを押すと、集計・結果画面に入れます。<br>（司会の方は、事前に聞いている動物を押してください）</p>' +
        '<div class="gate-grid" id="gate"></div>' +
        '<p class="gate-msg" id="gmsg">&nbsp;</p>' +
      '</div>'
    );
    app.appendChild(card);

    var grid = card.querySelector("#gate");
    var gmsg = card.querySelector("#gmsg");
    g.buttons.forEach(function (b) {
      var btn = el('<button class="gate-btn">' + esc(b) + '</button>');
      btn.onclick = function () {
        if (String(b) === String(g.answer)) {
          renderMC();
        } else {
          gmsg.textContent = "ちがうみたい…もう一度どうぞ";
          btn.classList.add("wrong");
          setTimeout(function () { btn.classList.remove("wrong"); }, 450);
        }
      };
      grid.appendChild(btn);
    });

    app.appendChild(el('<button class="btn btn-ghost mt" id="back">← 役割選択にもどる</button>'));
    document.getElementById("back").onclick = renderHome;
  }

  /* =====================================================================
     画面②：チーム選択（A〜J）
     ===================================================================== */
  function renderTeamSelect() {
    screen = "teamSelect";
    app.innerHTML = "";
    app.appendChild(el(header()));
    var card = el(
      '<div class="card">' +
        '<h2>担当チームを選択</h2>' +
        '<p class="sub">あなたのテーブルのチームをタップしてください。</p>' +
        '<div class="team-grid" id="grid"></div>' +
      '</div>'
    );
    app.appendChild(card);
    var grid = card.querySelector("#grid");
    TEAM_KEYS.forEach(function (t) {
      var s = teamScore(t);
      var answered = s.answered === N_Q;
      var cell = el(
        '<button class="team-cell' + (answered ? ' answered' : '') + '">' +
          '<span class="tletter">' + esc(t) + '</span>' +
          '<span class="tname">' + esc(t) + 'チーム' + (answered ? '（送信済）' : '') + '</span>' +
        '</button>'
      );
      cell.onclick = function () { chooseTeam(t); };
      grid.appendChild(cell);
    });
    app.appendChild(el('<button class="btn btn-ghost mt" id="back">← 役割選択にもどる</button>'));
    document.getElementById("back").onclick = renderHome;
  }

  function chooseTeam(t) {
    current.team = t;
    current.qi = 0;
    current.selected = null;
    // 保存済みのメンバー情報があれば復元
    var saved = store.getMembers()[t] || {};
    current.present = {};
    (CONFIG.teams[t] || []).forEach(function (name) {
      current.present[name] = saved.present ? saved.present.indexOf(name) >= 0 : false;
    });
    current.extras = (saved.extra || []).slice();
    renderMembers();
  }

  /* =====================================================================
     画面③：メンバー確認（出席チェック＋自由記述で追加）
     ===================================================================== */
  function renderMembers() {
    screen = "members";
    var t = current.team;
    var members = CONFIG.teams[t] || [];
    app.innerHTML = "";
    app.appendChild(el(header()));

    var card = el(
      '<div class="card">' +
        '<h2>' + esc(t) + 'チーム メンバー確認</h2>' +
        '<p class="sub">来ている人にチェックを入れてください。</p>' +
        '<div id="mlist"></div>' +
      '</div>'
    );
    var list = card.querySelector("#mlist");
    members.forEach(function (name, i) {
      var row = el(
        '<div class="member">' +
          '<input type="checkbox" id="m' + i + '"' + (current.present[name] ? ' checked' : '') + '>' +
          '<label for="m' + i + '">' + esc(name) + '</label>' +
        '</div>'
      );
      row.querySelector("input").onchange = function (e) { current.present[name] = e.target.checked; };
      list.appendChild(row);
    });
    app.appendChild(card);

    // 名簿にないメンバーを追加
    var extraCard = el(
      '<div class="card">' +
        '<h2>名簿にないメンバーを追加</h2>' +
        '<p class="sub">名簿に載っていない方がこのチームに参加している場合は、お名前を入力して追加してください。</p>' +
        '<div class="extra-row">' +
          '<input type="text" id="extra-input" placeholder="お名前を入力" autocomplete="off">' +
          '<button class="btn btn-secondary" id="extra-add" style="width:auto;min-width:88px;">追加</button>' +
        '</div>' +
        '<div class="chip-list" id="chips"></div>' +
      '</div>'
    );
    app.appendChild(extraCard);

    function renderChips() {
      var chips = extraCard.querySelector("#chips");
      chips.innerHTML = "";
      current.extras.forEach(function (name, idx) {
        var chip = el('<span class="chip">' + esc(name) + '<button aria-label="削除">×</button></span>');
        chip.querySelector("button").onclick = function () {
          current.extras.splice(idx, 1); renderChips();
        };
        chips.appendChild(chip);
      });
    }
    renderChips();

    var input = extraCard.querySelector("#extra-input");
    function addExtra() {
      var v = (input.value || "").trim();
      if (!v) return;
      current.extras.push(v);
      input.value = "";
      renderChips();
      input.focus();
    }
    extraCard.querySelector("#extra-add").onclick = addExtra;
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addExtra(); } });

    var actions = el(
      '<div class="btn-row">' +
        '<button class="btn btn-ghost" id="back">← もどる</button>' +
        '<button class="btn btn-primary" id="start">クイズをはじめる →</button>' +
      '</div>'
    );
    app.appendChild(actions);
    actions.querySelector("#back").onclick = renderTeamSelect;
    actions.querySelector("#start").onclick = function () {
      saveMembers();
      // すでに一部回答済みなら続きから、未回答なら最初から
      var ans = store.getTeamAnswers(t);
      var firstUnanswered = 0;
      for (var i = 0; i < N_Q; i++) { if (ans[i] === undefined || ans[i] === null) { firstUnanswered = i; break; } if (i === N_Q - 1) firstUnanswered = N_Q; }
      if (firstUnanswered >= N_Q) { renderDone(); } else { enterQuiz(firstUnanswered); }
    };
  }

  // 指定した問題番号に入る（保存済みの回答があれば current.selected に復元してから表示）
  function enterQuiz(qi) {
    current.qi = qi;
    var Q = QUESTIONS[qi];
    var ans = store.getTeamAnswers(current.team);
    if (Q.type === "order" || Q.type === "multi") {
      current.selected = Array.isArray(ans[qi]) ? ans[qi].slice() : [];
    } else {
      current.selected = (ans[qi] !== undefined && ans[qi] !== null) ? ans[qi] : null;
    }
    renderQuiz();
  }

  function saveMembers() {
    var present = [];
    Object.keys(current.present).forEach(function (name) { if (current.present[name]) present.push(name); });
    store.setMembers(current.team, { present: present, extra: current.extras.slice() });
  }

  /* =====================================================================
     画面④：クイズ回答（1問ずつ・4択）
     ===================================================================== */
  function renderQuiz() {
    screen = "quiz";
    var t = current.team;
    var qi = current.qi;
    var Q = QUESTIONS[qi];
    var isOrder = Q.type === "order";
    var isMulti = Q.type === "multi";
    var isOrderOrMulti = isOrder || isMulti;
    var ans = store.getTeamAnswers(t);
    // current.selected は enterQuiz() で初期化済み（ここでは再初期化しない。
    // タップのたびにこの関数を再実行するので、ここで作り直すと選択が消えてしまう）

    app.innerHTML = "";
    app.appendChild(el(header()));

    // 進捗ドット
    var dots = "";
    for (var i = 0; i < N_Q; i++) {
      var cls = "q-dot";
      if (ans[i] !== undefined && ans[i] !== null) cls += " done";
      if (i === qi) cls += " current";
      dots += '<span class="' + cls + '"></span>';
    }

    var choiceLetters = ["A", "B", "C", "D", "E", "F", "G", "H"];
    var choicesHtml = "";
    Q.choices.forEach(function (ch, idx) {
      var mark, sel;
      if (isOrder) {
        var pos = current.selected.indexOf(idx);
        sel = pos >= 0 ? " selected" : "";
        mark = pos >= 0 ? (pos + 1) : choiceLetters[idx];
      } else if (isMulti) {
        sel = current.selected.indexOf(idx) >= 0 ? " selected" : "";
        mark = choiceLetters[idx];
      } else {
        sel = current.selected === idx ? " selected" : "";
        mark = choiceLetters[idx];
      }
      choicesHtml +=
        '<button class="choice' + sel + '" data-idx="' + idx + '">' +
          '<span class="mark">' + mark + '</span>' +
          '<span>' + esc(ch) + '</span>' +
        '</button>';
    });

    var hint = "";
    if (isOrder) {
      hint = '<p class="sub">正しいと思う順番にタップしてください。もう一度タップすると、その選択を取り消せます。</p>';
    } else if (isMulti) {
      hint = '<p class="sub">' + Q.answer.length + 'つ選んでください（今の選択：' + current.selected.length + ' / ' + Q.answer.length + '）。もう一度タップすると、その選択を取り消せます。</p>';
    }

    var card = el(
      '<div class="card">' +
        '<div class="q-progress">' + dots + '</div>' +
        '<div class="q-num">' + esc(t) + 'チーム ／ 第' + (qi + 1) + '問（全' + N_Q + '問）</div>' +
        '<p class="q-text">' + esc(Q.q) + '</p>' +
        hint +
        '<div id="choices">' + choicesHtml + '</div>' +
      '</div>'
    );
    app.appendChild(card);

    var choiceEls = card.querySelectorAll(".choice");
    choiceEls.forEach(function (btn) {
      btn.onclick = function () {
        var idx = parseInt(btn.getAttribute("data-idx"), 10);
        if (isOrder) {
          var pos = current.selected.indexOf(idx);
          if (pos >= 0) { current.selected.splice(pos, 1); } else { current.selected.push(idx); }
          renderQuiz();   // 番号バッジを振り直すため再描画
        } else if (isMulti) {
          var mpos = current.selected.indexOf(idx);
          if (mpos >= 0) { current.selected.splice(mpos, 1); renderQuiz(); }
          else if (current.selected.length < Q.answer.length) { current.selected.push(idx); renderQuiz(); }
          // すでに選べる数に達している場合、未選択項目のタップは無視（先に選択解除が必要）
        } else {
          current.selected = idx;
          choiceEls.forEach(function (b) { b.classList.remove("selected"); });
          btn.classList.add("selected");
          sendBtn.disabled = false;
        }
      };
    });

    var canSend = isOrder ? (current.selected.length === Q.choices.length)
      : isMulti ? (current.selected.length === Q.answer.length)
      : (current.selected !== null);

    var actions = el(
      '<div class="btn-row">' +
        '<button class="btn btn-ghost" id="prev">' + (qi === 0 ? '← チーム' : '← 前の問題') + '</button>' +
        '<button class="btn btn-primary" id="send"' + (canSend ? '' : ' disabled') + '>' +
          (qi === N_Q - 1 ? 'この回答を送信して完了' : 'この回答を送信 →') +
        '</button>' +
      '</div>'
    );
    app.appendChild(actions);
    if (isOrderOrMulti && current.selected.length > 0) {
      var resetBtn = el('<button class="btn btn-ghost" id="clear-multi">選択をリセット</button>');
      app.appendChild(resetBtn);
      resetBtn.onclick = function () { current.selected = []; renderQuiz(); };
    }
    app.appendChild(el('<div class="note center">送信後も、最後の完了画面から前に戻って修正できます。</div>'));

    var sendBtn = actions.querySelector("#send");
    actions.querySelector("#prev").onclick = function () {
      if (qi === 0) { renderMembers(); }
      else { enterQuiz(qi - 1); }
    };
    sendBtn.onclick = function () {
      if (isOrderOrMulti) {
        var need = isOrder ? Q.choices.length : Q.answer.length;
        if (current.selected.length !== need) return;
        store.setAnswer(t, qi, current.selected.slice());
      } else {
        if (current.selected === null) return;
        store.setAnswer(t, qi, current.selected);
      }
      if (qi === N_Q - 1) { renderDone(); }
      else { enterQuiz(qi + 1); }
    };
  }

  /* =====================================================================
     画面⑤：回答完了（スタッフ側）
     ===================================================================== */
  function renderDone() {
    screen = "done";
    var t = current.team;
    var ans = store.getTeamAnswers(t);
    var choiceLetters = ["A", "B", "C", "D"];

    app.innerHTML = "";
    app.appendChild(el(header()));

    var rows = "";
    for (var i = 0; i < N_Q; i++) {
      var a = ans[i];
      var Qi = QUESTIONS[i];
      var label;
      if (a === undefined || a === null) {
        label = "<b style='color:#d23b3b'>未回答</b>";
      } else if (Qi.type === "order") {
        label = a.map(function (idx) { return esc(Qi.choices[idx]); }).join(" → ");
      } else if (Qi.type === "multi") {
        label = a.map(function (idx) { return esc(Qi.choices[idx]); }).join("・");
      } else {
        label = choiceLetters[a] + "：" + esc(Qi.choices[a]);
      }
      rows += '<div class="sent-row"><span class="qn">第' + (i + 1) + '問</span><span>' + label + '</span></div>';
    }

    var s = teamScore(t);
    var allDone = s.answered === N_Q;

    var card = el(
      '<div class="card">' +
        '<div class="done-hero">' +
          '<div class="big">' + (allDone ? '🎉' : '📝') + '</div>' +
          '<h2>' + esc(t) + 'チーム ' + (allDone ? '回答完了！' : '回答を保存しました') + '</h2>' +
          '<p class="sub">' + (allDone ? '全' + N_Q + '問の回答を送信しました。結果発表をお待ちください。' : 'まだ未回答の問題があります。') + '</p>' +
        '</div>' +
        '<div class="sent-list">' + rows + '</div>' +
      '</div>'
    );
    app.appendChild(card);

    var actions = el(
      '<div class="btn-row">' +
        '<button class="btn btn-secondary" id="edit">回答を修正する</button>' +
        '<button class="btn btn-ghost" id="home">最初の画面へ</button>' +
      '</div>'
    );
    app.appendChild(actions);
    actions.querySelector("#edit").onclick = function () { enterQuiz(0); };
    actions.querySelector("#home").onclick = renderHome;
  }

  /* =====================================================================
     画面⑥：MC 集計状況
     ===================================================================== */
  function renderMC() {
    screen = "mc";
    app.innerHTML = "";
    app.appendChild(el(header()));

    var rows = "";
    var answeredTeams = 0;
    TEAM_KEYS.forEach(function (t) {
      var s = teamScore(t);
      var pill, cls;
      if (s.answered === 0) { pill = "未回答"; cls = "wait"; }
      else if (s.answered < N_Q) { pill = "回答中 " + s.answered + "/" + N_Q; cls = "part"; }
      else { pill = "完了 " + N_Q + "/" + N_Q; cls = "done"; answeredTeams++; }
      rows +=
        '<tr>' +
          '<td><b>' + esc(t) + '</b>チーム</td>' +
          '<td><span class="pill ' + cls + '">' + pill + '</span></td>' +
          '<td class="cnt">' + s.answered + ' / ' + N_Q + '</td>' +
        '</tr>';
    });

    var card = el(
      '<div class="card">' +
        '<h2>集計状況</h2>' +
        '<p class="sub">各チームの回答送信状況です（自動で更新されます）。<br>完了：<b>' + answeredTeams + ' / ' + TEAM_KEYS.length + '</b> チーム</p>' +
        '<table class="status-table"><thead><tr><th>チーム</th><th>状況</th><th style="text-align:right;">回答数</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
      '</div>'
    );
    app.appendChild(card);

    var actions = el(
      '<div>' +
        '<button class="btn btn-primary" id="result">🏆 結果発表を表示する</button>' +
        '<div class="btn-row mt">' +
          '<button class="btn btn-ghost" id="home">← 役割選択</button>' +
          '<button class="btn btn-danger" id="reset">回答を全リセット</button>' +
        '</div>' +
      '</div>'
    );
    app.appendChild(actions);
    actions.querySelector("#result").onclick = renderResult;
    actions.querySelector("#home").onclick = renderHome;
    actions.querySelector("#reset").onclick = function () {
      if (confirm("すべてのチームの回答・メンバー情報を消去します。よろしいですか？\n（テスト後や、やり直しのときに使用します）")) {
        store.reset();
        renderMC();
      }
    };
  }

  /* =====================================================================
     画面⑦：結果発表（ランキング）
     ===================================================================== */
  function renderResult() {
    screen = "result";
    app.innerHTML = "";
    app.appendChild(el(header()));

    // 大画面（PC・全画面）で盛大に発表するボタン
    var grandBtn = el('<button class="btn btn-primary" id="grand" style="margin-bottom:14px;">🖥️ 大画面で盛大に発表（全画面）</button>');
    app.appendChild(grandBtn);
    grandBtn.onclick = renderGrandResult;

    // スコア計算 → 並べ替え（正解数の多い順、同点はチーム名順）
    var arr = TEAM_KEYS.map(function (t) {
      var s = teamScore(t);
      return { team: t, correct: s.correct, answered: s.answered };
    });
    arr.sort(function (a, b) {
      if (b.correct !== a.correct) return b.correct - a.correct;
      return a.team < b.team ? -1 : 1;
    });

    // 同点は同順位にする
    var medals = ["🥇", "🥈", "🥉"];
    var rankClass = ["gold", "silver", "bronze"];
    var html = "";
    var lastScore = null, lastRank = 0;
    arr.forEach(function (row, i) {
      var rank;
      if (row.correct === lastScore) { rank = lastRank; }
      else { rank = i + 1; lastRank = rank; lastScore = row.correct; }
      var cls = rank <= 3 ? rankClass[rank - 1] : "";
      var medal = rank <= 3 ? medals[rank - 1] : "";

      // 名簿のメンバー ＋ 当日追加した人（自由記述）を合わせて表示
      var savedM = store.getMembers()[row.team] || {};
      var extras = savedM.extra || [];
      var names = (CONFIG.teams[row.team] || []).slice().concat(extras);
      var memberItems = names.map(function (n) {
        return '<div class="m-item">' + esc(n) + '</div>';
      }).join("");

      html +=
        '<div class="rank-row ' + cls + '">' +
          '<div class="rank-head">' +
            (medal ? '<div class="medal">' + medal + '</div>' : '<div class="r-num">' + rank + '</div>') +
            '<div class="rt-letter">' + esc(row.team) + 'チーム</div>' +
            '<div class="r-score"><b>' + row.correct + '</b> / ' + N_Q + '問</div>' +
          '</div>' +
          (names.length ? '<div class="r-members-list">' + memberItems + '</div>' : '') +
        '</div>';
    });

    var card = el(
      '<div class="card">' +
        '<h2 class="center">🏆 結果発表 🏆</h2>' +
        '<p class="sub center">正解数の多い順のランキングです。</p>' +
        html +
      '</div>'
    );
    app.appendChild(card);

    app.appendChild(el('<button class="btn btn-secondary" id="back">← 集計状況にもどる</button>'));
    document.getElementById("back").onclick = renderMC;
  }

  /* =====================================================================
     画面⑧：大画面・結果発表（PC全画面用の盛大モード）
     ===================================================================== */

  // 順位を計算（同点は同順位）
  function computeRanking() {
    var arr = TEAM_KEYS.map(function (t) {
      var s = teamScore(t);
      return { team: t, correct: s.correct, answered: s.answered };
    });
    arr.sort(function (a, b) {
      if (b.correct !== a.correct) return b.correct - a.correct;
      return a.team < b.team ? -1 : 1;
    });
    var lastScore = null, lastRank = 0;
    arr.forEach(function (row, i) {
      if (row.correct === lastScore) { row.rank = lastRank; }
      else { row.rank = i + 1; lastRank = row.rank; lastScore = row.correct; }
    });
    return arr;
  }

  // チームのメンバー（名簿＋当日追加）
  function memberNames(team) {
    var savedM = store.getMembers()[team] || {};
    var extras = savedM.extra || [];
    return (CONFIG.teams[team] || []).slice().concat(extras);
  }

  // 大画面の共通の枠（背景・タイトル・紙吹雪・閉じる/もう一度ボタン）を作る
  function grandHead() {
    return '<div class="grand-head">' +
        '<div class="grand-badge">' + esc(CONFIG.companyName) + ' 20TH ANNIVERSARY</div>' +
        '<h1 class="grand-title"><span class="spark">✨</span> 🏆 結果発表 🏆 <span class="spark">✨</span></h1>' +
        '<p class="grand-sub">' + esc(CONFIG.eventTitle) + '</p>' +
      '</div>';
  }
  function openGrandStage(innerHtml) {
    var overlay = el(
      '<div class="grand-stage">' +
        '<canvas class="grand-confetti"></canvas>' +
        '<button class="grand-replay" id="g-replay">🔁 もう一度</button>' +
        '<button class="grand-close" id="g-close">✕ 閉じる</button>' +
        '<div class="grand-inner">' + innerHtml + '</div>' +
      '</div>'
    );
    document.body.appendChild(overlay);

    var confetti = startConfetti(overlay.querySelector(".grand-confetti"));
    try { if (overlay.requestFullscreen) overlay.requestFullscreen(); } catch (e) {}

    function closeGrand() {
      try { confetti.stop(); } catch (e) {}
      try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
      document.removeEventListener("keydown", onKey);
      overlay.remove();
    }
    function replay() {
      var nodes = overlay.querySelectorAll(".podium-card,.podium-bar,.podium-tie,.grand-rest-row,.grand-title,.grand-sub,.grand-msg-card");
      nodes.forEach(function (n) { n.style.animation = "none"; void n.offsetWidth; n.style.animation = ""; });
      try { confetti.burst(); } catch (e) {}
    }
    function onKey(e) { if (e.key === "Escape") closeGrand(); }

    overlay.querySelector("#g-close").onclick = closeGrand;
    overlay.querySelector("#g-replay").onclick = replay;
    document.addEventListener("keydown", onKey);
    return overlay;
  }

  function renderGrandResult() {
    var ranking = computeRanking();
    var medals = { 1: "🥇", 2: "🥈", 3: "🥉" };

    // --- ① まだ誰も回答していない場合：崩れた表彰台ではなく案内を出す ---
    var anyAnswered = ranking.some(function (r) { return r.answered > 0; });
    if (!anyAnswered) {
      openGrandStage(grandHead() +
        '<div class="grand-msg-card">' +
          '<div class="grand-msg-emoji">🏁</div>' +
          '<h2>結果発表は これから！</h2>' +
          '<p>まだ回答が集まっていません。<br>各チームの回答が届くと、ここに盛大な結果が表示されます。</p>' +
        '</div>');
      return;
    }

    // --- ② 全チームが同じ点数（＝順位がつかない）場合：大接戦として表示 ---
    var allSame = ranking.every(function (r) { return r.correct === ranking[0].correct; });
    if (allSame) {
      var chips = ranking.map(function (r) {
        return '<span class="tie-all-chip">' + esc(r.team) + 'チーム</span>';
      }).join("");
      openGrandStage(grandHead() +
        '<div class="grand-msg-card">' +
          '<div class="grand-msg-emoji">🎉</div>' +
          '<h2>全チーム 同点！</h2>' +
          '<p>全' + ranking.length + 'チームが <b>' + ranking[0].correct + ' / ' + N_Q + '問</b>正解の大接戦でした！</p>' +
          '<div class="tie-all">' + chips + '</div>' +
        '</div>');
      return;
    }

    // --- ③ 通常：表彰台（同率順位もきれいに扱う） ---
    var rest = ranking.filter(function (r) { return r.rank > 3; });

    function teamCard(row, isFirst) {
      var names = memberNames(row.team);
      var crown = isFirst ? '<div class="podium-crown">👑</div>' : "";
      return '<div class="podium-card">' +
          crown +
          '<div class="podium-medal">' + (medals[row.rank] || ("#" + row.rank)) + '</div>' +
          '<div class="podium-team">' + esc(row.team) + 'チーム</div>' +
          '<div class="podium-score"><b>' + row.correct + '</b>/ ' + N_Q + '問</div>' +
          (names.length ? '<div class="podium-members">' + names.map(esc).join(" ・ ") + '</div>' : "") +
        '</div>';
    }

    var delays = { 1: 0.55, 2: 0.25, 3: 0.10 };
    var clsByRank = { 1: "first", 2: "second", 3: "third" };
    var podiumHtml = "";
    [2, 1, 3].forEach(function (rk) {
      var group = ranking.filter(function (r) { return r.rank === rk; });
      if (!group.length) return;   // 同率で抜けた順位は台を作らない
      var cards = group.map(function (r) { return teamCard(r, rk === 1); }).join("");
      var tie = group.length > 1
        ? '<div class="podium-tie">🎉 同率' + rk + '位（' + group.length + 'チーム）</div>'
        : "";
      podiumHtml +=
        '<div class="podium-col ' + clsByRank[rk] + '" style="--d:' + delays[rk] + 's">' +
          tie +
          '<div class="podium-cards">' + cards + '</div>' +
          '<div class="podium-bar">' + rk + '</div>' +
        '</div>';
    });

    var restHtml = rest.map(function (row, idx) {
      return '<div class="grand-rest-row" style="animation-delay:' + (0.7 + idx * 0.08) + 's">' +
          '<div class="gr-rank">' + row.rank + '位</div>' +
          '<div class="gr-team">' + esc(row.team) + 'チーム</div>' +
          '<div class="gr-score"><b>' + row.correct + '</b> / ' + N_Q + '問</div>' +
        '</div>';
    }).join("");

    openGrandStage(grandHead() +
      '<div class="podium">' + podiumHtml + '</div>' +
      (rest.length ? '<div class="grand-rest">' + restHtml + '</div>' : ''));
  }

  /* =====================================================================
     画面⑨：サドンデス（同率順位のタイブレーク）
       ① 対象チームを選ぶ → ② 各チームの回答（数値）を入力 → ③ 判定
       ※ この機能は各端末の中だけで完結し、Firebase には保存しません
         （司会・進行役の端末で、その場で使うための機能です）。
     ===================================================================== */
  var sd = { teams: [], answers: {}, autoDetected: false };

  // 現在の集計から同率チームを検出する（1位の同率はじゃんけんで決める運用のため対象外。
  // 1位が確定した上で一番上位に同率がある組を優先して返す）
  function detectTieTeams() {
    var ranking = computeRanking();
    var byRank = {};
    ranking.forEach(function (r) {
      if (!byRank[r.rank]) byRank[r.rank] = [];
      byRank[r.rank].push(r.team);
    });
    var tieRanks = Object.keys(byRank)
      .map(Number)
      .filter(function (rk) { return rk !== 1 && byRank[rk].length > 1; })
      .sort(function (a, b) { return a - b; });
    return tieRanks.length ? byRank[tieRanks[0]] : [];
  }

  // ホーム画面から「🔥 サドンデス」で入るときの入口：自動検出した同率チームを選択済みにする
  function openSuddenDeath() {
    sd.teams = detectTieTeams();
    sd.autoDetected = sd.teams.length > 0;
    sd.answers = {};
    renderSDTeams();
  }

  function renderSDTeams() {
    screen = "sdTeams";
    app.innerHTML = "";
    app.appendChild(el(header()));

    var hint = sd.autoDetected
      ? '<p class="sub">集計結果から、同率になっているチーム（' + sd.teams.map(function (t) { return esc(t) + 'チーム'; }).join('・') + '）を自動で選択しました。必要に応じてタップで追加・解除できます。</p>'
      : '<p class="sub">同率になったチームをすべてタップしてください（2チーム以上）。</p>';

    var card = el(
      '<div class="card">' +
        '<h2>🔥 サドンデス：対象チームを選択</h2>' +
        hint +
        '<div class="team-grid" id="grid"></div>' +
      '</div>'
    );
    app.appendChild(card);

    var grid = card.querySelector("#grid");
    TEAM_KEYS.forEach(function (t) {
      var sel = sd.teams.indexOf(t) >= 0;
      var cell = el(
        '<button class="team-cell' + (sel ? ' selected' : '') + '">' +
          '<span class="tletter">' + esc(t) + '</span>' +
          '<span class="tname">' + esc(t) + 'チーム</span>' +
        '</button>'
      );
      cell.onclick = function () {
        var pos = sd.teams.indexOf(t);
        if (pos >= 0) { sd.teams.splice(pos, 1); } else { sd.teams.push(t); }
        sd.autoDetected = false;
        renderSDTeams();
      };
      grid.appendChild(cell);
    });

    var actions = el(
      '<div class="btn-row mt">' +
        '<button class="btn btn-ghost" id="back">← 役割選択にもどる</button>' +
        '<button class="btn btn-primary" id="next"' + (sd.teams.length < 2 ? ' disabled' : '') + '>次へ →</button>' +
      '</div>'
    );
    app.appendChild(actions);
    actions.querySelector("#back").onclick = function () { sd.teams = []; renderHome(); };
    actions.querySelector("#next").onclick = function () {
      if (sd.teams.length < 2) return;
      var prev = sd.answers;
      sd.answers = {};
      sd.teams.forEach(function (t) { sd.answers[t] = prev[t] || ""; });
      renderSDAnswer();
    };
  }

  function renderSDAnswer() {
    screen = "sdAnswer";
    var Q = CONFIG.suddenDeath;
    app.innerHTML = "";
    app.appendChild(el(header()));

    if (!Q || Q.answer === undefined || Q.answer === null) {
      app.appendChild(el(
        '<div class="card"><h2>🔥 サドンデス</h2>' +
          '<p class="sub">config.js に suddenDeath（サドンデス問題）が設定されていません。</p></div>'
      ));
      app.appendChild(el('<button class="btn btn-ghost" id="back">← もどる</button>'));
      document.getElementById("back").onclick = renderSDTeams;
      return;
    }

    var rowsHtml = "";
    sd.teams.forEach(function (t) {
      rowsHtml +=
        '<div class="sd-row">' +
          '<span class="sd-label">' + esc(t) + 'チーム</span>' +
          '<input type="number" inputmode="decimal" data-team="' + esc(t) + '" value="' + esc(sd.answers[t] || "") + '" placeholder="回答の数値">' +
        '</div>';
    });

    var card = el(
      '<div class="card">' +
        '<h2>🔥 サドンデス問題</h2>' +
        '<p class="q-text">' + esc(Q.q) + '</p>' +
        '<p class="sub">各チームの回答（数値）を入力し、「判定する」を押してください。正解に一番近いチームの勝ちです。</p>' +
        rowsHtml +
      '</div>'
    );
    app.appendChild(card);

    card.querySelectorAll("input[type=number]").forEach(function (input) {
      input.oninput = function () { sd.answers[input.getAttribute("data-team")] = input.value; };
    });

    var actions = el(
      '<div class="btn-row mt">' +
        '<button class="btn btn-ghost" id="back">← チーム選択にもどる</button>' +
        '<button class="btn btn-primary" id="judge">判定する</button>' +
      '</div>'
    );
    app.appendChild(actions);
    actions.querySelector("#back").onclick = renderSDTeams;
    actions.querySelector("#judge").onclick = renderSDResult;
  }

  function renderSDResult() {
    screen = "sdResult";
    var Q = CONFIG.suddenDeath;

    var rows = sd.teams.map(function (t) {
      var raw = sd.answers[t];
      var v = parseFloat(raw);
      var valid = raw !== "" && !isNaN(v);
      return { team: t, value: valid ? v : null, diff: valid ? Math.abs(v - Q.answer) : Infinity };
    });
    rows.sort(function (a, b) { return a.diff - b.diff; });
    var topDiff = (rows.length && rows[0].value !== null) ? rows[0].diff : null;

    app.innerHTML = "";
    app.appendChild(el(header()));

    var rowsHtml = rows.map(function (r) {
      var isWinner = topDiff !== null && r.diff === topDiff;
      var label = r.value === null ? "未入力" : r.value;
      return '<div class="sd-result-row' + (isWinner ? ' winner' : '') + '">' +
          '<span>' + (isWinner ? '🏆 ' : '') + esc(r.team) + 'チーム</span>' +
          '<span>回答：' + esc(label) + '</span>' +
        '</div>';
    }).join("");

    var card = el(
      '<div class="card">' +
        '<h2>🔥 サドンデス結果</h2>' +
        '<p class="sub">正解：' + esc(Q.answer) + ' ／ 正解に近い順に表示しています。</p>' +
        rowsHtml +
      '</div>'
    );
    app.appendChild(card);

    var actions = el(
      '<div class="btn-row mt">' +
        '<button class="btn btn-secondary" id="redo">チーム選択からやり直す</button>' +
        '<button class="btn btn-ghost" id="home">最初の画面へ</button>' +
      '</div>'
    );
    app.appendChild(actions);
    actions.querySelector("#redo").onclick = openSuddenDeath;
    actions.querySelector("#home").onclick = function () { sd.teams = []; sd.answers = {}; renderHome(); };
  }

  // 紙吹雪（外部ライブラリ不要・キャンバスで描画）
  function startConfetti(canvas) {
    var ctx = canvas.getContext("2d");
    var colors = ["#ffd54a", "#e8b423", "#2a8bea", "#1471c9", "#ffffff", "#7ec8ff", "#ff8fb8", "#8affc1"];
    var pieces = [];
    var running = true;

    function resize() {
      canvas.width = canvas.clientWidth || window.innerWidth;
      canvas.height = canvas.clientHeight || window.innerHeight;
    }
    function make(fromTop) {
      return {
        x: Math.random() * canvas.width,
        y: fromTop ? (-20 - Math.random() * canvas.height) : (Math.random() * canvas.height),
        w: 6 + Math.random() * 8,
        h: 9 + Math.random() * 12,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * 6.28,
        vr: -0.12 + Math.random() * 0.24,
        vy: 1.4 + Math.random() * 3.2,
        vx: -1 + Math.random() * 2,
        sway: Math.random() * 6.28
      };
    }
    resize();
    for (var i = 0; i < 170; i++) pieces.push(make(true));
    window.addEventListener("resize", resize);

    function frame() {
      if (!running) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (var i = 0; i < pieces.length; i++) {
        var p = pieces[i];
        p.y += p.vy; p.x += p.vx + Math.sin(p.sway) * 1.1; p.sway += 0.03; p.rot += p.vr;
        if (p.y > canvas.height + 24) { p.y = -20; p.x = Math.random() * canvas.width; }
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return {
      stop: function () { running = false; window.removeEventListener("resize", resize); },
      burst: function () { for (var i = 0; i < 60; i++) pieces.push(make(true)); if (pieces.length > 320) pieces.splice(0, pieces.length - 320); }
    };
  }

  /* ---------------------------------------------------------------------
     起動
     --------------------------------------------------------------------- */
  store.init();
  renderHome();

})();

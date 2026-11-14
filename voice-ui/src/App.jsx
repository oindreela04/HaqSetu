import React, { useCallback, useEffect, useRef, useState } from 'react';

const csrf = () => (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const STORE = 'haqsetu.voice.v1';

const UI = {
  en: { title: 'Ask HaqSetu', sub: 'Speak or type in your language. I will ask one question at a time and check real schemes for you.', placeholder: 'Type here, or tap the mic and speak…', send: 'Send', listen: 'Tap to speak', stopListen: 'Stop', thinking: 'Checking schemes…', listening: 'Listening…', transcribing: 'Converting speech to text…', speaking: 'Speaking…', stop: 'Stop audio', replay: 'Replay', mute: 'Mute', unmute: 'Unmute', textOnly: 'Text only', reset: 'Start again', edit: 'You can correct the text before sending.', yesSave: 'Yes, save to my profile', noSave: 'No, don\'t save', loginToSave: 'Log in to save these details to a profile.', eligible: 'Potentially eligible', more: 'Need more information', why: 'Why', docs: 'Documents', official: 'Official website', apply: 'Apply officially', unverified: 'Awaiting verification', noVoice: 'Your device has no voice for this language, so replies are shown as text.', noMic: 'Speech input is not available in this browser for this language. Please type instead.', micDenied: 'Microphone permission was denied. You can type instead.', noSpeech: 'I didn\'t hear anything. Try again or type.', details: 'Details', language: 'Language', privacy: 'Privacy: recordings are not stored. Browser speech recognition is processed by your browser\'s speech service (for example Google in Chrome).', saved: 'Saved to your profile.' },
  hi: { title: 'हकसेतु से पूछें', sub: 'अपनी भाषा में बोलें या लिखें। मैं एक-एक करके सवाल पूछूँगा और असली योजनाओं की जाँच करूँगा।', placeholder: 'यहाँ लिखें, या माइक दबाकर बोलें…', send: 'भेजें', listen: 'बोलने के लिए दबाएँ', stopListen: 'रोकें', thinking: 'योजनाएँ जाँची जा रही हैं…', listening: 'सुन रहा हूँ…', transcribing: 'आवाज़ को लिखा जा रहा है…', speaking: 'बोल रहा हूँ…', stop: 'आवाज़ रोकें', replay: 'फिर से सुनें', mute: 'म्यूट', unmute: 'आवाज़ चालू', textOnly: 'केवल लिखित', reset: 'फिर से शुरू', edit: 'भेजने से पहले आप लिखा हुआ सुधार सकते हैं।', yesSave: 'हाँ, प्रोफ़ाइल में सहेजें', noSave: 'नहीं, न सहेजें', loginToSave: 'यह जानकारी सहेजने के लिए लॉग इन करें।', eligible: 'संभावित रूप से पात्र', more: 'और जानकारी चाहिए', why: 'क्यों', docs: 'दस्तावेज़', official: 'आधिकारिक वेबसाइट', apply: 'आधिकारिक आवेदन', unverified: 'सत्यापन बाकी', noVoice: 'आपके डिवाइस में इस भाषा की आवाज़ नहीं है, इसलिए जवाब लिखित में दिखेंगे।', noMic: 'इस ब्राउज़र में इस भाषा के लिए बोलकर लिखना उपलब्ध नहीं है। कृपया टाइप करें।', micDenied: 'माइक की अनुमति नहीं मिली। आप टाइप कर सकते हैं।', noSpeech: 'मुझे कुछ सुनाई नहीं दिया। फिर से बोलें या टाइप करें।', details: 'विवरण', language: 'भाषा', privacy: 'गोपनीयता: रिकॉर्डिंग सहेजी नहीं जाती। ब्राउज़र की वाक्-पहचान आपके ब्राउज़र की सेवा (जैसे Chrome में Google) द्वारा होती है।', saved: 'प्रोफ़ाइल में सहेज दिया गया।' },
  bn: { title: 'হকসেতুকে জিজ্ঞাসা করুন', sub: 'নিজের ভাষায় বলুন বা লিখুন। আমি একটি করে প্রশ্ন করব এবং আসল প্রকল্প যাচাই করব।', placeholder: 'এখানে লিখুন, বা মাইক চেপে বলুন…', send: 'পাঠান', listen: 'বলতে চাপুন', stopListen: 'থামান', thinking: 'প্রকল্প যাচাই হচ্ছে…', listening: 'শুনছি…', transcribing: 'কথা লেখায় রূপান্তর হচ্ছে…', speaking: 'বলছি…', stop: 'অডিও থামান', replay: 'আবার শুনুন', mute: 'মিউট', unmute: 'আওয়াজ চালু', textOnly: 'শুধু লেখা', reset: 'আবার শুরু', edit: 'পাঠানোর আগে লেখা ঠিক করে নিতে পারেন।', yesSave: 'হ্যাঁ, প্রোফাইলে রাখুন', noSave: 'না, রাখবেন না', loginToSave: 'এই তথ্য সংরক্ষণ করতে লগ ইন করুন।', eligible: 'সম্ভাব্য যোগ্য', more: 'আরও তথ্য প্রয়োজন', why: 'কেন', docs: 'নথি', official: 'সরকারি ওয়েবসাইট', apply: 'সরকারি আবেদন', unverified: 'যাচাই বাকি', noVoice: 'আপনার ডিভাইসে এই ভাষার কণ্ঠ নেই, তাই উত্তর লেখায় দেখানো হবে।', noMic: 'এই ব্রাউজারে এই ভাষায় বলে লেখা উপলব্ধ নয়। দয়া করে টাইপ করুন।', micDenied: 'মাইকের অনুমতি পাওয়া যায়নি। আপনি টাইপ করতে পারেন।', noSpeech: 'কিছু শুনতে পাইনি। আবার বলুন বা টাইপ করুন।', details: 'বিস্তারিত', language: 'ভাষা', privacy: 'গোপনীয়তা: রেকর্ডিং সংরক্ষণ করা হয় না। ব্রাউজারের কথা-চেনা আপনার ব্রাউজারের পরিষেবা (যেমন Chrome-এ Google) দিয়ে হয়।', saved: 'প্রোফাইলে সংরক্ষিত হয়েছে।' },
};

async function api(path, { method = 'POST', json, body, timeout = 45000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(path, {
      method, credentials: 'same-origin', signal: ctrl.signal,
      headers: { 'x-csrf-token': csrf(), ...(json ? { 'content-type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : body,
    });
    const ct = r.headers.get('content-type') || '';
    if (ct.startsWith('audio/')) return { ok: r.ok, blob: await r.blob() };
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } finally { clearTimeout(t); }
}

function speakable(text) {
  return (text || '').replace(/https?:\/\/\S+/g, '').replace(/[—•]/g, ', ').trim();
}

export default function App({ siteLang, loggedIn }) {
  const [caps, setCaps] = useState(null);
  const [capsError, setCapsError] = useState('');
  const [lang, setLang] = useState(siteLang);
  const [messages, setMessages] = useState(() => { try { return JSON.parse(sessionStorage.getItem(STORE) || 'null')?.messages || []; } catch { return []; } });
  const [input, setInput] = useState('');
  const [interim, setInterim] = useState('');
  const [status, setStatus] = useState('idle');
  const [muted, setMuted] = useState(false);
  const [textOnly, setTextOnly] = useState(false);
  const [notice, setNotice] = useState('');
  const [lastSpoken, setLastSpoken] = useState(null);
  const recRef = useRef(null);
  const mediaRef = useRef(null);
  const audioRef = useRef(null);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const L = UI[lang] || UI.en;
  const langInfo = caps?.languages?.find((l) => l.code === lang);
  const speechTag = langInfo?.speech_tag || 'en-IN';

  useEffect(() => { try { sessionStorage.setItem(STORE, JSON.stringify({ messages: messages.slice(-40) })); } catch { /* storage unavailable */ } }, [messages]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, status]);

  useEffect(() => {
    (async () => {
      try {
        const r = await api('/voice-api/capabilities', { method: 'GET', timeout: 12000 });
        if (!r.ok) throw new Error(r.data?.error || 'unavailable');
        setCaps(r.data);
        if (!r.data.languages.some((l) => l.code === siteLang)) setLang('en');
      } catch (e) { setCapsError(e.message === 'unavailable' || e.name === 'AbortError' ? 'The voice assistant is starting up. Please refresh in a few seconds.' : e.message); }
    })();
  }, [siteLang]);

  const stopAudio = useCallback(() => {
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setStatus((s) => (s === 'speaking' ? 'idle' : s));
  }, []);

  const speak = useCallback(async (text, lng) => {
    if (muted || textOnly || !text) return;
    stopAudio();
    const clean = speakable(text);
    setLastSpoken({ text: clean, lang: lng });
    const tag = caps?.languages?.find((l) => l.code === lng)?.speech_tag || 'en-IN';
    // 1) AI4Bharat Indic Parler-TTS on the server, when configured for this language
    if (caps?.providers?.tts_server && caps.tts_server_languages.includes(lng)) {
      try {
        setStatus('speaking');
        const r = await api('/voice-api/tts', { json: { text: clean, lang: lng }, timeout: 70000 });
        if (r.ok && r.blob) {
          const a = new Audio(URL.createObjectURL(r.blob));
          audioRef.current = a;
          a.onended = () => setStatus('idle');
          await a.play();
          return;
        }
      } catch { /* fall through to device voice */ }
    }
    // 2) The device's own speech synthesis voice for the language
    const synth = window.speechSynthesis;
    const voices = synth ? synth.getVoices() : [];
    const prefix = tag.split('-')[0];
    const voice = voices.find((v) => v.lang === tag) || voices.find((v) => v.lang?.toLowerCase().startsWith(prefix));
    if (!synth || !voice) { setStatus('idle'); setNotice(L.noVoice); return; }
    const u = new SpeechSynthesisUtterance(clean);
    u.voice = voice; u.lang = voice.lang; u.rate = 0.95;
    u.onend = () => setStatus('idle');
    u.onerror = () => setStatus('idle');
    setStatus('speaking');
    synth.speak(u);
  }, [caps, muted, textOnly, stopAudio, L.noVoice]);

  // Some browsers load voices asynchronously
  useEffect(() => { if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = () => {}; }, []);

  const handleReply = useCallback(async (data, lng) => {
    const msg = { role: 'assistant', text: data.reply || data.error || '', results: data.results, action: data.action, question: data.question_field };
    setMessages((m) => [...m, msg]);
    if (data.action === 'save_confirmed') {
      const r = await api('/voice-api/save-profile', { json: {} });
      setMessages((m) => [...m, { role: 'system', text: r.ok ? L.saved : (r.data?.error || 'Could not save.') }]);
    }
    speak(data.reply, lng);
  }, [speak, L.saved]);

  const send = useCallback(async (text) => {
    const t = (text ?? input).trim();
    if (status === 'thinking') return;
    stopAudio();
    if (t) setMessages((m) => [...m, { role: 'user', text: t }]);
    setInput(''); setInterim(''); setNotice('');
    setStatus('thinking');
    try {
      const r = await api('/voice-api/chat', { json: { text: t, lang } });
      setStatus('idle');
      await handleReply(r.data || {}, lang);
    } catch (e) {
      setStatus('idle');
      setMessages((m) => [...m, { role: 'system', text: 'The assistant did not respond. Please try again, or type a shorter message.' }]);
    }
  }, [input, lang, status, stopAudio, handleReply]);

  // Greeting on first load (or after language change with empty history)
  useEffect(() => { if (caps && messages.length === 0) send(''); }, [caps]); // eslint-disable-line react-hooks/exhaustive-deps

  const serverASR = caps?.providers?.asr_server && caps.asr_server_languages.includes(lang);
  const browserASR = Boolean(SR);
  const canListen = !textOnly && (serverASR || browserASR) && typeof window !== 'undefined';

  const startBrowserSR = () => {
    const rec = new SR();
    rec.lang = speechTag; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let finalText = '';
    rec.onresult = (e) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interimText += e.results[i][0].transcript;
      }
      setInterim(interimText);
      if (finalText) setInput((prev) => (prev ? prev + ' ' : '') + finalText.trim());
      finalText = '';
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setNotice(L.micDenied);
      else if (e.error === 'no-speech') setNotice(L.noSpeech);
      else if (e.error === 'language-not-supported') setNotice(L.noMic);
      else if (e.error !== 'aborted') setNotice(L.noMic);
    };
    rec.onend = () => { setStatus('idle'); setInterim(''); recRef.current = null; setTimeout(() => inputRef.current?.focus(), 50); };
    recRef.current = rec;
    setStatus('listening');
    rec.start();
  };

  const startServerRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: true, echoCancellation: true } });
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setStatus('transcribing');
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        const fd = new FormData();
        fd.append('audio', blob, 'speech.webm'); fd.append('lang', lang);
        try {
          const r = await api('/voice-api/asr', { body: fd, timeout: 60000 });
          if (r.ok && r.data.text) setInput((prev) => (prev ? prev + ' ' : '') + r.data.text);
          else setNotice(r.data?.error === 'no speech recognised' ? L.noSpeech : (r.data?.error || L.noMic));
        } catch { setNotice(L.noMic); }
        setStatus('idle');
        setTimeout(() => inputRef.current?.focus(), 50);
      };
      mediaRef.current = mr;
      mr.start();
      setStatus('listening');
      setTimeout(() => { if (mr.state === 'recording') mr.stop(); }, 30000);
    } catch { setNotice(L.micDenied); setStatus('idle'); }
  };

  const toggleListen = () => {
    if (status === 'listening') {
      if (recRef.current) recRef.current.stop();
      if (mediaRef.current && mediaRef.current.state === 'recording') mediaRef.current.stop();
      return;
    }
    stopAudio(); setNotice('');
    if (serverASR) startServerRecording();
    else if (browserASR) startBrowserSR();
    else setNotice(L.noMic);
  };

  const reset = async () => {
    stopAudio();
    await api('/voice-api/reset', { json: {} }).catch(() => {});
    setMessages([]); setInput(''); setNotice('');
    setTimeout(() => send(''), 50);
  };

  if (capsError) return <div className="vx-card vx-error" role="alert">{capsError}</div>;
  if (!caps) return <div className="vx-card" aria-busy="true">Loading…</div>;

  const busyLabel = { thinking: L.thinking, listening: L.listening, transcribing: L.transcribing, speaking: L.speaking }[status];

  return (
    <div className="vx">
      <div className="vx-head">
        <div>
          <h1>{L.title}</h1>
          <p className="muted">{L.sub}</p>
        </div>
        <div className="vx-controls">
          <label className="vx-lang">{L.language}
            <select value={lang} onChange={(e) => { setLang(e.target.value); setNotice(''); }}>
              {caps.languages.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </label>
          <label className="vx-toggle"><input type="checkbox" checked={textOnly} onChange={(e) => { setTextOnly(e.target.checked); stopAudio(); }} /> {L.textOnly}</label>
        </div>
      </div>

      <div className="vx-chat" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`vx-msg vx-${m.role}`}>
            {m.text && <p className="vx-text">{m.text}</p>}
            {m.results && <Results r={m.results} L={L} />}
            {m.action === 'ask_save' && i === messages.length - 1 && (
              <div className="vx-consent">
                <button className="btn btn-sm" onClick={() => send(lang === 'hi' ? 'हाँ' : lang === 'bn' ? 'হ্যাঁ' : 'yes')}>{L.yesSave}</button>
                <button className="btn btn-sm btn-ghost" onClick={() => send(lang === 'hi' ? 'नहीं' : lang === 'bn' ? 'না' : 'no')}>{L.noSave}</button>
              </div>
            )}
            {m.role === 'assistant' && m.results && !loggedIn && <p className="small muted">{L.loginToSave} <a href="/login">→</a></p>}
          </div>
        ))}
        {busyLabel && <div className={`vx-status vx-status-${status}`} role="status"><span className="vx-dot" />{busyLabel}</div>}
        <div ref={endRef} />
      </div>

      {notice && <div className="note" role="status">{notice}</div>}

      <div className="vx-audio">
        <button className="btn btn-sm btn-ghost" onClick={stopAudio} disabled={status !== 'speaking'}>■ {L.stop}</button>
        <button className="btn btn-sm btn-ghost" onClick={() => lastSpoken && speak(lastSpoken.text, lastSpoken.lang)} disabled={!lastSpoken || muted || textOnly}>↻ {L.replay}</button>
        <button className="btn btn-sm btn-ghost" onClick={() => { setMuted(!muted); stopAudio(); }} aria-pressed={muted}>{muted ? `🔈 ${L.unmute}` : `🔇 ${L.mute}`}</button>
        <button className="btn btn-sm btn-ghost" onClick={reset}>⟲ {L.reset}</button>
      </div>

      <form className="vx-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        {canListen && (
          <button type="button" className={`vx-mic ${status === 'listening' ? 'on' : ''}`} onClick={toggleListen} disabled={status === 'thinking' || status === 'transcribing'} aria-label={status === 'listening' ? L.stopListen : L.listen} title={status === 'listening' ? L.stopListen : L.listen}>
            {status === 'listening' ? '■' : '🎤'}
          </button>
        )}
        <div className="vx-field">
          <textarea ref={inputRef} rows={2} value={input + (interim ? (input ? ' ' : '') + interim : '')} onChange={(e) => { setInput(e.target.value); setInterim(''); }} placeholder={L.placeholder} maxLength={1000}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} aria-label={L.placeholder} />
          {input && <small className="muted">{L.edit}</small>}
        </div>
        <button className="btn" type="submit" disabled={status === 'thinking' || !input.trim()}>{L.send}</button>
      </form>
      {!canListen && !textOnly && <p className="small muted">{L.noMic}</p>}
      <p className="small muted">{L.privacy}</p>
    </div>
  );
}

function Card({ r, L }) {
  return (
    <article className={`vx-scheme vx-${r.status}`}>
      <div className="vx-scheme-head">
        <span className={`badge lvl-${r.level}`}>{r.level === 'central' ? 'Central' : r.level === 'district' ? 'District' : 'State'}{r.level !== 'central' && r.state_codes?.length ? ` · ${r.state_codes.join(', ')}` : ''}</span>
        {!r.verified && <span className="badge badge-warn">{L.unverified}</span>}
      </div>
      <h3><a href={`/schemes/${r.slug}`}>{r.name}</a></h3>
      {r.benefit && <p className="amount">{r.benefit}</p>}
      <p className="small">{r.summary}</p>
      <details>
        <summary>{L.why} / {L.docs}</summary>
        <ul className="checks">
          {r.met.map((x, i) => <li key={`m${i}`} className="c-met">{x}</li>)}
          {r.unknown.map((x, i) => <li key={`u${i}`} className="c-unknown">{x}</li>)}
          {r.unmet.map((x, i) => <li key={`n${i}`} className="c-unmet">{x}</li>)}
        </ul>
        {r.documents.length > 0 && <><b className="small">{L.docs}:</b><ul className="small">{r.documents.map((d, i) => <li key={i}>{d}</li>)}</ul></>}
        {r.deadline_note && <p className="small">{r.deadline_note}</p>}
      </details>
      <div className="vx-links">
        {r.apply_url && <a className="btn btn-sm" href={r.apply_url} rel="noopener nofollow">{L.apply} ↗</a>}
        {r.official_url && <a className="btn btn-sm btn-ghost" href={r.official_url} rel="noopener nofollow">{L.official} ↗</a>}
      </div>
    </article>
  );
}

function Results({ r, L }) {
  if (r.focus) return <div className="vx-results"><Card r={r.focus} L={L} /></div>;
  return (
    <div className="vx-results">
      {r.eligible?.length > 0 && <h4 className="vx-group vx-g-ok">{L.eligible} ({r.eligible.length})</h4>}
      {r.eligible?.slice(0, 8).map((x) => <Card key={x.slug} r={x} L={L} />)}
      {r.more_info?.length > 0 && (
        <details className="vx-more"><summary className="vx-group vx-g-info">{L.more} ({r.more_info.length})</summary>
          {r.more_info.slice(0, 10).map((x) => <Card key={x.slug} r={x} L={L} />)}
        </details>
      )}
    </div>
  );
}

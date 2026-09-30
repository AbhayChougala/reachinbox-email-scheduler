import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bell, Box, Check, ChevronLeft, ChevronRight, Clock3, ExternalLink, Inbox, Link2, LoaderCircle, LogOut, Mail, Plus, Search, Send, Upload, X } from 'lucide-react';
import { currentEmailResults, emailTimestampForTab, emailViewKey, formatSlackChannel } from './display';
import { parseLeadText } from './leads';
import './index.css';

type User = { id: string; name: string; email: string; avatarUrl?: string; isAdmin: boolean };
type SenderAccount = { id: string; name: string; email: string; minIntervalMs: number; hourlyLimit: number };
type EmailItem = { id: string; recipient: string; subject: string; body: string; status: string; effectiveScheduledAt: string; sentAt?: string; previewUrl?: string; deferralReason?: string; lastError?: string };
type Slack = { enabled: boolean; teamName: string; channelName: string } | null;
type EmailView = { tab: 'scheduled' | 'sent'; query: string; page: number };
type EmailResults = { key: string; items: EmailItem[]; total: number; error: string; loading: boolean };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: response.statusText }));
    throw Object.assign(new Error(data.error ?? 'Request failed'), { status: response.status });
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

function Login() {
  return <main className="min-h-screen grid lg:grid-cols-[1.05fr_.95fr] bg-[#f4f3ef]">
    <section className="grid-noise text-white min-h-[38vh] lg:min-h-screen p-8 lg:p-14 flex flex-col justify-between">
      <div className="flex items-center gap-3 text-lg tracking-tight"><span className="grid place-items-center size-9 rounded-lg bg-white text-black"><Box size={20} fill="currentColor" /></span> OUTBOX LABS</div>
      <div className="max-w-xl py-16 lg:py-0"><p className="text-xs font-semibold tracking-[.25em] text-zinc-400 mb-6">REACHINBOX ASSIGNMENT</p><h1 className="text-5xl lg:text-7xl font-semibold leading-[.98] tracking-[-.055em]">Send later.<br />Reach right on time.</h1><p className="mt-7 text-zinc-400 max-w-md text-lg leading-relaxed">A durable email scheduler built for deliberate outreach, not inbox chaos.</p></div>
      <p className="text-xs text-zinc-600">Persistent queues · shared rate limits · observable delivery</p>
    </section>
    <section className="flex items-center justify-center p-8"><div className="w-full max-w-sm"><div className="size-12 rounded-xl bg-black text-white grid place-items-center mb-8"><Mail size={22} /></div><h2 className="text-3xl font-semibold tracking-tight">Welcome to Outbox</h2><p className="text-[#737069] mt-3 mb-8 leading-relaxed">Sign in with your Google account to manage senders and schedule email campaigns.</p><a href="/api/auth/google" className="flex items-center justify-center gap-3 rounded-xl bg-black px-5 py-3.5 text-white font-semibold hover:bg-zinc-800 transition"><span className="font-bold text-lg">G</span> Continue with Google</a><p className="text-xs text-[#8b8881] mt-5 text-center">Authentication uses Google OpenID Connect. Passwords never touch this app.</p></div></section>
  </main>;
}

function Compose({ senders, onClose, onScheduled }: { senders: SenderAccount[]; onClose: () => void; onScheduled: () => void }) {
  const [senderId, setSenderId] = useState(senders[0]?.id ?? '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [leadStats, setLeadStats] = useState<ReturnType<typeof parseLeadText> | null>(null);
  const [startAt, setStartAt] = useState(() => { const d = new Date(Date.now() + 5 * 60_000); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); });
  const [delaySeconds, setDelaySeconds] = useState(5);
  const sender = senders.find((item) => item.id === senderId);
  const [hourlyLimit, setHourlyLimit] = useState(sender?.hourlyLimit ?? 100);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function upload(file?: File) {
    if (!file) return;
    setError('');
    if (file.size > 2 * 1024 * 1024) { setError('Lead file must be 2 MB or smaller.'); return; }
    try { setLeadStats(parseLeadText(await file.text())); } catch (e) { setError(e instanceof Error ? e.message : 'Could not parse file'); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!leadStats?.recipients.length) { setError('Upload at least one valid recipient.'); return; }
    setBusy(true); setError('');
    try {
      await api('/api/campaigns/schedule', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ senderId, subject, body, recipients: leadStats.recipients, startAtUtc: new Date(startAt).toISOString(), timezone, delaySeconds, hourlyLimit }) });
      setIdempotencyKey(crypto.randomUUID());
      onScheduled();
    } catch (e) { setError(e instanceof Error ? e.message : 'Scheduling failed'); }
    finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-40 bg-black/45 backdrop-blur-sm flex justify-end" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="bg-[#f7f6f2] h-full w-full max-w-2xl overflow-y-auto shadow-2xl"><form onSubmit={submit} className="min-h-full flex flex-col">
      <header className="sticky top-0 z-10 bg-[#f7f6f2]/95 backdrop-blur border-b border-[#dedcd5] px-7 py-5 flex items-center justify-between"><div><p className="text-xs font-bold tracking-[.14em] text-[#85817a]">NEW CAMPAIGN</p><h2 className="text-2xl font-semibold mt-1">Compose email</h2></div><button type="button" onClick={onClose} className="size-10 rounded-full hover:bg-black/5 grid place-items-center" aria-label="Close"><X /></button></header>
      <div className="p-7 space-y-6 flex-1">
        {error && <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}
        <label><span className="label">Sender account</span><select className="field" value={senderId} onChange={(e) => { setSenderId(e.target.value); const next = senders.find((s) => s.id === e.target.value); if (next) setHourlyLimit(next.hourlyLimit); }} required>{senders.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.email}</option>)}</select></label>
        <label><span className="label">Subject</span><input className="field" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} placeholder="A clear, honest subject" required /></label>
        <label><span className="label">Message</span><textarea className="field min-h-40 resize-y" value={body} onChange={(e) => setBody(e.target.value)} maxLength={100000} placeholder="Write the plain-text email body…" required /></label>
        <div><span className="label">Recipients</span><label className="border border-dashed border-[#b9b6ae] bg-white rounded-xl p-5 flex items-center gap-4 cursor-pointer hover:border-black transition"><span className="size-11 rounded-lg bg-[#efeee9] grid place-items-center"><Upload size={20} /></span><span><b className="text-sm">Upload CSV or text</b><small className="block text-[#7b7871] mt-1">Email column or one address per line · max 2 MB</small></span><input type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} /></label>
          {leadStats && <div className="grid grid-cols-4 gap-2 mt-3">{([['Detected', leadStats.detected], ['Valid', leadStats.valid], ['Invalid', leadStats.invalid], ['Duplicates', leadStats.duplicates]] as const).map(([label, value]) => <div key={label} className="rounded-lg bg-[#eceae4] p-3"><div className="text-xl font-semibold">{value}</div><div className="text-[11px] uppercase tracking-wide text-[#78756e]">{label}</div></div>)}</div>}
        </div>
        <div className="grid sm:grid-cols-2 gap-4"><label><span className="label">Start date & time</span><input className="field" type="datetime-local" value={startAt} min={new Date().toISOString().slice(0, 16)} onChange={(e) => setStartAt(e.target.value)} required /><small className="text-[#77746d] block mt-2">{timezone}; saved as UTC</small></label><label><span className="label">Delay between emails</span><div className="relative"><input className="field pr-20" type="number" min="0" max="86400" value={delaySeconds} onChange={(e) => setDelaySeconds(Number(e.target.value))} required /><span className="absolute right-3 top-3 text-sm text-[#77746d]">seconds</span></div><small className="text-[#77746d] block mt-2">Cannot loosen sender minimum: {sender?.minIntervalMs ?? 0} ms</small></label></div>
        <label><span className="label">Campaign hourly limit</span><input className="field" type="number" min="1" max={sender?.hourlyLimit ?? 10000} value={hourlyLimit} onChange={(e) => setHourlyLimit(Number(e.target.value))} required /><small className="text-[#77746d] block mt-2">May tighten, never bypasses sender cap of {sender?.hourlyLimit ?? '—'} per UTC clock hour.</small></label>
      </div>
      <footer className="sticky bottom-0 bg-[#f7f6f2] border-t border-[#dedcd5] px-7 py-5 flex gap-3 justify-end"><button type="button" onClick={onClose} className="px-5 py-3 rounded-xl border border-[#d4d1c9] bg-white font-semibold">Cancel</button><button disabled={busy || !senders.length} className="px-5 py-3 rounded-xl bg-black text-white font-semibold flex items-center gap-2 disabled:opacity-50">{busy ? <LoaderCircle className="animate-spin" size={18} /> : <Send size={18} />} Schedule {leadStats?.valid ? `${leadStats.valid} emails` : 'emails'}</button></footer>
    </form></div>
  </div>;
}

function Status({ status }: { status: string }) {
  const success = status === 'SENT'; const danger = ['FAILED', 'AMBIGUOUS'].includes(status);
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${success ? 'bg-emerald-50 text-emerald-700' : danger ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}><span className={`size-1.5 rounded-full ${success ? 'bg-emerald-500' : danger ? 'bg-red-500' : 'bg-amber-500'}`} />{status.toLowerCase()}</span>;
}

function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="flex h-[46px] w-full min-w-0 items-center gap-3 rounded-[10px] border border-[#d8d6cf] bg-white px-3 transition-[border-color,box-shadow] focus-within:border-[#171717] focus-within:shadow-[0_0_0_3px_rgba(23,23,23,.08)] sm:w-72">
    <Search aria-hidden="true" className="shrink-0 text-[#8a867f]" size={19} />
    <span className="sr-only">Search emails</span>
    <input
      aria-label="Search emails"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[#151515] outline-none placeholder:text-[#8a867f]"
      placeholder="Search recipient, subject, body"
    />
  </label>;
}

function Dashboard({ user }: { user: User }) {
  const [senders, setSenders] = useState<SenderAccount[]>([]);
  const [tab, setTab] = useState<'scheduled' | 'sent'>('scheduled');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EmailResults | null>(null);
  const requestSequence = useRef(0);
  const [compose, setCompose] = useState(false);
  const [toast, setToast] = useState('');
  const [slack, setSlack] = useState<Slack>(null);
  const pageSize = 25;
  const view: EmailView = { tab, query, page };
  const viewKey = emailViewKey(tab, query, page);
  const currentResults = currentEmailResults(viewKey, results);
  const items = currentResults?.items ?? [];
  const total = currentResults?.total ?? 0;
  const loading = currentResults?.loading ?? true;
  const error = currentResults?.error ?? '';
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const initials = useMemo(() => user.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(), [user.name]);

  async function load(target: EmailView, signal?: AbortSignal) {
    const key = emailViewKey(target.tab, target.query, target.page);
    const sequence = ++requestSequence.current;
    setResults((previous) => previous?.key === key
      ? { ...previous, error: '', loading: true }
      : { key, items: [], total: 0, error: '', loading: true });
    try {
      const data = await api<{ items: EmailItem[]; total: number }>(`/api/emails?tab=${target.tab}&q=${encodeURIComponent(target.query)}&page=${target.page}&pageSize=${pageSize}`, { signal });
      if (sequence === requestSequence.current) setResults({ key, items: data.items, total: data.total, error: '', loading: false });
    } catch (e) {
      if (signal?.aborted || sequence !== requestSequence.current) return;
      setResults({ key, items: [], total: 0, error: e instanceof Error ? e.message : 'Could not load email index', loading: false });
    }
  }
  useEffect(() => { void Promise.all([api<{ senders: SenderAccount[] }>('/api/senders').then((d) => setSenders(d.senders)), api<{ integration: Slack }>('/api/integrations/slack').then((d) => setSlack(d.integration))]); }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(view, controller.signal);
    const timer = setInterval(() => void load(view, controller.signal), 10_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [tab, query, page]);
  useEffect(() => { const timer = setTimeout(() => { setPage(1); setQuery(search); }, 300); return () => clearTimeout(timer); }, [search]);

  return <div className="min-h-screen bg-[#f3f2ee] lg:grid lg:grid-cols-[248px_1fr]">
    <aside className="grid-noise text-white p-5 lg:min-h-screen lg:sticky lg:top-0 lg:h-screen flex lg:flex-col items-center lg:items-stretch justify-between">
      <div><div className="flex items-center gap-3 font-semibold tracking-tight"><span className="grid place-items-center size-9 rounded-lg bg-white text-black"><Box size={19} fill="currentColor" /></span><span>OUTBOX LABS</span></div><nav className="hidden lg:block mt-12 space-y-2"><button className="w-full flex items-center gap-3 rounded-xl bg-white text-black px-4 py-3 text-sm font-semibold"><Inbox size={18} /> Email scheduler</button>{user.isAdmin && <a href="/admin/queues" target="_blank" className="flex items-center gap-3 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 px-4 py-3 text-sm"><ExternalLink size={18} /> Queue monitor</a>}</nav></div>
      <div className="hidden lg:block"><div className="border-t border-white/10 pt-4 flex items-center gap-3"><div className="size-9 rounded-full bg-white/10 grid place-items-center text-xs font-bold overflow-hidden">{user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : initials}</div><div className="min-w-0 flex-1"><div className="text-sm font-semibold truncate">{user.name}</div><div className="text-xs text-zinc-500 truncate">{user.email}</div></div><button title="Log out" onClick={() => void api('/api/auth/logout', { method: 'POST' }).then(() => location.reload())}><LogOut size={17} className="text-zinc-500 hover:text-white" /></button></div></div>
    </aside>
    <main className="min-w-0"><header className="px-5 lg:px-10 py-7 lg:py-9 flex flex-col sm:flex-row sm:items-end justify-between gap-5 border-b border-[#dedcd5]"><div><p className="text-xs font-bold tracking-[.15em] text-[#8a867f] mb-2">EMAIL OPERATIONS</p><h1 className="text-3xl lg:text-4xl font-semibold tracking-[-.035em]">Your outbox</h1><p className="text-[#77746d] mt-2">Schedule deliberately. Delivery keeps moving after you close this tab.</p></div><button onClick={() => setCompose(true)} disabled={!senders.length} className="rounded-xl bg-black text-white px-5 py-3 font-semibold flex items-center justify-center gap-2 disabled:opacity-50"><Plus size={18} /> Compose new email</button></header>
      <section className="p-5 lg:p-10">
        {!senders.length && <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">No sender account exists yet. Run <code className="font-bold">npm run db:seed:senders</code> after setting PROVISION_OWNER_EMAIL to your Google email.</div>}
        {toast && <div className="mb-5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 flex gap-2"><Check size={19} /> {toast}</div>}
        <div className="flex flex-col xl:flex-row gap-4 justify-between xl:items-center mb-5"><div className="inline-flex bg-[#e8e6df] rounded-xl p-1 self-start"><button onClick={() => { setTab('scheduled'); setPage(1); }} className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 ${tab === 'scheduled' ? 'bg-white shadow-sm' : 'text-[#77746d]'}`}><Clock3 size={16} /> Scheduled emails</button><button onClick={() => { setTab('sent'); setPage(1); }} className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 ${tab === 'sent' ? 'bg-white shadow-sm' : 'text-[#77746d]'}`}><Send size={16} /> Sent emails</button></div><div className="flex w-full flex-wrap items-center gap-3 xl:w-auto"><SearchField value={search} onChange={setSearch} />{slack?.enabled ? <button onClick={() => void api('/api/integrations/slack', { method: 'DELETE' }).then(() => setSlack(null))} className="flex max-w-full min-w-0 items-center gap-2 rounded-xl border border-[#d7d4cc] bg-white px-4 py-2.5 text-sm font-semibold"><Bell className="shrink-0" size={16} /> <span className="min-w-0 truncate">{slack.teamName} · {formatSlackChannel(slack.channelName)}</span> <X className="shrink-0" size={14} /></button> : <a href="/api/integrations/slack/connect" className="rounded-xl border border-[#d7d4cc] bg-white px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2"><Link2 size={16} /> Connect Slack</a>}</div></div>
        <div className="rounded-2xl bg-white border border-[#dfddd6] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,.03)]">
          {error ? <div className="p-10 text-center"><div className="size-11 rounded-full bg-red-50 text-red-600 grid place-items-center mx-auto mb-3"><X /></div><h3 className="font-semibold">Search unavailable</h3><p className="text-sm text-[#77746d] mt-1">{error}</p><button onClick={() => void load(view)} className="mt-4 text-sm font-bold underline">Try again</button></div> : loading && !items.length ? <div className="p-16 grid place-items-center text-[#77746d]"><LoaderCircle className="animate-spin mb-3" />Loading indexed emails…</div> : !items.length ? <div className="p-16 text-center"><div className="size-12 rounded-full bg-[#efeee9] grid place-items-center mx-auto mb-4"><Mail size={21} /></div><h3 className="font-semibold">{query ? 'No matching emails' : `No ${tab} emails yet`}</h3><p className="text-sm text-[#77746d] mt-1">{query ? 'Try a different Elasticsearch query.' : tab === 'scheduled' ? 'Compose a campaign to place work in the queue.' : 'Confirmed deliveries will appear here.'}</p></div> : <div className="overflow-x-auto"><table className="w-full text-left"><thead className="bg-[#faf9f6] text-[11px] uppercase tracking-[.1em] text-[#85817a] border-b border-[#e5e3dd]"><tr><th className="px-5 py-4">Recipient</th><th className="px-5 py-4">Subject</th><th className="px-5 py-4">{tab === 'sent' ? 'Sent at' : 'Effective time'}</th><th className="px-5 py-4">Status</th><th className="px-5 py-4 text-right">Proof</th></tr></thead><tbody className="divide-y divide-[#eeece6]">{items.map((item) => { const timestamp = emailTimestampForTab(tab, item); return <tr key={item.id} className="hover:bg-[#faf9f6]"><td className="px-5 py-4 text-sm font-medium">{item.recipient}</td><td className="px-5 py-4"><div className="text-sm max-w-xs truncate">{item.subject}</div>{(item.deferralReason || item.lastError) && <div className="text-xs text-[#8a867f] max-w-xs truncate mt-1">{item.deferralReason ?? item.lastError}</div>}</td><td className="px-5 py-4 text-sm text-[#69665f] whitespace-nowrap">{timestamp ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp)) : '—'}</td><td className="px-5 py-4"><Status status={item.status} /></td><td className="px-5 py-4 text-right">{item.status === 'SENT' && item.previewUrl ? <a className="inline-flex gap-1 text-sm font-semibold underline" href={item.previewUrl} target="_blank" rel="noreferrer">Preview <ExternalLink size={14} /></a> : <span className="text-[#aaa69e]">—</span>}</td></tr>; })}</tbody></table></div>}
          <footer className="border-t border-[#e5e3dd] px-5 py-4 flex items-center justify-between text-sm"><span className="text-[#77746d]">{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : '0 results'}</span><div className="flex gap-2"><button disabled={page <= 1} onClick={() => setPage((v) => v - 1)} className="size-9 rounded-lg border border-[#d8d5ce] grid place-items-center disabled:opacity-30"><ChevronLeft size={17} /></button><span className="px-3 py-2">{page} / {pages}</span><button disabled={page >= pages} onClick={() => setPage((v) => v + 1)} className="size-9 rounded-lg border border-[#d8d5ce] grid place-items-center disabled:opacity-30"><ChevronRight size={17} /></button></div></footer>
        </div>
      </section>
    </main>
    {compose && <Compose senders={senders} onClose={() => setCompose(false)} onScheduled={() => { setCompose(false); setToast('Campaign committed. Queue publication is running in the background.'); setTab('scheduled'); setPage(1); window.setTimeout(() => setToast(''), 1500); }} />}
  </div>;
}

function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => { void api<User>('/api/me').then(setUser).catch((error) => error.status === 401 ? setUser(null) : setUser(null)); }, []);
  if (user === undefined) return <div className="min-h-screen grid place-items-center"><LoaderCircle className="animate-spin" /></div>;
  return user ? <Dashboard user={user} /> : <Login />;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

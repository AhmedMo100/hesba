/* ================= shell ================= */
const ROUTES = [['home', 'الرئيسية', 'home'], ['products', 'المنتجات', 'box'], ['sales', 'البيع', 'cart'], ['stock', 'المخزون', 'layers'], ['expenses', 'المصروفات', 'wallet'], ['people', 'الناس', 'users'], ['alerts', 'التنبيهات', 'bell'], ['ai', 'المساعد', 'sparkle']];
const PAGES = { home: HomePage, products: ProductsPage, sales: SalesPage, stock: StockPage, expenses: ExpensesPage, people: PeoplePage, alerts: AlertsPage, ai: AiPage };
function useRoute() {
  const get = () => { const h = (location.hash || '').replace(/^#\/?/, ''); return PAGES[h] ? h : 'home'; };
  const [r, setR] = useState(get);
  useEffect(() => { const f = () => { setR(get()); window.scrollTo(0, 0); }; window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return r;
}
const go = (r) => { location.hash = '#/' + r; };
function Logo({ s = 34 }) { return window.LOGO ? <img className="logo" src={window.LOGO} alt="حسبة" style={{ height: s }} /> : <span className="logo-t">حسبة</span>; }

function MenuBox({ children }) { const r = useRef(null); useGhost(r, 'out'); return <div className="menu" role="menu" ref={r}>{children}</div>; }
function StoreMenu({ onLogout }) {
  const { S, act, online, setOnline, sync, syncNow } = useApp(); const [open, setOpen] = useState(false); const toast = useToast(); const [ask, setAsk] = useState(false); const [prof, setProf] = useState(false);
  useEffect(() => { if (!open) return; const k = (e) => { if (e.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open]);
  const q = S.queue || 0;
  return (<div className="smenu">
    <button type="button" className="store-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="s-ic"><Icon n="store" s={20} /></span><span className="s-nm">{S.store.name}</span>
      {!online && <i className="off-dot" title="بدون نت" />}<Icon n="down" s={16} className={'chev' + (open ? ' up' : '')} /></button>
    {open && <><div className="menu-shield" onClick={() => setOpen(false)} />
      <MenuBox>
        <div className="mn-h"><b>{S.store.name}</b><small>{S.profile ? S.profile.owner + ' · ' : ''}{online ? 'متصل' : 'بدون نت — الشغل بيتحفظ'}</small></div>
        {S.profile && <button type="button" className="mn-i" role="menuitem" onClick={() => { setOpen(false); setProf(true); }}><Icon n="store" s={16} />بيانات الحساب والمحل</button>}
        <div className="mn-s"><div className="mn-l"><Icon n="sun" s={16} />المظهر</div>
          <Seg className="sm" value={S.theme} onChange={act.setTheme} options={[['light', 'فاتح'], ['dark', 'غامق'], ['auto', 'تلقائي']]} /></div>
        <div className="mn-s"><div className="mn-l"><Icon n={online ? 'wifi' : 'wifioff'} s={16} />المزامنة</div>
          <div className="mn-sync">{sync === 'syncing' ? <span>بتتزامن…</span> : q > 0 ? <span>{q} عملية مستنية</span> : <span>كله متزامن ✓</span>}
            <button type="button" className="btn btn-soft sm" disabled={!online || (q === 0) || sync === 'syncing'} onClick={() => syncNow()}><Icon n="refresh" s={15} />زامن دلوقتي</button></div>
          <label className="chk mini"><input type="checkbox" checked={!online} onChange={(e) => { setOnline(!e.target.checked); setOpen(false); toast.show({ msg: e.target.checked ? 'جرّب تبيع — مفيش نت (محاكاة)' : 'رجع النت' }); }} /><span>جرّب وضع «النت فاصل» (محاكاة)</span></label></div>
        <button type="button" className="mn-i" role="menuitem" onClick={() => { setAsk(true); }}><Icon n="refresh" s={16} />إعادة بيانات التجربة</button>
        <button type="button" className="mn-i danger" role="menuitem" onClick={() => { setOpen(false); onLogout(); }}><Icon n="logout" s={16} />تسجيل الخروج</button>
      </MenuBox></>}
    {prof && <ProfileModal onClose={() => setProf(false)} />}
    {ask && <Confirm danger ok="رجّع" title="إعادة بيانات التجربة" text="هترجع كل البيانات للوضع الأصلي للتجربة." onClose={() => setAsk(false)} onOk={() => { act.reset(); setOpen(false); toast.show({ msg: 'اتعادت بيانات التجربة' }); }} />}
  </div>);
}
function SyncBar() {
  const { S, online, sync } = useApp(); const q = S.queue || 0;
  if (online && !sync) return null;
  const done = sync && sync !== 'syncing';
  return (<div className={'syncbar ' + (!online ? 'off' : done ? 'ok' : 'busy')} role="status">
    <Icon n={!online ? 'wifioff' : done ? 'check' : 'refresh'} s={16} className={sync === 'syncing' ? 'spin' : ''} />
    <span>{!online ? 'مفيش نت — كمّل شغلك عادي، وهنزامن لما يرجع' + (q ? ' (' + q + ' عملية مستنية)' : '') : done ? 'اتزامن ' + sync.done + ' عملية ✓' : 'بنزامن شغلك…'}</span></div>);
}
function MoreSheet({ onClose, alerts }) {
  return (<Modal title="المزيد" onClose={onClose}><div className="more-g">{ROUTES.filter((r) => ['expenses', 'people', 'alerts', 'ai'].includes(r[0])).map(([k, l, ic]) => (<button type="button" key={k} className="more-i" onClick={() => { go(k); onClose(); }}><span className="mi-ic"><Icon n={ic} s={24} />{k === 'alerts' && alerts > 0 && <em>{alerts}</em>}</span><b>{l}</b></button>))}</div></Modal>);
}
function Shell({ onLogout }) {
  const { S, stockMap } = useApp(); const route = useRoute(); const Page = PAGES[route]; const [more, setMore] = useState(false);
  const alerts = useMemo(() => computeAlerts(S, stockMap).total, [S, stockMap]);
  const moreOn = ['expenses', 'people', 'alerts', 'ai'].includes(route);
  const mob = [['home', 'الرئيسية', 'home'], ['products', 'المنتجات', 'box'], ['sales', 'البيع', 'cart'], ['stock', 'المخزون', 'layers']];
  return (<div className="app">
    <aside className="side"><div className="sd-logo"><Logo s={40} /></div>
      <nav>{ROUTES.map(([k, l, ic]) => (<button type="button" key={k} className={'nv' + (route === k ? ' on' : '') + (k === 'sales' ? ' key' : '')} aria-current={route === k ? 'page' : undefined} onClick={() => go(k)}><Icon n={ic} s={20} /><span>{l}</span>{k === 'alerts' && alerts > 0 && <em>{alerts}</em>}</button>))}</nav></aside>
    <div className="main">
      <header className="top"><div className="t-logo"><Logo s={30} /></div><StoreMenu onLogout={onLogout} /><span className="sp" />
        <button type="button" className="ib hb" aria-label="التنبيهات" onClick={() => go('alerts')}><Icon n="bell" />{alerts > 0 && <em>{alerts}</em>}</button>
        <button type="button" className={'ib hb' + (route === 'ai' ? ' act' : '')} aria-label="المساعد" onClick={() => go('ai')}><Icon n="sparkle" /></button></header>
      <SyncBar />
      <main key={route} className="content"><Page /></main>
    </div>
    <nav className="bnav" aria-label="التنقل">{mob.slice(0, 2).map(([k, l, ic]) => (<button type="button" key={k} className={'bn' + (route === k ? ' on' : '')} onClick={() => go(k)}><Icon n={ic} s={22} /><span>{l}</span></button>))}
      <button type="button" className={'bn sell' + (route === 'sales' ? ' on' : '')} onClick={() => go('sales')}><span className="sell-c"><Icon n="cart" s={26} /></span><span>البيع</span></button>
      <button type="button" className={'bn' + (route === 'stock' ? ' on' : '')} onClick={() => go('stock')}><Icon n="layers" s={22} /><span>المخزون</span></button>
      <button type="button" className={'bn' + (moreOn ? ' on' : '')} onClick={() => setMore(true)}><span className="bn-i"><Icon n="more" s={22} />{alerts > 0 && <em>{alerts}</em>}</span><span>المزيد</span></button></nav>
    {more && <MoreSheet alerts={alerts} onClose={() => setMore(false)} />}
  </div>);
}
function Root() {
  const store = useStoreImpl(); const [authed, setAuthed] = useState(() => { try { return localStorage.getItem('hesba-demo-auth') === '1'; } catch (e) { return false; } });
  const [mode, setMode] = useState(store.S.profile ? 'login' : 'signup');
  useEffect(() => {
    const el = document.documentElement; if (store.S.theme === 'auto') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', store.S.theme);
    const dark = store.S.theme === 'dark' || (store.S.theme === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#1B1A15' : '#EFE8D6';
  }, [store.S.theme]);
  const setA = (v) => { setAuthed(v); try { localStorage.setItem('hesba-demo-auth', v ? '1' : '0'); } catch (e) {} };
  const inApp = authed && store.S.profile;
  return (<AppCtx.Provider value={store}><ToastHost>{inApp ? <Shell onLogout={() => { setMode('login'); setA(false); }} /> : <AuthScreen mode={store.S.profile ? mode : 'signup'} setMode={setMode} hasAccount={!!store.S.profile} onLogin={() => setA(true)} />}</ToastHost></AppCtx.Provider>);
}
ReactDOM.createRoot(document.getElementById('root')).render(<Root />);

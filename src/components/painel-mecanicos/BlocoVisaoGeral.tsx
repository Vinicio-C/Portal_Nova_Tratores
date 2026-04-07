'use client'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  MapPin, Clock, ChevronDown, Truck,
  Loader2, Coffee, ArrowRight, ArrowLeft, Briefcase, Moon,
  RefreshCw, Plus, X, Trash2, Search, FileText
} from 'lucide-react'

// ── Types ──
interface OrdemServico {
  Id_Ordem: string; Status: string; Os_Cliente: string; Cnpj_Cliente: string
  Os_Tecnico: string; Os_Tecnico2: string; Previsao_Execucao: string | null
  Previsao_Faturamento: string | null; Serv_Solicitado: string
  Endereco_Cliente: string; Cidade_Cliente: string; Tipo_Servico: string
  Qtd_HR?: string | number | null
}
interface Tecnico { user_id: string; tecnico_nome: string; tecnico_email: string; mecanico_role: 'tecnico' | 'observador' }
interface Caminho { id: number; tecnico_nome: string; destino: string; cidade: string; motivo: string; data_saida: string; status: string }
interface AgendaRow {
  id: number; data: string; tecnico_nome: string; id_ordem: string | null; id_caminho: number | null
  cliente: string; servico: string; endereco: string; cidade: string
  endereco_opcoes: { label: string; fonte: string; endereco: string }[]
  coordenadas: { lat: number; lng: number } | null
  tempo_ida_min: number; distancia_ida_km: number; tempo_volta_min: number; distancia_volta_km: number
  qtd_horas: number; ordem_sequencia: number; status: string; observacoes: string
}
interface TrechoRota {
  tipo: 'saida' | 'deslocamento' | 'servico' | 'almoco' | 'retorno' | 'proximo_dia'
  label: string; sublabel: string; horaInicio: string; duracao?: string
  icon: 'truck' | 'arrow-right' | 'briefcase' | 'coffee' | 'arrow-left' | 'pin' | 'moon'; color: string
}

// ── Helpers ──
function normNome(n: string): string[] { return n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(p => p.length > 2) }
function match(a: string, b: string) { if (!a || !b) return false; const pA = normNome(a), pB = normNome(b); if (!pA.length || !pB.length || pA[0] !== pB[0]) return false; if (pA.length === 1 || pB.length === 1) return true; const s = new Set(pA.slice(1)); return pB.slice(1).some(p => s.has(p)) }
function extrairSolicitacao(serv: string): string {
  if (!serv) return ''
  const idx = serv.indexOf('Solicitação do cliente:')
  if (idx === -1) return ''
  const after = serv.substring(idx + 'Solicitação do cliente:'.length)
  const fim = after.indexOf('Serviço Realizado')
  const trecho = fim > -1 ? after.substring(0, fim) : after
  return trecho.replace(/\n/g, ' ').trim()
}
function fm(m: number) { if (m < 60) return `${Math.round(m)}min`; const h = Math.floor(m / 60); const r = Math.round(m % 60); return r > 0 ? `${h}h${r}` : `${h}h` }
function fh(m: number) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}` }

const S = 510, AI = 660, AD = 90, FE = 1080
const IC: Record<string, React.ReactNode> = { truck: <Truck size={11} />, 'arrow-right': <ArrowRight size={11} />, briefcase: <Briefcase size={11} />, coffee: <Coffee size={11} />, 'arrow-left': <ArrowLeft size={11} />, pin: <MapPin size={11} />, moon: <Moon size={11} /> }

function cronograma(items: AgendaRow[]) {
  const t: TrechoRota[] = []; let c = S, al = false, dia = 0
  const ld = (d: number) => d === 0 ? '' : d === 1 ? ' (dia seguinte)' : ` (+${d}d)`
  const vira = () => { while (c >= FE) { t.push({ tipo: 'proximo_dia', label: `Fim expediente${ld(dia)}`, sublabel: 'Continua próximo dia 08:30', horaInicio: fh(FE), icon: 'moon', color: '#DC2626' }); dia++; c = S; al = false; t.push({ tipo: 'saida', label: `Retorno${ld(dia)}`, sublabel: 'Continuação', horaInicio: fh(c), icon: 'truck', color: '#71717A' }) } }
  t.push({ tipo: 'saida', label: 'Saída da oficina', sublabel: '08:30', horaInicio: fh(c), icon: 'truck', color: '#71717A' })
  for (const r of items) {
    const nm = r.cliente ? r.cliente.split(' ').slice(0, 3).join(' ') : r.id_ordem || '?'
    const dm = r.tempo_ida_min || 0, dk = r.distancia_ida_km || 0, sv = (r.qtd_horas || 2) * 60
    c += dm; vira()
    t.push({ tipo: 'deslocamento', label: `${nm}${ld(dia)}`, sublabel: `${fm(dm)} · ${dk}km`, horaInicio: fh(c), duracao: fm(dm), icon: 'arrow-right', color: '#52525B' })
    if (!al && c >= AI && c < AI + 90) { t.push({ tipo: 'almoco', label: 'Almoço', sublabel: '1h30', horaInicio: fh(c), duracao: '1h30', icon: 'coffee', color: '#D97706' }); c += AD; al = true }
    let rest = sv
    while (rest > 0) {
      if (!al && c >= AI && c < AI + 90) { t.push({ tipo: 'almoco', label: 'Almoço', sublabel: '1h30', horaInicio: fh(c), duracao: '1h30', icon: 'coffee', color: '#D97706' }); c += AD; al = true }
      const d = FE - c
      if (rest <= d) { t.push({ tipo: 'servico', label: `Serviço · ${r.id_ordem || ''}${rest < sv ? ' (cont.)' : ''}${ld(dia)}`, sublabel: fm(rest), horaInicio: fh(c), duracao: fm(rest), icon: 'briefcase', color: '#18181B' }); c += rest; rest = 0 }
      else { if (d > 0) { t.push({ tipo: 'servico', label: `Serviço · ${r.id_ordem || ''}${ld(dia)}`, sublabel: `${fm(d)}`, horaInicio: fh(c), duracao: fm(d), icon: 'briefcase', color: '#18181B' }); rest -= d }; c = FE; vira() }
    }
    if (!al && c >= AI && c <= AI + 120) { t.push({ tipo: 'almoco', label: 'Almoço', sublabel: '1h30', horaInicio: fh(c), duracao: '1h30', icon: 'coffee', color: '#D97706' }); c += AD; al = true }
  }
  const vm = items[items.length - 1]?.tempo_volta_min || 0, vk = items[items.length - 1]?.distancia_volta_km || 0
  c += vm; vira()
  t.push({ tipo: 'deslocamento', label: `Retorno oficina${ld(dia)}`, sublabel: `${fm(vm)} · ${vk}km`, horaInicio: fh(c), duracao: fm(vm), icon: 'arrow-left', color: '#52525B' })
  t.push({ tipo: 'retorno', label: dia > 0 ? `Chegada${ld(dia)}` : 'Chegada', sublabel: dia > 0 ? `${dia + 1} dias` : `Total: ${fm(c - S)}`, horaInicio: fh(c), icon: dia > 0 ? 'moon' : 'pin', color: dia > 0 ? '#DC2626' : '#18181B' })
  return { trechos: t, retornoHora: fh(c), totalForaMin: c - S, passaDia: dia > 0, diasExtras: dia }
}

// ── Styles ──
const INP: React.CSSProperties = { fontSize: 13, padding: '10px 14px', border: '1px solid #E4E4E7', borderRadius: 10, outline: 'none', width: '100%', background: '#FAFAFA', boxSizing: 'border-box', color: '#18181B', transition: 'border-color 0.15s, box-shadow 0.15s' }
const INP_FOCUS = 'border-color: #6366F1; box-shadow: 0 0 0 3px rgba(99,102,241,0.08);'
const LBL: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#71717A', marginBottom: 6, display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' }
const COLORS = ['#6366F1', '#0EA5E9', '#F59E0B', '#10B981', '#EC4899', '#8B5CF6', '#F97316', '#14B8A6']

// ── Types ──
interface ClienteOption { chave: string; display: string }

// ── Component ──
export default function BlocoVisaoGeral({ tecnicos, ordens, caminhos }: { tecnicos: Tecnico[]; ordens: OrdemServico[]; caminhos: Caminho[] }) {
  const [agenda, setAgenda] = useState<AgendaRow[]>([])
  const [syncing, setSyncing] = useState(false)
  const [calculando, setCalculando] = useState<Record<number, boolean>>({})
  const [cronoAberto, setCronoAberto] = useState<Record<string, boolean>>({})
  const [salvando, setSalvando] = useState<Record<number, boolean>>({})
  const [addTec, setAddTec] = useState<string | null>(null)
  const [addMode, setAddMode] = useState<'os' | 'manual'>('os')
  const [buscaOS, setBuscaOS] = useState('')
  const [form, setForm] = useState({ cliente: '', endereco: '', cidade: '', horas: 2, obs: '', servico: '', dataInicio: '', dataFim: '' })
  // Dropdown de clientes
  const [clientes, setClientes] = useState<ClienteOption[]>([])
  const [clienteDropdownId, setClienteDropdownId] = useState<number | null>(null)
  const [clienteFilter, setClienteFilter] = useState('')

  const tecs = useMemo(() => tecnicos.filter(t => t.mecanico_role === 'tecnico'), [tecnicos])
  const hoje = useMemo(() => new Date().toISOString().split('T')[0], [])

  // Carregar clientes para o dropdown
  useEffect(() => {
    fetch('/api/pos/clientes').then(r => r.ok ? r.json() : []).then(setClientes).catch(() => {})
  }, [])

  const clientesFiltrados = useMemo(() => {
    if (!clienteFilter) return []
    const terms = clienteFilter.toLowerCase().split(/\s+/).filter(Boolean)
    return clientes.filter(c => { const d = c.display.toLowerCase(); return terms.every(t => d.includes(t)) }).slice(0, 15)
  }, [clienteFilter, clientes])

  // ── API ──
  const calcRota = useCallback(async (row: AgendaRow) => {
    setCalculando(p => ({ ...p, [row.id]: true }))
    try { const r = await fetch('/api/pos/agenda-visao', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id, calcular: true }) }); if (r.ok) { const u = await r.json(); setAgenda(p => p.map(a => a.id === row.id ? u : a)) } } catch { }
    setCalculando(p => ({ ...p, [row.id]: false }))
  }, [])

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/pos/agenda-visao?data=${hoje}`)
    if (r.ok) { const rows = await r.json(); setAgenda(rows); return rows as AgendaRow[] }
    return []
  }, [hoje])

  // Refs para acessar valores atuais sem recriar callbacks
  const tecsRef = useRef(tecs)
  const ordensRef = useRef(ordens)
  tecsRef.current = tecs
  ordensRef.current = ordens

  const sincronizar = useCallback(async () => {
    const t = tecsRef.current
    const o = ordensRef.current
    if (!t.length) return
    setSyncing(true)
    try {
      const payload = t.map(tec => {
        const os = o.filter(ord =>
          ord.Status === 'Execução' &&
          (match(tec.tecnico_nome, ord.Os_Tecnico) || match(tec.tecnico_nome, ord.Os_Tecnico2))
        )
        return {
          nome: tec.tecnico_nome,
          ordens: os.filter(ord => match(tec.tecnico_nome, ord.Os_Tecnico)).map(ord => ({
            id: ord.Id_Ordem, cliente: ord.Os_Cliente, cnpj: ord.Cnpj_Cliente,
            endereco: ord.Endereco_Cliente, cidade: ord.Cidade_Cliente,
            servico: ord.Serv_Solicitado,
            qtdHoras: parseFloat(String(ord.Qtd_HR || 0)) || 2,
            observacoes: extrairSolicitacao(ord.Serv_Solicitado || ''),
          })),
        }
      }).filter(x => x.ordens.length > 0)

      if (payload.length > 0) {
        const r = await fetch('/api/pos/agenda-visao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: hoje, tecnicos: payload }) })
        if (r.ok) { const rows = await r.json() as AgendaRow[]; setAgenda(rows); rows.filter(r => r.tempo_ida_min === 0 && r.endereco).forEach(r => calcRota(r)) }
      } else {
        await carregar()
      }
    } finally {
      setSyncing(false)
    }
  }, [hoje, carregar, calcRota])

  // Sincroniza quando técnicos e ordens estão disponíveis
  useEffect(() => {
    if (!tecs.length || !ordens.length) return
    sincronizar()
  }, [tecs.length, ordens.length, sincronizar])

  // ── Computed ──
  const porTec = useMemo(() => { const m: Record<string, AgendaRow[]> = {}; tecs.forEach(t => { m[t.tecnico_nome] = agenda.filter(a => a.tecnico_nome === t.tecnico_nome).sort((a, b) => a.ordem_sequencia - b.ordem_sequencia) }); return m }, [tecs, agenda])
  const camPorTec = useMemo(() => { const m: Record<string, Caminho | null> = {}; tecs.forEach(t => { m[t.tecnico_nome] = caminhos.find(c => c.tecnico_nome === t.tecnico_nome && c.status === 'em_transito') || null }); return m }, [tecs, caminhos])
  const oficina = (items: AgendaRow[]) => items.length === 0 || items.every(a => (a.cliente || '').toLowerCase().includes('nova tratores'))

  // Ordens em execução por técnico
  const ordensPorTec = useMemo(() => {
    const m: Record<string, OrdemServico[]> = {}
    tecs.forEach(t => {
      m[t.tecnico_nome] = ordens.filter(o =>
        o.Status === 'Execução' &&
        (match(t.tecnico_nome, o.Os_Tecnico) || match(t.tecnico_nome, o.Os_Tecnico2))
      )
    })
    return m
  }, [tecs, ordens])

  // Todas as ordens em execução (para busca geral no painel adicionar)
  const todasOrdensExecucao = useMemo(() =>
    ordens.filter(o => o.Status === 'Execução'),
    [ordens]
  )

  // ── Actions ──
  const salvarCampo = async (id: number, campo: string, valor: any) => {
    setSalvando(p => ({ ...p, [id]: true }))
    const r = await fetch('/api/pos/agenda-visao', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, [campo]: valor }) })
    if (r.ok) { const u = await r.json(); setAgenda(p => p.map(a => a.id === id ? u : a)) }
    setSalvando(p => ({ ...p, [id]: false }))
  }

  const remover = async (id: number) => {
    const r = await fetch('/api/pos/agenda-visao', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    if (r.ok) setAgenda(p => p.filter(a => a.id !== id))
  }

  const adicionarOS = async (tecNome: string, os: OrdemServico) => {
    const horas = parseFloat(String(os.Qtd_HR || 0)) || 2
    setSalvando(p => ({ ...p, [-1]: true }))
    const r = await fetch('/api/pos/agenda-visao', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: hoje, tecnicos: [{ nome: tecNome, ordens: [{ id: os.Id_Ordem, cliente: os.Os_Cliente, cnpj: os.Cnpj_Cliente, endereco: os.Endereco_Cliente, cidade: os.Cidade_Cliente, servico: os.Serv_Solicitado, qtdHoras: horas, observacoes: extrairSolicitacao(os.Serv_Solicitado || '') }] }] }),
    })
    if (r.ok) {
      const rows = await r.json() as AgendaRow[]
      setAgenda(rows)
      rows.filter(x => x.tempo_ida_min === 0 && x.endereco && x.tecnico_nome === tecNome).forEach(x => calcRota(x))
    }
    setSalvando(p => ({ ...p, [-1]: false }))
  }

  const adicionarManual = async (tecNome: string) => {
    if (!form.cliente) return
    setSalvando(p => ({ ...p, [-1]: true }))
    const di = form.dataInicio || hoje
    const df = form.dataFim || di
    const inicio = new Date(di + 'T00:00:00')
    const fim = new Date(df + 'T00:00:00')
    const dias = Math.max(1, Math.round((fim.getTime() - inicio.getTime()) / 86400000) + 1)

    for (let d = 0; d < dias; d++) {
      const dt = new Date(inicio.getTime() + d * 86400000).toISOString().split('T')[0]
      const r = await fetch('/api/pos/agenda-visao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: dt, tecnicos: [{ nome: tecNome, ordens: [{ id: `AG-${Date.now()}-${d}`, cliente: form.cliente, cnpj: '', endereco: form.endereco, cidade: form.cidade, servico: form.servico, qtdHoras: form.horas, observacoes: form.obs }] }] }),
      })
      if (r.ok && dt === hoje) {
        const rows = await r.json() as AgendaRow[]
        setAgenda(rows)
        rows.filter(x => x.tempo_ida_min === 0 && x.endereco && x.tecnico_nome === tecNome).forEach(x => calcRota(x))
      }
    }

    setAddTec(null)
    setForm({ cliente: '', endereco: '', cidade: '', horas: 2, obs: '', servico: '', dataInicio: '', dataFim: '' })
    setSalvando(p => ({ ...p, [-1]: false }))
  }

  const abrirAdd = (tecNome: string) => {
    setAddTec(tecNome)
    setAddMode('os')
    setBuscaOS('')
    setForm({ cliente: '', endereco: '', cidade: '', horas: 2, obs: '', servico: '', dataInicio: '', dataFim: '' })
  }

  const fecharAdd = () => {
    setAddTec(null)
    setBuscaOS('')
    setForm({ cliente: '', endereco: '', cidade: '', horas: 2, obs: '', servico: '', dataInicio: '', dataFim: '' })
  }

  // ── Render ──
  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, padding: '20px 24px', background: '#fff', borderRadius: 16, border: '1px solid #E4E4E7', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#18181B', letterSpacing: '-0.01em' }}>
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <div style={{ fontSize: 13, color: '#A1A1AA', marginTop: 4 }}>{tecs.length} técnicos ativos</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <a href="/tv-painel" target="_blank" rel="noopener" style={{
            fontSize: 12, fontWeight: 600, color: '#71717A', textDecoration: 'none',
            border: '1px solid #E4E4E7', borderRadius: 10, padding: '8px 16px',
            background: '#FAFAFA', transition: 'all 0.15s',
          }}>TV</a>
          <button onClick={sincronizar} disabled={syncing} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'linear-gradient(135deg, #18181B 0%, #3F3F46 100%)', color: '#fff', border: 'none', borderRadius: 10,
            padding: '8px 18px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)', transition: 'all 0.15s',
          }}>
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} /> Sincronizar
          </button>
        </div>
      </div>

      {/* Grid de técnicos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(520px, 1fr))', gap: 24 }}>
        {tecs.map((tec, tecIdx) => {
          const items = porTec[tec.tecnico_nome] || []
          const cam = camPorTec[tec.tecnico_nome]
          const naOfi = !cam && oficina(items)
          const ext = items.filter(a => !(a.cliente || '').toLowerCase().includes('nova tratores'))
          const crono = ext.length > 0 && ext.every(a => a.tempo_ida_min > 0) ? cronograma(ext) : null
          const ordsTec = ordensPorTec[tec.tecnico_nome] || []
          const idsNaAgenda = new Set(items.map(a => a.id_ordem).filter(Boolean))
          const ordsDisponiveis = ordsTec.filter(o => !idsNaAgenda.has(o.Id_Ordem))
          const tecColor = COLORS[tecIdx % COLORS.length]
          const isAdding = addTec === tec.tecnico_nome

          let statusLabel = '', statusDot = ''
          if (cam) { statusLabel = 'Em trânsito'; statusDot = '#D97706' }
          else if (naOfi) { statusLabel = 'Na oficina'; statusDot = '#A1A1AA' }
          else if (ext.length > 0) { statusLabel = 'Em campo'; statusDot = '#18181B' }

          // Filtro de busca para o painel de adicionar OS
          const buscaLower = buscaOS.toLowerCase()
          const ordsFiltradas = isAdding && addMode === 'os'
            ? (buscaOS
                ? todasOrdensExecucao.filter(o =>
                    !idsNaAgenda.has(o.Id_Ordem) && (
                      o.Id_Ordem.toLowerCase().includes(buscaLower) ||
                      o.Os_Cliente.toLowerCase().includes(buscaLower) ||
                      (o.Cidade_Cliente || '').toLowerCase().includes(buscaLower) ||
                      (o.Serv_Solicitado || '').toLowerCase().includes(buscaLower) ||
                      (o.Tipo_Servico || '').toLowerCase().includes(buscaLower)
                    )
                  )
                : ordsDisponiveis
              )
            : []

          return (
            <div key={tec.user_id} style={{
              background: '#fff', borderRadius: 16, border: '1px solid #E4E4E7', overflow: 'hidden',
              boxShadow: '0 2px 12px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.02)',
              transition: 'box-shadow 0.2s, transform 0.2s',
            }}>
              {/* Header técnico — colorido */}
              <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16, borderBottom: `3px solid ${tecColor}`, background: `linear-gradient(135deg, ${tecColor}08 0%, #FAFAFA 100%)` }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 14, background: `linear-gradient(135deg, ${tecColor} 0%, ${tecColor}CC 100%)`,
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, fontWeight: 800, flexShrink: 0, position: 'relative',
                  boxShadow: `0 4px 12px ${tecColor}40`,
                }}>
                  {tec.tecnico_nome.charAt(0)}
                  {cam && <div style={{ position: 'absolute', bottom: -2, right: -2, width: 14, height: 14, borderRadius: '50%', background: '#F59E0B', border: '2.5px solid #fff', boxShadow: '0 1px 4px rgba(245,158,11,0.4)' }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: '#18181B', letterSpacing: '-0.01em' }}>{tec.tecnico_nome}</div>
                  <div style={{ fontSize: 13, color: '#52525B', display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                    {statusLabel && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        background: statusDot === '#D97706' ? '#FFFBEB' : statusDot === '#A1A1AA' ? '#F4F4F5' : '#F0FDF4',
                        padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                        color: statusDot === '#D97706' ? '#92400E' : statusDot === '#A1A1AA' ? '#71717A' : '#166534',
                        border: `1px solid ${statusDot === '#D97706' ? '#FDE68A' : statusDot === '#A1A1AA' ? '#E4E4E7' : '#BBF7D0'}`,
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusDot, display: 'inline-block' }} />
                        {statusLabel}
                      </span>
                    )}
                    <span style={{ fontSize: 12, color: '#71717A' }}>{ordsTec.length} em execução</span>
                    {items.length > 0 && <><span style={{ color: '#D4D4D8' }}>·</span><span style={{ fontSize: 12, color: '#71717A' }}>{items.length} na agenda</span></>}
                  </div>
                </div>
                {crono && (
                  <div style={{
                    textAlign: 'right', flexShrink: 0, padding: '10px 16px', borderRadius: 14,
                    background: crono.passaDia ? 'linear-gradient(135deg, #FEF2F2, #FFF)' : '#fff',
                    border: `1px solid ${crono.passaDia ? '#FECACA' : '#E4E4E7'}`,
                    boxShadow: crono.passaDia ? '0 2px 8px rgba(220,38,38,0.08)' : '0 1px 4px rgba(0,0,0,0.04)',
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: crono.passaDia ? '#DC2626' : '#71717A', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {crono.passaDia ? `+${crono.diasExtras}d` : 'Retorno'}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: crono.passaDia ? '#DC2626' : '#18181B', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
                      {crono.retornoHora}
                    </div>
                  </div>
                )}
                {ext.some(a => calculando[a.id]) && !crono && <Loader2 size={16} color="#71717A" className="animate-spin" />}
              </div>

              {/* ── Lista de itens da agenda ── */}
              <div style={{ padding: '16px 20px' }}>
                {items.map((row, idx) => {
                  const isExt = !(row.cliente || '').toLowerCase().includes('nova tratores')
                  return (
                    <div key={row.id} style={{
                      padding: '18px 20px', marginBottom: idx < items.length - 1 ? 12 : 0, borderRadius: 14,
                      border: '1px solid #F0F0F2', background: '#FAFBFC',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
                      transition: 'box-shadow 0.15s, border-color 0.15s',
                    }}>
                      {/* Topo: OS + rota + delete */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{
                            fontSize: 11, fontWeight: 700, color: '#fff', background: `linear-gradient(135deg, ${tecColor} 0%, ${tecColor}CC 100%)`,
                            padding: '5px 12px', borderRadius: 8, letterSpacing: '0.02em',
                            boxShadow: `0 2px 6px ${tecColor}30`,
                          }}>
                            {row.id_ordem || 'Manual'}
                          </span>
                          {row.tempo_ida_min > 0 && (
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#3F3F46', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Truck size={12} color="#71717A" />
                              {fm(row.tempo_ida_min)} · {row.distancia_ida_km}km
                            </span>
                          )}
                          {!row.tempo_ida_min && isExt && (
                            <span style={{ fontSize: 12, color: '#D4D4D8', fontStyle: 'italic' }}>Sem rota</span>
                          )}
                          {!isExt && (
                            <span style={{ fontSize: 12, color: '#A1A1AA', background: '#F4F4F5', padding: '2px 8px', borderRadius: 6, fontWeight: 500 }}>Oficina</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {salvando[row.id] && <Loader2 size={12} className="animate-spin" color="#71717A" />}
                          {calculando[row.id] && <span style={{ fontSize: 11, color: '#71717A', fontStyle: 'italic' }}>Calculando...</span>}
                          <button onClick={() => remover(row.id)} style={{ background: '#FAFAFA', border: '1px solid #F0F0F2', borderRadius: 8, cursor: 'pointer', color: '#D4D4D8', padding: 5, transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            onMouseEnter={e => { e.currentTarget.style.color = '#EF4444'; e.currentTarget.style.borderColor = '#FECACA'; e.currentTarget.style.background = '#FEF2F2' }}
                            onMouseLeave={e => { e.currentTarget.style.color = '#D4D4D8'; e.currentTarget.style.borderColor = '#F0F0F2'; e.currentTarget.style.background = '#FAFAFA' }}
                          ><Trash2 size={13} /></button>
                        </div>
                      </div>

                      {/* Campos editáveis — layout espaçoso */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: '12px 16px' }}>
                        <div style={{ position: 'relative' }}>
                          <label style={LBL}>Cliente</label>
                          <input
                            value={clienteDropdownId === row.id ? clienteFilter : (row.cliente || '')}
                            onFocus={() => { setClienteDropdownId(row.id); setClienteFilter(row.cliente || '') }}
                            onChange={e => { setClienteFilter(e.target.value); setClienteDropdownId(row.id) }}
                            onBlur={e => { setTimeout(() => { if (clienteDropdownId === row.id) { setClienteDropdownId(null); if (e.target.value !== (row.cliente || '')) salvarCampo(row.id, 'cliente', e.target.value) } }, 200) }}
                            placeholder="Buscar cliente..."
                            style={INP}
                          />
                          {clienteDropdownId === row.id && clienteFilter && clientesFiltrados.length > 0 && (
                            <div style={{
                              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                              background: '#fff', border: '1px solid #E4E4E7', borderRadius: 12,
                              boxShadow: '0 12px 32px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)', maxHeight: 200, overflowY: 'auto', marginTop: 6,
                            }}>
                              {clientesFiltrados.map(c => (
                                <div key={c.chave}
                                  onMouseDown={e => {
                                    e.preventDefault()
                                    const nome = c.display.split('[')[0].trim()
                                    salvarCampo(row.id, 'cliente', nome)
                                    setClienteDropdownId(null)
                                    setClienteFilter('')
                                  }}
                                  style={{
                                    padding: '10px 14px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #F4F4F5',
                                    transition: 'all 0.1s',
                                  }}
                                  onMouseEnter={e => { e.currentTarget.style.background = '#F4F4F5'; e.currentTarget.style.paddingLeft = '18px' }}
                                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.paddingLeft = '14px' }}
                                >
                                  <div style={{ fontWeight: 600, color: '#18181B' }}>{c.display.split('[')[0].trim()}</div>
                                  {c.display.includes('[') && (
                                    <div style={{ fontSize: 11, color: '#A1A1AA', marginTop: 1 }}>{c.display.substring(c.display.indexOf('['))}</div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div>
                          <label style={LBL}>Horas</label>
                          <input type="number" step="0.5" min="0.5" defaultValue={row.qtd_horas} onBlur={e => { const v = parseFloat(e.target.value) || 2; if (v !== row.qtd_horas) salvarCampo(row.id, 'qtd_horas', v) }} style={INP} />
                        </div>
                      </div>

                      {/* Endereço unificado */}
                      <div style={{ marginTop: 12 }}>
                        <label style={LBL}>
                          <MapPin size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4 }} />
                          Endereço
                        </label>
                        <input
                          defaultValue={[row.endereco, row.cidade].filter(Boolean).join(', ')}
                          placeholder="Ex: Fazenda São José, Piraju - SP"
                          onBlur={e => {
                            const v = e.target.value.trim()
                            const atual = [row.endereco, row.cidade].filter(Boolean).join(', ')
                            if (v !== atual) {
                              // Separar cidade do endereço: última parte após vírgula ou traço
                              const parts = v.split(/[,\-]/).map(p => p.trim()).filter(Boolean)
                              let endereco = v, cidade = ''
                              if (parts.length >= 2) {
                                cidade = parts[parts.length - 1]
                                endereco = parts.slice(0, -1).join(', ')
                              }
                              salvarCampo(row.id, 'endereco', endereco)
                              if (cidade !== (row.cidade || '')) salvarCampo(row.id, 'cidade', cidade)
                            }
                          }}
                          style={INP}
                        />
                      </div>

                      {/* Indicador visual de distância */}
                      {isExt && (row.tempo_ida_min > 0 || calculando[row.id]) && (
                        <div style={{
                          marginTop: 14, padding: '14px 16px', borderRadius: 12,
                          background: row.tempo_ida_min > 120 ? 'linear-gradient(135deg, #FEF2F2, #FFF5F5)' : row.tempo_ida_min > 60 ? 'linear-gradient(135deg, #FFFBEB, #FFFFF0)' : 'linear-gradient(135deg, #F0FDF4, #F7FEF9)',
                          border: `1px solid ${row.tempo_ida_min > 120 ? '#FECACA' : row.tempo_ida_min > 60 ? '#FDE68A' : '#BBF7D0'}`,
                          display: 'flex', alignItems: 'center', gap: 16,
                        }}>
                          {calculando[row.id] ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#71717A', fontSize: 12, fontWeight: 500 }}>
                              <Loader2 size={14} className="animate-spin" /> Calculando rota...
                            </div>
                          ) : (
                            <>
                              {/* Ida */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{
                                  width: 32, height: 32, borderRadius: 10,
                                  background: row.tempo_ida_min > 120 ? '#FEE2E2' : row.tempo_ida_min > 60 ? '#FEF3C7' : '#DCFCE7',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                                }}>
                                  <Truck size={15} color={row.tempo_ida_min > 120 ? '#DC2626' : row.tempo_ida_min > 60 ? '#D97706' : '#16A34A'} />
                                </div>
                                <div>
                                  <div style={{ fontSize: 10, color: '#71717A', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Ida</div>
                                  <div style={{ fontSize: 15, fontWeight: 800, color: '#18181B', lineHeight: 1 }}>{fm(row.tempo_ida_min)}</div>
                                </div>
                              </div>

                              <div style={{ width: 1, height: 28, background: '#E4E4E7' }} />

                              {/* Volta */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{
                                  width: 32, height: 32, borderRadius: 10,
                                  background: row.tempo_volta_min > 120 ? '#FEE2E2' : row.tempo_volta_min > 60 ? '#FEF3C7' : '#DCFCE7',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                                }}>
                                  <ArrowLeft size={15} color={row.tempo_volta_min > 120 ? '#DC2626' : row.tempo_volta_min > 60 ? '#D97706' : '#16A34A'} />
                                </div>
                                <div>
                                  <div style={{ fontSize: 10, color: '#71717A', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Volta</div>
                                  <div style={{ fontSize: 15, fontWeight: 800, color: '#18181B', lineHeight: 1 }}>{fm(row.tempo_volta_min)}</div>
                                </div>
                              </div>

                              <div style={{ width: 1, height: 28, background: '#E4E4E7' }} />

                              {/* Distância */}
                              <div>
                                <div style={{ fontSize: 10, color: '#71717A', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Distância</div>
                                <div style={{ fontSize: 15, fontWeight: 800, color: '#18181B', lineHeight: 1 }}>{row.distancia_ida_km} km</div>
                              </div>

                              <div style={{ flex: 1 }} />

                              {/* Total ida+volta */}
                              <div style={{
                                padding: '6px 14px', borderRadius: 10,
                                background: `linear-gradient(135deg, ${(row.tempo_ida_min + row.tempo_volta_min) > 240 ? '#DC2626' : (row.tempo_ida_min + row.tempo_volta_min) > 120 ? '#D97706' : '#16A34A'} 0%, ${(row.tempo_ida_min + row.tempo_volta_min) > 240 ? '#B91C1C' : (row.tempo_ida_min + row.tempo_volta_min) > 120 ? '#B45309' : '#15803D'} 100%)`,
                                color: '#fff', fontSize: 12, fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                              }}>
                                Total: {fm(row.tempo_ida_min + row.tempo_volta_min)}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* Observações */}
                      <div style={{ marginTop: 12 }}>
                        <label style={LBL}>Observações</label>
                        <input defaultValue={row.observacoes || ''} placeholder="Obs..." onBlur={e => { if (e.target.value !== (row.observacoes || '')) salvarCampo(row.id, 'observacoes', e.target.value) }} style={INP} />
                      </div>
                    </div>
                  )
                })}

                {items.length === 0 && !isAdding && (
                  <div style={{ textAlign: 'center', padding: '36px 0', color: '#D4D4D8' }}>
                    <Briefcase size={28} style={{ marginBottom: 8, opacity: 0.5 }} />
                    <div style={{ fontSize: 13, fontWeight: 500 }}>Nenhuma OS em execução</div>
                  </div>
                )}
              </div>

              {/* ── Painel de adicionar ── */}
              {isAdding ? (
                <div style={{ borderTop: '2px solid #F0F0F2', background: 'linear-gradient(180deg, #FAFAFA, #F5F5F5)' }}>
                  {/* Tabs OS / Manual */}
                  <div style={{ display: 'flex', borderBottom: '1px solid #E4E4E7', padding: '0 4px' }}>
                    <button onClick={() => setAddMode('os')} style={{
                      flex: 1, padding: '12px 0', fontSize: 12, fontWeight: addMode === 'os' ? 700 : 400, border: 'none', cursor: 'pointer',
                      background: 'transparent', color: addMode === 'os' ? '#18181B' : '#A1A1AA',
                      borderBottom: addMode === 'os' ? `2px solid ${tecColor}` : '2px solid transparent', marginBottom: -1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      transition: 'all 0.15s',
                    }}>
                      <FileText size={12} /> Ordens de Serviço
                      {ordsDisponiveis.length > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 600, background: tecColor, color: '#fff', padding: '2px 8px', borderRadius: 10 }}>
                          {ordsDisponiveis.length}
                        </span>
                      )}
                    </button>
                    <button onClick={() => setAddMode('manual')} style={{
                      flex: 1, padding: '12px 0', fontSize: 12, fontWeight: addMode === 'manual' ? 700 : 400, border: 'none', cursor: 'pointer',
                      background: 'transparent', color: addMode === 'manual' ? '#18181B' : '#A1A1AA',
                      borderBottom: addMode === 'manual' ? `2px solid ${tecColor}` : '2px solid transparent', marginBottom: -1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      transition: 'all 0.15s',
                    }}>
                      <Plus size={12} /> Entrada manual
                    </button>
                  </div>

                  {/* ── Tab OS: lista de ordens do técnico ── */}
                  {addMode === 'os' && (
                    <div style={{ padding: '14px 16px' }}>
                      {/* Busca */}
                      <div style={{ position: 'relative', marginBottom: 12 }}>
                        <Search size={14} color="#A1A1AA" style={{ position: 'absolute', left: 12, top: 11 }} />
                        <input
                          value={buscaOS}
                          onChange={e => setBuscaOS(e.target.value)}
                          placeholder="Buscar OS, cliente, cidade, serviço..."
                          style={{ ...INP, paddingLeft: 36 }}
                        />
                      </div>

                      {/* Lista de OS */}
                      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                        {ordsFiltradas.length === 0 ? (
                          <div style={{ textAlign: 'center', padding: '16px 0', color: '#D4D4D8', fontSize: 12 }}>
                            {buscaOS ? 'Nenhuma OS encontrada' : 'Todas as ordens já estão na agenda'}
                          </div>
                        ) : (
                          ordsFiltradas.map(os => {
                            const horas = parseFloat(String(os.Qtd_HR || 0)) || 2
                            const isTecPrimario = match(tec.tecnico_nome, os.Os_Tecnico)
                            return (
                              <div key={os.Id_Ordem} style={{
                                padding: '12px 14px', marginBottom: 8, borderRadius: 12,
                                border: '1px solid #F0F0F2', background: '#fff', cursor: 'pointer',
                                transition: 'all 0.15s', boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                              }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = '#D4D4D8'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)' }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = '#F0F0F2'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.02)' }}
                              >
                                {/* Linha 1: ID + tipo + botão */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: '#18181B' }}>{os.Id_Ordem}</span>
                                    {os.Tipo_Servico && (
                                      <span style={{ fontSize: 10, fontWeight: 600, color: '#71717A', background: '#F4F4F5', padding: '2px 8px', borderRadius: 6 }}>
                                        {os.Tipo_Servico}
                                      </span>
                                    )}
                                    {!isTecPrimario && (
                                      <span style={{ fontSize: 9, fontWeight: 600, color: '#A1A1AA', background: '#FAFAFA', padding: '2px 6px', borderRadius: 4 }}>
                                        2o técn.
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => adicionarOS(tec.tecnico_nome, os)}
                                    disabled={!!salvando[-1]}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: 5,
                                      background: `linear-gradient(135deg, ${tecColor} 0%, ${tecColor}CC 100%)`, color: '#fff', border: 'none', borderRadius: 8,
                                      padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                      boxShadow: `0 2px 6px ${tecColor}30`, transition: 'all 0.15s',
                                    }}
                                  >
                                    {salvando[-1] ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />} Adicionar
                                  </button>
                                </div>

                                {/* Linha 2: Cliente */}
                                <div style={{ fontSize: 13, fontWeight: 500, color: '#3F3F46', marginBottom: 2 }}>
                                  {os.Os_Cliente}
                                </div>

                                {/* Linha 3: Detalhes */}
                                <div style={{ fontSize: 11, color: '#A1A1AA', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                  {os.Cidade_Cliente && <span>{os.Cidade_Cliente}</span>}
                                  {os.Cidade_Cliente && horas > 0 && <span style={{ color: '#E4E4E7' }}>·</span>}
                                  <span>{horas}h</span>
                                  {os.Serv_Solicitado && (
                                    <>
                                      <span style={{ color: '#E4E4E7' }}>·</span>
                                      <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {os.Serv_Solicitado}
                                      </span>
                                    </>
                                  )}
                                  {os.Previsao_Execucao && (
                                    <>
                                      <span style={{ color: '#E4E4E7' }}>·</span>
                                      <span>Prev: {new Date(os.Previsao_Execucao + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
                                    </>
                                  )}
                                </div>

                                {/* Endereço */}
                                {os.Endereco_Cliente && (
                                  <div style={{ fontSize: 11, color: '#D4D4D8', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <MapPin size={10} /> {os.Endereco_Cliente}
                                  </div>
                                )}
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Tab Manual ── */}
                  {addMode === 'manual' && (
                    <div style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginBottom: 8 }}>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <label style={LBL}>Cliente</label>
                          <input value={form.cliente} onChange={e => setForm(p => ({ ...p, cliente: e.target.value }))} placeholder="Nome do cliente..." style={INP} />
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <label style={LBL}><MapPin size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4 }} />Endereço</label>
                          <input value={[form.endereco, form.cidade].filter(Boolean).join(form.endereco && form.cidade ? ', ' : '')}
                            onChange={e => {
                              const v = e.target.value
                              const parts = v.split(/[,\-]/).map(p => p.trim()).filter(Boolean)
                              if (parts.length >= 2) {
                                setForm(p => ({ ...p, endereco: parts.slice(0, -1).join(', '), cidade: parts[parts.length - 1] }))
                              } else {
                                setForm(p => ({ ...p, endereco: v, cidade: '' }))
                              }
                            }}
                            placeholder="Ex: Fazenda São José, Piraju - SP" style={INP} />
                        </div>
                        <div>
                          <label style={LBL}>Serviço</label>
                          <input value={form.servico} onChange={e => setForm(p => ({ ...p, servico: e.target.value }))} placeholder="Tipo de serviço..." style={INP} />
                        </div>
                        <div>
                          <label style={LBL}>Horas/dia</label>
                          <input type="number" step="0.5" min="0.5" value={form.horas} onChange={e => setForm(p => ({ ...p, horas: parseFloat(e.target.value) || 1 }))} style={INP} />
                        </div>
                        <div>
                          <label style={LBL}>Data Início</label>
                          <input type="date" value={form.dataInicio || hoje} onChange={e => setForm(p => ({ ...p, dataInicio: e.target.value }))} style={INP} />
                        </div>
                        <div>
                          <label style={LBL}>Data Fim</label>
                          <input type="date" value={form.dataFim || hoje} onChange={e => setForm(p => ({ ...p, dataFim: e.target.value }))} style={INP} />
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <label style={LBL}>Observações</label>
                          <input value={form.obs} onChange={e => setForm(p => ({ ...p, obs: e.target.value }))} placeholder="Obs..." style={INP} />
                        </div>
                      </div>

                      {form.dataInicio && form.dataFim && form.dataFim >= form.dataInicio && (
                        <div style={{ fontSize: 11, color: '#A1A1AA', marginBottom: 10 }}>
                          {Math.round((new Date(form.dataFim + 'T00:00:00').getTime() - new Date((form.dataInicio || hoje) + 'T00:00:00').getTime()) / 86400000) + 1} dia(s) · Total: {form.horas * Math.max(1, Math.round((new Date(form.dataFim + 'T00:00:00').getTime() - new Date(form.dataInicio + 'T00:00:00').getTime()) / 86400000) + 1)}h
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 10 }}>
                        <button onClick={() => adicionarManual(tec.tecnico_nome)} disabled={!form.cliente || salvando[-1]}
                          style={{
                            flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600, borderRadius: 10, border: 'none', cursor: 'pointer',
                            background: form.cliente ? `linear-gradient(135deg, ${tecColor} 0%, ${tecColor}CC 100%)` : '#E4E4E7',
                            color: form.cliente ? '#fff' : '#A1A1AA',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            boxShadow: form.cliente ? `0 2px 8px ${tecColor}30` : 'none',
                            transition: 'all 0.15s',
                          }}>
                          {salvando[-1] ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Adicionar
                        </button>
                        <button onClick={fecharAdd}
                          style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid #E4E4E7', background: '#fff', cursor: 'pointer', color: '#71717A', fontSize: 13, fontWeight: 500, transition: 'all 0.15s' }}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Botão fechar no rodapé */}
                  {addMode === 'os' && (
                    <div style={{ padding: '10px 14px', borderTop: '1px solid #F0F0F2', textAlign: 'center' }}>
                      <button onClick={fecharAdd} style={{
                        background: '#fff', border: '1px solid #E4E4E7', borderRadius: 8, cursor: 'pointer', color: '#71717A', fontSize: 12, fontWeight: 500,
                        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 16px',
                        transition: 'all 0.15s',
                      }}>
                        <X size={11} /> Fechar
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <button onClick={() => abrirAdd(tec.tecnico_nome)}
                  style={{
                    width: '100%', padding: '12px 0', fontSize: 12, fontWeight: 600, color: '#71717A',
                    background: 'transparent', border: 'none', borderTop: '1px solid #F0F0F2', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#FAFAFA'; e.currentTarget.style.color = '#18181B' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#71717A' }}
                >
                  <Plus size={13} /> Adicionar
                </button>
              )}

              {/* ── Cronograma ── */}
              {crono && (
                <>
                  <button onClick={() => setCronoAberto(p => ({ ...p, [tec.tecnico_nome]: !p[tec.tecnico_nome] }))} style={{
                    width: '100%', padding: '10px 0', fontSize: 12, fontWeight: 600, color: '#71717A',
                    background: 'transparent', border: 'none', borderTop: '1px solid #F0F0F2', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    transition: 'all 0.15s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#FAFAFA'; e.currentTarget.style.color = '#18181B' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#71717A' }}
                  >
                    <Clock size={12} /> {cronoAberto[tec.tecnico_nome] ? 'Ocultar cronograma' : 'Ver cronograma'}
                    <ChevronDown size={12} style={{ transform: cronoAberto[tec.tecnico_nome] ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                  </button>
                  {cronoAberto[tec.tecnico_nome] && (
                    <div style={{ padding: '14px 20px 18px', background: 'linear-gradient(180deg, #FAFAFA, #F5F5F5)', borderTop: '1px solid #F0F0F2' }}>
                      {crono.trechos.map((tr, i) => (
                        <div key={i}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' }}>
                            <div style={{
                              width: 26, height: 26, borderRadius: 8,
                              background: tr.tipo === 'proximo_dia' ? '#FEE2E2' : tr.tipo === 'almoco' ? '#FEF3C7' : tr.tipo === 'servico' ? '#EEF2FF' : '#F4F4F5',
                              color: tr.tipo === 'proximo_dia' ? '#DC2626' : tr.tipo === 'almoco' ? '#D97706' : tr.tipo === 'servico' ? '#6366F1' : '#71717A',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                            }}>
                              {IC[tr.icon]}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: '#18181B' }}>{tr.label}</div>
                              <div style={{ fontSize: 11, color: '#A1A1AA' }}>{tr.sublabel}</div>
                            </div>
                            <div style={{
                              fontSize: tr.tipo === 'retorno' ? 15 : 12, fontWeight: tr.tipo === 'retorno' ? 800 : 600,
                              color: tr.tipo === 'proximo_dia' || tr.tipo === 'retorno' ? '#18181B' : '#71717A',
                              fontVariantNumeric: 'tabular-nums',
                              background: tr.tipo === 'retorno' ? '#F4F4F5' : 'transparent',
                              padding: tr.tipo === 'retorno' ? '4px 10px' : 0, borderRadius: 8,
                            }}>
                              {tr.horaInicio}
                            </div>
                          </div>
                          {i < crono.trechos.length - 1 && <div style={{ marginLeft: 13, borderLeft: '2px dashed #E4E4E7', height: 6 }} />}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

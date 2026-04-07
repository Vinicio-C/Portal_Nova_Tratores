'use client'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import {
  MapPin, Clock, ChevronDown, Truck,
  Coffee, ArrowRight, ArrowLeft, Briefcase, Moon,
  RefreshCw, Wrench, Navigation, Timer, Radio, LogOut, Home,
  Car, Activity, Zap
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
interface Veiculo { id: number; placa: string; descricao: string }
interface VinculoVeiculo { id: number; tecnico_nome: string; adesao_id: number; placa: string; descricao: string }
interface EventoGPS {
  tipo: string; horario: string; lat: number; lng: number; na_loja: boolean
}
interface ViagemGPS {
  adesao_id: number; placa: string; descricao: string; data: string
  saida_loja: string | null; chegada_cliente: string | null
  saida_cliente: string | null; retorno_loja: string | null
  eventos: EventoGPS[]; posicoes_total: number
  ultima_posicao: { dt: string; lat: number; lng: number; ignicao: number; velocidade: number } | null
}
interface VisitaGPS {
  saida: string | null; chegada: string | null
  saidaCliente: string | null; retorno: string | null
}
interface EstimadoCliente {
  saida: number; chegada: number; fimServico: number; retorno: number | null
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
function fHora(iso: string | null): string {
  if (!iso) return '--:--'
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function isoToMin(iso: string): number { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes() }

function diffLabel(estMin: number, realIso: string | null): { text: string; color: string; bg: string } | null {
  if (!realIso) return null
  const diff = isoToMin(realIso) - estMin
  if (Math.abs(diff) <= 5) return { text: 'pontual', color: '#059669', bg: '#ECFDF5' }
  if (diff > 0) return { text: `+${fm(diff)}`, color: '#DC2626', bg: '#FEF2F2' }
  return { text: `-${fm(Math.abs(diff))}`, color: '#059669', bg: '#ECFDF5' }
}

// ── GPS: agrupar eventos em visitas por cliente ──
function agruparVisitasGPS(eventos: EventoGPS[]): VisitaGPS[] {
  const visitas: VisitaGPS[] = []
  let cur: VisitaGPS = { saida: null, chegada: null, saidaCliente: null, retorno: null }
  let hasData = false

  for (const ev of eventos) {
    if (ev.tipo === 'parada' || ev.tipo === 'inicio_movimento') continue
    if (ev.tipo === 'saida_loja') {
      if (hasData) { visitas.push({ ...cur }); cur = { saida: null, chegada: null, saidaCliente: null, retorno: null } }
      cur.saida = ev.horario; hasData = true
    } else if (ev.tipo === 'chegada_cliente') {
      if (cur.saidaCliente) {
        visitas.push({ ...cur })
        cur = { saida: cur.saidaCliente, chegada: ev.horario, saidaCliente: null, retorno: null }
      } else { cur.chegada = ev.horario }
      hasData = true
    } else if (ev.tipo === 'saida_cliente') {
      cur.saidaCliente = ev.horario; hasData = true
    } else if (ev.tipo === 'retorno_loja') {
      cur.retorno = ev.horario; visitas.push({ ...cur })
      cur = { saida: null, chegada: null, saidaCliente: null, retorno: null }; hasData = false
    }
  }
  if (hasData) visitas.push(cur)
  return visitas
}

// ── Estimativas por cliente (tempos em minutos desde 00:00) ──
const S = 510, AI = 660, AD = 90, FE = 1080

function estimativasPorCliente(items: AgendaRow[]): EstimadoCliente[] {
  const result: EstimadoCliente[] = []
  let cursor = S; let almocou = false
  for (let i = 0; i < items.length; i++) {
    const r = items[i]
    const tempoIda = r.tempo_ida_min || 0
    const servico = (r.qtd_horas || 2) * 60
    const saida = cursor
    cursor += tempoIda
    const chegada = cursor
    if (!almocou && cursor >= AI && cursor < AI + 120) { cursor += AD; almocou = true }
    cursor += servico
    const fimServico = cursor
    if (!almocou && cursor >= AI && cursor < AI + 120) { cursor += AD; almocou = true }
    let retorno: number | null = null
    if (i === items.length - 1) { cursor += (r.tempo_volta_min || 0); retorno = cursor }
    result.push({ saida, chegada, fimServico, retorno })
  }
  return result
}

// ── Cronograma (inalterado) ──
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

const COLORS = ['#6366F1', '#0EA5E9', '#F59E0B', '#10B981', '#EC4899', '#8B5CF6', '#F97316', '#14B8A6']

// ── CSS Animations ──
const CSS = `
@keyframes vg-fadeIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
@keyframes vg-pulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
@keyframes vg-slideDown { from { opacity: 0; max-height: 0; } to { opacity: 1; max-height: 2000px; } }
@keyframes vg-glow { 0%,100% { box-shadow: 0 0 0 0 rgba(99,102,241,.2); } 50% { box-shadow: 0 0 0 6px rgba(99,102,241,0); } }
.vg-card { animation: vg-fadeIn .45s cubic-bezier(.22,1,.36,1) both; transition: transform .2s, box-shadow .2s; }
.vg-card:hover { transform: translateY(-3px); box-shadow: 0 12px 40px rgba(0,0,0,.08) !important; }
.vg-crono-body { animation: vg-slideDown .35s ease-out both; overflow: hidden; }
.vg-gps-row { animation: vg-fadeIn .35s ease-out both; }
.vg-status-dot { animation: vg-pulse 2s ease-in-out infinite; }
.vg-sync-btn { transition: all .2s; }
.vg-sync-btn:hover { transform: scale(1.04); box-shadow: 0 4px 16px rgba(0,0,0,.2) !important; }
.vg-vehicle-select { transition: border-color .2s, box-shadow .2s; }
.vg-vehicle-select:focus { border-color: #6366F1 !important; box-shadow: 0 0 0 3px rgba(99,102,241,.12) !important; }
.vg-os-card { transition: all .2s; }
.vg-os-card:hover { border-color: #D4D4D8 !important; background: #F9FAFB !important; }
.vg-crono-btn { transition: all .2s; }
.vg-crono-btn:hover { background: #F4F4F5 !important; color: #18181B !important; }
.vg-time-cell { transition: transform .15s; }
.vg-time-cell:hover { transform: scale(1.05); }
`

// ── Component ──
export default function BlocoVisaoGeral({ tecnicos, ordens, caminhos }: { tecnicos: Tecnico[]; ordens: OrdemServico[]; caminhos: Caminho[] }) {
  const [agenda, setAgenda] = useState<AgendaRow[]>([])
  const [syncing, setSyncing] = useState(false)
  const [cronoAberto, setCronoAberto] = useState<Record<string, boolean>>({})
  const [veiculos, setVeiculos] = useState<Veiculo[]>([])
  const [vinculos, setVinculos] = useState<VinculoVeiculo[]>([])
  const [viagensPorTec, setViagensPorTec] = useState<Record<string, ViagemGPS>>({})
  const [gpsLoading, setGpsLoading] = useState(false)

  const tecs = useMemo(() => tecnicos.filter(t => t.mecanico_role === 'tecnico'), [tecnicos])
  const hoje = useMemo(() => new Date().toISOString().split('T')[0], [])

  // ── API agenda ──
  const calcRota = useCallback(async (row: AgendaRow) => {
    try {
      const r = await fetch('/api/pos/agenda-visao', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id, calcular: true }) })
      if (r.ok) { const u = await r.json(); setAgenda(p => p.map(a => a.id === row.id ? u : a)) }
    } catch { }
  }, [])

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/pos/agenda-visao?data=${hoje}`)
    if (r.ok) { const rows = await r.json(); setAgenda(rows); return rows as AgendaRow[] }
    return []
  }, [hoje])

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
      })

      if (payload.length > 0) {
        const r = await fetch('/api/pos/agenda-visao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: hoje, tecnicos: payload }) })
        if (r.ok) { const rows = await r.json() as AgendaRow[]; setAgenda(rows); rows.filter(r => r.tempo_ida_min === 0 && r.endereco).forEach(r => calcRota(r)) }
      } else {
        await carregar()
      }
    } finally { setSyncing(false) }
  }, [hoje, carregar, calcRota])

  // ── GPS ──
  const carregarVeiculos = useCallback(async () => {
    try { const r = await fetch('/api/pos/rastreamento?acao=veiculos'); if (r.ok) setVeiculos(await r.json()) } catch { }
  }, [])

  const carregarVinculos = useCallback(async () => {
    const { data } = await supabase.from('tecnico_veiculos').select('*')
    if (data) setVinculos(data as VinculoVeiculo[])
  }, [])

  const carregarGPS = useCallback(async (vincs: VinculoVeiculo[]) => {
    if (vincs.length === 0) return
    setGpsLoading(true)
    const map: Record<string, ViagemGPS> = {}
    for (const v of vincs) {
      try {
        const r = await fetch(`/api/pos/rastreamento?acao=viagens&adesao_id=${v.adesao_id}`)
        if (r.ok) {
          const viagens: ViagemGPS[] = await r.json()
          const deHoje = viagens.find(vi => vi.data === hoje)
          if (deHoje) map[v.tecnico_nome] = deHoje
        }
      } catch { }
    }
    setViagensPorTec(map)
    setGpsLoading(false)
  }, [hoje])

  const vincularVeiculo = useCallback(async (tecNome: string, adesaoId: number) => {
    const vei = veiculos.find(v => v.id === adesaoId)
    if (!vei) return
    const { data: existing } = await supabase.from('tecnico_veiculos').select('id').eq('tecnico_nome', tecNome).single()
    if (existing) await supabase.from('tecnico_veiculos').update({ adesao_id: adesaoId, placa: vei.placa, descricao: vei.descricao }).eq('id', existing.id)
    else await supabase.from('tecnico_veiculos').insert({ tecnico_nome: tecNome, adesao_id: adesaoId, placa: vei.placa, descricao: vei.descricao })
    await carregarVinculos()
    try {
      const r = await fetch(`/api/pos/rastreamento?acao=viagens&adesao_id=${adesaoId}`)
      if (r.ok) {
        const viagens: ViagemGPS[] = await r.json()
        const deHoje = viagens.find(v => v.data === hoje)
        if (deHoje) setViagensPorTec(p => ({ ...p, [tecNome]: deHoje }))
        else setViagensPorTec(p => { const n = { ...p }; delete n[tecNome]; return n })
      }
    } catch { }
  }, [veiculos, hoje, carregarVinculos])

  const desvincularVeiculo = useCallback(async (tecNome: string) => {
    await supabase.from('tecnico_veiculos').delete().eq('tecnico_nome', tecNome)
    await carregarVinculos()
    setViagensPorTec(p => { const n = { ...p }; delete n[tecNome]; return n })
  }, [carregarVinculos])

  // ── Init ──
  useEffect(() => {
    if (!tecs.length || !ordens.length) return
    sincronizar()
    carregarVeiculos()
    carregarVinculos().then(async () => {
      const { data } = await supabase.from('tecnico_veiculos').select('*')
      if (data && data.length > 0) carregarGPS(data as VinculoVeiculo[])
    })
  }, [tecs.length, ordens.length, sincronizar, carregarVeiculos, carregarVinculos, carregarGPS])

  // ── Computed ──
  const porTec = useMemo(() => {
    const m: Record<string, AgendaRow[]> = {}
    tecs.forEach(t => { m[t.tecnico_nome] = agenda.filter(a => a.tecnico_nome === t.tecnico_nome).sort((a, b) => a.ordem_sequencia - b.ordem_sequencia) })
    return m
  }, [tecs, agenda])

  const camPorTec = useMemo(() => {
    const m: Record<string, Caminho | null> = {}
    tecs.forEach(t => { m[t.tecnico_nome] = caminhos.find(c => c.tecnico_nome === t.tecnico_nome && c.status === 'em_transito') || null })
    return m
  }, [tecs, caminhos])

  const oficina = (items: AgendaRow[]) => items.length === 0 || items.every(a => (a.cliente || '').toLowerCase().includes('nova tratores'))

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

  const vinculoPorTec = useMemo(() => {
    const m: Record<string, VinculoVeiculo | null> = {}
    tecs.forEach(t => { m[t.tecnico_nome] = vinculos.find(v => v.tecnico_nome === t.tecnico_nome) || null })
    return m
  }, [tecs, vinculos])

  const veiculosVinculados = useMemo(() => new Set(vinculos.map(v => v.adesao_id)), [vinculos])

  // ── Render ──
  return (
    <>
      <style>{CSS}</style>
      <div>
        {/* ══════ HEADER ══════ */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24,
          padding: '20px 28px', background: '#fff', borderRadius: 16, border: '1px solid #E5E7EB',
          boxShadow: '0 1px 3px rgba(0,0,0,.04), 0 1px 2px rgba(0,0,0,.02)',
        }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', letterSpacing: '-.02em' }}>
              {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
            <div style={{ fontSize: 13, color: '#9CA3AF', marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{tecs.length} tecnicos</span>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#D1D5DB', display: 'inline-block' }} />
              <span>{ordens.filter(o => o.Status === 'Execução').length} em execucao</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <a href="/tv-painel" target="_blank" rel="noopener" style={{
              fontSize: 12, fontWeight: 600, color: '#6B7280', textDecoration: 'none',
              border: '1px solid #E5E7EB', borderRadius: 10, padding: '8px 16px', background: '#F9FAFB',
              transition: 'all .2s',
            }}>TV</a>
            <button className="vg-sync-btn" onClick={sincronizar} disabled={syncing} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'linear-gradient(135deg, #111827, #374151)', color: '#fff', border: 'none', borderRadius: 10,
              padding: '9px 20px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,.15)',
            }}>
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} /> Sincronizar
            </button>
          </div>
        </div>

        {/* ══════ GRID TECNICOS ══════ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(520px, 1fr))', gap: 20 }}>
          {tecs.map((tec, tecIdx) => {
            const items = porTec[tec.tecnico_nome] || []
            const cam = camPorTec[tec.tecnico_nome]
            const naOfi = !cam && oficina(items)
            const ext = items.filter(a => !(a.cliente || '').toLowerCase().includes('nova tratores'))
            const crono = ext.length > 0 && ext.every(a => a.tempo_ida_min > 0) ? cronograma(ext) : null
            const ordsTec = ordensPorTec[tec.tecnico_nome] || []
            const tecColor = COLORS[tecIdx % COLORS.length]
            const vinculo = vinculoPorTec[tec.tecnico_nome]
            const viagem = viagensPorTec[tec.tecnico_nome] || null

            // Status
            let statusLabel = '', statusColor = '', statusBg = ''
            if (cam) { statusLabel = 'Em transito'; statusColor = '#D97706'; statusBg = '#FFFBEB' }
            else if (naOfi) { statusLabel = 'Na oficina'; statusColor = '#6B7280'; statusBg = '#F3F4F6' }
            else if (ext.length > 0) { statusLabel = 'Em campo'; statusColor = '#059669'; statusBg = '#ECFDF5' }

            // GPS: agrupar visitas e estimativas
            const visitasGPS = viagem ? agruparVisitasGPS(viagem.eventos) : []
            const estimados = ext.length > 0 && ext.every(a => a.tempo_ida_min > 0) ? estimativasPorCliente(ext) : []
            const maxVisitas = Math.max(ext.length, visitasGPS.length)

            // Destino
            const proximoItem = ext[0]
            const destinoLabel = cam ? cam.destino : proximoItem ? (proximoItem.cliente || proximoItem.id_ordem || '—') : null
            const destinoCidade = cam ? cam.cidade : proximoItem?.cidade || ''

            return (
              <div key={tec.user_id} className="vg-card" style={{
                background: '#fff', borderRadius: 16, border: '1px solid #E5E7EB', overflow: 'hidden',
                boxShadow: '0 2px 8px rgba(0,0,0,.04)', animationDelay: `${tecIdx * .07}s`,
              }}>
                {/* ── HEADER CARD ── */}
                <div style={{
                  padding: '20px 24px', borderBottom: '1px solid #F3F4F6',
                  background: `linear-gradient(135deg, ${tecColor}06 0%, #fff 100%)`,
                  position: 'relative', overflow: 'hidden',
                }}>
                  {/* Accent line */}
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${tecColor}, ${tecColor}88)` }} />

                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    {/* Avatar */}
                    <div style={{
                      width: 48, height: 48, borderRadius: 14,
                      background: `linear-gradient(135deg, ${tecColor}, ${tecColor}BB)`,
                      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 20, fontWeight: 800, flexShrink: 0, position: 'relative',
                      boxShadow: `0 4px 14px ${tecColor}35`,
                    }}>
                      {tec.tecnico_nome.charAt(0)}
                      {cam && <div style={{ position: 'absolute', bottom: -2, right: -2, width: 14, height: 14, borderRadius: '50%', background: '#F59E0B', border: '2.5px solid #fff' }} />}
                    </div>

                    {/* Name + status */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#111827', letterSpacing: '-.01em' }}>
                        {tec.tecnico_nome}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
                        {statusLabel && (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            background: statusBg, padding: '3px 10px', borderRadius: 20,
                            fontSize: 11, fontWeight: 700, color: statusColor,
                          }}>
                            <span className="vg-status-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
                            {statusLabel}
                          </span>
                        )}
                        <span style={{ fontSize: 12, color: '#9CA3AF' }}>{ordsTec.length} OS</span>
                        {vinculo && (
                          <span style={{ fontSize: 11, color: '#6366F1', display: 'flex', alignItems: 'center', gap: 3, fontWeight: 600 }}>
                            <Car size={11} /> {vinculo.placa}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* ETA badge */}
                    {crono && (
                      <div style={{
                        textAlign: 'right', flexShrink: 0, padding: '8px 14px', borderRadius: 12,
                        background: crono.passaDia ? '#FEF2F2' : '#F9FAFB',
                        border: `1px solid ${crono.passaDia ? '#FECACA' : '#E5E7EB'}`,
                      }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: crono.passaDia ? '#DC2626' : '#9CA3AF', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                          {crono.passaDia ? `+${crono.diasExtras}d` : 'Retorno est.'}
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: crono.passaDia ? '#DC2626' : '#111827', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
                          {crono.retornoHora}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Vehicle selector */}
                  <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Car size={14} color={vinculo ? '#6366F1' : '#D1D5DB'} />
                    <select
                      className="vg-vehicle-select"
                      value={vinculo?.adesao_id || ''}
                      onChange={e => {
                        const val = Number(e.target.value)
                        if (val) vincularVeiculo(tec.tecnico_nome, val)
                        else desvincularVeiculo(tec.tecnico_nome)
                      }}
                      style={{
                        flex: 1, padding: '6px 10px', borderRadius: 8, fontSize: 12,
                        border: '1px solid #E5E7EB', background: '#fff', color: '#374151',
                        outline: 'none', cursor: 'pointer',
                      }}
                    >
                      <option value="">Vincular veiculo...</option>
                      {veiculos.map(v => (
                        <option key={v.id} value={v.id} disabled={veiculosVinculados.has(v.id) && vinculo?.adesao_id !== v.id}>
                          {v.placa} — {v.descricao || 'Sem descricao'}
                        </option>
                      ))}
                    </select>
                    {gpsLoading && vinculo && <RefreshCw size={13} color="#9CA3AF" className="animate-spin" />}
                  </div>
                </div>

                {/* ── DESTINO BANNER ── */}
                {destinoLabel && (
                  <div style={{
                    padding: '14px 24px', background: cam ? '#FFFBEB' : '#F0F5FF', borderBottom: '1px solid #F3F4F6',
                    display: 'flex', alignItems: 'center', gap: 14,
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, background: cam ? '#FEF3C7' : '#E0E7FF',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      <Navigation size={16} color={cam ? '#D97706' : '#6366F1'} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        {cam ? 'Em transito para' : 'Proximo destino'}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {destinoLabel}
                      </div>
                      {destinoCidade && <div style={{ fontSize: 11, color: '#6B7280', marginTop: 1 }}>{destinoCidade}</div>}
                    </div>
                    {proximoItem && proximoItem.tempo_ida_min > 0 && (
                      <div style={{ textAlign: 'center', flexShrink: 0 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#6366F1', textTransform: 'uppercase' }}>ETA</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#4338CA', fontVariantNumeric: 'tabular-nums' }}>
                          {fh(S + proximoItem.tempo_ida_min)}
                        </div>
                        <div style={{ fontSize: 10, color: '#9CA3AF' }}>{fm(proximoItem.tempo_ida_min)} / {proximoItem.distancia_ida_km}km</div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── GPS COMPARISON PER CLIENT ── */}
                {vinculo && !viagem && !gpsLoading && (
                  <div style={{
                    padding: '14px 24px', background: '#F9FAFB', borderBottom: '1px solid #F3F4F6',
                    display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#9CA3AF',
                  }}>
                    <Activity size={14} color="#D1D5DB" />
                    <span>{vinculo.placa} — Sem dados GPS hoje</span>
                  </div>
                )}

                {vinculo && viagem && (
                  <div style={{ borderBottom: '1px solid #F3F4F6' }}>
                    {/* GPS Header */}
                    <div style={{
                      padding: '12px 24px', background: '#F8FAFF',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      borderBottom: '1px solid #EEF2FF',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: 8, background: '#EEF2FF',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Activity size={14} color="#6366F1" />
                        </div>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#4338CA' }}>Rastreamento GPS</div>
                          <div style={{ fontSize: 10, color: '#9CA3AF' }}>{viagem.placa} — {viagem.posicoes_total} posicoes</div>
                        </div>
                      </div>
                      {viagem.ultima_posicao && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#6B7280',
                          background: viagem.ultima_posicao.ignicao ? '#ECFDF5' : '#F3F4F6',
                          padding: '4px 10px', borderRadius: 6,
                        }}>
                          <span className="vg-status-dot" style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: viagem.ultima_posicao.ignicao ? '#10B981' : '#9CA3AF',
                            display: 'inline-block',
                          }} />
                          {viagem.ultima_posicao.ignicao ? `${viagem.ultima_posicao.velocidade}km/h` : 'Desligado'}
                          <span style={{ color: '#D1D5DB' }}>|</span>
                          {fHora(viagem.ultima_posicao.dt)}
                        </div>
                      )}
                    </div>

                    {/* Per-client comparison cards */}
                    <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {maxVisitas > 0 ? Array.from({ length: maxVisitas }, (_, i) => {
                        const cliente = ext[i] || null
                        const est = estimados[i] || null
                        const gps = visitasGPS[i] || null
                        const clienteNome = cliente ? (cliente.cliente || '').split(' ').slice(0, 4).join(' ') : null
                        const isEmAndamento = gps && gps.saida && !gps.retorno

                        return (
                          <div key={i} className="vg-gps-row" style={{
                            background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB',
                            overflow: 'hidden', animationDelay: `${i * .1}s`,
                          }}>
                            {/* Client header */}
                            <div style={{
                              padding: '10px 16px', background: '#F9FAFB',
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              borderBottom: '1px solid #F3F4F6',
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <MapPin size={13} color={tecColor} />
                                <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>
                                  {clienteNome || `Visita ${i + 1}`}
                                </span>
                                {cliente?.cidade && (
                                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>{cliente.cidade}</span>
                                )}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {isEmAndamento && (
                                  <span style={{
                                    fontSize: 10, fontWeight: 700, color: '#D97706', background: '#FFFBEB',
                                    padding: '2px 8px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 3,
                                  }}>
                                    <Zap size={9} /> Em andamento
                                  </span>
                                )}
                                {cliente?.id_ordem && (
                                  <span style={{
                                    fontSize: 10, fontWeight: 700, color: '#fff',
                                    background: tecColor, padding: '2px 8px', borderRadius: 4,
                                  }}>
                                    {cliente.id_ordem}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Comparison table */}
                            <div style={{ padding: '10px 12px' }}>
                              {/* Column headers */}
                              <div style={{ display: 'grid', gridTemplateColumns: '72px repeat(4, 1fr)', gap: 4, marginBottom: 6 }}>
                                <div />
                                {[
                                  { icon: <LogOut size={10} />, label: 'Saida', color: '#D97706' },
                                  { icon: <MapPin size={10} />, label: 'Chegada', color: '#6366F1' },
                                  { icon: <Truck size={10} />, label: 'Saiu', color: '#0EA5E9' },
                                  { icon: <Home size={10} />, label: 'Retorno', color: '#10B981' },
                                ].map((col, ci) => (
                                  <div key={ci} style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                                    <span style={{ color: col.color }}>{col.icon}</span>
                                    <span style={{ fontSize: 9, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '.04em' }}>{col.label}</span>
                                  </div>
                                ))}
                              </div>

                              {/* Estimated row */}
                              {est && (
                                <div style={{
                                  display: 'grid', gridTemplateColumns: '72px repeat(4, 1fr)', gap: 4, marginBottom: 4,
                                }}>
                                  <div style={{
                                    display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700,
                                    color: '#9CA3AF', padding: '6px 8px',
                                  }}>
                                    <Clock size={10} /> Estimado
                                  </div>
                                  {[
                                    fh(est.saida),
                                    fh(est.chegada),
                                    fh(est.fimServico),
                                    est.retorno ? fh(est.retorno) : '--:--',
                                  ].map((val, ci) => (
                                    <div key={ci} className="vg-time-cell" style={{
                                      textAlign: 'center', padding: '6px 4px', borderRadius: 6,
                                      background: '#F9FAFB', fontSize: 13, fontWeight: 600,
                                      color: val === '--:--' ? '#D1D5DB' : '#6B7280',
                                      fontVariantNumeric: 'tabular-nums',
                                    }}>
                                      {val}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* GPS Real row */}
                              {gps && (
                                <div style={{
                                  display: 'grid', gridTemplateColumns: '72px repeat(4, 1fr)', gap: 4, marginBottom: 4,
                                }}>
                                  <div style={{
                                    display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700,
                                    color: '#4338CA', padding: '6px 8px',
                                  }}>
                                    <Activity size={10} /> GPS
                                  </div>
                                  {[
                                    fHora(gps.saida),
                                    fHora(gps.chegada),
                                    fHora(gps.saidaCliente),
                                    fHora(gps.retorno),
                                  ].map((val, ci) => (
                                    <div key={ci} className="vg-time-cell" style={{
                                      textAlign: 'center', padding: '6px 4px', borderRadius: 6,
                                      background: val === '--:--' ? '#F9FAFB' : '#EEF2FF',
                                      fontSize: 14, fontWeight: 800,
                                      color: val === '--:--' ? '#D1D5DB' : '#111827',
                                      fontVariantNumeric: 'tabular-nums',
                                    }}>
                                      {val}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Diff row */}
                              {est && gps && (
                                <div style={{
                                  display: 'grid', gridTemplateColumns: '72px repeat(4, 1fr)', gap: 4,
                                }}>
                                  <div />
                                  {[
                                    diffLabel(est.saida, gps.saida),
                                    diffLabel(est.chegada, gps.chegada),
                                    diffLabel(est.fimServico, gps.saidaCliente),
                                    est.retorno ? diffLabel(est.retorno, gps.retorno) : null,
                                  ].map((d, ci) => (
                                    <div key={ci} style={{
                                      textAlign: 'center', padding: '3px 4px', borderRadius: 4,
                                      fontSize: 10, fontWeight: 700,
                                      color: d ? d.color : '#D1D5DB',
                                      background: d ? d.bg : 'transparent',
                                    }}>
                                      {d ? d.text : '—'}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* GPS only (no estimates) */}
                              {!est && gps && (
                                <div style={{ fontSize: 10, color: '#9CA3AF', textAlign: 'center', marginTop: 2 }}>
                                  Sem estimativa para comparar
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      }) : (
                        <div style={{ textAlign: 'center', padding: '8px 0', fontSize: 12, color: '#9CA3AF' }}>
                          Nenhuma viagem detectada hoje
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── SERVICOS ── */}
                <div style={{ padding: '16px 20px' }}>
                  {ordsTec.length > 0 ? (
                    <>
                      <div style={{
                        fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase',
                        letterSpacing: '.05em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        <Wrench size={12} /> Servicos em execucao ({ordsTec.length})
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {ordsTec.map(os => {
                          const agendaItem = items.find(a => a.id_ordem === os.Id_Ordem)
                          const solicitacao = extrairSolicitacao(os.Serv_Solicitado || '')
                          return (
                            <div key={os.Id_Ordem} className="vg-os-card" style={{
                              padding: '12px 14px', borderRadius: 10,
                              background: '#FAFBFC', border: '1px solid #F3F4F6',
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{
                                    fontSize: 10, fontWeight: 700, color: '#fff',
                                    background: tecColor, padding: '3px 8px', borderRadius: 5,
                                  }}>
                                    {os.Id_Ordem}
                                  </span>
                                  {os.Tipo_Servico && (
                                    <span style={{ fontSize: 10, color: '#6B7280', background: '#F3F4F6', padding: '2px 7px', borderRadius: 4 }}>
                                      {os.Tipo_Servico}
                                    </span>
                                  )}
                                </div>
                                {os.Qtd_HR && (
                                  <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 3 }}>
                                    <Timer size={11} color="#9CA3AF" /> {os.Qtd_HR}h
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 3 }}>{os.Os_Cliente}</div>
                              <div style={{ fontSize: 11, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <MapPin size={10} />
                                {os.Cidade_Cliente || os.Endereco_Cliente || '—'}
                                {os.Previsao_Execucao && (
                                  <>
                                    <span style={{ color: '#E5E7EB', margin: '0 3px' }}>/</span>
                                    Prev: {new Date(os.Previsao_Execucao + 'T12:00:00').toLocaleDateString('pt-BR')}
                                  </>
                                )}
                              </div>
                              {solicitacao && (
                                <div style={{
                                  fontSize: 11, color: '#6B7280', marginTop: 6, padding: '6px 10px',
                                  background: '#fff', borderRadius: 6, border: '1px solid #F3F4F6', lineHeight: 1.5,
                                }}>
                                  {solicitacao.length > 150 ? solicitacao.substring(0, 150) + '...' : solicitacao}
                                </div>
                              )}
                              {agendaItem && agendaItem.tempo_ida_min > 0 && (
                                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#6B7280' }}>
                                  <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                    <ArrowRight size={10} color="#9CA3AF" /> {fm(agendaItem.tempo_ida_min)} ({agendaItem.distancia_ida_km}km)
                                  </span>
                                  {agendaItem.tempo_volta_min > 0 && (
                                    <>
                                      <span style={{ color: '#E5E7EB' }}>|</span>
                                      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                        <ArrowLeft size={10} color="#9CA3AF" /> {fm(agendaItem.tempo_volta_min)} ({agendaItem.distancia_volta_km}km)
                                      </span>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '24px 0', color: '#D1D5DB' }}>
                      <Briefcase size={24} style={{ marginBottom: 6, opacity: .5 }} />
                      <div style={{ fontSize: 12, fontWeight: 500 }}>Nenhum servico em execucao</div>
                    </div>
                  )}
                </div>

                {/* ── CRONOGRAMA ── */}
                {crono && (
                  <>
                    <button
                      className="vg-crono-btn"
                      onClick={() => setCronoAberto(p => ({ ...p, [tec.tecnico_nome]: !p[tec.tecnico_nome] }))}
                      style={{
                        width: '100%', padding: '10px 0', fontSize: 12, fontWeight: 600, color: '#6B7280',
                        background: '#FAFBFC', border: 'none', borderTop: '1px solid #F3F4F6', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}
                    >
                      <Clock size={12} /> {cronoAberto[tec.tecnico_nome] ? 'Ocultar cronograma' : 'Ver cronograma estimado'}
                      <ChevronDown size={12} style={{ transform: cronoAberto[tec.tecnico_nome] ? 'rotate(180deg)' : 'none', transition: 'transform .25s' }} />
                    </button>
                    {cronoAberto[tec.tecnico_nome] && (
                      <div className="vg-crono-body" style={{ padding: '14px 20px 18px', background: '#FAFBFC', borderTop: '1px solid #F3F4F6' }}>
                        {crono.trechos.map((tr, i) => (
                          <div key={i}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '5px 0' }}>
                              <div style={{
                                width: 26, height: 26, borderRadius: 8,
                                background: tr.tipo === 'proximo_dia' ? '#FEE2E2' : tr.tipo === 'almoco' ? '#FEF3C7' : tr.tipo === 'servico' ? '#EEF2FF' : '#F3F4F6',
                                color: tr.tipo === 'proximo_dia' ? '#DC2626' : tr.tipo === 'almoco' ? '#D97706' : tr.tipo === 'servico' ? '#6366F1' : '#6B7280',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                              }}>
                                {IC[tr.icon]}
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{tr.label}</div>
                                <div style={{ fontSize: 11, color: '#9CA3AF' }}>{tr.sublabel}</div>
                              </div>
                              <div style={{
                                fontSize: tr.tipo === 'retorno' ? 14 : 12, fontWeight: tr.tipo === 'retorno' ? 800 : 600,
                                color: tr.tipo === 'proximo_dia' || tr.tipo === 'retorno' ? '#111827' : '#6B7280',
                                fontVariantNumeric: 'tabular-nums',
                                background: tr.tipo === 'retorno' ? '#E5E7EB' : 'transparent',
                                padding: tr.tipo === 'retorno' ? '3px 10px' : 0, borderRadius: 6,
                              }}>
                                {tr.horaInicio}
                              </div>
                            </div>
                            {i < crono.trechos.length - 1 && <div style={{ marginLeft: 13, borderLeft: '2px dashed #E5E7EB', height: 5 }} />}
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
    </>
  )
}
